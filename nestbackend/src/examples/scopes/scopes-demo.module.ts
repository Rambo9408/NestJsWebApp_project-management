import { DynamicModule, Module } from '@nestjs/common';

import {
  ConsumerA,
  ConsumerB,
  RequestScopedCounter,
  SingletonCounter,
  TransientCounter,
} from './counters';
import { ScopeInspectorService } from './scope-inspector.service';
import { ScopesController } from './scopes.controller';

/**
 * =============================================================================
 * A DYNAMIC MODULE, written by hand
 * =============================================================================
 * Phase 1 explained dynamic modules from the consumer side
 * (`ConfigModule.forRoot()`). This is the other side: a static method that
 * RETURNS a `DynamicModule` object.
 *
 *     { module, imports?, providers?, controllers?, exports?, global? }
 *
 * `registerIf(false)` returns a module with nothing in it - so the routes are
 * never mapped and the providers never built. That is a genuinely useful
 * pattern for feature-flagged modules, and it is why a diagnostics endpoint can
 * exist in the codebase without existing in production.
 *
 * ALTERNATIVE for the same job: conditional spreading in the parent's imports -
 *     imports: [...(isDev ? [ScopesDemoModule] : [])]
 * Simpler, and it puts the decision at the composition root, which is arguably
 * where it belongs. The trade-off is that the module cannot enforce its own
 * rule. We use the dynamic-module form here because writing one by hand once is
 * the fastest way to stop finding `forRoot()` mysterious.
 *
 * For anything more elaborate, Nest ships `ConfigurableModuleBuilder`, which
 * generates the `register`/`registerAsync`/`OPTIONS_TYPE` boilerplate for you.
 * =============================================================================
 */
@Module({})
export class ScopesDemoModule {
  static registerIf(enabled: boolean): DynamicModule {
    if (!enabled) {
      // An empty module: imported, instantiated, contributes nothing.
      return { module: ScopesDemoModule };
    }

    return {
      module: ScopesDemoModule,
      controllers: [ScopesController],
      providers: [
        SingletonCounter,
        RequestScopedCounter,
        TransientCounter,
        ConsumerA,
        ConsumerB,
        ScopeInspectorService,
      ],
    };
  }
}
