import { Module } from '@nestjs/common';

import { RedisThrottlerStorage } from './redis-throttler.storage';

/**
 * =============================================================================
 * A one-provider module, and the error that forced it
 * =============================================================================
 * `RedisThrottlerStorage` was originally declared in `CacheModule.providers`,
 * next to everything else it belongs with. That failed at boot:
 *
 *     Nest can't resolve dependencies of the THROTTLER:MODULE_OPTIONS
 *     (AppConfigService, ?). Please make sure that the argument
 *     RedisThrottlerStorage at index [1] is available in the ThrottlerModule
 *     module.
 *
 * Read the last five words: **in the ThrottlerModule module**.
 *
 * WHY: a `forRootAsync` factory is resolved inside the DYNAMIC MODULE it
 * configures, not inside the module that called it. So `ThrottlerModule`'s
 * container has to be able to see `RedisThrottlerStorage` - and it cannot see
 * `CacheModule`'s providers, because a module's providers are private (Phase 2)
 * and `ThrottlerModule` does not import `CacheModule`.
 *
 * This is the Phase 4 debugging checklist working exactly as written: the class
 * WAS decorated, it WAS registered in a module - but it was not EXPORTED from a
 * module that the consumer IMPORTS. The fix is the honest one, not a
 * `@Global()` sticking plaster:
 *
 *     ThrottlerModule.forRootAsync({
 *       imports: [ThrottlerStorageModule],   // <- makes the storage visible
 *       inject: [AppConfigService, RedisThrottlerStorage],
 *       ...
 *     })
 *
 * `AppConfigService` resolved fine all along because `AppConfigModule` is
 * `@Global()` - which is also why the error named only the second argument.
 * A useful reminder that "it works for the other dependency" tells you about
 * that dependency's module, not about yours.
 *
 * WHY NOT JUST MAKE THIS @Global() TOO? Because one storage class used by one
 * dynamic module is precisely the case `@Global()` is not for. A tiny module
 * with one export states the dependency; a global one hides it.
 * =============================================================================
 */
@Module({
  providers: [RedisThrottlerStorage],
  exports: [RedisThrottlerStorage],
})
export class ThrottlerStorageModule {}
