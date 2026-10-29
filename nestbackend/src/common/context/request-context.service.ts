import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  /** Correlates every log line, span and downstream call for one request. */
  requestId: string;
  /** Populated by the auth guard once it has run. */
  userId?: string;
  startedAt: number;
}

/**
 * =============================================================================
 * RequestContextService - per-request state WITHOUT request scope
 * =============================================================================
 * Phase 4 listed three ways to carry per-request context, in order of
 * preference:
 *
 *   1. Pass it as a method argument.    explicit, free - but verbose across
 *                                        five layers
 *   2. AsyncLocalStorage.                a SINGLETON with per-request storage
 *   3. Scope.REQUEST.                    correct, framework-native, and the
 *                                        most expensive - it is contagious
 *                                        upward and rebuilds the provider chain
 *                                        on every request
 *
 * This is option 2, and it is what most production Nest applications actually
 * use for correlation ids (the `nestjs-cls` package is a wrapper around exactly
 * this).
 *
 * HOW IT WORKS: `AsyncLocalStorage` is a Node core API built on async_hooks. It
 * keeps a value alive across an entire asynchronous call chain - through
 * `await`, `setTimeout`, promise callbacks, database driver internals - without
 * threading a parameter through every function. Think of it as a thread-local
 * for a language with no threads.
 *
 * WHY IT BEATS REQUEST SCOPE HERE:
 *   - This service stays a SINGLETON, so nothing above it becomes request-scoped
 *     and no provider chain is rebuilt per request.
 *   - It works OUTSIDE the HTTP pipeline too - a BullMQ worker (Phase 12) can
 *     open its own store and get the same correlation-id behaviour, which a
 *     request-scoped provider cannot do because there is no request.
 *
 * THE HONEST COSTS:
 *   - It is IMPLICIT. Reading `context.requestId` gives no hint about where the
 *     value came from, which is exactly the criticism people level at globals.
 *     The mitigation is to keep the stored object tiny and to use it only for
 *     cross-cutting concerns (logging, tracing) - never for business data.
 *   - async_hooks has a measurable cost. It is small on modern Node (single
 *     digit percent) but it is not zero, and it is why you store a few fields
 *     rather than a request object.
 *   - `run()` must wrap the whole request, or the store is empty in the parts
 *     it does not cover - which is why the middleware is registered for every
 *     route rather than selectively.
 * =============================================================================
 */
@Injectable()
export class RequestContextService {
  private readonly storage = new AsyncLocalStorage<RequestContext>();

  /**
   * Run `callback` with a fresh context. Everything awaited inside - however
   * deep - sees the same store.
   */
  run<T>(context: RequestContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  /**
   * Returns `undefined` outside a `run()` call - during bootstrap, in a script,
   * or in a queue worker that did not open a store. Callers must tolerate that
   * rather than assume a context exists; a logger that throws because there is
   * no request id is worse than one that omits it.
   */
  get(): RequestContext | undefined {
    return this.storage.getStore();
  }

  get requestId(): string | undefined {
    return this.storage.getStore()?.requestId;
  }

  /**
   * Guards run AFTER the middleware that opened the store, so the user id is
   * attached later. Mutating the stored object is safe: it belongs to exactly
   * one request.
   */
  setUserId(userId: string): void {
    const store = this.storage.getStore();
    if (store) store.userId = userId;
  }
}
