import { Provider, ValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';

/**
 * =============================================================================
 * THE GLOBAL ValidationPipe - registered via APP_PIPE, and why that matters
 * =============================================================================
 * There are two ways to make a pipe global:
 *
 *     app.useGlobalPipes(new ValidationPipe({...}))   // in main.ts
 *     { provide: APP_PIPE, useClass: ValidationPipe } // in a module
 *
 * They are NOT equivalent, and the difference is a classic interview question:
 *
 *   - `useGlobalPipes` constructs the pipe YOURSELF, outside the container. It
 *     therefore CANNOT inject anything. Fine for `ValidationPipe`, useless the
 *     moment your global guard needs a `ConfigService` or a repository.
 *   - `APP_PIPE` registers it as a PROVIDER, so Nest builds it and dependency
 *     injection works normally.
 *
 * The same four tokens exist for the other three enhancer types, and they are
 * how every global-with-DI registration is done:
 *
 *     APP_PIPE  APP_GUARD  APP_INTERCEPTOR  APP_FILTER
 *
 * We use `useValue` here because the pipe needs options rather than injected
 * dependencies - but registering it through the module keeps every global
 * enhancer in one place and makes the switch to `useClass` a one-line change if
 * that ever changes.
 *
 * ORDER NOTE: multiple APP_* providers of the same type run in REGISTRATION
 * order. For guards and interceptors that ordering is significant; for pipes it
 * rarely is.
 * =============================================================================
 */
export const validationPipeProvider: Provider = {
  provide: APP_PIPE,
  useValue: new ValidationPipe({
    /**
     * ---------------------------------------------------------------------------
     * whitelist: true  - STRIP any property that has no validation decorator
     * ---------------------------------------------------------------------------
     * This is the security flag. Without it, `@Body()` hands your service
     * whatever the client sent, and code like `Object.assign(user, dto)` or
     * `new Model(dto)` writes ALL of it - including fields the client had no
     * business setting.
     *
     * That is MASS ASSIGNMENT, and it is not theoretical: `{"role":"admin"}` on
     * a profile-update endpoint is the single most common privilege-escalation
     * bug in tutorial-grade APIs. GitHub was famously compromised this way in
     * 2012.
     *
     * With `whitelist`, an undecorated property simply does not exist by the
     * time the handler runs.
     */
    whitelist: true,

    /**
     * ---------------------------------------------------------------------------
     * forbidNonWhitelisted: true - REJECT instead of silently stripping
     * ---------------------------------------------------------------------------
     *     400 { message: ["property role should not exist"] }
     *
     * WHY REJECT RATHER THAN STRIP? Because silent stripping means a client can
     * send `{ "nmae": "typo" }` and get a 200 with nothing changed - and then
     * spend an hour wondering why. Failing loudly turns a silent no-op into an
     * immediate, self-explanatory error.
     *
     * WHEN TO PREFER STRIPPING (`whitelist` alone): a public API with many
     * third-party clients you cannot coordinate, where a newly-added field in
     * someone's payload should not break them. That is a real trade-off between
     * strictness and backward compatibility - pick deliberately.
     */
    forbidNonWhitelisted: true,

    /**
     * ---------------------------------------------------------------------------
     * transform: true - construct a real DTO INSTANCE
     * ---------------------------------------------------------------------------
     * This is what makes `@Body() dto: CreateUserDto` TRUE at runtime rather
     * than a compile-time fiction. Without it you receive a plain object that
     * merely resembles the DTO: `dto instanceof CreateUserDto` is false, class
     * methods do not exist, `@Type()` conversions never run, and default values
     * declared on the class are absent.
     *
     * It is also what makes `PaginationQuery.skip` (a getter) work at all - a
     * plain object has no prototype methods.
     */
    transform: true,

    transformOptions: {
      /**
       * DELIBERATELY FALSE.
       *
       * With `enableImplicitConversion: true`, class-transformer infers
       * conversions from the TypeScript type, so `page: number` converts
       * automatically and you can drop every `@Type(() => Number)`.
       *
       * Convenient - and implicit. It will coerce `"abc"` to `NaN` and hand it
       * to `@IsInt()`, produce surprising results for `boolean` (any non-empty
       * string is truthy), and generally make the behaviour of a DTO depend on
       * a type annotation that is otherwise erased. This project writes
       * `@Type()` explicitly because explicit conversions are easier to review.
       *
       * Both choices are common; be able to argue yours.
       */
      enableImplicitConversion: false,
    },

    /**
     * ---------------------------------------------------------------------------
     * stopAtFirstError: false (the default) - report EVERY failure at once
     * ---------------------------------------------------------------------------
     * A form with five bad fields should tell the user about all five, not make
     * them submit five times. Same reasoning as `abortEarly: false` in the Joi
     * config from Phase 1.
     */
    stopAtFirstError: false,

    /**
     * ---------------------------------------------------------------------------
     * disableErrorMessages in production - a trade-off, NOT a free win
     * ---------------------------------------------------------------------------
     * Turning it on hides field names and constraint details from clients, which
     * marginally reduces information disclosure about your internal shape.
     *
     * We leave it OFF, deliberately. The information leaked is low value (your
     * OpenAPI document publishes the same field names anyway), and the cost is
     * high: legitimate clients get a bare "Bad Request" with no way to know
     * what was wrong, and your support load goes up. Security theatre that
     * makes the product worse is a bad trade.
     *
     * If you do enable it, log the full message server-side with a correlation
     * id (Phase 18) so support can still answer "why was my request rejected?".
     */
    disableErrorMessages: false,
  }),
};
