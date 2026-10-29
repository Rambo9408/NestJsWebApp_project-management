import { Injectable } from '@nestjs/common';
import { ContextIdFactory, ModuleRef } from '@nestjs/core';

import { RequestScopedCounter } from './counters';

/**
 * =============================================================================
 * `ModuleRef` - reaching into the container by hand
 * =============================================================================
 * `ModuleRef` is Nest's own injector, injectable like any provider. It has two
 * methods, and the difference between them is exam material:
 *
 *   get(TOKEN)        - synchronous. Returns the SINGLETON instance.
 *                       THROWS for request- or transient-scoped providers,
 *                       because there is no instance to hand you.
 *                       `{ strict: false }` widens the search beyond the
 *                       current module to the whole application.
 *
 *   resolve(TOKEN)    - async. Creates and returns a NEW instance of a
 *                       scoped provider. Each call gives you a different one
 *                       unless you pass the same `contextId`.
 *
 * WHEN `ModuleRef` IS THE RIGHT TOOL:
 *   - Resolving a scoped provider from a singleton (this class).
 *   - Genuinely dynamic dispatch: "given a string from the database, give me
 *     the handler registered for it" - a plugin registry.
 *   - Breaking a circular dependency LAZILY, by resolving in a method instead
 *     of the constructor (see the note in `users.service.ts`).
 *
 * WHEN IT IS A MISTAKE - and this matters more than the API:
 * using it as a general SERVICE LOCATOR. If your constructors are empty and
 * every method starts with `this.moduleRef.get(...)`, you have thrown away
 * everything DI gives you: dependencies are no longer visible in the
 * signature, missing ones fail at CALL time instead of BOOT time, and tests
 * must stub the container instead of passing a fake. Constructor injection is
 * declarative; ModuleRef is imperative. Prefer the declarative one, and treat
 * every ModuleRef call as needing a one-line justification.
 * =============================================================================
 */
@Injectable()
export class ScopeInspectorService {
  constructor(private readonly moduleRef: ModuleRef) {}

  /**
   * Resolve a REQUEST-scoped provider from inside a SINGLETON.
   *
   * `resolve()` with no contextId mints a brand-new DI sub-context, so the
   * instance you get here is NOT the one bound to the current HTTP request -
   * it is a fresh, orphaned one. Two consequences worth knowing:
   *
   *   - It cannot inject `REQUEST` meaningfully (Nest supplies a placeholder),
   *     so this trick is only safe for scoped providers that do not depend on
   *     the actual request.
   *   - To get the instance belonging to the CURRENT request you must pass its
   *     context id, obtained with `ContextIdFactory.getByRequest(req)`, which
   *     means you need the request - and if you have the request, you are
   *     usually better off injecting the provider normally and letting Nest do
   *     the bubbling.
   *
   * We do it here purely to make the distinction visible in the response.
   */
  async resolveDetachedRequestScoped(): Promise<string> {
    const instance = await this.moduleRef.resolve(RequestScopedCounter);
    return instance.instanceId;
  }

  /**
   * The same resolution, but bound to a context id you control.
   *
   * Passing the SAME `contextId` twice returns the SAME instance - which is
   * exactly how Nest gives every provider in one request the same
   * request-scoped object. This method proves the mechanism: two resolves, one
   * id, one instance.
   */
  async resolveTwiceInOneContext(): Promise<{ first: string; second: string; same: boolean }> {
    const contextId = ContextIdFactory.create();

    const first = await this.moduleRef.resolve(RequestScopedCounter, contextId);
    const second = await this.moduleRef.resolve(RequestScopedCounter, contextId);

    return {
      first: first.instanceId,
      second: second.instanceId,
      same: first === second,
    };
  }
}
