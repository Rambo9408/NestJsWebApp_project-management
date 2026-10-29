import { Test } from '@nestjs/testing';

import { REDIS_CLIENT } from 'src/common/constants';

import { RedisThrottlerStorage } from './redis-throttler.storage';

interface PipelineChain {
  incr(key: string): PipelineChain;
  pttl(key: string): PipelineChain;
  exec(): Promise<Array<[Error | null, number]>>;
}

/**
 * =============================================================================
 * The rate-limiting ALGORITHM, tested directly
 * =============================================================================
 * Rate limiting is skipped in the e2e suites (see the note in
 * `cache.module.ts`), so this is where it is actually verified - and it is the
 * more valuable test anyway: the interesting behaviour is the counter and the
 * window, not the HTTP plumbing around them.
 *
 * "We disabled it in tests" is a smell unless you can say what you test
 * instead. This file is the answer.
 * =============================================================================
 */
describe('RedisThrottlerStorage', () => {
  /** A fake ioredis that can be switched to failing, to exercise the fallback. */
  class FakeRedis {
    readonly counters = new Map<string, number>();
    readonly ttls = new Map<string, number>();
    failing = false;

    /**
     * An ARROW property, and arrow methods inside the chain.
     *
     * The obvious `const self = this` is what ESLint's `no-this-alias` objects
     * to, and it is right: arrow functions capture `this` lexically, so the
     * chain's methods see the FakeRedis instance without an alias. Writing them
     * as shorthand object methods would rebind `this` to the chain object -
     * which is exactly the bug the rule exists to prevent.
     */
    pipeline = (): PipelineChain => {
      const commands: Array<() => number> = [];

      const chain: PipelineChain = {
        incr: (key: string) => {
          commands.push(() => {
            const next = (this.counters.get(key) ?? 0) + 1;
            this.counters.set(key, next);
            return next;
          });
          return chain;
        },
        pttl: (key: string) => {
          // -1 means "exists, no expiry" - exactly what Redis returns after the
          // first INCR creates the key.
          commands.push(() => this.ttls.get(key) ?? -1);
          return chain;
        },
        exec: (): Promise<Array<[Error | null, number]>> => {
          if (this.failing) return Promise.reject(new Error('ECONNREFUSED'));
          return Promise.resolve(commands.map((run) => [null, run()] as [Error | null, number]));
        },
      };

      return chain;
    };

    pexpire(key: string, ttl: number): Promise<number> {
      this.ttls.set(key, ttl);
      return Promise.resolve(1);
    }
  }

  let storage: RedisThrottlerStorage;
  let redis: FakeRedis;

  beforeEach(async () => {
    redis = new FakeRedis();

    const moduleRef = await Test.createTestingModule({
      providers: [RedisThrottlerStorage, { provide: REDIS_CLIENT, useValue: redis }],
    }).compile();

    storage = moduleRef.get(RedisThrottlerStorage);
  });

  it('counts hits and reports when the limit is exceeded', async () => {
    const limit = 3;

    const results = [];
    for (let i = 0; i < 4; i += 1) {
      results.push(await storage.increment('client-a', 60_000, limit, 0, 'default'));
    }

    expect(results.map((r) => r.totalHits)).toEqual([1, 2, 3, 4]);
    expect(results.map((r) => r.isBlocked)).toEqual([false, false, false, true]);
  });

  it('SETS THE WINDOW on the first hit', async () => {
    /**
     * The bug this guards against is nasty: `INCR` creates the key with NO
     * expiry, so `PTTL` returns -1. Miss that, and the counter never resets -
     * every client is permanently blocked after their first `limit` requests.
     * It passes a short test and locks out production.
     */
    await storage.increment('client-b', 60_000, 10, 0, 'default');

    expect(redis.ttls.get('throttle:default:client-b')).toBe(60_000);
  });

  it('keeps clients in SEPARATE buckets', async () => {
    await storage.increment('client-c', 60_000, 10, 0, 'default');
    await storage.increment('client-c', 60_000, 10, 0, 'default');
    const other = await storage.increment('client-d', 60_000, 10, 0, 'default');

    expect(other.totalHits).toBe(1);
  });

  it('keeps NAMED throttlers separate', async () => {
    // The same client under two limits - the general one and the strict auth
    // one - must not share a counter, or logging in would consume the API quota.
    await storage.increment('client-e', 60_000, 10, 0, 'default');
    const auth = await storage.increment('client-e', 900_000, 10, 0, 'auth');

    expect(auth.totalHits).toBe(1);
  });

  describe('when Redis is unavailable', () => {
    it('DEGRADES to per-instance counting rather than failing', async () => {
      redis.failing = true;

      const first = await storage.increment('client-f', 60_000, 2, 0, 'default');
      const second = await storage.increment('client-f', 60_000, 2, 0, 'default');
      const third = await storage.increment('client-f', 60_000, 2, 0, 'default');

      // Still counting, still blocking - just per process rather than globally.
      expect(first.totalHits).toBe(1);
      expect(second.totalHits).toBe(2);
      expect(third.isBlocked).toBe(true);
    });

    it('resets the in-memory window after it expires', async () => {
      redis.failing = true;

      await storage.increment('client-g', 1, 5, 0, 'default');
      await new Promise((resolve) => setTimeout(resolve, 5));
      const afterExpiry = await storage.increment('client-g', 1, 5, 0, 'default');

      expect(afterExpiry.totalHits).toBe(1);
    });
  });
});
