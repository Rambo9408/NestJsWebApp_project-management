import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';

export const CSRF_PROTECTED_KEY = 'taskflow:csrfProtected';

/** Mark a route as requiring the double-submit CSRF token. */
export const CsrfProtected = () => SetMetadata(CSRF_PROTECTED_KEY, true);

export const CSRF_COOKIE = 'taskflow_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/**
 * =============================================================================
 * CsrfGuard - and, more usefully, WHEN CSRF APPLIES AT ALL
 * =============================================================================
 * This is one of the most misunderstood topics in web security, and the useful
 * answer starts with when it is NOT a risk.
 *
 * CSRF EXISTS BECAUSE BROWSERS ATTACH COOKIES AUTOMATICALLY. An attacker's page
 * can make your browser issue a request to our API, and the browser helpfully
 * includes the session cookie - so the request is authenticated even though the
 * attacker never saw the credential.
 *
 * THEREFORE:
 *
 *   ✗ NOT VULNERABLE: an API authenticated purely by `Authorization: Bearer`.
 *     The browser does not attach that header by itself; JavaScript must, and
 *     the same-origin policy stops an attacker's script from reading or
 *     scripting our origin. **Most of this API is in this category.**
 *
 *   ✓ VULNERABLE: any endpoint that authenticates using a COOKIE. In this
 *     project that is exactly two - `POST /auth/refresh` and `POST /auth/logout`
 *     - because the refresh token is deliberately an httpOnly cookie (Phase 7).
 *
 * So the honest answer to "do you protect against CSRF?" is not yes or no - it
 * is "on the endpoints where a credential is sent automatically, and here is
 * why the rest do not need it". That answer is worth more in an interview than
 * bolting `csurf` onto everything.
 *
 * -----------------------------------------------------------------------------
 * DEFENCE IN DEPTH: `SameSite` FIRST, TOKEN SECOND
 * -----------------------------------------------------------------------------
 * The refresh cookie is already `SameSite=strict`, which instructs the browser
 * never to send it on a cross-site request. In a modern browser that alone
 * defeats CSRF.
 *
 * SO WHY THIS GUARD TOO? Because `SameSite` is enforced by the CLIENT:
 *   - Old browsers ignore it entirely.
 *   - `SameSite=none` becomes necessary the moment the API and the frontend are
 *     on different sites - and then the protection is gone, silently, from a
 *     config change made for an unrelated reason.
 *   - Some proxies and embedded webviews behave inconsistently.
 *
 * A server-enforced check does not depend on the client cooperating. Two
 * independent mechanisms, one of which is under our control.
 *
 * -----------------------------------------------------------------------------
 * THE DOUBLE-SUBMIT COOKIE PATTERN
 * -----------------------------------------------------------------------------
 *   1. The server sets a random token in a NON-httpOnly cookie.
 *   2. JavaScript on our origin reads it and echoes it in a request HEADER.
 *   3. The server requires cookie and header to match.
 *
 * WHY IT WORKS: an attacker's page can CAUSE the cookie to be sent (that is the
 * whole problem) but cannot READ it, because the same-origin policy blocks
 * cross-origin cookie access. Without the value, it cannot set the header.
 *
 * NOTE THE COOKIE IS DELIBERATELY NOT httpOnly - the opposite of the refresh
 * cookie. That looks wrong until you see why: this token is not a credential.
 * It carries no authority; it only proves the request came from a page that
 * could read our origin. Making it httpOnly would break the pattern, because
 * our own JavaScript could not read it either.
 *
 * ITS KNOWN WEAKNESS: an attacker with a subdomain XSS can often set cookies on
 * the parent domain, which lets them forge a matching pair. The stronger
 * variant is the SIGNED double-submit (HMAC the token with a server secret and
 * the session id), or the synchroniser-token pattern with server-side state.
 * `csurf` is deprecated and unmaintained, which is why this is 40 lines of our
 * own rather than a dependency.
 * =============================================================================
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const protectedRoute = this.reflector.getAllAndOverride<boolean>(CSRF_PROTECTED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // OPT-IN, not deny-by-default - the opposite of the auth guard, and
    // deliberately so: applying CSRF to bearer-authenticated endpoints would be
    // ceremony that protects nothing and breaks every non-browser client.
    if (!protectedRoute) return true;

    const request = context.switchToHttp().getRequest<Request>();

    /**
     * SAFE METHODS ARE EXEMPT. GET/HEAD/OPTIONS must not change state, so there
     * is nothing to forge - and requiring a token on them would break ordinary
     * navigation.
     *
     * The corollary is a rule worth stating: if a GET in your API changes
     * state, CSRF is the least of your problems. Browsers, proxies and link
     * prefetchers will trigger it for you.
     */
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;

    const cookies = request.cookies as Record<string, string> | undefined;
    const fromCookie = cookies?.[CSRF_COOKIE];
    const fromHeader = request.headers[CSRF_HEADER];

    if (!fromCookie || typeof fromHeader !== 'string') {
      throw new ForbiddenException('Missing CSRF token');
    }

    /**
     * CONSTANT-TIME COMPARISON. `===` on a secret leaks, through timing, how
     * many leading characters matched - which over enough samples is enough to
     * reconstruct the value.
     *
     * `timingSafeEqual` throws when the lengths differ, so the length check
     * comes first. (The lengths themselves are not secret: both are ours.)
     */
    const cookieBuffer = Buffer.from(fromCookie);
    const headerBuffer = Buffer.from(fromHeader);

    if (
      cookieBuffer.length !== headerBuffer.length ||
      !timingSafeEqual(cookieBuffer, headerBuffer)
    ) {
      throw new ForbiddenException('Invalid CSRF token');
    }

    return true;
  }
}

/**
 * Issue a fresh CSRF token and set the readable cookie.
 *
 * Called wherever a session begins (login, register, refresh), so the client
 * always has a current value to echo.
 */
export function issueCsrfToken(response: Response, secure: boolean): string {
  const token = randomBytes(32).toString('base64url');

  response.cookie(CSRF_COOKIE, token, {
    // NOT httpOnly - see the long note above. This token is not a credential.
    httpOnly: false,
    secure,
    sameSite: 'strict',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  return token;
}
