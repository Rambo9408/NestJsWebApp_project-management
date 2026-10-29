import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AuthenticatedUser } from 'src/auth/auth.types';

import { Role } from '../enums/role.enum';
import { RolesGuard } from './roles.guard';

/**
 * =============================================================================
 * UNIT-TESTING A GUARD
 * =============================================================================
 * A guard is a class with one method. It needs no HTTP server, no container and
 * no database - just an `ExecutionContext` shaped enough for what it reads.
 *
 * THE FAKE CONTEXT IS THE WHOLE TECHNIQUE, and it is worth internalising
 * because it applies to interceptors and filters too. `ExecutionContext` is an
 * interface; a guard typically uses three of its members, so a test supplies
 * those three and nothing else.
 *
 * WHY THIS MATTERS: authorization logic tested only through e2e tests is
 * expensive to run and awkward to exercise exhaustively. Every branch here -
 * no metadata, no user, wrong role, right role - is one cheap assertion.
 * =============================================================================
 */
describe('RolesGuard', () => {
  /**
   * A minimal ExecutionContext. `getHandler` and `getClass` only need to return
   * something stable for `Reflector` to key on; `switchToHttp().getRequest()`
   * returns whatever the guard reads.
   */
  const contextFor = (user?: AuthenticatedUser): ExecutionContext =>
    ({
      getHandler: () => handlerMarker,
      getClass: () => classMarker,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  const handlerMarker = function handler() {};
  const classMarker = class Controller {};

  /** A Reflector that returns whatever the test wants for ROLES_KEY. */
  const reflectorReturning = (roles: Role[] | undefined): Reflector =>
    ({ getAllAndOverride: () => roles }) as unknown as Reflector;

  const member: AuthenticatedUser = { id: 'u1', email: 'm@example.com', role: Role.MEMBER };
  const admin: AuthenticatedUser = { id: 'u2', email: 'a@example.com', role: Role.ADMIN };

  it('ALLOWS a route with no @Roles() metadata', () => {
    /**
     * Allow-by-default for AUTHORIZATION, which looks like it contradicts the
     * deny-by-default of authentication - and does not. "No @Roles() means
     * nobody" would 403 every ordinary endpoint until decorated, and the
     * practical result is `@Roles(ADMIN, MANAGER, MEMBER)` everywhere: noise
     * that means nothing and hides the routes where the policy is real.
     *
     * The security floor is that the caller is AUTHENTICATED (the global JWT
     * guard). Role checks narrow from there.
     */
    const guard = new RolesGuard(reflectorReturning(undefined));
    expect(guard.canActivate(contextFor(member))).toBe(true);
  });

  it('ALLOWS a route with an empty @Roles() list', () => {
    const guard = new RolesGuard(reflectorReturning([]));
    expect(guard.canActivate(contextFor(member))).toBe(true);
  });

  it('ALLOWS a user whose role is in the list', () => {
    const guard = new RolesGuard(reflectorReturning([Role.ADMIN, Role.MANAGER]));
    expect(guard.canActivate(contextFor(admin))).toBe(true);
  });

  it('DENIES a user whose role is not', () => {
    const guard = new RolesGuard(reflectorReturning([Role.ADMIN]));

    // ForbiddenException -> 403, not 401. The caller IS authenticated; they are
    // simply not allowed, and a client must not retry.
    expect(() => guard.canActivate(contextFor(member))).toThrow(ForbiddenException);
  });

  it('names the REQUIREMENT but not the caller’s actual role', () => {
    const guard = new RolesGuard(reflectorReturning([Role.ADMIN]));

    try {
      guard.canActivate(contextFor(member));
      throw new Error('expected the guard to throw');
    } catch (error) {
      const message = (error as ForbiddenException).message;

      expect(message).toContain('admin');
      // Telling someone "you are a MEMBER" is mild information disclosure, and
      // the client cannot act on it anyway - it is the server's decision.
      expect(message).not.toContain('member');
    }
  });

  it('FAILS CLOSED when @Roles() is present but nobody is authenticated', () => {
    /**
     * This state means someone combined `@Public()` with `@Roles()`, which is a
     * contradiction. The guard refuses rather than letting the request through -
     * the safe direction to be wrong in.
     */
    const guard = new RolesGuard(reflectorReturning([Role.ADMIN]));
    expect(() => guard.canActivate(contextFor(undefined))).toThrow(ForbiddenException);
  });
});
