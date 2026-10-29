import { Test } from '@nestjs/testing';

import { REDIS_CLIENT } from 'src/common/constants';
import { AppConfigService } from 'src/config';

import { CacheService } from './cache.service';

/**
 * =============================================================================
 * The cache-aside behaviours worth asserting
 * =============================================================================
 * A fake Redis rather than a real one: the interesting logic here is OURS (the
 * miss/populate flow, the stampede de-duplication, the degradation on failure),
 * not Redis's. The SCAN-based invalidation is exercised against the real thing
 * in the integration suite, because that is where the keyPrefix subtlety lives.
 * =============================================================================
 */
describe('CacheService', () => {
  /** A minimal in-memory stand-in for the subset of ioredis we use. */
  class FakeRedis {
    readonly store = new Map<string, string>();
    readonly options = { keyPrefix: 'test:' };
    failing = false;

    get(key: string): Promise<string | null> {
      if (this.failing) return Promise.reject(new Error('ECONNREFUSED'));
      return Promise.resolve(this.store.get(key) ?? null);
    }

    // Signature mirrors the ioredis overload we call: set(key, value, 'EX', ttl)
    set(key: string, value: string, _mode?: string, _ttl?: number): Promise<'OK'> {
      if (this.failing) return Promise.reject(new Error('ECONNREFUSED'));
      this.store.set(key, value);
      return Promise.resolve('OK');
    }

    del(...keys: string[]): Promise<number> {
      let removed = 0;
      for (const key of keys) if (this.store.delete(key)) removed += 1;
      return Promise.resolve(removed);
    }
  }

  let cache: CacheService;
  let redis: FakeRedis;

  beforeEach(async () => {
    redis = new FakeRedis();

    const moduleRef = await Test.createTestingModule({
      providers: [
        CacheService,
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: AppConfigService, useValue: { cache: { defaultTtl: 60 } } },
      ],
    }).compile();

    cache = moduleRef.get(CacheService);
  });

  describe('getOrSet', () => {
    it('calls the factory on a MISS and caches the result', async () => {
      let calls = 0;
      const factory = () => {
        calls += 1;
        return Promise.resolve({ id: '1', name: 'Ada' });
      };

      const first = await cache.getOrSet('user:1', factory);
      const second = await cache.getOrSet('user:1', factory);

      expect(first).toEqual({ id: '1', name: 'Ada' });
      expect(second).toEqual({ id: '1', name: 'Ada' });
      expect(calls).toBe(1); // the second call was a HIT
    });

    it('DE-DUPLICATES concurrent misses - the stampede defence', async () => {
      /**
       * Without the in-flight map, fifty concurrent misses on the same key
       * become fifty database reads - and that happens precisely when a popular
       * key expires under load, which is how a cache expiry becomes an outage.
       */
      let calls = 0;
      const slowFactory = () => {
        calls += 1;
        return new Promise((resolve) => setTimeout(() => resolve({ value: 'expensive' }), 20));
      };

      const results = await Promise.all(
        Array.from({ length: 50 }, () => cache.getOrSet('hot-key', slowFactory)),
      );

      expect(calls).toBe(1);
      expect(results).toHaveLength(50);
      expect(
        results.every((r) => JSON.stringify(r) === JSON.stringify({ value: 'expensive' })),
      ).toBe(true);
    });

    it('does NOT cache a failure, and does not poison later callers', async () => {
      /**
       * If a rejected promise stayed in the in-flight map, every later caller
       * would inherit the same error - a cached failure, the worst kind. The
       * `finally` in `getOrSet` is what prevents it.
       */
      let attempt = 0;
      const flaky = () => {
        attempt += 1;
        return attempt === 1
          ? Promise.reject(new Error('database down'))
          : Promise.resolve('recovered');
      };

      await expect(cache.getOrSet('flaky', flaky)).rejects.toThrow('database down');
      await expect(cache.getOrSet('flaky', flaky)).resolves.toBe('recovered');
    });

    it('does NOT cache null - see the cache-penetration note', async () => {
      let calls = 0;
      const missing = () => {
        calls += 1;
        return Promise.resolve(null);
      };

      await cache.getOrSet('absent', missing);
      await cache.getOrSet('absent', missing);

      // Both went to the factory: a record created a second later must be
      // visible immediately, not after the TTL.
      expect(calls).toBe(2);
    });
  });

  describe('degradation when Redis is unavailable', () => {
    it('treats a failed GET as a MISS rather than throwing', async () => {
      redis.failing = true;

      // The whole design decision from Phase 3, asserted: Redis makes us
      // faster, not correct, so an outage must never produce a 500.
      await expect(cache.get('anything')).resolves.toBeNull();
    });

    it('swallows a failed SET', async () => {
      redis.failing = true;
      await expect(cache.set('key', { a: 1 })).resolves.toBeUndefined();
    });

    it('still returns the factory result when the cache is down', async () => {
      redis.failing = true;

      await expect(cache.getOrSet('key', () => Promise.resolve('from the database'))).resolves.toBe(
        'from the database',
      );
    });
  });

  describe('TTL jitter', () => {
    it('does not use the exact same expiry for every entry', async () => {
      /**
       * Not a strict assertion on randomness - just proof that the jitter code
       * path runs and produces values around the configured TTL. Without it,
       * a hundred entries written in one burst all expire in the same second
       * and the database sees a synchronised spike.
       */
      const ttls = new Set<number>();
      const spy = jest.spyOn(redis, 'set');

      for (let i = 0; i < 30; i += 1) {
        await cache.set(`key:${i}`, i, 100);
      }

      for (const call of spy.mock.calls) {
        ttls.add(call[3] as number);
      }

      // 30 writes should not all land on the same TTL.
      expect(ttls.size).toBeGreaterThan(1);
    });
  });
});
