import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';

import { AppConfigService } from 'src/config';

/**
 * =============================================================================
 * QueueModule - the BullMQ CONNECTION, and nothing else
 * =============================================================================
 * Same root/feature split as MongoDB (Phase 5):
 *
 *     BullModule.forRootAsync()   here, once - the connection and defaults
 *     BullModule.registerQueue()  in the feature module that owns the queue
 *
 * Recognising that pattern across libraries (`forRoot` + `forFeature`,
 * `forRoot` + `registerQueue`) is worth more than memorising each one.
 *
 * -----------------------------------------------------------------------------
 * WHY BULLMQ GETS ITS OWN CONNECTIONS
 * -----------------------------------------------------------------------------
 * We already have `REDIS_CLIENT` and `REDIS_SUBSCRIBER`. This makes a third
 * (fourth, fifth - BullMQ opens one per queue and per worker), and that is
 * correct rather than wasteful:
 *
 *   1. `maxRetriesPerRequest` MUST BE `null` for BullMQ. Its blocking commands
 *      (`BRPOPLPUSH`) legitimately sit for seconds waiting for a job, and a
 *      retry limit would abort them. Hand BullMQ a client with a limit and it
 *      refuses to start:
 *
 *        "BullMQ: Your redis options maxRetriesPerRequest must be null"
 *
 *      Our shared client deliberately sets `2` so cache reads FAIL FAST during
 *      an outage (Phase 3). The two requirements are incompatible - so they are
 *      different connections. This is the clearest possible example of why one
 *      shared client is not always the frugal choice.
 *
 *   2. A worker blocked on `BRPOPLPUSH` cannot serve a cache `GET` at the same
 *      time; sharing would serialise unrelated work behind job polling.
 * =============================================================================
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        connection: {
          host: config.redis.host,
          port: config.redis.port,
          password: config.redis.password || undefined,
          db: config.redis.db,

          /**
           * REQUIRED by BullMQ - see above.
           */
          maxRetriesPerRequest: null,

          /**
           * FAIL FAST WHEN REDIS IS DOWN instead of buffering commands forever.
           *
           * With the offline queue enabled (the default), `queue.add()` on a
           * disconnected client never rejects - it waits for a connection that
           * may never come, and the HTTP request that called it hangs. The
           * producer's fallback path can only work if `add()` actually FAILS.
           *
           * This is the difference between "the queue is unavailable" and "the
           * API is unavailable", and it is one line.
           */
          enableOfflineQueue: false,

          retryStrategy: (attempt: number): number | null =>
            attempt > 10 ? null : Math.min(attempt * 200, 3000),
        },

        /**
         * ---------------------------------------------------------------------
         * DEFAULT JOB OPTIONS - the four settings that matter
         * ---------------------------------------------------------------------
         */
        defaultJobOptions: {
          /**
           * RETRIES. A job that fails is retried, because most job failures are
           * transient - an SMTP timeout, a rate limit, a brief network blip.
           *
           * The corollary people forget: a retried job means the work runs
           * MORE THAN ONCE. Every consumer must therefore be idempotent, which
           * is not optional advice - it is the price of retries.
           */
          attempts: 5,

          /**
           * EXPONENTIAL BACKOFF: 1s, 2s, 4s, 8s, 16s.
           *
           * WHY NOT FIXED? Because a fixed delay retries a struggling
           * dependency at a constant rate, which is exactly what keeps it
           * struggling. Backoff gives it room to recover, and the sum of the
           * delays gives you a real window (~31s here) rather than five
           * near-simultaneous hits.
           *
           * WHAT IS MISSING, and it matters at scale: JITTER. A thousand jobs
           * that fail together retry together, in lockstep, forever. BullMQ
           * supports a custom backoff strategy - add one the day you have
           * enough volume for the herd to matter.
           */
          backoff: { type: 'exponential', delay: 1000 },

          /**
           * CLEAN UP AFTER SUCCESS, and this is not housekeeping - it is a
           * memory bound. Completed jobs stay in Redis forever by default, and
           * a busy queue will fill it. `age` and `count` together cap both time
           * and volume.
           */
          removeOnComplete: { age: 3600, count: 1000 },

          /**
           * KEEP FAILURES LONGER. A failed job is evidence: you want to inspect
           * the payload and the stack days later. This is the closest thing
           * BullMQ has to a dead-letter queue by default - jobs that exhaust
           * their attempts sit in the `failed` set until this age passes.
           */
          removeOnFail: { age: 7 * 24 * 3600 },
        },
      }),
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
