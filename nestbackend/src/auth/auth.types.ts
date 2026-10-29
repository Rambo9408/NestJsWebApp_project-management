import { Role } from 'src/common/enums/role.enum';

/**
 * =============================================================================
 * The shapes that travel through the auth flow
 * =============================================================================
 */

/**
 * The ACCESS token payload.
 *
 * `sub` (subject) is the registered JWT claim for "who this token is about" -
 * use it rather than inventing `userId`, because every JWT library and every
 * gateway already understands it.
 *
 * WHAT TO PUT IN A JWT, and what not to:
 *   - It is SIGNED, not ENCRYPTED. Anyone holding the token can base64-decode
 *     the payload and read it. Never put anything secret in it. (jwt.io will
 *     happily show it to you, which is a useful thing to demonstrate in an
 *     interview.)
 *   - Keep it SMALL. It is sent on every request, so every claim is bytes on
 *     the wire forever.
 *   - Include only what you need to authorise WITHOUT a database read - that is
 *     the entire point of a stateless token. Here: the user id and the role.
 *
 * THE COST OF PUTTING `role` IN THE TOKEN, stated honestly: it is a snapshot.
 * Demote an admin and their existing access token still says `admin` until it
 * expires. With a 15-minute TTL that window is usually acceptable; when it is
 * not, you either shorten the TTL, check a "permissions changed at" timestamp,
 * or read the role from the database on sensitive routes. Knowing that this is
 * a deliberate staleness trade-off - rather than assuming the token is truth -
 * is what separates a considered answer from a copied one.
 */
export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: Role;

  // Added by @nestjs/jwt when signing; present when verifying.
  iat?: number;
  exp?: number;
}

/**
 * The REFRESH token payload.
 *
 * `jti` (JWT ID) is what links this token to its stored row, and `family` is
 * what makes reuse detection possible. Note it deliberately carries NO role and
 * NO email: a refresh token's only job is to prove "this session is still
 * valid", and any claim it carried would be stale by definition.
 */
export interface RefreshTokenPayload {
  sub: string;
  jti: string;
  family: string;
  iat?: number;
  exp?: number;
}

/**
 * What `request.user` holds once a guard has run - the object every controller
 * and every downstream guard reads.
 *
 * Deliberately MINIMAL. It is tempting to attach the whole user document, and
 * that quietly turns every authenticated request into a database read, undoing
 * the reason for using JWTs. If a handler needs more than this, it should ask
 * `UsersService` explicitly, so the cost is visible at the call site.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the ACCESS token expires - clients use it to pre-emptively refresh. */
  expiresIn: number;
}
