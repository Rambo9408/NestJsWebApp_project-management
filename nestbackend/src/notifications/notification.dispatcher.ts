import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import {
  NOTIFICATION_QUEUE,
  NotificationJobHandler,
  SendNotificationJob,
} from './notification-job.handler';

/**
 * =============================================================================
 * NotificationDispatcher - the PRODUCER, and the degraded path
 * =============================================================================
 * PRODUCER / CONSUMER, in the two sentences that matter:
 *
 *   PRODUCER  puts a job on the queue and returns immediately. It does NOT know
 *             who will run it, when, or on which machine.
 *   CONSUMER  (the worker) pulls jobs and runs them, retrying on failure.
 *
 * WHY THIS EXISTS AT ALL - what a queue actually buys:
 *
 *   1. LATENCY. `POST /tasks` no longer waits for an SMTP round trip. Enqueuing
 *      is a single Redis write - well under a millisecond.
 *   2. RETRIES. Inline delivery gets one attempt and a swallowed error. A job
 *      gets five attempts with exponential backoff, and stays inspectable if
 *      they all fail.
 *   3. BACKPRESSURE. A spike becomes a longer queue rather than a thundering
 *      herd against a third party that will rate-limit you.
 *   4. ISOLATION. A slow or broken email provider degrades notifications, not
 *      the API.
 *
 * WHAT IT COSTS, honestly: an extra moving part, at-least-once delivery (so
 * every consumer must be idempotent), a queue to monitor, and jobs that can
 * outlive the code that created them - a payload enqueued by v1 may be handled
 * by v2, so payload shapes need the same backward-compatibility care as an API.
 * =============================================================================
 */
@Injectable()
export class NotificationDispatcher {
  private readonly logger = new Logger(NotificationDispatcher.name);

  constructor(
    @InjectQueue(NOTIFICATION_QUEUE) private readonly queue: Queue,
    private readonly handler: NotificationJobHandler,
  ) {}

  /**
   * Enqueue - or, if the queue is unreachable, do the work inline.
   *
   * ---------------------------------------------------------------------------
   * IDEMPOTENCY, via the JOB ID
   * ---------------------------------------------------------------------------
   * BullMQ de-duplicates by `jobId`: adding a job whose id already exists is a
   * NO-OP. Passing a deterministic key therefore makes the ENQUEUE side
   * idempotent for free - a retried HTTP request, a duplicated event, or a
   * double-clicked button cannot produce two emails.
   *
   * That covers duplicate PRODUCTION. It does NOT cover duplicate EXECUTION:
   * a worker that crashes after sending but before acknowledging will have the
   * job redelivered, and the email goes twice. Every queue is AT LEAST ONCE;
   * exactly-once delivery does not exist, and anyone who says otherwise is
   * describing exactly-once *processing* built on top of it.
   *
   * THE THREE WAYS TO MAKE A CONSUMER IDEMPOTENT, in order of preference:
   *   1. Make the operation NATURALLY idempotent - `$set` rather than `$inc`,
   *      upsert rather than insert. Nothing to remember, nothing to store.
   *   2. Record the key BEFORE acting, in the same transaction as the effect.
   *   3. Ask the downstream system for an idempotency key (Stripe, SendGrid and
   *      most serious APIs accept one) and let IT deduplicate.
   *
   * A "have I seen this key?" check in Redis with a TTL is the common
   * fourth option, and it is the weakest: the check and the effect are not
   * atomic, so a crash between them reintroduces the duplicate. It narrows the
   * window rather than closing it - fine for an email, not for a payment.
   *
   * ---------------------------------------------------------------------------
   * THE FALLBACK
   * ---------------------------------------------------------------------------
   * If Redis is down, `add()` rejects immediately (`enableOfflineQueue: false`
   * in `queue.module.ts`) and we run the handler inline instead.
   *
   * WHY THAT IS THE RIGHT DEGRADATION HERE: the alternative is losing the
   * notification entirely, and delivery is cheap. Note the trade-off is real -
   * inline execution reintroduces the latency and the single attempt that the
   * queue existed to remove. It is a worse mode, deliberately entered, and
   * logged as such.
   *
   * WHEN IT WOULD BE WRONG: if the job were expensive (a report, a video
   * transcode) or if losing it were preferable to blocking the request. Then
   * you fail the enqueue loudly and let the caller decide.
   */
  async dispatch(payload: SendNotificationJob): Promise<'queued' | 'inline'> {
    try {
      await this.queue.add('send-notification', payload, {
        // Deterministic id -> duplicate enqueues collapse into one job.
        jobId: payload.idempotencyKey,
      });

      return 'queued';
    } catch (error) {
      this.logger.warn(`Queue unavailable, delivering inline (degraded): ${describe(error)}`);

      // The SAME handler the worker would have used - so the degraded path is
      // not a second, less-tested implementation.
      await this.handler.run(payload).catch((inlineError: unknown) => {
        // Inline, a failure must NOT propagate - it would fail the user's
        // request for a side effect. In the worker, the opposite is true.
        this.logger.error(`Inline notification delivery failed: ${describe(inlineError)}`);
      });

      return 'inline';
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
