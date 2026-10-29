import { Controller, Get } from '@nestjs/common';

import { Public } from 'src/auth/decorators/public.decorator';

import {
  ConsumerA,
  ConsumerB,
  RequestScopedCounter,
  SingletonCounter,
  TransientCounter,
} from './counters';
import { ScopeInspectorService } from './scope-inspector.service';

/**
 * =============================================================================
 * A TEACHING ENDPOINT: GET /api/v1/scopes
 * =============================================================================
 * Call it twice and read the ids:
 *
 *   singleton.instanceId        SAME on every request, forever
 *   singleton.calls             keeps counting up - proof it is never replaced
 *   requestScoped.instanceId    DIFFERENT on every request
 *   transient.inConsumerA/B     different from EACH OTHER, same across requests
 *   controller.instanceId       DIFFERENT on every request  <-- the contagion
 *
 * THAT LAST LINE IS THE WHOLE LESSON. This controller declares no scope. It is
 * request-scoped anyway, because it injects `RequestScopedCounter`. Scope
 * bubbles UPWARD through the dependency graph, silently, and converts every
 * consumer above it.
 *
 * In a real application that is how one "harmless" request-scoped repository
 * ends up rebuilding half your provider graph on every request. Nothing warns
 * you; the app just gets slower.
 *
 * NOTE: this module is only registered outside production (see
 * `app.module.ts`). Shipping a diagnostics endpoint that exposes internals is
 * a habit worth not forming - and conditional module registration is itself a
 * technique worth seeing.
 * =============================================================================
 */
@Controller('scopes')
export class ScopesController {
  /**
   * Generated per INSTANCE of this controller. Because the controller is
   * request-scoped by contagion, this changes on every request.
   */
  private readonly instanceId = Math.random().toString(36).slice(2, 10);

  constructor(
    private readonly singleton: SingletonCounter,
    private readonly requestScoped: RequestScopedCounter,
    private readonly transientDirect: TransientCounter,
    private readonly consumerA: ConsumerA,
    private readonly consumerB: ConsumerB,
    private readonly inspector: ScopeInspectorService,
  ) {}

  // A non-production teaching endpoint; @Public() so it is usable without a
  // token. It exposes only instance ids, never data.
  @Public()
  @Get()
  async describe(): Promise<Record<string, unknown>> {
    return {
      explanation:
        'Call this twice. Ids that change are per-request; ids that stay are singletons.',

      singleton: {
        instanceId: this.singleton.instanceId,
        callsSinceBoot: this.singleton.hit(),
        note: 'One instance for the whole process. Never rebuilt.',
      },

      requestScoped: {
        instanceId: this.requestScoped.instanceId,
        sawPath: this.requestScoped.path,
        note: 'New instance per request; can inject the REQUEST object.',
      },

      transient: {
        injectedIntoController: this.transientDirect.instanceId,
        injectedIntoConsumerA: this.consumerA.transient.instanceId,
        injectedIntoConsumerB: this.consumerB.transient.instanceId,
        note: 'One instance PER INJECTION SITE. A and B differ and are stable across requests; the controller one changes because the controller itself is request-scoped.',
      },

      controller: {
        instanceId: this.instanceId,
        note: 'This controller declares NO scope, yet it is rebuilt per request - scope bubbles upward from RequestScopedCounter.',
      },

      moduleRef: {
        detachedResolve: await this.inspector.resolveDetachedRequestScoped(),
        sameContextTwice: await this.inspector.resolveTwiceInOneContext(),
        note: 'resolve() mints a new DI sub-context unless you pass the same contextId.',
      },
    };
  }
}
