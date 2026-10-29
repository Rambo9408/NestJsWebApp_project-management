import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';

import { ConsoleNotificationChannel } from './channels/console-notification.channel';
import { notificationChannelProvider } from './notification-channel.provider';
import { NotificationDispatcher } from './notification.dispatcher';
import { NOTIFICATION_QUEUE, NotificationJobHandler } from './notification-job.handler';
import { NotificationsProcessor } from './notifications.processor';
import { EmailNotificationChannel } from './channels/email-notification.channel';
import { NoopNotificationChannel } from './channels/noop-notification.channel';
import { NotificationStreamService } from './notification-stream.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';
import { Notification, NotificationSchema } from './schemas/notification.schema';

/**
 * =============================================================================
 * NotificationsModule
 * =============================================================================
 * A note on what is registered and why, because this module is where the four
 * recipes sit side by side:
 *
 *   ConsoleNotificationChannel   -> shorthand class provider (token = the class)
 *   EmailNotificationChannel     -> same, and it has its own dependency
 *   NoopNotificationChannel      -> same
 *   NOTIFICATION_CHANNEL         -> useFactory, choosing one of the above
 *   NotificationsService         -> shorthand class provider
 *
 * ONLY `NotificationsService` IS EXPORTED. The channel token stays private, so
 * no other module can bypass the facade's swallow-and-log rule by talking to a
 * transport directly. Same encapsulation reasoning as `PasswordHasher` in
 * `UsersModule`: the public API is a capability, not an implementation.
 *
 * -----------------------------------------------------------------------------
 * CUSTOM PROVIDER #4: `useExisting` - the one people miss
 * -----------------------------------------------------------------------------
 *     { provide: NEW_TOKEN, useExisting: ExistingToken }
 *
 * It creates an ALIAS: both tokens resolve to the SAME instance. Compare:
 *
 *     useClass:    "build a new one for this token"     -> two objects
 *     useExisting: "point this token at that provider"  -> one object
 *
 * If we had written `{ provide: NOTIFICATION_CHANNEL, useClass:
 * ConsoleNotificationChannel }` while ALSO listing `ConsoleNotificationChannel`
 * in providers, the application would hold TWO console channels with separate
 * state - and a test asserting on one would silently miss the other. Our
 * factory returns the INJECTED instance, so there is exactly one.
 *
 * `notifications.module.spec.ts` proves both halves with object-identity
 * assertions. It is a short test and it is the fastest way to make this
 * distinction stick.
 *
 * WHEN `useExisting` IS THE RIGHT TOOL IN REAL LIFE:
 *   - Renaming a token without a breaking change: keep the old one aliased to
 *     the new one for a release.
 *   - Exposing one implementation under several contracts, e.g. a single
 *     `AuditLogService` also serving a narrower `ReadOnlyAuditLog` token.
 * =============================================================================
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Notification.name, schema: NotificationSchema }]),
    // The gateway verifies the handshake token itself - a Socket.IO handshake
    // is not an Express request, so Passport HTTP guards cannot see it.
    JwtModule.register({}),

    /**
     * PHASE 12: the feature half of the root/feature split - QueueModule opened
     * the connection, this declares the queue this module owns.
     */
    BullModule.registerQueue({ name: NOTIFICATION_QUEUE }),
  ],
  controllers: [NotificationsController],
  providers: [
    ConsoleNotificationChannel,
    EmailNotificationChannel,
    NoopNotificationChannel,
    notificationChannelProvider,
    NotificationsService,
    NotificationsRepository,
    NotificationStreamService,
    NotificationsGateway,
    NotificationJobHandler,
    NotificationDispatcher,

    /**
     * THE WORKER IS NOT REGISTERED IN TESTS.
     *
     * A BullMQ worker polls Redis with blocking commands from the moment it is
     * constructed. In a test run with no Redis that is pure noise, and the open
     * handle keeps Jest from exiting.
     *
     * The PRODUCER stays registered, so the enqueue path is still exercised -
     * it simply falls back to inline delivery, which runs the exact same
     * handler. So the logic under test is identical either way; only the
     * scheduling differs.
     *
     * Reading process.env at composition time is the same chicken-and-egg as
     * ScopesDemoModule (Phase 4): module metadata is evaluated before the
     * container exists.
     */
    ...(process.env.NODE_ENV === 'test' ? [] : [NotificationsProcessor]),
  ],
  exports: [NotificationsService, NotificationsRepository],
})
export class NotificationsModule {}
