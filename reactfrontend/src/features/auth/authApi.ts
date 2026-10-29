import { http } from '@/services/httpClient';
import type { AuthResponse, User } from '@/types/api';
import type { LoginFormValues, RegisterPayload } from './authSchemas';

/**
 * =============================================================================
 * THE AUTH API - real calls against the real NestJS backend
 * =============================================================================
 * Thin by design. Each function is one request, typed at both ends.
 *
 * WHY A MODULE OF FUNCTIONS RATHER THAN A CLASS: there is no state to hold and
 * nothing to inject. A `class AuthService` with only static methods is a
 * namespace wearing a costume - and in React, tests intercept at the NETWORK
 * layer (MSW) rather than swapping an implementation, so there is no
 * testability argument for the indirection either.
 *
 * ANGULAR BRIDGE: this is an `@Injectable()` HTTP service, minus the DI. Where
 * Angular would inject it, we import it - or, better, pass it in as a prop, as
 * LoginForm and RegisterForm do, so the components stay independent of it.
 *
 * PHASE 20 REPLACES MOST OF THIS with RTK Query, which adds caching, request
 * deduplication and automatic loading/error state. Auth mutations are the part
 * that stays closest to this shape, because they are commands rather than
 * cached reads.
 * =============================================================================
 */

export const authApi = {
  /**
   * POST /api/v1/auth/register -> 201
   *
   * The response is `{ user, accessToken, expiresIn }`. NO refreshToken - the
   * controller sets it as an httpOnly cookie scoped to /api/v1/auth and
   * deliberately drops it from the body. See the long note in types/api.ts;
   * this was verified against the running server rather than assumed.
   */
  register: (payload: RegisterPayload) => http.post<AuthResponse>('/auth/register', payload, { skipAuthRetry: true }),

  /**
   * POST /api/v1/auth/login -> 200, not 201.
   *
   * The backend uses `@HttpCode(HttpStatus.OK)` because a login creates no
   * resource - its comment says "201 would be a lie". Our client does not care,
   * but it is the kind of detail worth noticing in a code review.
   */
  login: (values: LoginFormValues) => http.post<AuthResponse>('/auth/login', values, { skipAuthRetry: true }),

  /**
   * POST /api/v1/auth/refresh -> 200
   *
   * NO BODY. The refresh token travels as the httpOnly cookie, which
   * `credentials: 'include'` attaches automatically. The endpoint accepts a
   * body token as well, for non-browser clients - we deliberately do not use
   * that path, because putting the refresh token anywhere JavaScript can read
   * it undoes the reason it is httpOnly.
   *
   * The backend rotates the token and revokes the whole family on reuse, so a
   * stolen-and-replayed token invalidates the session rather than granting one.
   * Phase 10 builds the single-flight interceptor around this.
   */
  refresh: () => http.post<AuthResponse>('/auth/refresh', undefined, { skipAuthRetry: true }),

  /**
   * POST /api/v1/auth/logout -> 204 No Content.
   *
   * `http.post<void>` because there is no body. Our client returns early on
   * 204 rather than calling `.json()` on an empty response, which would throw
   * a SyntaxError - see httpClient.
   */
  logout: () => http.post<void>('/auth/logout'),

  /** GET /api/v1/auth/me -> the current user. Used to restore a session. */
  me: () => http.get<User>('/auth/me'),
};
