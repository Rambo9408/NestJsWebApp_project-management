import { Global, Inject, Logger, Module, OnApplicationShutdown, Provider } from '@nestjs/common';
import { Redis, RedisOptions } from 'ioredis';

import { REDIS_CLIENT, REDIS_SUBSCRIBER } from 'src/common/constants';
import { AppConfigService } from 'src/config';

/**
 * =============================================================================
 * CUSTOM PROVIDER #3b: an ASYNC `useFactory`
 * =============================================================================
 * The notifications factory made a synchronous decision. This one performs
 * I/O - and that is the case `useFactory` exists for above all others.
 *
 *     useFactory: async (config) => { const client = new Redis(...); await ...; return client; }
 *
 * If the factory returns a Promise, NEST AWAITS IT before the application
 * finishes bootstrapping. That single behaviour is why you cannot express this
 * with `useClass` (a constructor cannot be async) or `useValue` (the value must
 * already exist at module-evaluation time, before configuration is even
 * validated).
 *
 * -----------------------------------------------------------------------------
 * WHY A SEPARATE `redis/` MODULE, WHEN THE BRIEF'S LAYOUT HAS `cache/`?
 * -----------------------------------------------------------------------------
 * Because THREE subsystems need Redis and they are not the same concern:
 *
 *     cache/   - cache-aside GET/SET with TTLs            (Phase 10)
 *     queue/   - BullMQ job storage                       (Phase 12)
 *     SSE      - pub/sub fan-out across instances         (Phase 11)
 *
 * If the connection lived in `cache/`, then `queue/` would import `cache/` to
 * get a socket - a dependency that says something false about the architecture.
 * Owning the CONNECTION separately from the USES of it keeps each module's
 * dependencies honest. This is the same instinct as separating a repository
 * from a service: infrastructure lifetime is not a feature concern.
 *
 * -----------------------------------------------------------------------------
 * THE DESIGN DECISION IN THIS FILE: should the app boot if Redis is down?
 * -----------------------------------------------------------------------------
 * Our answer: YES, boot in degraded mode. The reasoning:
 *
 *   - Redis's job here is CACHING and BACKGROUND WORK. Neither is required to
 *     answer a request correctly - a cache miss just means reading MongoDB.
 *     Refusing to start would convert a performance degradation into a total
 *     outage, which is strictly worse.
 *   - Compare with MongoDB (Phase 5), where the opposite is right: without the
 *     database there is no correct response to give, so failing fast is honest.
 *
 * The rule worth carrying into an interview: **fail fast on dependencies you
 * cannot function without; degrade gracefully on dependencies that only make
 * you faster.** Then make the degradation VISIBLE - which is why Phase 18's
 * readiness probe reports `degraded` rather than pretending everything is fine,
 * and why the log line below is a warning rather than a debug.
 *
 * The opposite choice is also defensible if Redis holds sessions or is the only
 * rate limiter in front of a login endpoint - then a Redis outage is a security
 * problem, not a performance one. Know which case you are in.
 * =============================================================================
 */
const redisClientProvider: Provider = {
  provide: REDIS_CLIENT,

  useFactory: async (config: AppConfigService): Promise<Redis> => {
    const logger = new Logger('RedisFactory');
    const { host, port, password, db, keyPrefix } = config.redis;

    const options: RedisOptions = {
      host,
      port,
      password: password || undefined,
      db,

      /**
       * Every key this client touches is silently prefixed. That is what lets
       * two environments share one Redis server safely, and what makes
       * `taskflow:dev:projects:*` a usable invalidation pattern (Phase 10)
       * rather than a FLUSHALL that would also destroy the job queues.
       *
       * CAVEAT worth knowing: ioredis applies `keyPrefix` to commands, but NOT
       * to the channel names in `subscribe`/`publish`. Phase 11 prefixes those
       * by hand.
       */
      keyPrefix: `${keyPrefix}:`,

      /**
       * Do NOT connect in the constructor. We want to control WHEN the
       * connection attempt happens so we can catch its failure below, instead
       * of an unhandled rejection escaping during module construction.
       */
      lazyConnect: true,

      /**
       * How many times a single command retries before rejecting.
       *
       * WHY BOUND IT: the default retries essentially forever, so a request
       * that touches the cache during a Redis outage hangs until the client
       * times out - and every request behind it queues. A bounded retry turns
       * "the API is down" into "the cache is missing", which is the whole point
       * of degrading gracefully. Fail fast at the edge, not slowly in the
       * middle.
       */
      maxRetriesPerRequest: 2,

      /**
       * Reconnection backoff. Returning `null` STOPS retrying.
       *
       * Capping attempts matters for more than tidiness: an uncapped retry loop
       * against a dead host emits an error event every few hundred milliseconds
       * forever, which fills disks and costs money in a hosted log platform.
       * Exponential-ish growth plus a ceiling is the standard shape.
       */
      retryStrategy: (attempt: number): number | null => {
        if (attempt > 10) {
          logger.warn('Redis unreachable after 10 attempts; giving up until restart');
          return null;
        }
        return Math.min(attempt * 200, 3000);
      },
    };

    const client = new Redis(options);

    /**
     * ATTACH THE ERROR LISTENER BEFORE CONNECTING.
     *
     * A Node EventEmitter that emits `error` with no listener THROWS - which
     * would crash the process on a transient network blip. This one line is the
     * difference between "the cache reconnects quietly" and a 3am page.
     */
    client.on('error', (error: Error) => {
      // `error.message` is EMPTY for a plain ECONNREFUSED on Node 20+: the DNS
      // resolver tries IPv6 and IPv4, both fail, and the two failures are
      // wrapped in an `AggregateError` whose own message is blank. Logging the
      // name as well is the difference between "Redis error:" (useless) and
      // "Redis error: AggregateError" (a thread to pull). Small detail, and
      // exactly the kind of thing that costs twenty minutes at 3am.
      logger.debug(`Redis error: ${error.name}${error.message ? `: ${error.message}` : ''}`);
    });
    client.on('ready', () => logger.log(`Redis connected (${host}:${port}, db=${db})`));

    try {
      await client.connect();
    } catch {
      // Degraded, not dead. See the discussion above.
      logger.warn(
        `Redis unavailable at ${host}:${port} - starting in DEGRADED mode (caching and queues disabled until it returns)`,
      );
    }

    return client;
  },

  // Positional, matching the factory's single parameter.
  inject: [AppConfigService],
};

const redisSubscriberProvider: Provider = {
  provide: REDIS_SUBSCRIBER,

  /**
   * PHASE 11: a SECOND connection, used only for Pub/Sub.
   *
   * This is not duplication - it is a protocol requirement. A Redis connection
   * in SUBSCRIBER MODE cannot issue normal commands; the server rejects them
   * with "Connection in subscriber mode, only subscriber commands may be
   * used". Sharing one client between SUBSCRIBE and GET breaks both.
   *
   * It is also the cleanest possible example of why provider TOKENS exist
   * (Phase 3): same class, two instances, and the ONLY thing that can tell them
   * apart is the token.
   *
   * NOTE there is no keyPrefix here. ioredis applies keyPrefix to KEYS, not to
   * pub/sub CHANNEL names - so setting it would be misleading, and channel
   * namespacing is done explicitly in the channel constant instead.
   */
  useFactory: async (config: AppConfigService): Promise<Redis> => {
    const logger = new Logger('RedisSubscriberFactory');
    const { host, port, password, db } = config.redis;

    const client = new Redis({
      host,
      port,
      password: password || undefined,
      db,
      lazyConnect: true,
      maxRetriesPerRequest: null,
      retryStrategy: (attempt: number): number | null =>
        attempt > 10 ? null : Math.min(attempt * 200, 3000),
    });

    client.on('error', (error: Error) => {
      logger.debug(`Redis subscriber error: ${error.name}`);
    });

    try {
      await client.connect();
      logger.log('Redis subscriber connected');
    } catch {
      logger.warn('Redis subscriber unavailable - cross-instance fan-out disabled');
    }

    return client;
  },
  inject: [AppConfigService],
};

/**
 * =============================================================================
 * RedisModule
 * =============================================================================
 * `@Global()` because the connection is exactly the kind of thing that
 * qualifies: stateless from a consumer's point of view, needed by several
 * unrelated modules, and singular by nature. It is the same justification as
 * `AppConfigModule` - and the same warning applies: this is a short list, not
 * a habit.
 *
 * -----------------------------------------------------------------------------
 * SHUTDOWN: why a MODULE implements a lifecycle hook here
 * -----------------------------------------------------------------------------
 * A provider created by a factory is a plain object as far as Nest is
 * concerned - it will not call `onApplicationShutdown` on the ioredis client,
 * because the client does not implement Nest's interface. So the MODULE takes
 * responsibility for closing what it opened.
 *
 * WHY IT MATTERS: without `quit()`, a rolling deploy leaves sockets open until
 * the server times them out, and the Node process can stay alive after
 * `app.close()` because an open handle keeps the event loop from draining -
 * the classic "my container will not exit" and "Jest did not exit one second
 * after the test run" symptoms.
 *
 * `quit()` vs `disconnect()`: `quit` sends QUIT and waits for in-flight
 * commands to finish (graceful); `disconnect` severs the socket immediately.
 * Use `quit` on shutdown; `disconnect` only when you have given up.
 * =============================================================================
 */
@Global()
@Module({
  providers: [redisClientProvider, redisSubscriberProvider],
  exports: [REDIS_CLIENT, REDIS_SUBSCRIBER],
})
export class RedisModule implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisModule.name);

  /**
   * A module class can inject providers exactly like any other class. Here it
   * injects the very client it registered, so it can close it.
   */
  constructor(
    @Inject(REDIS_CLIENT) private readonly client: Redis,
    @Inject(REDIS_SUBSCRIBER) private readonly subscriber: Redis,
  ) {}

  async onApplicationShutdown(signal?: string): Promise<void> {
    this.logger.log(`Closing Redis connection (signal: ${signal ?? 'none'})`);
    try {
      // Both connections, and the subscriber first - it holds a long-lived
      // SUBSCRIBE that would otherwise keep the event loop alive after
      // app.close(), which is the "my container will not exit" symptom.
      await Promise.all([this.subscriber.quit(), this.client.quit()]);
    } catch {
      // Already disconnected - nothing to clean up, and a shutdown path must
      // never throw. An exception here would mask the real reason for the
      // shutdown and could abort the cleanup of other modules.
      this.subscriber.disconnect();
      this.client.disconnect();
    }
  }
}
