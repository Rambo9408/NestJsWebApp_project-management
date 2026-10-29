import { Injectable, Logger } from '@nestjs/common';

import { NotificationChannel, NotificationPayload } from './notification-channel.interface';

/**
 * Development implementation: print the notification instead of delivering it.
 *
 * WHY THIS IS A REAL IMPLEMENTATION AND NOT A MOCK: developers need to see what
 * the system would have sent, without an SMTP server, without spamming real
 * inboxes, and without a `if (isDev) console.log(...)` branch inside the email
 * class. "Log it" is a legitimate delivery strategy for a development
 * environment - MailHog and Mailtrap exist for exactly this reason, and this is
 * the zero-dependency version of the same idea.
 */
@Injectable()
export class ConsoleNotificationChannel implements NotificationChannel {
  readonly name = 'console';

  private readonly logger = new Logger(ConsoleNotificationChannel.name);

  /**
   * A counter, purely so the `useClass` vs `useExisting` test in
   * `notifications.module.spec.ts` can prove that two registrations really do
   * produce two independent objects with independent state.
   */
  sentCount = 0;

  send(payload: NotificationPayload): Promise<void> {
    this.sentCount += 1;

    this.logger.log(`[notification] to=${payload.to} subject="${payload.subject}"`);
    this.logger.debug(payload.body);

    // `Promise.resolve()` rather than `async` with no `await`: the method is
    // Promise-returning because the CONTRACT is async (real channels do I/O).
    // Designing the boundary as async from the start is free; changing a method
    // from sync to async later is a breaking change for every caller.
    return Promise.resolve();
  }
}
