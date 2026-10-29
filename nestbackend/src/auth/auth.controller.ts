import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { CsrfGuard, CsrfProtected, issueCsrfToken } from 'src/common/guards/csrf.guard';
import { AppConfigService } from 'src/config';
import { PublicUser } from 'src/users/entities/user.entity';
import { UsersService } from 'src/users/users.service';

import { AuthService } from './auth.service';
import { AuthenticatedUser, TokenPair } from './auth.types';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { ChangePasswordDto, LoginDto, RefreshDto, RegisterDto } from './dto/auth.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { LocalAuthGuard } from './guards/local-auth.guard';

/** The cookie the refresh token travels in. */
const REFRESH_COOKIE = 'taskflow_refresh';

/**
 * =============================================================================
 * AuthController - the complete flow
 * =============================================================================
 *     POST /api/v1/auth/register     public
 *     POST /api/v1/auth/login        public  (LocalAuthGuard)
 *     POST /api/v1/auth/refresh      public  (the refresh token IS the credential)
 *     POST /api/v1/auth/logout       authenticated
 *     POST /api/v1/auth/logout-all   authenticated
 *     POST /api/v1/auth/password     authenticated
 *     GET  /api/v1/auth/me           authenticated
 *
 * THE LOGIN FLOW, end to end:
 *
 *     client POST /auth/login { email, password }
 *        |
 *        v  JwtAuthGuard sees @Public() -> stands down
 *        v  LocalAuthGuard -> LocalStrategy.validate()
 *        v  AuthService.validateCredentials() -> hasher.compare()
 *        v  request.user = { id, email, role }
 *        v  handler: AuthService.login() issues the token pair
 *        v  refresh token -> httpOnly cookie; access token -> JSON body
 *
 * THE AUTHENTICATED-REQUEST FLOW:
 *
 *     client GET /api/v1/tasks   Authorization: Bearer <access>
 *        |
 *        v  JwtAuthGuard (global) -> route is not @Public()
 *        v  JwtStrategy: verify signature + expiry -> validate(payload)
 *        v  request.user = { id, email, role }
 *        v  @CurrentUser() user  -> the handler
 * =============================================================================
 */
@ApiBearerAuth('access-token')
@ApiTags('auth')
/**
 * PHASE 16: the CSRF guard is registered here and OPTS IN per route.
 *
 * Only the two endpoints that authenticate with a COOKIE are marked - refresh
 * and logout. Everything else in this API uses a bearer token, which the
 * browser never attaches by itself, so CSRF does not apply. See csrf.guard.ts
 * for why that distinction is the whole answer.
 */
@UseGuards(CsrfGuard)
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * @ApiOperation is the SUMMARY a reader sees first. The Swagger CLI plugin
   * already infers request and response SHAPES from the types; what it cannot
   * infer is what an endpoint MEANS and which errors it can return - so those
   * are the only things worth writing by hand.
   */
  @ApiOperation({ summary: 'Register a new account (always creates a MEMBER)' })
  @ApiResponse({ status: 201, description: 'Registered; refresh token set as an httpOnly cookie' })
  @ApiResponse({ status: 400, description: 'Validation failed, or a role was supplied' })
  @ApiResponse({ status: 409, description: 'Email already in use' })
  /**
   * Registration gets the same strict budget as login, for a different reason:
   * it is unauthenticated, it WRITES, and each call costs a bcrypt HASH - the
   * expensive direction. Left on the general limit it is a cheap way to fill
   * the users collection and burn CPU.
   *
   * A shared constant would be tempting; two explicit declarations are better
   * here, because the day one of them needs a different number, a shared
   * constant is edited and silently changes both.
   */
  @Throttle({ default: { limit: 10, ttl: 15 * 60 * 1000 } })
  @Public()
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ user: PublicUser; accessToken: string; expiresIn: number }> {
    const result = await this.authService.register(dto, sessionContext(request));
    this.setRefreshCookie(response, result.refreshToken);

    return { user: result.user, accessToken: result.accessToken, expiresIn: result.expiresIn };
  }

  /**
   * `@Public()` AND `@UseGuards(LocalAuthGuard)` together.
   *
   * `@Public()` tells the GLOBAL JWT guard to stand down - you cannot require a
   * token from someone who is asking for one. `LocalAuthGuard` then does the
   * actual authentication. Both guards run; they answer different questions.
   *
   * `@HttpCode(200)` because a login creates no resource. 201 would be a lie.
   *
   * NOTE `@Res({ passthrough: true })`: it gives access to the response object
   * to set a cookie WITHOUT taking over response handling. Plain `@Res()` opts
   * out of Nest's serialisation entirely - your `return` value is ignored, the
   * request hangs unless you call `res.json()` yourself, and interceptors that
   * transform the body (Phase 9) silently stop working. `passthrough` is almost
   * always the one you want.
   */
  @ApiOperation({ summary: 'Exchange credentials for an access token' })
  @ApiResponse({ status: 200, description: 'Authenticated' })
  @ApiResponse({
    status: 401,
    description: 'Invalid email or password (deliberately indistinguishable)',
  })
  /**
   * ===========================================================================
   * THE STRICT LIMIT, DECLARED WHERE IT APPLIES
   * ===========================================================================
   * 10 attempts per 15 minutes, overriding the general API limit for this
   * route only.
   *
   * `@Throttle({ default: {...} })` RECONFIGURES the globally-registered
   * `default` throttler for this handler. It does not add a second one - and
   * that distinction is exactly what caused an outage when a separate `auth`
   * throttler was registered globally in cache.module.ts and silently capped
   * the whole API at ten requests per fifteen minutes. Read the note there.
   *
   * WHY THIS ROUTE SPECIFICALLY:
   *   - Each attempt costs a bcrypt comparison, ~250ms of single-threaded CPU.
   *     An attacker chooses how much of your CPU to spend, which is the
   *     definition of an asymmetric cost.
   *   - It is the route where the limit is doing SECURITY work, not fairness
   *     work: it turns credential stuffing from thousands of guesses a minute
   *     into ten in fifteen minutes.
   *
   * WHAT IT DELIBERATELY DOES NOT DO: lock the ACCOUNT. Per-IP and per-user
   * request limits are the right tool; locking an account after N failures is
   * a denial-of-service vector, because anyone who knows your email address can
   * lock you out of your own account at will.
   *
   * AND ITS HONEST LIMIT: SmartThrottlerGuard keys anonymous requests by IP, so
   * a distributed attempt from many addresses gets the full budget from each
   * one. Rate limiting raises the cost of credential stuffing; it does not
   * prevent it. The controls that actually do are unique passwords, breached-
   * password rejection and MFA - none of which are here.
   * ===========================================================================
   */
  @Throttle({ default: { limit: 10, ttl: 15 * 60 * 1000 } })
  @Public()
  @UseGuards(LocalAuthGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ user: PublicUser; accessToken: string; expiresIn: number }> {
    const result = await this.authService.login(dto, sessionContext(request));
    this.setRefreshCookie(response, result.refreshToken);

    return { user: result.user, accessToken: result.accessToken, expiresIn: result.expiresIn };
  }

  /**
   * `@Public()` because the REFRESH TOKEN IS the credential here - requiring a
   * valid access token would defeat the purpose, since the whole reason to
   * refresh is that the access token expired.
   *
   * The token is read from the cookie first, then the body. Browsers use the
   * cookie (JavaScript cannot read it, so XSS cannot steal it); mobile and
   * service clients, which have no cookie jar, send it in the body.
   */
  @ApiOperation({
    summary: 'Rotate the refresh token',
    description:
      'Reads the token from the httpOnly cookie, or from the body for non-browser clients. Reuse of a spent token revokes the entire session family.',
  })
  @ApiResponse({ status: 200, description: 'Rotated' })
  @ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
  @ApiResponse({ status: 403, description: 'Reuse detected - all sessions revoked' })
  @CsrfProtected()
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body() dto: RefreshDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Omit<TokenPair, 'refreshToken'>> {
    const raw = this.readRefreshToken(request, dto);
    if (!raw) throw new UnauthorizedException('No refresh token provided');

    const tokens = await this.authService.refresh(raw, sessionContext(request));
    this.setRefreshCookie(response, tokens.refreshToken);

    /**
     * The new refresh token goes ONLY in the cookie, never in the JSON body -
     * a value in the body is a value JavaScript can read, and therefore a value
     * XSS can exfiltrate. (A non-browser client that sent its token in the body
     * gets it back in the `Set-Cookie` header, which it can read from the
     * response.)
     */
    return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn };
  }

  @CsrfProtected()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Body() dto: RefreshDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.authService.logout(this.readRefreshToken(request, dto));

    // Clear the cookie with the SAME attributes it was set with, or the browser
    // keeps the old one - a genuinely common "logout does not work" bug.
    response.clearCookie(REFRESH_COOKIE, this.cookieOptions());
  }

  /** "Sign out everywhere" - what a user clicks after a suspicious-login alert. */
  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  async logoutAll(
    @CurrentUser('id') userId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ revokedSessions: number }> {
    const revokedSessions = await this.authService.logoutAll(userId);
    response.clearCookie(REFRESH_COOKIE, this.cookieOptions());

    return { revokedSessions };
  }

  @Post('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.authService.changePassword(userId, dto);
    response.clearCookie(REFRESH_COOKIE, this.cookieOptions());
  }

  /**
   * "Who am I?" - the endpoint every frontend calls on boot.
   *
   * Note it READS FROM THE DATABASE rather than returning the token's claims.
   * The token is a snapshot up to 15 minutes old; this endpoint exists
   * precisely so a client can see the CURRENT name and role. Returning the
   * token's claims would make a just-promoted user look unpromoted until they
   * logged out - and this is the one route where paying for a query is
   * obviously right.
   */
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): Promise<PublicUser> {
    return this.usersService.findById(user.id);
  }

  /**
   * SELF-SERVICE PROFILE EDIT.
   *
   * PHASE 8 moved this out of `PATCH /users/:id`, which is now admin-only. The
   * id is not a parameter at all - it comes from the token, so there is no
   * "can this user edit that user?" question to get wrong. An endpoint that
   * cannot express the unsafe case does not need a check for it, which is the
   * cheapest kind of authorization there is.
   */
  @Patch('me')
  updateMe(@CurrentUser('id') userId: string, @Body() dto: UpdateMeDto): Promise<PublicUser> {
    return this.usersService.update(userId, dto);
  }

  private readRefreshToken(request: Request, dto: RefreshDto): string | undefined {
    const cookies = request.cookies as Record<string, string> | undefined;
    return cookies?.[REFRESH_COOKIE] ?? dto.refreshToken;
  }

  private setRefreshCookie(response: Response, token: string): void {
    response.cookie(REFRESH_COOKIE, token, this.cookieOptions());

    /**
     * A session begins (or rotates) here, so the client gets a fresh CSRF token
     * at the same moment. Issuing it anywhere else would leave a window in
     * which the cookie exists and the token does not.
     */
    issueCsrfToken(response, this.config.isProduction);
  }

  /**
   * ---------------------------------------------------------------------------
   * COOKIE ATTRIBUTES - every one of these is a security decision
   * ---------------------------------------------------------------------------
   *   httpOnly  JavaScript cannot read it. This is the whole reason to put the
   *             refresh token in a cookie: XSS can steal anything in
   *             localStorage, but not this.
   *   secure    HTTPS only. Off in development because localhost is http.
   *   sameSite  'strict' means the browser never attaches it to a cross-site
   *             request - the CSRF defence. Use 'lax' if your flow involves a
   *             redirect back from an external provider, and 'none' (with
   *             `secure`) only if the API is on a different site from the
   *             frontend - in which case you also need CSRF tokens (Phase 16).
   *   path      Scoped to the auth routes, so the cookie is not attached to
   *             every API request. Smaller exposure, smaller requests.
   *   maxAge    Matches the refresh TTL. Without it this is a SESSION cookie
   *             that vanishes when the browser closes, quietly breaking
   *             "remember me".
   */
  private cookieOptions() {
    return {
      httpOnly: true,
      secure: this.config.isProduction,
      sameSite: 'strict' as const,
      path: '/api/v1/auth',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    };
  }
}

function sessionContext(request: Request) {
  return {
    userAgent: request.headers['user-agent'] ?? '',
    // `req.ip` is the REAL client address only because main.ts sets
    // `trust proxy` - see the note there.
    ip: request.ip ?? '',
  };
}
