import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Observable } from 'rxjs';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * =============================================================================
 * JwtAuthGuard - the GLOBAL guard, with an opt-out
 * =============================================================================
 * 1. WHAT IS A GUARD?
 * A class implementing `CanActivate` with one method:
 *
 *     canActivate(context): boolean | Promise<boolean> | Observable<boolean>
 *
 * Return `true` and the request proceeds; return `false` and Nest throws 403;
 * throw an exception and that exception is used instead (which is how this one
 * produces 401 rather than 403).
 *
 * 2. WHERE GUARDS SIT
 *
 *     middleware -> GUARDS -> interceptors(pre) -> pipes -> handler
 *
 * Guards run BEFORE pipes. That ordering is deliberate: an unauthenticated
 * caller is rejected before you spend CPU validating their body, and a
 * validation error can never leak field names to someone not allowed in.
 *
 * 3. GUARD vs MIDDLEWARE - the interview question
 * Express middleware could do this. What a guard has that middleware does not:
 *   - `ExecutionContext`, so the same guard works for HTTP, WebSocket and
 *     microservice transports (`switchToHttp()` / `switchToWs()`).
 *   - `Reflector`, so it can read ROUTE METADATA - which is what makes
 *     `@Public()` and `@Roles()` possible. Express middleware has no idea which
 *     handler it is about to run, so you would have to invent your own
 *     registry.
 *   - Dependency injection.
 *   - It runs AFTER routing, so it knows the route was matched at all.
 *
 * 4. WHY THIS ONE IS GLOBAL - deny by default
 * Registered with `APP_GUARD` in `auth.module.ts`, so EVERY route is protected
 * and routes opt out with `@Public()`.
 *
 * The alternative - `@UseGuards(JwtAuthGuard)` per route - is allow-by-default,
 * and it fails in the worst direction: the day someone adds an endpoint and
 * forgets the decorator, it is silently open to the internet and works
 * perfectly. With deny-by-default, forgetting produces a 401 in the first test
 * run. **Fail closed, not open.**
 * =============================================================================
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  /**
   * `Reflector` is the service that reads metadata written by `SetMetadata`.
   * It is injectable, which is exactly why this guard must be registered via
   * `APP_GUARD` (a provider) rather than `app.useGlobalGuards(new JwtAuthGuard())`
   * (constructed by hand, outside the container, with nothing to inject).
   */
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    /**
     * `getAllAndOverride` checks the HANDLER first, then the CONTROLLER class,
     * and returns the first value found - so a method-level `@Public()`
     * overrides a class-level setting.
     *
     * The alternatives are worth knowing because choosing wrong is a real bug:
     *   getAllAndOverride  - most specific wins          (flags: @Public, @Roles)
     *   getAllAndMerge     - concatenates both levels    (accumulating lists)
     *   get                - one target only
     */
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Skip authentication entirely. NOTE: `request.user` will be undefined on
    // these routes, which is why `@CurrentUser()` returns undefined there -
    // handlers must not assume it exists on a public route.
    if (isPublic) return true;

    // Delegate to Passport: run the 'jwt' strategy, populate `request.user`.
    return super.canActivate(context);
  }
}
