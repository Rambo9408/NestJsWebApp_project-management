import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { AuthenticatedUser } from 'src/auth/auth.types';

import { ROLES_KEY } from '../decorators/roles.decorator';
import { Role } from '../enums/role.enum';

/**
 * =============================================================================
 * RolesGuard - AUTHORIZATION, as distinct from authentication
 * =============================================================================
 * AUTHENTICATION (Phase 7) answers "WHO are you?" and fails with **401**.
 * AUTHORIZATION (this) answers "may you do THIS?" and fails with **403**.
 *
 * The status codes are not interchangeable and the difference is behavioural: a
 * client seeing 401 should try to refresh its token and retry; a client seeing
 * 403 must not retry, because nothing about the request will change the answer.
 * Returning 401 for an authorization failure sends clients into a refresh loop.
 *
 * ORDER: this guard is registered AFTER `JwtAuthGuard` in `auth.module.ts`, and
 * that ordering is load-bearing. Multiple `APP_GUARD` providers run in
 * REGISTRATION ORDER, and this one reads `request.user` - which only exists
 * because the JWT guard already ran and populated it. Register them the other
 * way round and every protected route 403s with `user` undefined.
 *
 * -----------------------------------------------------------------------------
 * NOTE ON `common/` PLACEMENT
 * -----------------------------------------------------------------------------
 * This file imports a TYPE from `src/auth`, which brushes against the rule that
 * `common/` must not depend on features. It is `import type` - erased at
 * compile time, so there is no runtime dependency and no module-graph edge.
 *
 * The alternative is to move `AuthenticatedUser` into `common/`, which is
 * arguably more correct and is what I would do if a second such import
 * appeared. Worth flagging rather than silently bending the rule: architecture
 * rules are only useful if you notice when you are near the edge of one.
 * =============================================================================
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    /**
     * `getAllAndOverride` - the handler wins over the class, so a method can
     * relax or tighten a controller-wide `@Roles()`.
     *
     * Choosing the wrong Reflector method is a real bug:
     *   getAllAndOverride  most specific wins        <- flags and policies
     *   getAllAndMerge     concatenates both levels  <- accumulating lists
     * With `merge`, a controller-level `@Roles(ADMIN)` plus a method-level
     * `@Roles(MEMBER)` would allow BOTH - quietly widening access, which is the
     * dangerous direction to be wrong in.
     */
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    /**
     * NO `@Roles()` ON THE ROUTE -> ALLOW.
     *
     * This is deliberately allow-by-default, which looks like it contradicts
     * the deny-by-default posture of `JwtAuthGuard`. It does not, and the
     * distinction matters:
     *
     *   AUTHENTICATION is deny-by-default: a route with no opinion must still
     *   require a valid token, because "anyone at all" is almost never right.
     *
     *   AUTHORIZATION cannot be deny-by-default without a policy for every
     *   route. "No @Roles() means nobody" would make every ordinary endpoint
     *   403 until decorated, and the practical result is people decorating
     *   everything with @Roles(ADMIN, MANAGER, MEMBER) - noise that means
     *   nothing and hides the routes where the policy is real.
     *
     * The security floor is that the caller is AUTHENTICATED. Role checks
     * narrow from there.
     */
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;

    /**
     * Defensive: a `@Roles()` route with no authenticated user means somebody
     * combined `@Public()` and `@Roles()`, which is a contradiction. Fail
     * closed and say so, rather than letting the request through.
     */
    if (!user) {
      throw new ForbiddenException('Authentication is required for this resource');
    }

    if (!required.includes(user.role)) {
      /**
       * The message names the requirement but not the caller's actual role.
       * Telling someone "you are a MEMBER" is mild information disclosure, and
       * the client cannot act on it anyway - it is the server's decision.
       */
      throw new ForbiddenException(
        `This action requires one of the following roles: ${required.join(', ')}`,
      );
    }

    return true;
  }
}

/**
 * =============================================================================
 * WHEN ROLES ARE NOT ENOUGH - the honest limits of RBAC
 * =============================================================================
 * This guard answers "is this user a MANAGER?". Real systems need "is this user
 * a manager OF THIS PROJECT?" - a question about the RESOURCE, which a global
 * role cannot answer. That is `ProjectAccessGuard` (Phase 8, in `projects/`),
 * and it is the half most implementations hand-wave.
 *
 * THE PROGRESSION worth being able to describe:
 *
 *   1. RBAC          role -> allowed actions.
 *                    Simple, cacheable in a token, no database read.
 *                    Breaks as soon as access depends on WHICH resource.
 *
 *   2. RBAC + ownership/membership (what this project does)
 *                    Global role for coarse policy, per-resource membership for
 *                    the rest. Covers the vast majority of real applications.
 *
 *   3. PBAC (permissions/claims)
 *                    `@RequirePermission('task:delete')`. Roles become bundles
 *                    of permissions, so adding a role does not mean editing
 *                    every guard. Worth it once roles start multiplying.
 *
 *   4. ABAC / policy engines (OPA, Cedar, CASL)
 *                    Rules over attributes: "a manager may delete a task in a
 *                    project they own, during business hours, if it is not
 *                    archived". Powerful, and a large operational commitment.
 *
 * The senior answer to "how would you do authorization?" is not to name the
 * most sophisticated option - it is to say which of these the system needs and
 * why, and to note that moving up the list is easy if the checks live in guards
 * rather than scattered through handlers.
 * =============================================================================
 */
