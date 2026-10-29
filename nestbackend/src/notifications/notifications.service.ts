import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';

import { NOTIFICATION_CHANNEL } from 'src/common/constants';

import { NotificationChannel } from './channels/notification-channel.interface';
import { NotificationDispatcher } from './notification.dispatcher';
import { NotificationStreamService } from './notification-stream.service';
import { NotificationsRepository } from './notifications.repository';
import { NotificationType } from './schemas/notification.schema';

export interface NotifyOptions {
  to: string;
  subject: string;
  body: string;
  meta?: Record<string, unknown>;
}

/** Everything needed to deliver a notification three ways. */
export interface NotifyUserOptions {
  userId: string;
  email: string;
  type: NotificationType;
  title: string;
  body: string;
  meta?: Record<string, unknown>;
}

/**
 * =============================================================================
 * NotificationsService - one call, three delivery paths
 * =============================================================================
 * Phase 3 introduced this as a facade over a single channel. Phase 11 gives it
 * the shape a real notification system has:
 *
 *     1. PERSIST     MongoDB   - the source of truth. Survives offline users,
 *                                closed tabs, dropped connections and deploys.
 *     2. PUSH        Redis     - fan-out to every instance, so whichever one
 *                                holds the user's SSE stream or socket delivers
 *                                it.
 *     3. OUT-OF-BAND channel   - email / console. The Phase 3 strategy.
 *
 * THE ORDER IS THE DESIGN. Persist first: if the process dies immediately
 * afterwards the notification still exists and the user sees it on their next
 * request. Push and channel delivery are best-effort layers ON TOP of a durable
 * record, never instead of one.
 *
 * That ordering is also what makes the fire-and-forget nature of Redis Pub/Sub
 * acceptable (see `notification-stream.service.ts`): a dropped message costs a
 * refresh, not a notification.
 * =============================================================================
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(NOTIFICATION_CHANNEL) private readonly channel: NotificationChannel,
    private readonly repository: NotificationsRepository,
    private readonly stream: NotificationStreamService,

    /**
     * PHASE 12: delivery moved OFF the request path.
     *
     * Phase 3 said this method was "the seam where Phase 12 swaps inline
     * sending for a queue without callers noticing". This is that swap, and
     * nothing above this class changed.
     */
    private readonly dispatcher: NotificationDispatcher,
  ) {}

  /** Which channel implementation the factory selected - surfaced by `/health`. */
  get activeChannel(): string {
    return this.channel.name;
  }

  /**
   * The full path: persist, push, then send out of band.
   *
   * Still `Promise<void>` and still never throws - see `notify()` below for the
   * reasoning, which has not changed: a notification is a side effect of the
   * user's operation, not the operation.
   */
  async notifyUser(options: NotifyUserOptions): Promise<void> {
    try {
      // 1. DURABLE FIRST.
      const stored = await this.repository.create({
        userId: options.userId,
        type: options.type,
        title: options.title,
        body: options.body,
        meta: options.meta,
      });

      // 2. PUSH. Reaches every instance; whichever holds the connection wins.
      await this.stream.publish({
        id: stored.id,
        userId: stored.userId,
        type: stored.type,
        title: stored.title,
        body: stored.body,
        meta: stored.meta,
        createdAt: stored.createdAt.toISOString(),
      });
    } catch (error) {
      this.logger.error(
        `Failed to record notification for ${options.userId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    // 3. OUT OF BAND. Independent of the above: an email should still go out
    // even if the push failed, and vice versa.
    await this.notify({
      to: options.email,
      subject: options.title,
      body: options.body,
      meta: options.meta,
    });
  }

  /**
   * ===========================================================================
   * Out-of-band delivery - ENQUEUED as of Phase 12
   * ===========================================================================
   * This method used to call `channel.send()` directly and swallow the error.
   * Phase 3's comment said it was "the seam where Phase 12 swaps inline sending
   * for a queue without callers noticing". This is that swap - and nothing
   * above this class changed, which is the point of having had a seam.
   *
   * WHAT CHANGED, and why each part matters:
   *
   *   BEFORE  await channel.send(...)          one attempt, in the request,
   *           catch { log }                    failure = silently lost
   *
   *   AFTER   await dispatcher.dispatch(...)   sub-millisecond enqueue,
   *                                            5 attempts with backoff,
   *                                            inspectable if they all fail
   *
   * The swallow-and-log rule has NOT gone away - it moved. Enqueuing can still
   * fail (Redis down), and the dispatcher handles that by running the work
   * inline rather than by failing the user's request. A notification is still a
   * side effect of the user's operation, not the operation.
   *
   * IDEMPOTENCY KEY: derived from the recipient and the subject, so a retried
   * HTTP request or a duplicated domain event collapses into ONE job. See the
   * long note in the dispatcher for what this does and does not protect against.
   */
  async notify(options: NotifyOptions): Promise<void> {
    const idempotencyKey = buildIdempotencyKey(options);

    try {
      await this.dispatcher.dispatch({
        idempotencyKey,
        to: options.to,
        subject: options.subject,
        body: options.body,
        meta: options.meta,
      });
    } catch (error) {
      // The dispatcher already degrades to inline delivery; reaching here means
      // both paths failed. Log and continue - never fail the caller.
      this.logger.error(
        `Notification could not be dispatched to=${options.to} subject="${options.subject}"`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}

/**
 * A deterministic id for the delivery job.
 *
 * WHY HASH RATHER THAN CONCATENATE: recipients and subjects contain colons,
 * spaces and unicode, and a raw concatenation makes keys that are long, ugly in
 * Redis, and ambiguous ("a:b" + "c" collides with "a" + "b:c"). A short hash is
 * fixed-length and collision-free in practice.
 *
 * WHY NOT INCLUDE A TIMESTAMP: because then it would not deduplicate anything -
 * two identical notifications a millisecond apart would get different ids,
 * which is exactly the case the key exists to collapse.
 *
 * THE TRADE-OFF THAT CREATES, stated plainly: a genuinely repeated notification
 * ("WEB-142 assigned to you", assigned away and back again) is suppressed while
 * the previous job id is still known to BullMQ. For notifications that is
 * usually the desired behaviour; for something like a one-time passcode it
 * would be a bug, and the key would need to include the thing that makes each
 * one distinct.
 */
function buildIdempotencyKey(options: NotifyOptions): string {
  return createHash('sha256')
    .update(`${options.to}|${options.subject}|${options.body}`)
    .digest('hex')
    .slice(0, 32);
}
