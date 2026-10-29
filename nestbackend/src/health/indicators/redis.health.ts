import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';
import type Redis from 'ioredis';

import { REDIS_CLIENT } from 'src/common/constants';

/**
 * =============================================================================
 * A CUSTOM HEALTH INDICATOR
 * =============================================================================
 * Terminus ships indicators for Mongoose, TypeORM, HTTP, disk and memory. For
 * anything else - Redis, a queue, a third-party API - you write one, and it is
 * about fifteen lines.
 *
 * TERMINUS 11 CHANGED THE API. The old pattern was to extend `HealthIndicator`
 * and call `this.getStatus(key, isHealthy, data)`, throwing `HealthCheckError`
 * on failure. Terminus 11 replaces that with `HealthIndicatorService`, which is
 * INJECTED rather than inherited:
 *
 *     const indicator = this.healthIndicatorService.check(key);
 *     return indicator.up({ ... });   // or indicator.down({ ... })
 *
 * WHY THE CHANGE MATTERS BEYOND SYNTAX: the old API signalled failure by
 * THROWING, which meant a "down" result and a genuine bug in your indicator
 * looked identical from the outside. The new one returns a value, so the
 * distinction survives - and composition (`.down()` inside a `catch`) is
 * explicit rather than implied by control flow.
 *
 * This is exactly the kind of version-specific detail worth knowing: most
 * tutorials and most of the internet still show the pre-11 pattern, and it does
 * not compile here.
 * =============================================================================
 */
@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * `PING` is the right probe, and the reason is worth stating: it exercises the
   * full round trip - socket, auth, and the server's event loop - while costing
   * Redis essentially nothing.
   *
   * WHAT NOT TO DO: `INFO` (returns kilobytes of stats you then have to parse),
   * `SET`/`GET` of a probe key (a write on every probe, from every instance,
   * forever), or checking `client.status === 'ready'` (that is ioredis's own
   * opinion of the connection, not evidence that the server is answering).
   *
   * THE TIMEOUT IS THE IMPORTANT PART. Without it, a Redis server that accepts
   * connections but never replies - a genuinely common failure, e.g. under
   * memory pressure or a network partition - leaves this promise pending, and
   * the health endpoint hangs. A probe that hangs is worse than one that fails:
   * the orchestrator's own timeout fires, and you get no diagnostic at all.
   */
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    const startedAt = Date.now();

    try {
      /**
       * A NOTE ON WHAT IS *NOT* CHECKED HERE: an explicit `pong !== 'PONG'`
       * branch. ioredis types `ping()` as `Promise<'PONG'>`, so TypeScript
       * narrows the failure branch to `never` and the compiler proves it
       * unreachable. Writing it anyway would be defensive code the type system
       * has already discharged - and the linter says so.
       *
       * A REAL failure does not come back as a wrong string; it comes back as a
       * rejected promise (connection refused, auth failure) or as no answer at
       * all - which is what the timeout below is for.
       */
      await Promise.race([
        this.redis.ping(),
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error('Redis PING timed out after 1000ms')), 1_000).unref(),
        ),
      ]);

      /**
       * REPORTING LATENCY, not just up/down. "Redis is up" and "Redis is up and
       * answering in 340ms" are very different operational facts, and the second
       * one is what tells you an incident is starting before it becomes an
       * outage.
       */
      /**
       * NOTE THE FIELD IS `connection`, NOT `status`. Terminus reserves `status`
       * for its own up/down value and strips it from the payload type - the
       * compile error (`Type 'RedisStatus' is not assignable to type 'never'`)
       * is genuinely unhelpful about why.
       */
      return indicator.up({ latencyMs: Date.now() - startedAt, connection: this.redis.status });
    } catch (error) {
      return indicator.down({
        message: error instanceof Error ? error.message : 'Redis is unreachable',
        connection: this.redis.status,
        latencyMs: Date.now() - startedAt,
      });
    }
  }
}
