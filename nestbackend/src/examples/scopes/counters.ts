import { Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';

/**
 * =============================================================================
 * PROVIDER SCOPES - three classes, three lifetimes
 * =============================================================================
 * Every provider gets an `instanceId` at construction. Hit `GET /api/v1/scopes`
 * twice and compare: which ids change tells you exactly what each scope means,
 * without reading a word of documentation.
 * =============================================================================
 */

/**
 * -----------------------------------------------------------------------------
 * SCOPE 1: DEFAULT (singleton) - the one you want almost always
 * -----------------------------------------------------------------------------
 * WHAT: exactly ONE instance for the whole application, created at bootstrap,
 * shared by every consumer, alive until the process exits.
 *
 * WHY IT IS THE DEFAULT: it is the fastest possible answer. The instance is
 * built once, so per-request cost is zero, and it can hold expensive shared
 * things - a connection pool, a compiled regex, a warm cache.
 *
 * MEMORY IMPLICATION: a singleton lives forever, so anything it accumulates
 * lives forever too. `private readonly seen = new Map()` in a singleton with no
 * eviction is a textbook memory leak - it grows for the life of the process and
 * is invisible until the container OOMs at 3am.
 *
 * THE RULE THAT FOLLOWS: a singleton must be STATELESS with respect to a
 * request. Storing `this.currentUser` in a singleton is not a subtle bug - two
 * concurrent requests share the object, so request B overwrites request A's
 * user and A acts as B. That is a data-leak-shaped bug, and it is the single
 * most dangerous mistake in this entire topic.
 */
@Injectable()
export class SingletonCounter {
  readonly instanceId = randomUUID().slice(0, 8);
  /** Increments forever - deliberately, to show the instance is never replaced. */
  calls = 0;

  hit(): number {
    return ++this.calls;
  }
}

/**
 * -----------------------------------------------------------------------------
 * SCOPE 2: REQUEST - one instance per incoming request
 * -----------------------------------------------------------------------------
 * WHAT: Nest creates a fresh instance for every request, and can inject the
 * REQUEST object itself. It is garbage collected when the request finishes.
 *
 * WHEN IT IS GENUINELY USEFUL:
 *   - Per-request context that must reach code far from the controller:
 *     correlation id, tenant id, the authenticated user, a database transaction
 *     handle. (We build the production version of this in Phase 9.)
 *   - Multi-tenancy where the tenant decides which database connection to use.
 *
 * WHY IT IS NOT THE DEFAULT - the cost, stated precisely:
 *   1. ALLOCATION per request instead of once. Usually small, but not free.
 *   2. THE DEPENDENCY GRAPH IS REBUILT for the affected subtree on EVERY
 *      request - Nest re-resolves and re-instantiates each provider in that
 *      chain.
 *   3. IT IS CONTAGIOUS UPWARD. This is the part people miss:
 *
 *          Repository(REQUEST) -> Service -> Controller
 *
 *      makes the Service AND the Controller request-scoped too, automatically
 *      and silently. One request-scoped leaf can convert an entire vertical
 *      slice of your application into per-request construction. Nest calls this
 *      "scope bubbling", and it is the number-one interview question on this
 *      topic.
 *   4. YOU LOSE SINGLETON CACHING along that whole chain - anything the service
 *      memoised is thrown away every request.
 *
 * ALTERNATIVES, in order of preference:
 *   a) Pass the context as a method ARGUMENT. Explicit, zero framework magic,
 *      zero scope cost. Verbose when it must travel through five layers.
 *   b) `AsyncLocalStorage` (node:async_hooks) - a singleton service backed by
 *      per-request async context. This is how `nestjs-cls` works, and it is
 *      what most production Nest apps use for correlation ids precisely because
 *      it avoids scope bubbling entirely. Trade-off: implicit, and a genuine
 *      (small) performance cost on the async hooks.
 *   c) Request scope. Correct, framework-native, and the most expensive.
 *
 * A HARD CONSTRAINT WORTH KNOWING: `app.get(Token)` CANNOT retrieve a
 * request-scoped provider - there is no request. You need
 * `moduleRef.resolve(Token)` (see `ScopeInspectorService`). The same limitation
 * is why a request-scoped provider cannot be used as an `APP_GUARD`-style
 * global enhancer without making every request pay for it.
 */
@Injectable({ scope: Scope.REQUEST })
export class RequestScopedCounter {
  readonly instanceId = randomUUID().slice(0, 8);

  /**
   * `REQUEST` is a built-in token. Injecting it is only legal in a
   * request-scoped (or transient-inside-request-scoped) provider - there is no
   * request to give a singleton.
   */
  constructor(@Inject(REQUEST) private readonly request: Request) {}

  get path(): string {
    return this.request.url;
  }
}

/**
 * -----------------------------------------------------------------------------
 * SCOPE 3: TRANSIENT - a new instance for every INJECTION SITE
 * -----------------------------------------------------------------------------
 * WHAT: each consumer that injects this gets its OWN private instance. Note
 * carefully: per injection site, NOT per call and NOT per request. Two
 * singletons that both inject it hold two different instances, and each keeps
 * its instance for the life of the application.
 *
 * THE CANONICAL REAL USE: a logger that knows who owns it.
 *
 *     @Injectable({ scope: Scope.TRANSIENT })
 *     class ContextLogger {
 *       constructor(@Inject(INQUIRER) private parent: object) {
 *         this.context = parent.constructor.name;   // "UsersService"
 *       }
 *     }
 *
 * `INQUIRER` is a built-in token, valid only in transient providers, that gives
 * you the class that asked for the injection. That is how a transient logger
 * labels its own output without every service passing its own name.
 *
 * COMMON MISCONCEPTION: "transient means a new instance per request". It does
 * not. A transient provider injected into a singleton is created once, with the
 * singleton. Only a transient inside a REQUEST-scoped provider is recreated per
 * request - because its parent is.
 *
 * WHEN TO AVOID: for anything holding a connection or a cache. Transient means
 * N copies of that state, one per consumer, which is usually the opposite of
 * what you want.
 */
@Injectable({ scope: Scope.TRANSIENT })
export class TransientCounter {
  readonly instanceId = randomUUID().slice(0, 8);
}

/** Two singletons, each injecting the SAME transient token - and getting different objects. */
@Injectable()
export class ConsumerA {
  constructor(readonly transient: TransientCounter) {}
}

@Injectable()
export class ConsumerB {
  constructor(readonly transient: TransientCounter) {}
}
