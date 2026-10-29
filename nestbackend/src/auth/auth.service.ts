import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash, randomUUID } from 'node:crypto';

import { PASSWORD_HASHER } from 'src/common/constants';
import { Role } from 'src/common/enums/role.enum';
import { AppConfigService } from 'src/config';
import { toObjectId } from 'src/database/schema.helpers';
import { PasswordHasher } from 'src/users/hashing/password-hasher.interface';
import { PublicUser, toPublicUser } from 'src/users/entities/user.entity';
import { UsersService } from 'src/users/users.service';

import {
  AccessTokenPayload,
  AuthenticatedUser,
  RefreshTokenPayload,
  TokenPair,
} from './auth.types';
import { ChangePasswordDto, LoginDto, RegisterDto } from './dto/auth.dto';
import { RefreshToken, RefreshTokenDocument } from './schemas/refresh-token.schema';

/** Context captured with each session so a user can recognise their devices. */
export interface SessionContext {
  userAgent?: string;
  ip?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: AppConfigService,
    @Inject(PASSWORD_HASHER) private readonly passwordHasher: PasswordHasher,
    @InjectModel(RefreshToken.name)
    private readonly refreshTokenModel: Model<RefreshTokenDocument>,
  ) {}

  /**
   * ===========================================================================
   * REGISTER
   * ===========================================================================
   * `RegisterDto` cannot carry a role (it is `OmitType(CreateUserDto, ['role'])`),
   * and we ALSO force `Role.MEMBER` here. Belt and braces on purpose: the DTO
   * protects the HTTP boundary, this line protects the method if it is ever
   * called from somewhere else - a seed script, a queue consumer, a future
   * admin import.
   *
   * Defence in depth is not paranoia when the failure mode is "anyone can
   * become an administrator".
   */
  async register(
    dto: RegisterDto,
    context: SessionContext = {},
  ): Promise<TokenPair & { user: PublicUser }> {
    const user = await this.usersService.create({ ...dto, role: Role.MEMBER });

    const tokens = await this.issueTokens(
      { id: user.id, email: user.email, role: user.role },
      randomUUID(),
      context,
    );

    this.logger.log(`User registered: ${user.id}`);
    return { ...tokens, user };
  }

  /**
   * ===========================================================================
   * VALIDATE CREDENTIALS - called by the Passport LocalStrategy
   * ===========================================================================
   * THE TIMING-ATTACK DETAIL, which is the interesting part of this method.
   *
   * The naive implementation returns early when the email is unknown:
   *
   *     const user = await findByEmail(email);
   *     if (!user) return null;                 // fast  - ~2ms
   *     return compare(password, user.hash);    // slow  - ~250ms
   *
   * The response time now tells an attacker whether an account exists. That is
   * USER ENUMERATION, and it matters: knowing which emails are registered turns
   * a credential-stuffing list from a guess into a target list, and it leaks
   * membership of whatever your product implies about people.
   *
   * The fix is to do the same work either way - hash against a dummy value when
   * the user is absent, so both paths cost the same. Then return the SAME
   * message for both failures ("Invalid email or password"), so the response
   * body does not leak what the timing no longer does.
   */
  async validateCredentials(email: string, password: string): Promise<AuthenticatedUser | null> {
    const user = await this.usersService.findByEmailWithSecrets(email);

    if (!user) {
      // Burn equivalent CPU so an absent user is indistinguishable from a wrong
      // password. The result is discarded; only the elapsed time matters.
      await this.passwordHasher.compare(password, DUMMY_HASH);
      return null;
    }

    const valid = await this.passwordHasher.compare(password, user.passwordHash);
    if (!valid) return null;

    return { id: user.id, email: user.email, role: user.role };
  }

  async login(
    dto: LoginDto,
    context: SessionContext = {},
  ): Promise<TokenPair & { user: PublicUser }> {
    const authenticated = await this.validateCredentials(dto.email, dto.password);

    // ONE message for both "no such user" and "wrong password". See above.
    if (!authenticated) throw new UnauthorizedException('Invalid email or password');

    const tokens = await this.issueTokens(authenticated, randomUUID(), context);
    const user = await this.usersService.findById(authenticated.id);

    return { ...tokens, user };
  }

  /**
   * ===========================================================================
   * REFRESH - rotation with REUSE DETECTION
   * ===========================================================================
   * The flow, and why each step exists:
   *
   *   1. Verify the JWT signature and expiry.        - is this our token at all?
   *   2. Look up the stored row by hash.             - has it been revoked?
   *   3. If the row is REVOKED -> reuse detected.    - kill the whole family
   *   4. Revoke this token, issue a new one in the same family.
   *
   * STEP 3 IS THE PART MOST IMPLEMENTATIONS SKIP. Rotation alone means a stolen
   * token stops working as soon as the real user refreshes - but the thief may
   * refresh first, and then the REAL user's token is the one that fails, with
   * no signal that anything happened.
   *
   * With reuse detection, the second use of a rotated token is treated as
   * evidence of theft and the entire session family is destroyed. You cannot
   * tell victim from thief, so you log both out. That is the OAuth 2.0 Security
   * BCP recommendation.
   *
   * THE HONEST CAVEAT: a legitimate client that retries after a network timeout
   * can trigger a false positive and be logged out. Mitigations are a short
   * grace window on the immediately-previous token, or client-side
   * de-duplication of concurrent refreshes. Both trade a little security for a
   * lot fewer support tickets - and knowing that trade-off exists is the point.
   */
  async refresh(rawToken: string, context: SessionContext = {}): Promise<TokenPair> {
    let payload: RefreshTokenPayload;

    try {
      payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(rawToken, {
        secret: this.config.jwt.refreshSecret,
      });
    } catch {
      // Signature invalid, malformed, or expired. Nothing to look up.
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokenHash = hashToken(rawToken);
    const stored = await this.refreshTokenModel.findOne({ tokenHash }).exec();

    if (!stored) {
      /**
       * A validly-SIGNED token with no stored row. Either it was already
       * cleaned up by the TTL index, or the whole family was revoked by an
       * earlier reuse detection. Either way: refuse, and revoke the family
       * again in case this is an ongoing attack.
       */
      await this.revokeFamily(payload.family, 'unknown token presented');
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (stored.revokedAt) {
      // REUSE DETECTED.
      this.logger.warn(
        `Refresh token reuse detected for user ${String(stored.userId)} - revoking family ${stored.family}`,
      );
      await this.revokeFamily(stored.family, 'reuse detected');
      throw new ForbiddenException('Refresh token reuse detected; all sessions have been revoked');
    }

    if (stored.expiresAt.getTime() < Date.now()) {
      // Checked in CODE as well as by the TTL index, because the TTL remover
      // only runs about once a minute - never rely on it for security timing.
      throw new UnauthorizedException('Refresh token expired');
    }

    const user = await this.usersService.findById(String(stored.userId));

    // Rotate: this token is spent the moment it is used.
    stored.revokedAt = new Date();
    await stored.save();

    return this.issueTokens(
      { id: user.id, email: user.email, role: user.role },
      stored.family, // same family - so reuse detection can still see the lineage
      context,
    );
  }

  /**
   * LOGOUT - revoke ONE session (this device).
   *
   * Deliberately does not throw when the token is unknown: logging out
   * something that is already logged out is success, not an error. An
   * idempotent logout also means a client can safely retry it, which matters
   * because logout is exactly the request people fire and navigate away from.
   */
  async logout(rawToken?: string): Promise<void> {
    if (!rawToken) return;

    await this.refreshTokenModel
      .updateOne(
        { tokenHash: hashToken(rawToken), revokedAt: null },
        { $set: { revokedAt: new Date() } },
      )
      .exec();
  }

  /** LOGOUT EVERYWHERE - what a user clicks after "was that login me?". */
  async logoutAll(userId: string): Promise<number> {
    const result = await this.refreshTokenModel
      .updateMany(
        { userId: toObjectId(userId), revokedAt: null },
        { $set: { revokedAt: new Date() } },
      )
      .exec();

    return result.modifiedCount;
  }

  /**
   * CHANGE PASSWORD.
   *
   * Two rules that are easy to forget and both matter:
   *   1. REQUIRE THE CURRENT PASSWORD. Without it, anyone with a stolen access
   *      token can lock the real owner out permanently - which turns a 15-minute
   *      problem into an account takeover.
   *   2. REVOKE EVERY SESSION afterwards. Changing a password is usually a
   *      reaction to suspected compromise; leaving other refresh tokens alive
   *      means the attacker keeps their access.
   */
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.usersService.findByIdWithSecrets(userId);
    if (!user) throw new UnauthorizedException();

    const valid = await this.passwordHasher.compare(dto.currentPassword, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Current password is incorrect');

    await this.usersService.setPassword(userId, dto.newPassword);
    const revoked = await this.logoutAll(userId);

    this.logger.log(`Password changed for ${userId}; ${revoked} session(s) revoked`);
  }

  /**
   * Issue an access/refresh pair and persist the refresh token's hash.
   *
   * Note the two DIFFERENT SECRETS. If both tokens were signed with one secret,
   * a refresh token would also verify as an access token - so a stolen refresh
   * token (long-lived, and often stored less carefully) would be usable
   * directly against every protected endpoint. That defeats the entire point of
   * having two token types, which is why `env.validation.ts` refuses to boot
   * when the secrets are equal.
   */
  private async issueTokens(
    user: AuthenticatedUser,
    family: string,
    context: SessionContext,
  ): Promise<TokenPair> {
    const jti = randomUUID();

    const accessPayload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const refreshPayload: RefreshTokenPayload = { sub: user.id, jti, family };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload, {
        secret: this.config.jwt.accessSecret,
        expiresIn: this.config.jwt.accessTtl,
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: this.config.jwt.refreshSecret,
        expiresIn: this.config.jwt.refreshTtl,
      }),
    ]);

    const decoded = this.jwtService.decode<RefreshTokenPayload>(refreshToken);

    await this.refreshTokenModel.create({
      userId: toObjectId(user.id),
      tokenHash: hashToken(refreshToken),
      family,
      expiresAt: new Date((decoded.exp ?? 0) * 1000),
      userAgent: context.userAgent ?? '',
      ip: context.ip ?? '',
    });

    const accessDecoded = this.jwtService.decode<AccessTokenPayload>(accessToken);
    const expiresIn = Math.max(0, (accessDecoded.exp ?? 0) - Math.floor(Date.now() / 1000));

    return { accessToken, refreshToken, expiresIn };
  }

  private async revokeFamily(family: string, reason: string): Promise<void> {
    const result = await this.refreshTokenModel
      .updateMany({ family, revokedAt: null }, { $set: { revokedAt: new Date() } })
      .exec();

    if (result.modifiedCount > 0) {
      this.logger.warn(`Revoked ${result.modifiedCount} token(s) in family ${family}: ${reason}`);
    }
  }
}

/**
 * SHA-256, hex. See the long note on `tokenHash` in the schema for why a fast
 * hash is correct for a high-entropy secret and wrong for a password.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * A real bcrypt hash of a value nobody knows, used only to spend the same CPU
 * on the "user does not exist" path as on the "wrong password" path.
 *
 * It must be a VALID hash of the algorithm in use, or `compare` short-circuits
 * and the timing difference reappears - which is a subtle way to implement this
 * mitigation and get none of its benefit.
 */
const DUMMY_HASH = '$2a$12$K8t6Qz5nGZK8yQ0zjJ5bF.9m1oP2vXqL7Cw3rN4sT6uY8aB0dE2fG';

/**
 * Convenience export so the type is available where `toPublicUser` is used.
 * (Kept here rather than re-exported broadly - see the note in the entity.)
 */
export { toPublicUser };
