import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';

import { AuthenticatedUser } from 'src/auth/auth.types';

import { RequestContextService } from '../context/request-context.service';

/**
 * =============================================================================
 * INTERCEPTORS - the only hook that sees BOTH sides of the handler
 * =============================================================================
 * 1. THE SIGNATURE, and why it looks like that
 *
 *     intercept(context: ExecutionContext, next: CallHandler): Observable<T>
 *
 *   `next.handle()` returns an OBSERVABLE that emits the handler's result. Code
 *   BEFORE that call runs before the handler; RxJS operators applied to it run
 *   after. That is the whole model:
 *
 *       const started = Date.now();          // before
 *       return next.handle().pipe(
 *         tap(() => log(Date.now() - started)),   // after
 *       );
 *
 * 2. WHY AN OBSERVABLE AND NOT A PROMISE?
 *   Because a handler can legitimately emit MORE THAN ONCE - an `@Sse()` stream
 *   (Phase 11) returns an Observable of many events, and a promise cannot
 *   model that. It also buys the RxJS operator set for free: `timeout`,
 *   `retry`, `catchError`, `map`. This is the honest answer to "why does Nest
 *   drag RxJS into an HTTP framework?" - not fashion, but because the response
 *   is a STREAM in the general case.
 *
 *   The practical consequence people trip over: if you never subscribe, the
 *   handler never runs. Returning something other than `next.handle()` (or a
 *   pipe of it) makes the request hang.
 *
 * 3. THE FOUR OPERATORS THAT COVER ~95% OF INTERCEPTORS
 *     tap(fn)          side effect, value untouched     <- logging, metrics
 *     map(fn)          transform the value              <- response envelopes
 *     catchError(fn)   handle or rewrite an error       <- error mapping
 *     timeout(ms)      fail if it takes too long        <- see timeout.interceptor
 *
 * 4. WHAT THIS ONE DOES, and what it deliberately does NOT
 *   Logs method, path, status, duration and the correlation id - one line per
 *   request, structured enough to grep and to aggregate.
 *
 *   It does NOT log request or response BODIES. That is not laziness: bodies
 *   contain passwords, tokens and personal data, and a log pipeline is usually
 *   the least access-controlled system you own. "We leaked credentials through
 *   our logs" is a genuinely common incident. If you must log bodies, log them
 *   at debug level only, behind a flag, with an explicit redaction list.
 * =============================================================================
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  constructor(private readonly requestContext: RequestContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    /**
     * An interceptor runs for EVERY execution context, not just HTTP. A
     * WebSocket message (Phase 11) or a queue job would arrive here too, and
     * `switchToHttp().getRequest()` would return something meaningless.
     *
     * Checking `getType()` is the correct guard, and forgetting it is a common
     * source of "why is my interceptor crashing on WebSocket frames?".
     */
    if (context.getType() !== 'http') return next.handle();

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const response = context.switchToHttp().getResponse<Response>();

    const { method, originalUrl } = request;

    /**
     * PHASE 18: DO NOT LOG THE PROBES.
     *
     * Kubernetes probes liveness and readiness on every instance every ten
     * seconds. Across ten instances that is roughly a QUARTER OF A MILLION log
     * lines a day whose entire content is "the app is up" - which buries the
     * signal and costs real money on a per-GB ingestion plan.
     *
     * The same exclusion is applied to pino's `autoLogging` in
     * `logging.module.ts`. It has to be in BOTH places, because they are two
     * independent loggers observing the same request from different layers -
     * which is exactly the sort of thing you only notice by reading a real log
     * stream, not by running tests.
     */
    if (originalUrl.startsWith('/health/')) return next.handle();

    const startedAt = Date.now();

    // Captured BEFORE the handler runs.
    const requestId = this.requestContext.requestId ?? 'none';

    return next.handle().pipe(
      /**
       * `tap` with THREE handlers: next, error, complete.
       *
       * Using only the success handler is the classic mistake - failed requests
       * then produce no timing line at all, and errors are exactly the requests
       * whose duration you want. (Note the error path still logs here even
       * though the exception filter will also log: this line records the timing
       * and the request shape, the filter records the error detail.)
       */
      tap({
        next: () =>
          this.log(method, originalUrl, response.statusCode, startedAt, requestId, request),
        error: (error: unknown) => {
          const status =
            typeof error === 'object' && error !== null && 'status' in error
              ? Number(error.status)
              : 500;

          this.log(method, originalUrl, status, startedAt, requestId, request);
        },
      }),
    );
  }

  private log(
    method: string,
    url: string,
    status: number,
    startedAt: number,
    requestId: string,
    request: Request & { user?: AuthenticatedUser },
  ): void {
    const duration = Date.now() - startedAt;

    /**
     * The user id, not the email. Emails are personal data and end up in log
     * aggregators, backups and third-party tools; an opaque id is enough to
     * answer "which account was this?" and can be resolved by someone with the
     * right access.
     */
    const actor = request.user?.id ?? 'anonymous';

    const line = `${method} ${url} ${status} ${duration}ms user=${actor} req=${requestId}`;

    /**
     * LEVEL BY STATUS CLASS, which is what makes the logs usable:
     *   5xx -> error   something WE did wrong; page someone
     *   4xx -> warn    something the CLIENT did wrong; not an incident
     *   2xx -> log
     *
     * Logging 4xx as errors is the fastest way to make an error dashboard
     * meaningless - a bot probing for /wp-admin should not look like an outage.
     */
    if (status >= 500) this.logger.error(line);
    else if (status >= 400) this.logger.warn(line);
    else this.logger.log(line);
  }
}
