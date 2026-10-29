import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';

import { NotificationDispatcher } from './notification.dispatcher';
import { NOTIFICATION_QUEUE, NotificationJobHandler } from './notification-job.handler';

/**
 * =============================================================================
 * The producer's two paths, and the ONE contract a consumer must honour
 * =============================================================================
 * `getQueueToken(name)` is the same trick as `getModelToken` (Phase 5): the
 * queue is an ordinary provider under a derived token, so a test can replace it
 * with `{ provide: getQueueToken('notifications'), useValue: fake }`.
 *
 * Worth noticing in itself - every convenience decorator in the Nest ecosystem
 * (`@InjectModel`, `@InjectQueue`, `@InjectConnection`) is `@Inject` with a
 * generated token. Once you know that, none of them are magic and all of them
 * are mockable.
 * =============================================================================
 */
describe('NotificationDispatcher', () => {
  const payload = {
    idempotencyKey: 'abc123',
    to: 'ada@example.com',
    subject: 'WEB-1 assigned to you',
    body: 'It is yours now.',
  };

  const build = async (queue: Partial<Queue>, handler: Partial<NotificationJobHandler>) => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationDispatcher,
        { provide: getQueueToken(NOTIFICATION_QUEUE), useValue: queue },
        { provide: NotificationJobHandler, useValue: handler },
      ],
    }).compile();

    return moduleRef.get(NotificationDispatcher);
  };

  it('enqueues with the idempotency key as the JOB ID', async () => {
    const added: Array<{ name: string; opts: { jobId?: string } }> = [];

    const dispatcher = await build(
      {
        add: ((name: string, _data: unknown, opts: { jobId?: string }) => {
          added.push({ name, opts });
          return Promise.resolve({ id: opts.jobId });
        }) as unknown as Queue['add'],
      },
      { run: () => Promise.resolve() },
    );

    await expect(dispatcher.dispatch(payload)).resolves.toBe('queued');

    /**
     * The job id IS the deduplication mechanism: BullMQ treats an `add` with an
     * existing id as a no-op, so a retried request or a duplicated event
     * collapses into one job - without any "have I seen this?" bookkeeping.
     */
    expect(added).toHaveLength(1);
    expect(added[0].opts.jobId).toBe('abc123');
  });

  it('DEGRADES to inline delivery when the queue is unreachable', async () => {
    /**
     * This only works because the queue connection sets
     * `enableOfflineQueue: false`. With the default, `add()` would buffer the
     * command and wait for a connection that may never come - so the request
     * would hang instead of falling back, and this test would time out rather
     * than pass.
     */
    let ranInline = false;

    const dispatcher = await build(
      { add: () => Promise.reject(new Error('ECONNREFUSED')) },
      {
        run: () => {
          ranInline = true;
          return Promise.resolve();
        },
      },
    );

    await expect(dispatcher.dispatch(payload)).resolves.toBe('inline');
    expect(ranInline).toBe(true);
  });

  it('does not fail the caller when BOTH the queue and inline delivery fail', async () => {
    // The user's operation already succeeded. A notification failure must never
    // turn it into a 500 - that would invite a retry of something that worked.
    const dispatcher = await build(
      { add: () => Promise.reject(new Error('ECONNREFUSED')) },
      { run: () => Promise.reject(new Error('SMTP down too')) },
    );

    await expect(dispatcher.dispatch(payload)).resolves.toBe('inline');
  });
});

/**
 * =============================================================================
 * The consumer contract: THROW TO RETRY
 * =============================================================================
 */
describe('NotificationJobHandler', () => {
  it('PROPAGATES a delivery failure, because that is the retry signal', async () => {
    const handler = new NotificationJobHandler({
      name: 'exploding',
      send: () => Promise.reject(new Error('SMTP timeout')),
    });

    /**
     * The single most damaging thing you can write in a queue consumer is a
     * try/catch that swallows: every job then reports success, nothing is
     * retried, and the dashboard is green while the feature is broken.
     *
     * Note this is the OPPOSITE of the rule for the inline path - and that
     * inversion is exactly why moving work to a queue changes the error
     * handling, not just the timing.
     */
    await expect(
      handler.run({ idempotencyKey: 'k', to: 'a@b.c', subject: 's', body: 'b' }),
    ).rejects.toThrow('SMTP timeout');
  });

  it('resolves when delivery succeeds', async () => {
    const sent: string[] = [];

    const handler = new NotificationJobHandler({
      name: 'recording',
      send: (p) => {
        sent.push(p.subject);
        return Promise.resolve();
      },
    });

    await handler.run({ idempotencyKey: 'k', to: 'a@b.c', subject: 'Hello', body: 'b' });
    expect(sent).toEqual(['Hello']);
  });
});
