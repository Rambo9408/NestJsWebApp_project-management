import { Logger, Provider } from '@nestjs/common';

import { NOTIFICATION_CHANNEL } from 'src/common/constants';
import { AppConfigService } from 'src/config';

import { ConsoleNotificationChannel } from './channels/console-notification.channel';
import { EmailNotificationChannel } from './channels/email-notification.channel';
import { NotificationChannel } from './channels/notification-channel.interface';
import { NoopNotificationChannel } from './channels/noop-notification.channel';

/**
 * PHASE 11 EXTRACTED THIS from notifications.module.ts.
 *
 * The module grew a Mongoose model and a WebSocket gateway, so importing it in
 * a unit test now drags in a database connection. Pulling the pure DECISION
 * out into its own file keeps it cheap to test, and is a refactor worth
 * recognising: when a module accumulates infrastructure, the decisions inside
 * it should move out rather than becoming untestable.
 */
/**
 * =============================================================================
 * CUSTOM PROVIDER #3: `useFactory` - the most powerful of the three
 * =============================================================================
 * 1. WHAT IT IS
 *     {
 *       provide: TOKEN,
 *       useFactory: (dep1, dep2) => buildTheThing(dep1, dep2),
 *       inject: [Dep1Token, Dep2Token],   // resolved and passed IN THIS ORDER
 *     }
 *
 * Nest resolves everything in `inject`, calls your function with those values
 * IN THAT EXACT ORDER, and stores the return value under the token. If the
 * function returns a Promise, Nest AWAITS it before the application finishes
 * booting.
 *
 * 2. WHEN IT IS THE RIGHT CHOICE - four cases, all real:
 *    a) THE DECISION NEEDS INJECTED INFORMATION. This file: which channel to
 *       use depends on `AppConfigService`. `useClass` cannot ask a question;
 *       it is a static answer written in the source.
 *    b) CONSTRUCTION IS ASYNC - opening a database or Redis connection.
 *       See `src/redis/redis.module.ts` for an async factory.
 *    c) THE VALUE IS NOT A CLASS YOU CONTROL - a third-party SDK client that
 *       is configured through a builder or a `createClient()` function.
 *    d) YOU NEED SEVERAL DISTINCT INSTANCES OF THE SAME CLASS, each with
 *       different options (two Redis connections, two HTTP clients).
 *
 * 3. THE `inject` ARRAY IS POSITIONAL, AND THAT IS A REAL FOOTGUN.
 *    Nest matches by INDEX, not by name or type. Reorder `inject` without
 *    reordering the parameters and you get a runtime type confusion that
 *    TypeScript cannot catch, because the factory signature is checked against
 *    what you wrote, not against what Nest will pass. Keep them adjacent and
 *    keep them in the same order - and be suspicious of any factory long enough
 *    that they scroll apart.
 *
 * 4. COMMON MISTAKE: forgetting `inject` entirely. The factory then receives
 *    `undefined` for every parameter, and you get "Cannot read properties of
 *    undefined" from inside the factory rather than a helpful DI error. If a
 *    factory crashes on a dependency, check `inject` first.
 *
 * 5. TRADE-OFF vs `useClass`: a factory is imperative code that runs at boot,
 *    so it is harder to read and harder to test than a class swap. Prefer
 *    `useClass` when the decision is static. Reach for `useFactory` when you
 *    genuinely need to ASK something before deciding.
 * =============================================================================
 */
export const notificationChannelProvider: Provider = {
  provide: NOTIFICATION_CHANNEL,

  /**
   * The factory receives ALREADY-CONSTRUCTED instances, because all three
   * channels are registered as providers below.
   *
   * WHY NOT `new EmailNotificationChannel(config)` INSIDE THE FACTORY?
   * It would work today and rot tomorrow. `EmailNotificationChannel` has a
   * dependency; the day it gains a second one, every manual `new` has to be
   * found and updated - which is precisely the problem DI exists to remove.
   * Letting the container build them keeps their constructors free to change.
   *
   * THE COST, STATED HONESTLY: all three channels are instantiated even though
   * only one is used. Here they are trivially cheap. If one of them opened an
   * SMTP pool at construction, this pattern would be wasteful and you would
   * instead inject `ModuleRef` and resolve the winner lazily - a trade-off
   * worth naming in an interview, because it shows you have thought past the
   * happy path.
   */
  useFactory: (
    config: AppConfigService,
    consoleChannel: ConsoleNotificationChannel,
    emailChannel: EmailNotificationChannel,
    noopChannel: NoopNotificationChannel,
  ): NotificationChannel => {
    const logger = new Logger('NotificationChannelFactory');

    // Tests must be silent and must never attempt delivery.
    if (config.isTest) return noopChannel;

    // Production delivers for real; everywhere else, print it so a developer
    // can see what would have been sent.
    const channel = config.isProduction ? emailChannel : consoleChannel;

    // Log the selection ONCE at boot. When something is chosen dynamically,
    // "which one did it pick?" is the first question during an incident - and
    // a startup log line answers it without a debugger.
    logger.log(`Notification channel: ${channel.name} (env=${config.app.nodeEnv})`);

    return channel;
  },

  /**
   * POSITIONAL, and matching the parameter list above exactly.
   *
   * Note the mix of token kinds: `AppConfigService` is a class token from a
   * @Global() module; the three channels are class tokens from THIS module's
   * providers. A factory can inject anything the module can see - including
   * string tokens, which is how the Redis module's factory gets its config.
   */
  inject: [
    AppConfigService,
    ConsoleNotificationChannel,
    EmailNotificationChannel,
    NoopNotificationChannel,
  ],
};
