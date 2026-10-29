import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';

import { AppConfigService } from 'src/config';

import { CacheService } from './cache.service';
import { RedisThrottlerStorage } from './redis-throttler.storage';
import { SmartThrottlerGuard } from './smart-throttler.guard';
import { ThrottlerStorageModule } from './throttler-storage.module';

/**
 * =============================================================================
 * CacheModule - caching and rate limiting, both built on Redis
 * =============================================================================
 * Two concerns in one module because they share one dependency and one
 * degradation story. Neither owns the Redis CONNECTION - that is `RedisModule`
 * (Phase 3), for the reason given there: three subsystems need a socket, and
 * making `queue/` import `cache/` to get one would state something false about
 * the architecture.
 * =============================================================================
 */
@Global()
@Module({
  imports: [
    /**
     * `ThrottlerModule.forRootAsync` - async because the limits come from
     * validated configuration rather than being hard-coded.
     *
     * ONE GLOBAL THROTTLER, and the reason there is only one is a REAL OUTAGE
     * this file used to cause. Worth reading before adding a second.
     *
     * -------------------------------------------------------------------------
     * THE BUG: A SECOND NAMED THROTTLER RATE-LIMITED THE ENTIRE API TO 10
     * REQUESTS PER 15 MINUTES
     * -------------------------------------------------------------------------
     * This array used to contain a second entry:
     *
     *     { name: 'auth', ttl: 15 * 60 * 1000, limit: 10 }
     *
     * with a comment explaining that a route opts into it via `@Throttle`. That
     * is the wrong mental model, and it is the single most common mistake with
     * this library.
     *
     * IN @nestjs/throttler v5+, EVERY THROTTLER IN THIS ARRAY IS ENFORCED ON
     * EVERY ROUTE. The array is not a menu of limits to opt into - it is a list
     * of limits that ALL APPLY. `@Throttle({ auth: {...} })` RECONFIGURES the
     * named throttler for one handler; it does not enable it. Opting OUT is
     * `@SkipThrottle({ auth: true })`, per route, everywhere else.
     *
     * So the strictest limit in the array became the effective limit for the
     * whole API. Every user, every endpoint: ten requests, then 429 for
     * fifteen minutes. A dashboard that fires four requests on load exhausted
     * nearly half of it.
     *
     * HOW IT WAS FOUND, which is the transferable part: not by reading this
     * file - the code and its comment were internally consistent and both read
     * as correct. It was found by sending fourteen requests to a health probe
     * and watching requests 11-14 return 429.
     *
     * AND IT HAD A VISIBLE SYMPTOM NOBODY HAD CONNECTED: the api container had
     * been sitting at `unhealthy` with a failing streak of 11. The Docker
     * HEALTHCHECK polls /health/live every 30 seconds - 30 requests per 15
     * minutes against a limit of 10. THE CONTAINER WAS RATE-LIMITING ITS OWN
     * LIVENESS PROBE, permanently, from about five minutes after boot.
     *
     * In an orchestrator that would be a crash loop: probe fails, pod is
     * killed, restarts, serves traffic for five minutes, fails again. And the
     * restart makes it WORSE under load, because a fresh replica attracts more
     * traffic and burns the ten requests faster.
     *
     * -------------------------------------------------------------------------
     * THE CORRECT SHAPE, which is what is here now
     * -------------------------------------------------------------------------
     *   - ONE global throttler: the general API limit.
     *   - Stricter limits declared PER ROUTE with `@Throttle`, next to the
     *     route they protect (see auth.controller.ts).
     *   - `@SkipThrottle()` on the health controller, because probes must never
     *     be rate-limited.
     *
     * The rule of thumb: a limit belongs where its scope is. A global array is
     * global scope; "login is special" is route scope. Declaring a route-scoped
     * concern in a global list and hoping something narrows it later is how
     * this happened.
     *
     * WHY LOGIN STILL NEEDS ITS OWN LIMIT: it is the one route where an
     * attacker chooses how much CPU you spend - each attempt costs a bcrypt
     * hash (~250ms of single-threaded work, Phase 3). It is also where the
     * limit does SECURITY work rather than fairness work, turning a
     * credential-stuffing run from thousands of guesses a minute into ten in
     * fifteen minutes.
     */
    ThrottlerModule.forRootAsync({
      /**
       * REQUIRED. A forRootAsync factory resolves inside the DYNAMIC MODULE it
       * configures, not inside CacheModule - so ThrottlerModule has to import
       * the module that exports the storage. See throttler-storage.module.ts
       * for the exact error this omission produced.
       */
      imports: [ThrottlerStorageModule],
      inject: [AppConfigService, RedisThrottlerStorage],
      useFactory: (config: AppConfigService, storage: RedisThrottlerStorage) => ({
        throttlers: [
          // EXACTLY ONE. Anything added here applies to every route in the
          // application - see the note above for what that cost last time.
          { name: 'default', ttl: config.throttle.ttl, limit: config.throttle.limit },
        ],
        storage,

        /**
         * SKIP RATE LIMITING IN TESTS, and say why rather than hiding it.
         *
         * The e2e suites make dozens of authenticated requests and several
         * logins in a few seconds; a realistic limit would fail them for the
         * wrong reason and, worse, INTERMITTENTLY - which is how a suite
         * becomes something people re-run until it goes green.
         *
         * The cost is that the limits are not exercised end to end, so the
         * ALGORITHM is unit-tested directly instead (see
         * `redis-throttler.storage.spec.ts`) - which is the more valuable test
         * anyway, because the interesting behaviour is the counter and the
         * window, not the HTTP plumbing.
         *
         * This is a trade-off worth being able to defend: "we disabled it in
         * tests" is a smell unless you can say what you test instead.
         */
        skipIf: () => config.isTest,
      }),
    }),
  ],
  providers: [
    CacheService,

    /**
     * The THIRD global guard. Order across all three:
     *
     *     JwtAuthGuard      (AuthModule)  - who are you?
     *     RolesGuard        (AuthModule)  - may you?
     *     SmartThrottlerGuard (here)      - how often?
     *
     * Throttling runs LAST on purpose, and the reasoning is worth stating: it
     * keys by USER ID when available, which requires `request.user` - populated
     * by the JWT guard. Registered before it, every request would be counted as
     * anonymous and bucketed by IP.
     *
     * The counter-argument is real: rejecting an over-limit request BEFORE
     * verifying its token would save the signature check. That matters when the
     * limit is your defence against a flood - but a JWT verification is
     * microseconds, and per-user limits are worth far more than the saving. If
     * you were being flooded, the limit belongs at the edge (a CDN or WAF), not
     * in the application at all.
     */
    { provide: APP_GUARD, useClass: SmartThrottlerGuard },
  ],
  exports: [CacheService],
})
export class CacheModule {}
