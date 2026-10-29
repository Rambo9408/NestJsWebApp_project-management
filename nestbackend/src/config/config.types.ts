/**
 * =============================================================================
 * CONFIGURATION TYPES
 * =============================================================================
 * WHAT: The shape of every configuration value the application can read.
 *
 * WHY does this file exist at all? Because `process.env` in Node is typed as
 * `Record<string, string | undefined>`. Every single value is a possibly-
 * undefined STRING. Without a layer like this, code across the app ends up
 * looking like:
 *
 *     const port = parseInt(process.env.PORT || '3000', 10);      // in main.ts
 *     const port = Number(process.env.PORT ?? 3000);              // in health
 *     const poolSize = +process.env.MONGODB_MAX_POOL_SIZE!;       // in database
 *
 * ...three parsers, three defaults, three chances to be wrong, and a runtime
 * crash the day someone types `PORT=three thousand`.
 *
 * The pipeline we build in this folder is:
 *
 *     process.env (strings)
 *          |
 *          v   Joi validation  (env.validation.ts)   -> fail fast at boot
 *          |
 *          v   registerAs namespaces (namespaces/*)  -> parse + group + default
 *          |
 *          v   AppConfigService (app-config.service.ts) -> typed, injectable
 *          |
 *          v   your services:  this.config.database.uri   // string, guaranteed
 *
 * EXPRESS COMPARISON: in an Express app you would typically have a
 * `config/index.js` that reads process.env and exports a plain object, then
 * `require()` it wherever needed. That works, but the module is a hidden
 * global dependency - you cannot swap it out in a unit test without
 * `jest.mock()` gymnastics. In Nest the same object arrives via dependency
 * injection, so a test simply provides a different value for the token.
 * Same data, testable delivery mechanism.
 * =============================================================================
 */

/** Environments the application understands. Used for behaviour switches. */
export type NodeEnv = 'development' | 'test' | 'staging' | 'production';

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export interface AppConfig {
  nodeEnv: NodeEnv;
  port: number;
  name: string;
  /** Global route prefix, e.g. `api` -> GET /api/v1/users */
  apiPrefix: string;
  /** Parsed from a comma-separated env var into a real array. */
  corsOrigins: string[];
  logLevel: LogLevel;
  swaggerEnabled: boolean;
}

export interface DatabaseConfig {
  uri: string;
  maxPoolSize: number;
  minPoolSize: number;
}

export interface RedisConfig {
  host: string;
  port: number;
  /** Optional: local dev Redis usually has no password; production always does. */
  password?: string;
  db: number;
  keyPrefix: string;
}

/**
 * A duration string the `ms` library understands, e.g. `15m`, `7d`.
 *
 * WHY A TEMPLATE-LITERAL TYPE rather than plain `string`? Because @nestjs/jwt
 * types `expiresIn` as `ms.StringValue | number`, and a bare `string` is not
 * assignable to it. Rather than casting the error away, we make the config
 * type as precise as the consumer expects - which also means a typo like
 * `15minutes` is now a compile error at the point it is written.
 */
export type JwtDuration = `${number}${'s' | 'm' | 'h' | 'd' | 'w' | 'y'}`;

export interface JwtConfig {
  accessSecret: string;
  /** A `ms`-style duration string such as `15m`, consumed by @nestjs/jwt. */
  accessTtl: JwtDuration;
  refreshSecret: string;
  refreshTtl: JwtDuration;
}

export interface CacheConfig {
  /** Seconds. */
  defaultTtl: number;
}

export interface ThrottleConfig {
  /** Window length in milliseconds. */
  ttl: number;
  /** Requests permitted per window. */
  limit: number;
}

/**
 * The union of every namespace, keyed by its namespace name.
 *
 * This type is what makes `ConfigService<ConfigSchema, true>` return precise
 * types instead of `any`. The second generic argument (`true`) means
 * "WasValidated" - it tells ConfigService that a Joi schema guarantees the
 * values exist, so `get()` returns `T` instead of `T | undefined`.
 */
export interface ConfigSchema {
  app: AppConfig;
  database: DatabaseConfig;
  redis: RedisConfig;
  jwt: JwtConfig;
  cache: CacheConfig;
  throttle: ThrottleConfig;
}
