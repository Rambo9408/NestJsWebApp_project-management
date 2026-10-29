import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';

import { AppConfigService } from './app-config.service';
import { envValidationOptions, envValidationSchema } from './env.validation';
import {
  appConfig,
  cacheConfig,
  databaseConfig,
  jwtConfig,
  redisConfig,
  throttleConfig,
} from './namespaces';

/**
 * =============================================================================
 * AppConfigModule
 * =============================================================================
 * The first MODULE in this project, so let us be precise about what a module
 * even is.
 *
 * A Nest module is NOT a JavaScript module (a file). It is a unit of the
 * application dependency-injection graph. `@Module()` takes four keys and each
 * one answers a different question:
 *
 *   imports     -> "which OTHER modules' exported providers may I use?"
 *   providers   -> "which classes/values should the container build FOR ME?"
 *   controllers -> "which classes handle incoming HTTP requests?"
 *   exports     -> "which of MY providers may modules that import me use?"
 *
 * That last pair - providers vs exports - is the single most misunderstood
 * thing in Nest and the cause of most "Nest can't resolve dependencies"
 * errors. A provider listed in `providers` but NOT in `exports` is PRIVATE to
 * this module. Importing the module does not give you access to it. We prove
 * this with a deliberately broken example in Phase 4.
 *
 * EXPRESS COMPARISON: Express has no equivalent. In Express, `require()` IS
 * your dependency graph: any file can require any other file, so there are no
 * boundaries and nothing stops notification code from importing the
 * password-hashing internals. Nest modules give you enforceable boundaries -
 * which is exactly what makes a MODULAR MONOLITH viable, and what turns a
 * later extraction into microservices into a mechanical job rather than an
 * archaeology project.
 * =============================================================================
 *
 * WHY `@Global()`?
 * -----------------------------------------------------------------------------
 * A global module's exported providers are available everywhere WITHOUT the
 * consuming module importing it. Normally that is a smell: it hides the
 * dependency graph and makes it harder to see what a module actually needs.
 *
 * Configuration is one of the few legitimate exceptions, alongside logging:
 *   - Practically every module needs it.
 *   - It is read-only and stateless, so there is no coupling risk.
 *   - Writing `imports: [AppConfigModule]` in 15 modules is noise, not
 *     information.
 *
 * TRADE-OFF / WHEN TO AVOID: never reach for @Global() to "fix" a dependency
 * resolution error. If module A needs a provider from module B, the honest fix
 * is `imports: [BModule]` in A plus `exports: [TheProvider]` in B. Overusing
 * @Global() turns your DI container back into a bag of globals - the exact
 * problem DI exists to solve.
 *
 * MECHANICS NOTE: @Global() only means "no import statement needed". The module
 * is still instantiated exactly once, and it must still appear in the imports
 * of the ROOT module (AppModule) so that Nest actually loads it.
 */
@Global()
@Module({
  imports: [
    /**
     * `NestConfigModule.forRoot()` is a DYNAMIC MODULE.
     *
     * A static module (`@Module({...})`) is configured at author time. A
     * dynamic module is a class with a static method that RETURNS a module
     * definition, so the CALLER configures it at import time. That is why you
     * see these four names all over the Nest ecosystem:
     *
     *   forRoot() / forRootAsync()   -> configure a module once, app-wide
     *                                   (ConfigModule, MongooseModule, BullModule)
     *   register() / registerAsync() -> configure per consumer; may be called
     *                                   many times with different options
     *                                   (JwtModule, HttpModule)
     *   forFeature()                 -> declare feature-scoped pieces against
     *                                   an already-configured root
     *                                   (MongooseModule.forFeature([schemas]))
     *
     * The `Async` variants exist for exactly one reason: when the OPTIONS
     * themselves depend on injectable things (like ConfigService). We use
     * `MongooseModule.forRootAsync` in Phase 5 for precisely that.
     *
     * INTERVIEW: "What is a dynamic module and when would you write one?"
     * A module whose providers/imports are computed from options supplied by
     * the consumer, returned from a static method as a `DynamicModule` object
     * ({ module, imports, providers, exports, global }). You write one when
     * building a reusable module - our CacheModule in Phase 10 is a real
     * example. Nest also ships `ConfigurableModuleBuilder` to generate the
     * boilerplate for you.
     */
    NestConfigModule.forRoot({
      /**
       * FALSE on purpose. We do not let @nestjs/config make itself global;
       * instead THIS module is @Global() and re-exports it below.
       *
       * Why bother? To keep a single owner for configuration. Every consumer
       * depends on OUR module (and mostly on our typed AppConfigService), not
       * directly on a third-party module. If we ever swap @nestjs/config for
       * something else, the blast radius is this one file.
       */
      isGlobal: false,

      /**
       * ENV FILE RESOLUTION ORDER. First file that defines a variable wins, so
       * the array runs most-specific to least-specific:
       *
       *   .env.development  (or .env.test / .env.staging / .env.production)
       *   .env              (shared fallback, gitignored)
       *
       * We read NODE_ENV straight off process.env here because this code runs
       * BEFORE ConfigService exists - a genuine chicken-and-egg situation.
       * This is the ONLY place in the app where reading process.env directly is
       * correct. Everywhere else: inject AppConfigService.
       */
      envFilePath: [`.env.${process.env.NODE_ENV ?? 'development'}`, '.env'],

      /**
       * In production, configuration comes from the orchestrator (Kubernetes
       * Secrets, ECS task definitions, platform config vars) and never from a
       * file baked into the image. Ignoring env files there prevents a stale
       * `.env.production` that accidentally got COPYed into the Docker image
       * from silently overriding real secrets - a nasty and very real failure
       * mode.
       */
      ignoreEnvFile: process.env.NODE_ENV === 'production',

      // Fail fast at boot. Full reasoning in env.validation.ts.
      validationSchema: envValidationSchema,
      validationOptions: envValidationOptions,

      // The namespaced factories. Each becomes both a config key and an
      // injectable provider token (see app.config.ts).
      load: [appConfig, databaseConfig, redisConfig, jwtConfig, cacheConfig, throttleConfig],

      /**
       * Memoises `get()` lookups. Without it every call walks process.env.
       * Harmless at 10 req/s, measurable when a hot path reads config on every
       * request. Safe here because our configuration is immutable after boot.
       */
      cache: true,

      /**
       * Allows `${VAR}` references inside .env files, e.g.
       *   REDIS_URL=redis://${REDIS_HOST}:${REDIS_PORT}
       * Handy for composing URLs without duplicating hosts and ports.
       */
      expandVariables: true,
    }),
  ],

  /**
   * `providers` = things this module asks the container to construct.
   *
   * AppConfigService below is a class provider in SHORTHAND form. These two
   * lines are exactly equivalent:
   *
   *     providers: [AppConfigService]
   *     providers: [{ provide: AppConfigService, useClass: AppConfigService }]
   *
   * The second form exposes the underlying model: EVERY provider is a
   * { token, recipe } pair. When you write the class name alone, the class
   * itself is BOTH the token and the recipe. Phase 3 is entirely about pulling
   * those two apart.
   */
  providers: [AppConfigService],

  /**
   * `exports` = this module's public API.
   *
   * We export two things:
   *   - AppConfigService: our typed facade, the recommended way to read config.
   *   - NestConfigModule: re-exporting a MODULE re-exports whatever that module
   *     exports (here, ConfigService). This is how `@Inject(appConfig.KEY)`
   *     injections and third-party code keep working.
   *
   * Re-exporting an imported module is a normal, deliberate Nest technique for
   * building "shared module" aggregates. It does NOT create a second instance:
   * modules are singletons per application, so ConfigService is the same object
   * everywhere.
   */
  exports: [AppConfigService, NestConfigModule],
})
export class AppConfigModule {}
