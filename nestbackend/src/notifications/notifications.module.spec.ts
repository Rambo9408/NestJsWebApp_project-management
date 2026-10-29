import { Test, TestingModule } from '@nestjs/testing';

import { NOTIFICATION_CHANNEL } from 'src/common/constants';
import { AppConfigService } from 'src/config';

import { ConsoleNotificationChannel } from './channels/console-notification.channel';
import { EmailNotificationChannel } from './channels/email-notification.channel';
import { NotificationChannel } from './channels/notification-channel.interface';
import { NoopNotificationChannel } from './channels/noop-notification.channel';
import { NotificationDispatcher } from './notification.dispatcher';
import { NotificationStreamService } from './notification-stream.service';
import { notificationChannelProvider } from './notification-channel.provider';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';

/**
 * =============================================================================
 * Two things are tested here, and the second one is pure teaching.
 * =============================================================================
 * 1. That the FACTORY picks the right channel per environment.
 * 2. That `useClass` and `useExisting` differ in OBJECT IDENTITY - the single
 *    most commonly missed distinction among the four provider recipes, and one
 *    that produces genuinely confusing bugs when you get it wrong.
 *
 * PHASE 11 NOTE: these used to import the whole `NotificationsModule`, which
 * was the better test - it exercised the real wiring. That stopped being
 * possible when the module gained a Mongoose model and a WebSocket gateway,
 * because importing it now drags in a database connection.
 *
 * Rather than spin up MongoDB to test a `useFactory`, the provider was
 * EXTRACTED into its own file (`notification-channel.provider.ts`) and is
 * registered here directly. That is a real and common refactor: when a module
 * grows infrastructure, pull the pure decisions out so they stay cheap to test.
 * The cost is honest - this no longer proves the module wires it up - which is
 * why the e2e suites exercise the module end to end.
 * =============================================================================
 */

/** Minimal stubs; the factory only reads these three flags plus `app.nodeEnv`. */
const configFor = (env: 'development' | 'test' | 'production'): AppConfigService =>
  ({
    isDevelopment: env === 'development',
    isTest: env === 'test',
    isProduction: env === 'production',
    app: { nodeEnv: env, name: 'taskflow-api' },
  }) as AppConfigService;

describe('NOTIFICATION_CHANNEL factory', () => {
  const buildFor = async (env: 'development' | 'test' | 'production'): Promise<TestingModule> =>
    Test.createTestingModule({
      providers: [
        ConsoleNotificationChannel,
        EmailNotificationChannel,
        NoopNotificationChannel,
        notificationChannelProvider,
        { provide: AppConfigService, useValue: configFor(env) },
      ],
    }).compile();

  it('uses the console channel in development', async () => {
    const moduleRef = await buildFor('development');
    expect(moduleRef.get<NotificationChannel>(NOTIFICATION_CHANNEL).name).toBe('console');
  });

  it('uses the email channel in production', async () => {
    const moduleRef = await buildFor('production');
    expect(moduleRef.get<NotificationChannel>(NOTIFICATION_CHANNEL).name).toBe('email');
  });

  it('uses the no-op channel in tests, so specs never deliver anything', async () => {
    const moduleRef = await buildFor('test');
    expect(moduleRef.get<NotificationChannel>(NOTIFICATION_CHANNEL).name).toBe('noop');
  });

  it('returns the SAME instance that the container built, not a copy', async () => {
    const moduleRef = await buildFor('development');

    const viaToken = moduleRef.get<NotificationChannel>(NOTIFICATION_CHANNEL);
    const viaClass = moduleRef.get(ConsoleNotificationChannel);

    // The factory returns an INJECTED instance, so both lookups land on one
    // object. Had the provider been `useClass: ConsoleNotificationChannel`,
    // these would be two different objects - see the next describe block.
    expect(viaToken).toBe(viaClass);
  });
});

/**
 * =============================================================================
 * useClass vs useExisting - the identity lesson, in nine lines of assertion
 * =============================================================================
 */
describe('useClass vs useExisting', () => {
  const ALIAS = 'ALIAS_TOKEN';

  it('useClass creates a SECOND, independent instance', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ConsoleNotificationChannel, // instance A, under the class token
        { provide: ALIAS, useClass: ConsoleNotificationChannel }, // instance B
      ],
    }).compile();

    const viaClass = moduleRef.get(ConsoleNotificationChannel);
    const viaAlias = moduleRef.get<ConsoleNotificationChannel>(ALIAS);

    expect(viaAlias).not.toBe(viaClass);

    // ...and independent state is what makes this a bug rather than a curiosity:
    // work done through one token is invisible through the other.
    await viaAlias.send({ to: 'a@b.c', subject: 's', body: 'b' });
    expect(viaAlias.sentCount).toBe(1);
    expect(viaClass.sentCount).toBe(0); // <- the "why is my counter zero?" bug
  });

  it('useExisting ALIASES the same instance', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ConsoleNotificationChannel,
        { provide: ALIAS, useExisting: ConsoleNotificationChannel },
      ],
    }).compile();

    const viaClass = moduleRef.get(ConsoleNotificationChannel);
    const viaAlias = moduleRef.get<ConsoleNotificationChannel>(ALIAS);

    expect(viaAlias).toBe(viaClass);

    await viaAlias.send({ to: 'a@b.c', subject: 's', body: 'b' });
    expect(viaClass.sentCount).toBe(1); // one object, one counter
  });
});

describe('NotificationsService', () => {
  /** A recording fake - the counterpart to the Null Object channel. */
  class RecordingChannel implements NotificationChannel {
    readonly name = 'recording';
    readonly sent: string[] = [];

    send(payload: { subject: string }): Promise<void> {
      this.sent.push(payload.subject);
      return Promise.resolve();
    }
  }

  const stubRepository = {
    create: jest.fn(),
  } as unknown as NotificationsRepository;

  const stubStream = {
    publish: jest.fn(() => Promise.resolve()),
  } as unknown as NotificationStreamService;

  it('never lets a dispatch failure escape to the caller', async () => {
    /**
     * PHASE 12 moved delivery to the queue, so the failure that must be
     * swallowed moved too - it is now a failed ENQUEUE rather than a failed
     * send. The rule is unchanged: a notification is a side effect of the
     * user's operation, not the operation, so it must never turn a successful
     * POST into a 500.
     */
    const explodingDispatcher = {
      dispatch: () => Promise.reject(new Error('Redis and SMTP are both on fire')),
    } as unknown as NotificationDispatcher;

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: NOTIFICATION_CHANNEL, useValue: new RecordingChannel() },
        { provide: NotificationsRepository, useValue: stubRepository },
        { provide: NotificationStreamService, useValue: stubStream },
        { provide: NotificationDispatcher, useValue: explodingDispatcher },
      ],
    }).compile();

    await expect(
      moduleRef.get(NotificationsService).notify({ to: 'a@b.c', subject: 's', body: 'b' }),
    ).resolves.toBeUndefined();
  });

  it('ENQUEUES with a deterministic idempotency key', async () => {
    const dispatched: Array<{ idempotencyKey: string; subject: string }> = [];
    const dispatcher = {
      dispatch: (payload: { idempotencyKey: string; subject: string }) => {
        dispatched.push(payload);
        return Promise.resolve('queued' as const);
      },
    } as unknown as NotificationDispatcher;

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: NOTIFICATION_CHANNEL, useValue: new RecordingChannel() },
        { provide: NotificationsRepository, useValue: stubRepository },
        { provide: NotificationStreamService, useValue: stubStream },
        { provide: NotificationDispatcher, useValue: dispatcher },
      ],
    }).compile();

    const service = moduleRef.get(NotificationsService);
    const payload = {
      to: 'ada@example.com',
      subject: 'Added to project WEB',
      body: 'You were added.',
    };

    await service.notify(payload);
    await service.notify(payload);

    // The SAME key both times - which is what lets BullMQ collapse a retried
    // request or a duplicated event into one job.
    expect(dispatched).toHaveLength(2);
    expect(dispatched[0].idempotencyKey).toBe(dispatched[1].idempotencyKey);
    expect(dispatched[0].subject).toBe('Added to project WEB');
  });

  it('PERSISTS BEFORE PUSHING - the ordering that makes fire-and-forget safe', async () => {
    const order: string[] = [];

    const repository = {
      create: jest.fn(() => {
        order.push('persist');
        return Promise.resolve({
          id: 'n1',
          userId: 'u1',
          type: 'task_assigned',
          title: 'T',
          body: 'B',
          meta: {},
          readAt: null,
          createdAt: new Date(),
        });
      }),
    } as unknown as NotificationsRepository;

    const stream = {
      publish: jest.fn(() => {
        order.push('push');
        return Promise.resolve();
      }),
    } as unknown as NotificationStreamService;

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: NOTIFICATION_CHANNEL, useValue: new RecordingChannel() },
        { provide: NotificationsRepository, useValue: repository },
        { provide: NotificationStreamService, useValue: stream },
        {
          provide: NotificationDispatcher,
          useValue: { dispatch: () => Promise.resolve('queued' as const) },
        },
      ],
    }).compile();

    await moduleRef.get(NotificationsService).notifyUser({
      userId: 'u1',
      email: 'u1@example.com',
      type: 'task_assigned' as never,
      title: 'T',
      body: 'B',
    });

    /**
     * Durable FIRST. If the process died between the two, the notification
     * still exists and the user sees it on their next request - which is
     * exactly what makes Redis Pub/Sub's at-most-once delivery an acceptable
     * choice for the push.
     */
    expect(order).toEqual(['persist', 'push']);
  });
});
