import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  RequestTimeoutException,
} from '@nestjs/common';
import { Observable, TimeoutError, catchError, throwError, timeout } from 'rxjs';

/** Fail a request that has taken longer than this. */
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * =============================================================================
 * TimeoutInterceptor - `timeout` + `catchError`, and why this matters
 * =============================================================================
 * A request with no timeout can hang forever. That sounds harmless until you
 * count what it holds while hanging: a socket, a Node event-loop registration,
 * a database connection from the pool, and a slot in whatever concurrency limit
 * your load balancer applies.
 *
 * Enough hung requests and the pool is exhausted, at which point every OTHER
 * endpoint starts failing too. That is how one slow query takes down an entire
 * service - and the reason `database.module.ts` also sets `socketTimeoutMS`.
 * Timeouts are a bulkhead, not a nicety.
 *
 * `timeout(ms)` emits a `TimeoutError` if the source has not emitted in time;
 * `catchError` translates it into an HTTP-shaped exception so the client gets
 * **504 Gateway Timeout** rather than a 500 with an RxJS stack trace.
 *
 * -----------------------------------------------------------------------------
 * THE LIMITATION, stated honestly because it is the interesting part
 * -----------------------------------------------------------------------------
 * This ABANDONS the response; it does not CANCEL the work. The database query
 * keeps running, the HTTP call to the third party keeps going, and the
 * connection stays busy until it finishes on its own. The client is freed, the
 * server is not.
 *
 * Real cancellation needs the timeout pushed down to the operation itself:
 *   - Mongo:  `maxTimeMS` on the query (the server kills it)
 *   - HTTP:   an `AbortSignal` on fetch/axios
 *   - Redis:  command timeouts (Phase 3 sets `maxRetriesPerRequest`)
 *
 * So the correct answer to "how do you handle slow requests?" is BOTH: a
 * per-operation timeout that actually cancels work, and this interceptor as the
 * outer bound that guarantees no request lives forever regardless.
 *
 * -----------------------------------------------------------------------------
 * WHY IT IS NOT GLOBAL IN THIS PROJECT
 * -----------------------------------------------------------------------------
 * Phase 11 adds `@Sse()`, which returns a long-lived Observable that
 * deliberately never completes. A global 15-second timeout would kill every SSE
 * connection after fifteen seconds - a genuinely confusing bug ("our real-time
 * feed reconnects constantly").
 *
 * Options: register globally and exclude streaming routes with metadata, or
 * apply it per controller. We apply it per controller, because an interceptor
 * whose correctness depends on remembering to exclude routes is a trap for the
 * next person.
 * =============================================================================
 */
@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  constructor(private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS) {}

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      timeout(this.timeoutMs),
      catchError((error: unknown) => {
        if (error instanceof TimeoutError) {
          return throwError(
            () => new RequestTimeoutException(`Request exceeded ${this.timeoutMs}ms`),
          );
        }

        /**
         * Anything else is re-thrown UNCHANGED so the exception filter can
         * classify it. Swallowing unknown errors in an interceptor is a common
         * and expensive mistake: a 404 arrives at the client as a 500, or worse,
         * as a 200 with an empty body.
         */
        return throwError(() => error);
      }),
    );
  }
}
