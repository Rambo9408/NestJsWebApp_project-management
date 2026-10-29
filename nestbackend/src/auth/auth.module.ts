import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';

import { PASSWORD_HASHER } from 'src/common/constants';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { UsersModule } from 'src/users/users.module';
import { BcryptPasswordHasher } from 'src/users/hashing/bcrypt-password-hasher';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RefreshToken, RefreshTokenSchema } from './schemas/refresh-token.schema';
import { JwtStrategy } from './strategies/jwt.strategy';
import { LocalStrategy } from './strategies/local.strategy';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: RefreshToken.name, schema: RefreshTokenSchema }]),
    UsersModule,

    /**
     * `PassportModule` with no options. `defaultStrategy` is deliberately NOT
     * set: with three strategies in play, naming each guard explicitly
     * (`AuthGuard('jwt')` vs `AuthGuard('local')`) is clearer than a default
     * that someone has to go and look up.
     */
    PassportModule,

    /**
     * `JwtModule.register({})` - EMPTY, on purpose.
     *
     * We do not configure a global secret or expiry here, because this
     * application signs with TWO DIFFERENT SECRETS (access and refresh) and
     * passes them per call in `AuthService`. A module-level default would make
     * it easy to sign a refresh token with the access secret by forgetting an
     * option - and that mistake makes a refresh token usable as an access
     * token, which removes the entire benefit of having two.
     *
     * Explicit-per-call is more verbose and impossible to get silently wrong.
     * (`registerAsync` with a factory is the right choice when there IS one
     * secret and it comes from config.)
     */
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    LocalStrategy,

    /**
     * =========================================================================
     * THE GLOBAL GUARD - deny by default
     * =========================================================================
     * `APP_GUARD` registers `JwtAuthGuard` for EVERY route in the application,
     * as a PROVIDER - so Nest constructs it and its `Reflector` dependency is
     * injected. `app.useGlobalGuards(new JwtAuthGuard(???))` could not work,
     * because you would have to construct the Reflector by hand.
     *
     * That is the practical difference between the two registration styles, and
     * it is why `APP_GUARD` exists at all.
     *
     * SECURITY POSTURE: every route now requires a valid access token unless it
     * is explicitly marked `@Public()`. Forgetting to protect an endpoint is
     * now impossible; forgetting to UNprotect one is a 401 in the first test
     * run. Fail closed.
     *
     * SCOPE NOTE: a global guard declared here applies application-wide even
     * though it lives in AuthModule - `APP_*` providers are hoisted, they are
     * not module-scoped. That surprises people, and it is why they are usually
     * declared in the module that owns the concern rather than in AppModule.
     * =========================================================================
     */
    { provide: APP_GUARD, useClass: JwtAuthGuard },

    /**
     * PHASE 8: the second global guard - and the ORDER IS LOAD-BEARING.
     *
     * Multiple APP_GUARD providers run in REGISTRATION ORDER. RolesGuard reads
     * request.user, which only exists because JwtAuthGuard already ran and
     * populated it. Swap these two lines and every @Roles() route fails with
     * user undefined.
     *
     * This is the one place in Nest where provider ORDER genuinely matters -
     * everywhere else the container resolves by dependency graph, not position.
     */
    { provide: APP_GUARD, useClass: RolesGuard },

    /**
     * AuthService needs the password hasher, but `UsersModule` deliberately
     * does NOT export it (Phase 2's encapsulation lesson).
     *
     * So AuthModule binds the same token to the same implementation for its own
     * container. NOTE THE CONSEQUENCE, and it is worth being precise about:
     * this is a SECOND INSTANCE of `BcryptPasswordHasher`. That is harmless
     * here - the class is stateless, holding only a cost factor derived from
     * config - but it would be a bug for anything holding a connection or a
     * cache.
     *
     * THE ALTERNATIVES, and why this one:
     *   a) Export PASSWORD_HASHER from UsersModule. Simplest, and it widens
     *      UsersModule's public API so that any module can hash passwords -
     *      exactly what Phase 2 argued against.
     *   b) Put the hasher in its own small shared module that both import.
     *      The cleanest answer once a third consumer appears, and the one to
     *      reach for then.
     *   c) Re-bind locally, as here. Fine for a stateless provider; state it
     *      explicitly so nobody assumes there is only one.
     */
    { provide: PASSWORD_HASHER, useClass: BcryptPasswordHasher },
  ],

  /**
   * `AuthService` is exported for Phase 8's guards; the strategies and the
   * refresh-token model stay private.
   */
  exports: [AuthService],
})
export class AuthModule {}
