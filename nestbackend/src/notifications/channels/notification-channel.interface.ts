/**
 * What gets delivered. Deliberately transport-agnostic: no `html`, no `sms`,
 * no `deviceToken` - those belong to specific channels, and putting them here
 * would leak one implementation's concerns into the contract every
 * implementation must satisfy.
 */
export interface NotificationPayload {
  /** Recipient address in whatever form the channel understands. */
  to: string;
  subject: string;
  body: string;
  /** Structured context for logs and for richer channels. */
  meta?: Record<string, unknown>;
}

/**
 * =============================================================================
 * NotificationChannel - a PORT with several real implementations
 * =============================================================================
 * This is the textbook case for a non-class provider token, for two reasons at
 * once:
 *
 *   1. It is an INTERFACE, so there is no runtime object to use as a key
 *      (interfaces are erased). Consumers must write
 *      `@Inject(NOTIFICATION_CHANNEL)`.
 *
 *   2. WHICH implementation to use is decided at RUNTIME from configuration -
 *      console in development, email in production, a no-op in tests. A
 *      `useClass` provider is a static decision written in the source; this one
 *      needs to read `AppConfigService`, and only a FACTORY can inject
 *      something in order to decide.
 *
 * THE PATTERN IS STRATEGY, AGAIN - the same shape as `PasswordHasher`, chosen
 * differently:
 *
 *     PasswordHasher      -> useClass   (the decision is made at build time)
 *     NotificationChannel -> useFactory (the decision needs injected config)
 *
 * That contrast is the most useful thing in this phase. `useClass` and
 * `useFactory` are not alternatives you pick by taste; the question is whether
 * the decision requires information only available at runtime.
 *
 * WHY NOT ONE CLASS WITH `if (isProduction) { sendEmail() } else { log() }`?
 * Because every branch then drags in its own dependencies (an SMTP client, a
 * push SDK, a rate limiter), the class grows a constructor nobody can read, and
 * the test for the console path must still satisfy the email path's
 * dependencies. Separate classes keep each one small and independently
 * testable; the module composes them.
 * =============================================================================
 */
export interface NotificationChannel {
  /** Identifies the active implementation in logs and health output. */
  readonly name: string;

  /**
   * Deliver a notification.
   *
   * CONTRACT NOTE - and this is the kind of decision an interviewer will probe:
   * implementations MUST NOT throw for ordinary delivery failures. A
   * notification is a side effect of the operation the user asked for, not the
   * operation itself. If adding a project member succeeds but the "you were
   * added" email bounces, the correct outcome is a logged warning, not a 500
   * that makes the client retry an operation that already happened.
   *
   * The real answer at scale is to not send inline at all: enqueue the
   * notification and let a worker retry it with backoff, so delivery failures
   * are isolated from the request path entirely. That is exactly what Phase 12
   * does, and this contract is written so that swapping to it changes nothing
   * for callers.
   */
  send(payload: NotificationPayload): Promise<void>;
}
