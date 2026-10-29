import * as Joi from 'joi';

/**
 * =============================================================================
 * ENVIRONMENT VALIDATION SCHEMA
 * =============================================================================
 * WHAT: A Joi schema describing every environment variable the app requires.
 * @nestjs/config runs it during `ConfigModule.forRoot()`, i.e. while the
 * application is still bootstrapping, BEFORE a single HTTP request is served.
 *
 * WHY: fail fast. Without validation, a missing `JWT_ACCESS_SECRET` does not
 * crash the app - it produces `undefined`, `jsonwebtoken` happily signs tokens
 * with the string "undefined", and you ship an authentication system that any
 * attacker can forge tokens for. The bug surfaces days later, in production,
 * as a security incident.
 *
 * With this schema the process exits at second 0 with:
 *
 *     Config validation error: "JWT_ACCESS_SECRET" is required
 *
 * That is the entire point: a container that refuses to start is a page for
 * the on-call engineer; a container that starts misconfigured is an outage.
 * The same principle is why Kubernetes readiness probes matter (Phase 18) -
 * a broken instance should never enter the load balancer rotation.
 *
 * WHY JOI AND NOT class-validator?
 *   - @nestjs/config supports Joi natively via the `validationSchema` option.
 *   - Env vars are a flat string map, not a class instance; Joi's coercion
 *     (`Joi.number()` turning "3000" into 3000) fits that shape naturally.
 *   - ALTERNATIVE: pass a `validate: (raw) => ...` function and use
 *     class-transformer + class-validator on an `EnvironmentVariables` class.
 *     That keeps one validation library across the whole project (we still use
 *     class-validator for DTOs in Phase 6). Trade-off: more boilerplate, but
 *     one fewer dependency and one fewer mental model. Both are common in
 *     production Nest codebases - know that both exist and why.
 *   - A third modern option is `zod`, usually wired through a custom `validate`
 *     function. Same idea, different syntax.
 * =============================================================================
 */

/** Reusable rule: a secret must be long enough to resist brute force. */
const secret = Joi.string().min(32).required().messages({
  'string.min':
    "{{#label}} must be at least 32 characters. Generate one with: node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"",
});

export const envValidationSchema = Joi.object({
  // --- Application ---------------------------------------------------------
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'staging', 'production')
    // A default here is deliberate: forgetting NODE_ENV should NOT silently
    // enable production behaviour. Defaulting to the most restrictive-to-
    // debug value ('development') is the safe direction to be wrong in.
    .default('development'),
  PORT: Joi.number().port().default(3000),
  APP_NAME: Joi.string().default('taskflow-api'),
  API_PREFIX: Joi.string().default('api'),
  CORS_ORIGINS: Joi.string().default('*'),
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent')
    .default('info'),

  // --- MongoDB -------------------------------------------------------------
  // No default. There is no sane fallback for "which database holds our data",
  // and a default like `mongodb://localhost` is exactly how a production pod
  // ends up writing to nowhere and reporting success.
  MONGODB_URI: Joi.string()
    .uri({ scheme: ['mongodb', 'mongodb+srv'] })
    .required(),
  MONGODB_MAX_POOL_SIZE: Joi.number().min(1).max(500).default(20),
  MONGODB_MIN_POOL_SIZE: Joi.number().min(0).default(2),

  // --- Redis ---------------------------------------------------------------
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().port().default(6379),
  // `.allow('')` because an empty value in a .env file is an empty string, not
  // undefined. Without this, `REDIS_PASSWORD=` fails validation.
  REDIS_PASSWORD: Joi.string().allow('').default(''),
  REDIS_DB: Joi.number().min(0).max(15).default(0),
  REDIS_KEY_PREFIX: Joi.string().default('taskflow'),

  // --- Auth ----------------------------------------------------------------
  JWT_ACCESS_SECRET: secret,
  JWT_ACCESS_TTL: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: secret,
  JWT_REFRESH_TTL: Joi.string().default('7d'),

  // --- Cache / throttling / docs -------------------------------------------
  CACHE_DEFAULT_TTL: Joi.number().min(1).default(60),
  THROTTLE_TTL: Joi.number().min(1000).default(60_000),
  THROTTLE_LIMIT: Joi.number().min(1).default(100),
  SWAGGER_ENABLED: Joi.boolean().default(false),
})
  // Cross-field rule: signing access and refresh tokens with the SAME secret
  // means a stolen refresh token is also a valid access token and vice versa,
  // which defeats the whole point of having two token types. This is a real,
  // frequently-shipped bug - so we make it impossible to boot with.
  .custom((value: Record<string, unknown>, helpers) => {
    if (value.JWT_ACCESS_SECRET === value.JWT_REFRESH_SECRET) {
      return helpers.error('any.invalid', {
        message: 'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different values',
      });
    }
    return value;
  }, 'jwt secrets must differ')
  // Unknown keys are allowed: the OS environment is full of PATH, HOME, CI...
  // that have nothing to do with us. We validate what we care about and
  // ignore the rest.
  .unknown(true);

/**
 * Joi options passed to ConfigModule.
 *
 * abortEarly: false  -> report EVERY invalid variable at once. With the default
 *   (true) you fix one variable, restart, discover the next one, restart...
 *   Ten variables = ten restarts. This single flag saves a lot of time.
 *
 * allowUnknown: true -> same reason as `.unknown(true)` above.
 */
export const envValidationOptions = {
  abortEarly: false,
  allowUnknown: true,
};
