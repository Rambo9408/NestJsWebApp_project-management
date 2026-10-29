import { Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

import { REDIS_CLIENT } from 'src/common/constants';
import { AppConfigService } from 'src/config';

/**
 * =============================================================================
 * CacheService - cache-aside, with the failure modes handled
 * =============================================================================
 * THE CACHE-ASIDE (lazy-loading) PATTERN:
 *
 *     read:   cache hit?  -> return it
 *             cache miss? -> read the database, WRITE the cache, return it
 *     write:  write the database, then INVALIDATE the cache entry
 *
 * The application owns the cache. Compare with the alternatives:
 *
 *   READ-THROUGH / WRITE-THROUGH  the cache library talks to the database for
 *                                 you. Less application code, less control, and
 *                                 you need a library that supports your store.
 *   WRITE-BEHIND                  write to the cache, flush to the database
 *                                 asynchronously. Very fast writes; you can
 *                                 lose data on a crash. Almost never right for
 *                                 a system of record.
 *
 * Cache-aside is the default for good reasons: it is explicit, it works with
 * any store, and a cache outage degrades to "slow" rather than "broken".
 *
 * -----------------------------------------------------------------------------
 * THE THREE HARD PARTS, all handled below
 * -----------------------------------------------------------------------------
 *   1. INVALIDATION  - `delByPrefix`, called from every write path.
 *   2. STAMPEDE      - `getOrSet` de-duplicates concurrent misses.
 *   3. THE CACHE ITSELF FAILING - every method degrades to a miss.
 *
 * That third one is the design decision from Phase 3 made real: Redis makes us
 * faster, it does not make us correct, so a Redis outage must never produce a
 * 500. Every method here swallows connection errors and behaves as though the
 * key was absent.
 * =============================================================================
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly defaultTtl: number;

  /**
   * In-flight lookups, keyed by cache key.
   *
   * This is the CACHE STAMPEDE (thundering herd) defence for a single process:
   * when 50 concurrent requests miss the same key, the first one starts the
   * database read and the other 49 await the SAME promise instead of starting
   * 49 more.
   *
   * WHY IT MATTERS: a stampede is at its worst exactly when you can least
   * afford it - a popular key expires under load, and every in-flight request
   * hits the database simultaneously. That is how a cache expiry becomes an
   * outage.
   *
   * ITS LIMIT, stated honestly: this is PER PROCESS. With ten instances you get
   * ten concurrent rebuilds instead of five hundred - a 50x improvement, not a
   * complete fix. The cross-instance version needs a distributed lock (SET NX
   * PX + a token, released with a Lua compare-and-delete), and that brings its
   * own problems: lock expiry during a slow rebuild, and the need for a
   * fencing token. Worth doing for genuinely expensive keys; overkill for a
   * 2ms document read.
   */
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: AppConfigService,
  ) {
    this.defaultTtl = config.cache.defaultTtl;
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(key);
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch (error) {
      /**
       * DEGRADE, DO NOT THROW. A cache read that fails is a cache MISS - the
       * caller falls through to the database and the request succeeds, slower.
       *
       * `debug`, not `error`: during a Redis outage this fires on every
       * request, and an error-level log per request will bury the ONE line that
       * says Redis went away. The connection-level events in `redis.module.ts`
       * are where that is reported.
       */
      this.logger.debug(`Cache get failed for ${key}: ${describe(error)}`);
      return null;
    }
  }

  /**
   * Store a value with a TTL.
   *
   * EVERY ENTRY HAS A TTL, deliberately - there is no way to call this without
   * one. An entry with no expiry lives until something explicitly deletes it,
   * and the one code path that forgets to invalidate produces data that is
   * wrong forever. A TTL is the backstop that turns "wrong forever" into
   * "wrong for at most N seconds", which is the difference between a bug and an
   * incident.
   */
  async set<T>(key: string, value: T, ttlSeconds = this.defaultTtl): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', withJitter(ttlSeconds));
    } catch (error) {
      this.logger.debug(`Cache set failed for ${key}: ${describe(error)}`);
    }
  }

  async del(keys: string | string[]): Promise<void> {
    const list = Array.isArray(keys) ? keys : [keys];
    if (list.length === 0) return;

    try {
      await this.redis.del(...list);
    } catch (error) {
      this.logger.debug(`Cache delete failed: ${describe(error)}`);
    }
  }

  /**
   * Delete every key under a prefix - the invalidation used by write paths.
   *
   * ---------------------------------------------------------------------------
   * SCAN, NEVER `KEYS`
   * ---------------------------------------------------------------------------
   * `KEYS pattern` walks the ENTIRE keyspace in one blocking operation. Redis is
   * single-threaded, so on a large database that command stalls every other
   * client for the duration - hundreds of milliseconds or worse. Running `KEYS`
   * in production is a well-known way to cause an outage, and it is still the
   * first thing most examples show.
   *
   * `SCAN` is a cursor: it returns a few keys at a time and lets other commands
   * run in between. The guarantee is weaker (a key present for the whole scan
   * is returned at least once; keys added or removed during it may or may not
   * appear), which is exactly the right trade for invalidation - a slightly
   * stale extra key is harmless, a stalled Redis is not.
   *
   * `ioredis`'s `scanStream` handles the cursor loop.
   *
   * NOTE the `keyPrefix` subtlety: ioredis prefixes the keys you WRITE, but the
   * MATCH pattern for SCAN is sent raw, and the keys it returns are the full,
   * prefixed ones. So the pattern needs the prefix, and the returned keys must
   * be unprefixed before being passed back to `del` - otherwise the prefix is
   * applied twice and nothing is deleted. This is the single most common
   * ioredis-plus-keyPrefix bug.
   */
  async delByPrefix(prefix: string): Promise<number> {
    const keyPrefix = this.redis.options.keyPrefix ?? '';
    let deleted = 0;

    try {
      const stream = this.redis.scanStream({ match: `${keyPrefix}${prefix}*`, count: 100 });

      for await (const batch of stream as AsyncIterable<string[]>) {
        if (batch.length === 0) continue;

        // Strip the prefix ioredis will add back on `del`.
        const unprefixed = batch.map((key) => key.slice(keyPrefix.length));
        deleted += await this.redis.del(...unprefixed);
      }
    } catch (error) {
      this.logger.debug(`Cache prefix delete failed for ${prefix}: ${describe(error)}`);
    }

    return deleted;
  }

  /**
   * ===========================================================================
   * getOrSet - the cache-aside pattern in one call
   * ===========================================================================
   * Everything a caller needs: check the cache, and on a miss run `factory`,
   * store the result and return it.
   *
   * The reason it exists as a helper rather than three lines at each call site
   * is the STAMPEDE handling: without the in-flight map, N concurrent misses
   * become N database reads. With it, they become one.
   */
  async getOrSet<T>(key: string, factory: () => Promise<T>, ttlSeconds?: number): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    // Someone else is already computing this key - await their result.
    const existing = this.inFlight.get(key) as Promise<T> | undefined;
    if (existing) return existing;

    const promise = factory()
      .then(async (value) => {
        // `null`/`undefined` is deliberately NOT cached - see the note below.
        if (value !== null && value !== undefined) {
          await this.set(key, value, ttlSeconds);
        }
        return value;
      })
      .finally(() => {
        // ALWAYS clear the entry, including on failure. Leaving a rejected
        // promise in the map would make every later caller inherit the same
        // error - a cached failure, which is the worst kind.
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, promise);
    return promise;
  }
}

/**
 * =============================================================================
 * TTL JITTER - why the TTL is randomised by +/-10%
 * =============================================================================
 * If a hundred cache entries are written during the same burst with the same
 * TTL, they all expire in the same second. Every one of them then misses at
 * once, and the database sees a synchronised spike - the stampede problem again,
 * but caused by the CACHE rather than by traffic.
 *
 * It is self-reinforcing: the spike slows the rebuilds, the rebuilds finish
 * together, and the next expiry is synchronised too. Systems have oscillated
 * like this for hours.
 *
 * Spreading expiries over a window breaks the synchronisation. Ten percent is a
 * common default; the exact number matters far less than the fact that it is
 * not zero.
 */
function withJitter(ttlSeconds: number): number {
  const jitter = ttlSeconds * 0.1;
  return Math.max(1, Math.round(ttlSeconds - jitter + Math.random() * jitter * 2));
}

/**
 * =============================================================================
 * WHY `null` IS NOT CACHED, AND WHEN IT SHOULD BE
 * =============================================================================
 * `getOrSet` skips storing empty results, so a lookup for a missing record hits
 * the database every time.
 *
 * That is the right default here: the alternative caches a negative result, and
 * a record CREATED a second later is then invisible for the whole TTL - a bug
 * that looks like "the API is eventually consistent with itself" and is
 * miserable to debug.
 *
 * BUT it leaves a real hole worth naming: CACHE PENETRATION. An attacker
 * requesting random non-existent ids bypasses the cache entirely and sends
 * every request to the database. If that becomes a problem, the standard
 * answers are:
 *   - cache the negative result with a SHORT ttl (5-30s), accepting the
 *     staleness, or
 *   - a Bloom filter of existing ids in front of the cache.
 * Both are worth knowing by name; neither is worth the complexity until the
 * traffic justifies it.
 * =============================================================================
 */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
