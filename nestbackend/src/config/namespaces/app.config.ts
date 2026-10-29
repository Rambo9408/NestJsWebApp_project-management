import { registerAs } from '@nestjs/config';

import type { AppConfig, LogLevel, NodeEnv } from '../config.types';
import { envBoolean, envList, envNumber, requireEnv } from '../env.util';

/**
 * =============================================================================
 * CONFIGURATION NAMESPACE  (read this one carefully - the other five are the
 * same idea with different values)
 * =============================================================================
 * WHAT IS `registerAs`?
 * It creates a namespaced configuration factory. Two things come out of it:
 *
 *   1. A factory function you hand to ConfigModule.forRoot({ load: [...] }).
 *      Nest calls it once at bootstrap and files the result under the key
 *      "app", so configService.get("app.port") works.
 *
 *   2. A PROVIDER TOKEN, exposed as `appConfig.KEY` (its value is the string
 *      "CONFIGURATION(app)"). This is your first real encounter with the
 *      concept we go deep on in Phase 3: a provider token is just a lookup key
 *      in the Nest DI container. Because registerAs registers the result under
 *      that token, you can inject a fully-typed slice of config directly:
 *
 *          constructor(
 *            @Inject(appConfig.KEY)
 *            private readonly config: ConfigType<typeof appConfig>,
 *          ) {}
 *
 *          this.config.port   // number - no get(), no strings, no casts
 *
 *      `ConfigType<typeof appConfig>` is a TypeScript helper from
 *      @nestjs/config that infers the factory return type. This pattern is the
 *      most type-safe way to read config in Nest, and it is a very good thing
 *      to be able to explain in an interview.
 *
 * WHY NAMESPACES INSTEAD OF ONE FLAT OBJECT?
 *   - Grouping: everything about Redis lives in one place, so a module can be
 *     handed exactly the config it needs and nothing more (least privilege for
 *     configuration - the notifications module has no business reading
 *     JWT_REFRESH_SECRET).
 *   - Extraction: when a module later becomes its own microservice (Phase 20),
 *     its namespace file moves with it, unchanged.
 *   - Naming collisions: `database.uri` and `redis.uri` can coexist.
 *
 * TRADE-OFF: one more indirection between .env and the consumer. For a
 * three-variable script it is overkill. For anything with more than one
 * backing service it pays for itself immediately.
 * =============================================================================
 */
export const appConfig = registerAs<AppConfig>('app', () => ({
  nodeEnv: requireEnv('NODE_ENV') as NodeEnv,
  port: envNumber('PORT'),
  name: requireEnv('APP_NAME'),
  apiPrefix: requireEnv('API_PREFIX'),
  // Stored as a comma-separated string in the environment (env vars can only
  // be strings), exposed to the app as a real array. Parsing lives HERE, once,
  // instead of in every consumer.
  corsOrigins: envList('CORS_ORIGINS'),
  logLevel: requireEnv('LOG_LEVEL') as LogLevel,
  swaggerEnabled: envBoolean('SWAGGER_ENABLED'),
}));
