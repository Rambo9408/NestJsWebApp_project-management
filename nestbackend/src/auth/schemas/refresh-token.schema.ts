import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import { baseSchemaOptions } from 'src/database/schema.helpers';

/**
 * =============================================================================
 * RefreshToken - the piece that makes JWT auth revocable
 * =============================================================================
 * ACCESS tokens are stateless by design: the server verifies a signature and
 * asks no database. That is what makes JWT scale, and it is also its one hard
 * limitation - **you cannot revoke a stateless token**. A stolen access token
 * is valid until it expires, full stop.
 *
 * The standard answer is two tokens with different properties:
 *
 *   ACCESS   short-lived (15m), stateless, sent on EVERY request
 *            -> cannot be revoked, so it must expire fast
 *   REFRESH  long-lived (7d), STORED here, sent RARELY (only to /auth/refresh)
 *            -> can be revoked, because we have a row to delete
 *
 * So "logout" means: delete the refresh token row, and wait at most 15 minutes
 * for the access token to die. If you need instant revocation of access tokens
 * too, you need a denylist checked on every request - which reintroduces the
 * database read that JWT was meant to avoid. That trade-off is the answer to
 * "how do you log a user out immediately?", and the honest version includes
 * "and here is what it costs".
 * =============================================================================
 */
@Schema({ ...baseSchemaOptions, collection: 'refresh_tokens' })
export class RefreshToken {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  /**
   * A SHA-256 hash of the token, never the token itself.
   *
   * WHY HASH AT ALL? Because a database dump would otherwise be a set of
   * ready-to-use credentials. Same reasoning as password hashes.
   *
   * WHY SHA-256 AND NOT BCRYPT? This is the question interviewers like, and the
   * answer is about ENTROPY, not laziness:
   *
   *   - A password is low-entropy and human-chosen, so an attacker with the
   *     hash can guess it. Bcrypt's slowness is what makes guessing expensive.
   *   - A refresh token is a 256-bit random value we generated. There is
   *     nothing to guess: brute-forcing it is computationally impossible
   *     regardless of hash speed.
   *
   * And there is a practical reason too: we must LOOK THE TOKEN UP. Bcrypt
   * embeds a random salt, so the same input hashes differently every time and
   * cannot be used as a lookup key - you would have to fetch every token for a
   * user and compare one by one.
   *
   * Fast hash for high-entropy secrets, slow hash for human-chosen ones.
   */
  @Prop({ required: true, unique: true })
  tokenHash: string;

  /**
   * The token FAMILY - all tokens descended from one login.
   *
   * This is what makes REUSE DETECTION possible. Rotation means each refresh
   * issues a new token and revokes the old one. If a REVOKED token is ever
   * presented again, exactly one of two things happened:
   *
   *   1. a legitimate client retried after a network failure, or
   *   2. someone stole the token, and now both the thief and the real user are
   *      refreshing with it.
   *
   * You cannot tell which, so you assume the worst and kill the whole family -
   * every descendant of that login. The real user is forced to log in again;
   * the thief gets nothing. This is the recommendation in OAuth 2.0 Security
   * Best Current Practice, and implementing it is a strong senior signal
   * because most JWT tutorials stop at "rotate the token".
   */
  @Prop({ required: true, index: true })
  family: string;

  /**
   * Set when this token is rotated or revoked. A revoked-but-present token is
   * the signal reuse detection looks for, which is why rows are kept until they
   * expire rather than deleted on rotation.
   */
  @Prop({ type: Date, default: null })
  revokedAt: Date | null;

  /**
   * A TTL INDEX is declared on this field below. MongoDB deletes the document
   * once `expiresAt` passes, so expired tokens clean themselves up.
   *
   * Without it this collection grows forever - one row per login per device,
   * for the life of the product. "Which collection is 400GB?" is a real
   * production question, and the answer is usually sessions or logs with no
   * expiry policy.
   */
  @Prop({ type: Date, required: true })
  expiresAt: Date;

  /** Diagnostic context: helps a user recognise "a session I do not know". */
  @Prop({ default: '' })
  userAgent: string;

  @Prop({ default: '' })
  ip: string;

  createdAt: Date;
  updatedAt: Date;
}

export type RefreshTokenDocument = HydratedDocument<RefreshToken>;

export const RefreshTokenSchema = SchemaFactory.createForClass(RefreshToken);

/**
 * THE TTL INDEX.
 *
 * `expireAfterSeconds: 0` means "delete this document when the DATE IN THE
 * FIELD is reached" - as opposed to a positive value, which means "delete it N
 * seconds after that date". Getting this backwards is a common mistake.
 *
 * Two caveats worth knowing, because they surprise people:
 *   - The background remover runs about once a MINUTE, so deletion is
 *     approximate. Never rely on a TTL index for security timing; always check
 *     `expiresAt` in code as well (we do).
 *   - The field must be a `Date` (or an array of them). A number or an ISO
 *     string is silently never expired.
 */
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/** "All live sessions for this user" - the logout-everywhere query. */
RefreshTokenSchema.index({ userId: 1, revokedAt: 1 });
