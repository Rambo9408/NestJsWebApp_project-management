import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';

import { RequestContextService } from './context/request-context.service';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { LoggingInterceptor } from './interceptors/logging.interceptor';
import { TransformResponseInterceptor } from './interceptors/transform-response.interceptor';
import { validationPipeProvider } from './pipes/validation.provider';

/**
 * =============================================================================
 * CommonModule - every global enhancer, in one place
 * =============================================================================
 * Phase 9 gathers the cross-cutting pipeline that was accumulating in
 * `app.module.ts`. Having one module own `APP_PIPE`, `APP_INTERCEPTOR` and
 * `APP_FILTER` means the answer to "what runs on every request?" is one file.
 *
 * (`APP_GUARD` stays in `AuthModule`, because the guards ARE the auth concern
 * and belong with the strategies they depend on. `APP_*` providers are hoisted
 * regardless of which module declares them - so the choice is about where a
 * reader will look for them, not about scope.)
 *
 * @Global() so that `RequestContextService` and the interceptors are injectable
 * anywhere - same justification as config, Redis and the database connection:
 * cross-cutting, stateless from a consumer's point of view, exactly one of each.
 * =============================================================================
 */
@Global()
@Module({
  providers: [
    RequestContextService,

    // Phase 6. Kept here now that every global enhancer lives together.
    validationPipeProvider,

    /**
     * -------------------------------------------------------------------------
     * INTERCEPTOR ORDER, which is genuinely counter-intuitive
     * -------------------------------------------------------------------------
     * Interceptors registered globally run in REGISTRATION order on the way IN,
     * and in REVERSE order on the way OUT - they nest, like middleware onions:
     *
     *     LoggingInterceptor    ┌ before
     *       [ guards, pipes, handler ]
     *     LoggingInterceptor    └ after   <- sees the final status
     *
     * With a second interceptor registered after this one, the second would run
     * closer to the handler and its "after" phase would complete FIRST. That
     * matters whenever one interceptor transforms what another observes - for
     * example, a logging interceptor registered before a response-envelope
     * interceptor logs the ENVELOPED body, not the resource.
     *
     * The practical rule: register observation (logging, metrics) OUTERMOST, so
     * it sees the true, final response and the true, total duration.
     */
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },

    /**
     * -------------------------------------------------------------------------
     * THE GLOBAL EXCEPTION FILTER
     * -------------------------------------------------------------------------
     * Registered as a PROVIDER (`APP_FILTER`) rather than with
     * `app.useGlobalFilters(new AllExceptionsFilter())`, for the same reason as
     * every other enhancer in this project: it injects `HttpAdapterHost` and
     * `RequestContextService`, and a filter you construct by hand cannot.
     *
     * ORDER NOTE for filters: the MOST RECENTLY registered filter whose
     * `@Catch()` matches wins, and a bare `@Catch()` matches everything. So a
     * specialised filter (say `@Catch(MongoNetworkError)`) must be registered
     * AFTER this one to take precedence - which reads backwards until you have
     * been bitten by it once.
     */
    { provide: APP_FILTER, useClass: AllExceptionsFilter },

    /**
     * Exported but NOT global - see the long note in the file for why a
     * response envelope is a decision rather than a default. Controllers opt in
     * with `@UseInterceptors(TransformResponseInterceptor)`.
     */
    TransformResponseInterceptor,
  ],
  exports: [RequestContextService, TransformResponseInterceptor],
})
export class CommonModule {}
