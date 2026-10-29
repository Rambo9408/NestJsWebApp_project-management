import { Inject, Injectable, Logger } from '@nestjs/common';

import { NOTIFICATION_CHANNEL } from 'src/common/constants';

import { NotificationChannel } from './channels/notification-channel.interface';

/** The queue name. Exported so producer, consumer and tests cannot drift. */
export const NOTIFICATION_QUEUE = 'notifications';

export interface SendNotificationJob {
  /** Used as the BullMQ job id, so a duplicate enqueue is a no-op. */
  idempotencyKey: string;
  to: string;
  subject: string;
  body: string;
  meta?: Record<string, unknown>;
}

/**
 * =============================================================================
 * The WORK ITSELF, separated from how it was scheduled
 * =============================================================================
 * This class knows nothing about BullMQ. That separation is deliberate and buys
 * three things:
 *
 *   1. The same logic runs whether the job came from the queue OR was executed
 *      inline because Redis was unavailable - so the degraded path is not a
 *      second, less-tested implementation.
 *   2. It is unit-testable without Redis, a worker, or a job object.
 *   3. Moving this work to a separate worker PROCESS later (Phase 20) means
 *      moving one class, not untangling it from a processor.
 *
 * The rule: a processor should be a thin adapter that unwraps a job and calls a
 * service. Business logic inside a `@Process()` method is business logic that
 * can only ever be triggered by a queue - the same argument as keeping
 * controllers thin.
 * =============================================================================
 */
@Injectable()
export class NotificationJobHandler {
  private readonly logger = new Logger(NotificationJobHandler.name);

  constructor(@Inject(NOTIFICATION_CHANNEL) private readonly channel: NotificationChannel) {}

  /**
   * Deliver one notification.
   *
   * NOTE THIS THROWS on failure, unlike `NotificationsService.notify` which
   * swallows. That inversion is the whole point of moving delivery to a queue:
   *
   *   - INLINE, a failure must be swallowed, because it must not fail the
   *     user's request - and swallowing means the notification is simply lost.
   *   - IN A JOB, a failure must PROPAGATE, because that is what tells BullMQ
   *     to retry it. Swallowing here would mark the job successful and lose the
   *     notification silently - the single most common queue-consumer bug.
   *
   * "Throw to retry" is the contract of every job runner, and getting it
   * backwards produces a queue that reports 100% success and delivers nothing.
   */
  async run(payload: SendNotificationJob): Promise<void> {
    await this.channel.send({
      to: payload.to,
      subject: payload.subject,
      body: payload.body,
      meta: payload.meta,
    });

    this.logger.debug(`Delivered notification ${payload.idempotencyKey} to ${payload.to}`);
  }
}
