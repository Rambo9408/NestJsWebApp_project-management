import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import {
  NOTIFICATION_QUEUE,
  NotificationJobHandler,
  SendNotificationJob,
} from './notification-job.handler';

/**
 * =============================================================================
 * NotificationsProcessor - the CONSUMER
 * =============================================================================
 * `@Processor(queueName)` + `WorkerHost` is the Nest wrapper around a BullMQ
 * `Worker`. `process(job)` is called for each job; the SAME dependency
 * injection, guards, interceptors and filters apply as anywhere else, because a
 * job is just another `ExecutionContext`.
 *
 * NOTE HOW LITTLE IS HERE. The processor unwraps the job and calls a service.
 * Business logic inside a processor is logic that can only be triggered by a
 * queue - the same argument as keeping controllers thin, and the reason
 * `NotificationJobHandler` exists separately.
 *
 * -----------------------------------------------------------------------------
 * CONCURRENCY, and the number people get wrong
 * -----------------------------------------------------------------------------
 * `concurrency: 5` means five jobs at once IN THIS PROCESS. Across four
 * instances that is twenty concurrent jobs hitting your email provider - which
 * is usually where the rate limit is, and which is why the right number depends
 * on the DOWNSTREAM capacity rather than on your CPU count.
 *
 * For genuinely rate-limited work, BullMQ's `limiter: { max, duration }` is the
 * correct tool - it caps jobs per window across the whole worker rather than
 * making you guess a concurrency that happens to fit.
 *
 * -----------------------------------------------------------------------------
 * GRACEFUL SHUTDOWN
 * -----------------------------------------------------------------------------
 * `WorkerHost` implements `OnModuleDestroy`, so `app.enableShutdownHooks()`
 * (Phase 1) makes Nest close the worker on SIGTERM: it stops taking new jobs
 * and waits for in-flight ones.
 *
 * WITHOUT IT, a rolling deploy kills the process mid-job. The job is not lost -
 * BullMQ will redeliver it once its lock expires - but that takes 30 seconds by
 * default, during which the work simply has not happened. "Notifications are
 * delayed by exactly 30 seconds after every deploy" is a real bug report with a
 * one-line cause.
 *
 * The interaction with Kubernetes matters too: `terminationGracePeriodSeconds`
 * must exceed your longest job, or the pod is SIGKILLed mid-flight anyway.
 * =============================================================================
 */
@Processor(NOTIFICATION_QUEUE, { concurrency: 5 })
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(private readonly handler: NotificationJobHandler) {
    super();
  }

  /**
   * THROWING IS THE RETRY SIGNAL.
   *
   * Returning normally marks the job complete. Throwing marks it failed, and
   * BullMQ re-queues it with the configured backoff until `attempts` is
   * exhausted - after which it lands in the `failed` set for inspection.
   *
   * So a `try/catch` that swallows here is the single most damaging thing you
   * can write in a consumer: every job reports success and nothing is ever
   * delivered or retried. The queue dashboard is green and the feature is
   * broken.
   */
  async process(job: Job<SendNotificationJob>): Promise<void> {
    this.logger.debug(
      `Processing ${job.name} ${job.id} (attempt ${job.attemptsMade + 1}/${job.opts.attempts ?? 1})`,
    );

    await this.handler.run(job.data);
  }

  /**
   * Worker events - the hooks a real deployment needs.
   *
   * `failed` fires on EVERY failed attempt, not only the last one. Alerting on
   * it directly produces noise for transient errors that the retry would have
   * fixed; the useful signal is "failed AND attempts exhausted", which is what
   * the check below expresses.
   */
  @OnWorkerEvent('failed')
  onFailed(job: Job<SendNotificationJob> | undefined, error: Error): void {
    const exhausted = job ? job.attemptsMade >= (job.opts.attempts ?? 1) : true;

    if (exhausted) {
      // TERMINAL. This is the one worth paging on - the notification will not
      // be delivered without human action. In production this is also where a
      // dead-letter queue entry or an alert would be raised.
      this.logger.error(
        `Job ${job?.id ?? 'unknown'} failed permanently after ${job?.attemptsMade ?? 0} attempts: ${error.message}`,
      );
      return;
    }

    this.logger.warn(`Job ${job?.id ?? 'unknown'} failed, will retry: ${error.message}`);
  }

  /**
   * STALLED means a job was picked up but its lock was not renewed - almost
   * always because the process died, or because the handler blocked the event
   * loop long enough that the renewal never ran.
   *
   * That second cause is worth knowing: a CPU-bound job (image processing, a
   * big JSON parse, bcrypt) starves the timer that renews the lock, so BullMQ
   * concludes the worker is dead and gives the job to someone else - and now it
   * runs twice. The fix is not a longer lock; it is to stop blocking the event
   * loop (a worker thread, or a separate process).
   */
  @OnWorkerEvent('stalled')
  onStalled(jobId: string): void {
    this.logger.warn(
      `Job ${jobId} stalled - the worker died or blocked the event loop. It will be retried, so the handler MUST be idempotent.`,
    );
  }
}
