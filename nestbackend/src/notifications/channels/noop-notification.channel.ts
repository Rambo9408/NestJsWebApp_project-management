import { Injectable } from '@nestjs/common';

import { NotificationChannel, NotificationPayload } from './notification-channel.interface';

/**
 * The NULL OBJECT pattern: an implementation that satisfies the contract and
 * does nothing.
 *
 * WHY IT EXISTS: during tests, notifications are noise. Without this, every
 * spec that touches a code path which notifies would either print log lines or
 * need its own stub.
 *
 * WHY IT IS BETTER THAN `channel?.send(...)` OR `if (!isTest) channel.send(...)`:
 *   - Every caller keeps ONE code path. No null checks, no environment
 *     branching sprinkled through business logic.
 *   - The decision lives in exactly one place - the factory in the module.
 *   - It is impossible to forget the check somewhere, because there is no check.
 *
 * That is the Null Object pattern's whole value proposition, and it is worth
 * being able to name: replace "absence" with a harmless implementation of the
 * same interface, so that the absence stops being a special case.
 *
 * TRADE-OFF: silence can hide bugs. If a test asserts that a notification was
 * sent, it must inject a RECORDING fake instead of this one - which is exactly
 * what `notifications.service.spec.ts` does. Null Object is for "I do not care";
 * a spy is for "I care that it happened".
 */
@Injectable()
export class NoopNotificationChannel implements NotificationChannel {
  readonly name = 'noop';

  send(_payload: NotificationPayload): Promise<void> {
    return Promise.resolve();
  }
}
