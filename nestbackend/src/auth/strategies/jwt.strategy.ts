import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { AppConfigService } from 'src/config';

import { AccessTokenPayload, AuthenticatedUser } from '../auth.types';

/**
 * =============================================================================
 * JwtStrategy - what Passport actually does for you
 * =============================================================================
 * A Passport STRATEGY answers one question: "given this request, who is the
 * caller?" It does NOT decide whether they are allowed in - that is the guard.
 *
 * THE DIVISION OF LABOUR, which is the thing to be able to state cleanly:
 *
 *     Guard     (JwtAuthGuard)  - decides whether the request proceeds
 *     Strategy  (this class)    - extracts + verifies credentials, returns a user
 *     Passport                  - glue: runs the strategy, puts the result on
 *                                 `request.user`
 *
 * WHAT `PassportStrategy(Strategy, 'jwt')` DOES: it is a MIXIN factory. It
 * returns a base class that wires this class into passport-jwt and registers it
 * under the name 'jwt', which is what `AuthGuard('jwt')` later looks up. The
 * name matters - `AuthGuard('jwt-refresh')` would find a different strategy.
 *
 * -----------------------------------------------------------------------------
 * IS PASSPORT WORTH IT? A fair question, and the honest answer is "sometimes".
 * -----------------------------------------------------------------------------
 * For JWT alone, verifying a token by hand is about ten lines and skips a
 * dependency. Passport earns its place when you have SEVERAL mechanisms -
 * local, JWT, refresh, API key, OAuth (Google/GitHub), SAML - because it gives
 * them one shape, one place they attach the user, and 500+ ready-made
 * strategies for the providers you have not integrated yet.
 *
 * We use it here because it is what the ecosystem expects and what interviewers
 * ask about - and because this project has three mechanisms already.
 * =============================================================================
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: AppConfigService) {
    super({
      /**
       * WHERE to find the token. `fromAuthHeaderAsBearerToken` reads
       * `Authorization: Bearer <token>`.
       *
       * WHY THE HEADER FOR THE ACCESS TOKEN, when the refresh token goes in a
       * cookie? Because a token the browser sends AUTOMATICALLY (a cookie) is
       * exposed to CSRF - an attacker's page can trigger a request and the
       * browser attaches the credential. A token JavaScript must attach by hand
       * cannot be sent by a cross-site form.
       *
       * The trade-off is the mirror image: a header token must live somewhere
       * JavaScript can read, so it is exposed to XSS. Hence the split used
       * here: short-lived access token in memory + header, long-lived refresh
       * token in an httpOnly cookie that script cannot touch. Neither storage
       * is safe against everything; the split limits what each compromise costs.
       */
      /**
       * PHASE 11 added the SECOND extractor, and it deserves the warning.
       *
       * The browser EventSource API CANNOT SET HEADERS. There is no
       *  - the spec simply does not have
       * one. So an SSE endpoint has exactly three options for authentication:
       *
       *   a) a COOKIE (sent automatically) - safest, but then the endpoint is
       *      CSRF-exposed and needs SameSite plus the usual care;
       *   b) a QUERY PARAMETER - what we do, with the caveats below;
       *   c) a polyfill / fetch-based EventSource that can set headers - which
       *      means shipping a library and losing native auto-reconnect.
       *
       * WHY A QUERY PARAMETER IS A REAL SECURITY DOWNGRADE, stated plainly:
       *   - It lands in ACCESS LOGS - nginx, the load balancer, the CDN, and
       *     your own request logging. Tokens in logs are credentials in logs.
       *   - It can leak through the  header to third parties.
       *   - It is visible in browser history and in shoulder-surfing range.
       *
       * THE MITIGATIONS THAT MAKE IT ACCEPTABLE:
       *   - The access token is SHORT-LIVED (15 minutes), so a leaked one has a
       *     small window. This is a concrete payoff of the two-token design.
       *   - Only this ONE endpoint is reachable this way in practice.
       *   - In production you would exclude the query string for this path from
       *     access logging, or issue a separate, narrowly-scoped stream token.
       *
       * ORDER MATTERS: the header extractor is FIRST, so a normal API call
       * never falls back to the query string.
       */
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        ExtractJwt.fromUrlQueryParameter('access_token'),
      ]),

      /**
       * FALSE, emphatically. `true` means "accept expired tokens", which
       * removes the only thing that limits the damage of a leaked access token.
       * It exists for niche migration scenarios and is a genuine footgun.
       */
      ignoreExpiration: false,

      secretOrKey: config.jwt.accessSecret,
    });
  }

  /**
   * Called ONLY after the signature and expiry have been verified. So this
   * method's job is not "is the token valid" - it is "turn a valid payload into
   * the user object the rest of the request will see".
   *
   * WHATEVER THIS RETURNS BECOMES `request.user`. Returning `null` or throwing
   * produces a 401.
   *
   * NOTE THERE IS NO DATABASE READ HERE, and that is the entire point of a
   * stateless token: authentication costs a signature verification, not a
   * query. The cost is staleness - a user deleted or demoted 5 minutes ago
   * still has a working token until it expires.
   *
   * WHEN THAT IS NOT ACCEPTABLE, the options, in increasing cost:
   *   - shorten the access TTL (cheap, more refresh traffic)
   *   - keep a small Redis denylist of revoked user ids (one fast read)
   *   - load the user on sensitive routes only (targeted, explicit)
   * "Always read the user from the database" is the answer that throws away the
   * reason you chose JWTs; know why you would still sometimes do it.
   */
  validate(payload: AccessTokenPayload): AuthenticatedUser {
    if (!payload?.sub) throw new UnauthorizedException('Malformed token payload');

    return { id: payload.sub, email: payload.email, role: payload.role };
  }
}
