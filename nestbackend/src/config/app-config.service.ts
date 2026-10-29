import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type {
  AppConfig,
  CacheConfig,
  ConfigSchema,
  DatabaseConfig,
  JwtConfig,
  RedisConfig,
  ThrottleConfig,
} from './config.types';

/**
 * =============================================================================
 * AppConfigService - a typed FACADE over @nestjs/config's ConfigService
 * =============================================================================
 *
 * 1. WHAT IS IT?
 * A thin, injectable wrapper that exposes the six configuration namespaces as
 * strongly-typed properties.
 *
 * 2. WHY DOES IT EXIST? (the "why not just inject ConfigService?" question)
 * You absolutely can inject ConfigService directly - many codebases do. The
 * problem shows up at scale:
 *
 *     // Without a facade, spread across 40 files:
 *     const ttl = this.configService.get<number>('cache.defaultTtl');   // ok
 *     const ttl = this.configService.get<number>('cache.defaultTTL');   // typo -> undefined
 *     const ttl = this.configService.get<number>('cache.default_ttl');  // typo -> undefined
 *
 * `get()` takes a STRING PATH. Strings are not checked by the compiler, they
 * are not refactor-safe, and a typo silently yields `undefined` instead of
 * failing. Wrapping it once means:
 *
 *     this.config.cache.defaultTtl   // compiler-checked, autocompleted, renameable
 *
 * It also gives us ONE place to add derived helpers (`isProduction`), and ONE
 * seam to stub in tests:
 *
 *     { provide: AppConfigService, useValue: { app: { port: 3000 } } }
 *
 * (That is a `useValue` custom provider - Phase 3 covers it properly.)
 *
 * 3. DESIGN PATTERN: this is the FACADE pattern.
 *    - Problem it solves: a general-purpose, stringly-typed subsystem
 *      (ConfigService) is awkward and error-prone for the specific way THIS
 *      application uses it.
 *    - Alternative: inject `@Inject(appConfig.KEY) config: ConfigType<typeof appConfig>`
 *      per namespace. That is arguably even better for a module that needs
 *      exactly one namespace, and we will use it in places. The facade wins
 *      when a class needs several namespaces or when you want derived helpers.
 *    - Trade-off: one extra class to maintain, and it must be kept in sync
 *      with config.types.ts. In exchange, every consumer becomes type-safe.
 *
 * 4. WHY `@Injectable()` HERE? (the first big DI lesson of this project)
 * `@Injectable()` marks this class as a candidate for Nest's DI container.
 * Concretely, the decorator attaches metadata to the class so that:
 *
 *   a) Nest is willing to instantiate it when a module lists it in `providers`.
 *   b) Nest reads `design:paramtypes` (emitted because tsconfig has
 *      `emitDecoratorMetadata: true`) to discover that the constructor wants a
 *      `ConfigService`, then resolves THAT provider first and passes it in.
 *
 * Without DI you would write `new AppConfigService(new ConfigService())` at
 * every call site: the caller must know how to build its dependencies, and
 * swapping the implementation in a test means editing production code.
 * With DI the caller declares WHAT it needs; the container decides HOW to
 * build it. That is the Dependency Inversion Principle (the D in SOLID) made
 * mechanical.
 *
 * SUBTLE POINT WORTH KNOWING FOR INTERVIEWS: `@Injectable()` is only strictly
 * required on a class that HAS constructor dependencies to inject. A provider
 * class with an empty constructor works without it - but Nest documentation
 * (and every sane team) says decorate all providers anyway, because the day
 * someone adds a constructor parameter, the missing decorator becomes a
 * confusing "Nest can't resolve dependencies" error.
 * =============================================================================
 */
@Injectable()
export class AppConfigService {
  /**
   * The two generic arguments matter:
   *   ConfigSchema -> tells ConfigService what keys/shapes exist.
   *   `true`       -> "WasValidated": because a Joi schema guarantees presence,
   *                   `get()` returns `T` and not `T | undefined`. This is the
   *                   payoff for validating at boot: no `!` or `??` downstream.
   *
   * `private readonly` in the constructor is TypeScript's parameter-property
   * shorthand: it declares the field AND assigns it. Nest passes the argument;
   * TypeScript does the wiring. (Express equivalent: you would `require()` the
   * config module at the top of the file - same data, but an unmockable,
   * hard-coded dependency.)
   */
  constructor(private readonly configService: ConfigService<ConfigSchema, true>) {}

  get app(): AppConfig {
    // `{ infer: true }` makes ConfigService return the precise type of the
    // namespace object rather than a widened one.
    return this.configService.get('app', { infer: true });
  }

  get database(): DatabaseConfig {
    return this.configService.get('database', { infer: true });
  }

  get redis(): RedisConfig {
    return this.configService.get('redis', { infer: true });
  }

  get jwt(): JwtConfig {
    return this.configService.get('jwt', { infer: true });
  }

  get cache(): CacheConfig {
    return this.configService.get('cache', { infer: true });
  }

  get throttle(): ThrottleConfig {
    return this.configService.get('throttle', { infer: true });
  }

  // --- Derived helpers -------------------------------------------------------
  // These exist so that behaviour switches read as intent ("are we in prod?")
  // rather than as string comparisons scattered through the codebase. If the
  // rule ever changes (say, staging should behave like production for logging),
  // it changes in exactly one place.

  get isProduction(): boolean {
    return this.app.nodeEnv === 'production';
  }

  get isTest(): boolean {
    return this.app.nodeEnv === 'test';
  }

  get isDevelopment(): boolean {
    return this.app.nodeEnv === 'development';
  }
}
