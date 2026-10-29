import { Inject, Injectable, Logger } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { Redis } from 'ioredis';

import { REDIS_CLIENT } from 'src/common/constants';

/**
 * =============================================================================
 * RedisThrottlerStorage - rate limiting that survives horizontal scaling
 * =============================================================================
 * `@nestjs/throttler`'s default storage is an in-memory Map. That is fine on
 * one instance and WRONG the moment you run two:
 *
 *     limit = 100/min, 4 instances behind a load balancer
 *     -> each instance counts independently
 *     -> the real limit is 400/min
 *
 * Worse, it is not even a consistent 400: a client whose requests happen to
 * land on one instance is limited at 100, another spread evenly gets 400. The
 * limit becomes a function of load-balancer luck.
 *
 * A SHARED COUNTER is the only correct answer, and Redis is the obvious place
 * for one - it is single-threaded, so `INCR` is atomic with no coordination.
 *
 * -----------------------------------------------------------------------------
 * THE ALGORITHM: fixed window, and its known flaw
 * -----------------------------------------------------------------------------
 *     INCR key            -> atomic counter
 *     if it was the first hit, PEXPIRE key ttl
 *
 * FIXED WINDOW is the simplest correct-enough algorithm, and its flaw is worth
 * being able to state: a client can send `limit` requests at 11:59:59 and
 * `limit` again at 12:00:00 - **twice the limit** in one second, straddling the
 * boundary.
 *
 * The alternatives, in order of cost:
 *   SLIDING WINDOW LOG    a sorted set of timestamps per client. Exact, and it
 *                         stores one entry per request - expensive at volume.
 *   SLIDING WINDOW COUNTER weighted average of the current and previous window.
 *                         Nearly exact, still O(1) memory. The usual production
 *                         choice.
 *   TOKEN BUCKET          allows controlled bursts, which is often what you
 *                         actually want for an API. Two values per client.
 *
 * Fixed window is used here because it is what `@nestjs/throttler`'s interface
 * models, and because a 2x burst at a window boundary is an acceptable failure
 * for a limit whose purpose is abuse prevention rather than billing. Knowing
 * which flaw you have chosen is the point.
 *
 * WHY NOT A PRE-BUILT PACKAGE? `@nest-lab/throttler-storage-redis` exists and
 * is perfectly good. Writing the twenty lines here means one fewer dependency,
 * full control of the degradation behaviour below - and, for the purpose of
 * this project, it makes the algorithm visible rather than hidden.
 * =============================================================================
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);

  /**
   * The fallback used when Redis is unreachable. See the long note at the
   * bottom of this file for why falling back rather than failing is the right
   * call HERE, and when it would not be.
   */
  private readonly memory = new Map<string, { hits: number; expiresAt: number }>();

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const namespaced = `throttle:${throttlerName}:${key}`;

    try {
      /**
       * A PIPELINE, not two round trips.
       *
       * `INCR` then `PTTL` in one network round trip. Redis executes the
       * commands in order without other clients interleaving between them,
       * which is what makes reading the TTL immediately after the increment
       * meaningful.
       */
      const [incrResult, pttlResult] = (await this.redis
        .pipeline()
        .incr(namespaced)
        .pttl(namespaced)
        .exec()) as [[Error | null, number], [Error | null, number]];

      const totalHits = incrResult[1];
      let timeToExpire = pttlResult[1];

      /**
       * `PTTL` returns -1 when the key exists with NO expiry. That happens on
       * the very first `INCR`, which creates the key without one - so the
       * window has to be set explicitly here.
       *
       * Forgetting this is a genuinely nasty bug: the counter never resets, and
       * every client is permanently rate-limited after their first `limit`
       * requests. It works fine in a short test and locks out production.
       */
      if (timeToExpire === -1) {
        await this.redis.pexpire(namespaced, ttl);
        timeToExpire = ttl;
      }

      return {
        totalHits,
        timeToExpire: Math.ceil(timeToExpire / 1000),
        isBlocked: totalHits > limit,
        timeToBlockExpire: Math.ceil((blockDuration || timeToExpire) / 1000),
      };
    } catch (error) {
      this.logger.debug(`Throttler storage unavailable, using memory: ${describe(error)}`);
      return this.incrementInMemory(namespaced, ttl, limit, blockDuration);
    }
  }

  /**
   * The degraded path. Same algorithm, per-process scope.
   *
   * NOTE this map is unbounded in principle - one entry per client key. It is
   * bounded in practice because entries are removed once expired and this path
   * is only reached during a Redis outage, but on a very large keyspace it is
   * worth an explicit cap. Naming the risk is better than pretending there
   * isn't one.
   */
  private incrementInMemory(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
  ): ThrottlerStorageRecord {
    const now = Date.now();
    const existing = this.memory.get(key);

    if (!existing || existing.expiresAt <= now) {
      this.memory.set(key, { hits: 1, expiresAt: now + ttl });
      return {
        totalHits: 1,
        timeToExpire: Math.ceil(ttl / 1000),
        isBlocked: false,
        timeToBlockExpire: Math.ceil((blockDuration || ttl) / 1000),
      };
    }

    existing.hits += 1;
    const timeToExpire = existing.expiresAt - now;

    return {
      totalHits: existing.hits,
      timeToExpire: Math.ceil(timeToExpire / 1000),
      isBlocked: existing.hits > limit,
      timeToBlockExpire: Math.ceil((blockDuration || timeToExpire) / 1000),
    };
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * =============================================================================
 * FAIL OPEN OR FAIL CLOSED WHEN REDIS IS DOWN?
 * =============================================================================
 * The three options, and what each one costs:
 *
 *   FAIL OPEN     allow everything. The API stays up; the rate limit is gone,
 *                 so an ongoing attack is unimpeded exactly when you are least
 *                 able to cope.
 *   FAIL CLOSED   reject everything. Nobody is abused; nobody is served either.
 *                 A cache outage becomes a full outage.
 *   DEGRADE       fall back to per-instance in-memory counting. <- what we do.
 *
 * Degrading gives an effective limit of `limit x instances` instead of `limit`,
 * which is worse than correct and far better than nothing. It is the same
 * instinct as Phase 3's rule - degrade on dependencies that make you faster -
 * applied to a dependency that makes you SAFER.
 *
 * WHEN THIS WOULD BE THE WRONG CHOICE: if the rate limit is the only thing
 * standing between an attacker and a brute-force login, or if it enforces a
 * paid quota, then a degraded limit is a security or revenue hole and failing
 * closed is defensible. The answer depends on what the limit is FOR, and
 * "always fail open" is not a rule - it is a decision you should be able to
 * justify per limit.
 * =============================================================================
 */
