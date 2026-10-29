import { Injectable, Logger } from '@nestjs/common';

import { AppConfigService } from 'src/config';

import { NotificationChannel, NotificationPayload } from './notification-channel.interface';

/**
 * The production channel.
 *
 * HONEST LABEL: there is no SMTP client here yet. Wiring nodemailer or an
 * email API would add a dependency and a set of credentials that this phase
 * does not need, and Phase 12 changes the delivery model anyway (the send moves
 * into a BullMQ worker, so failures retry with backoff instead of failing a
 * request). What this class demonstrates NOW is the part that matters for
 * Phase 3: an implementation that HAS ITS OWN DEPENDENCIES, and therefore
 * cannot simply be `new`-ed inside a factory without care.
 *
 * That is a genuinely important detail. `AppConfigService` is injected through
 * the constructor, which means this class must be registered as a provider for
 * Nest to build it - the factory in `notifications.module.ts` receives the
 * already-constructed instance rather than constructing one itself. A factory
 * that did `new EmailNotificationChannel(config)` by hand would work today and
 * break the moment this class gains a second dependency.
 */
@Injectable()
export class EmailNotificationChannel implements NotificationChannel {
  readonly name = 'email';

  private readonly logger = new Logger(EmailNotificationChannel.name);

  private readonly fromAddress: string;

  constructor(private readonly config: AppConfigService) {
    // Derived once, at construction. A singleton provider is the right place
    // for values that are expensive or pointless to recompute per call.
    this.fromAddress = `no-reply@${this.config.app.name}`;
  }

  send(payload: NotificationPayload): Promise<void> {
    /**
     * DELIVERY FAILURES MUST NOT PROPAGATE. See the contract note in the
     * interface: a bounced notification should never fail the operation that
     * triggered it. When the real client lands, this method wraps it in
     * try/catch and logs - it does not rethrow.
     */
    this.logger.log(
      `[email:pending-transport] from=${this.fromAddress} to=${payload.to} subject="${payload.subject}"`,
    );

    return Promise.resolve();
  }
}
