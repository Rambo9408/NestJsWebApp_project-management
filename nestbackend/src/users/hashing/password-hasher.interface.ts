/**
 * =============================================================================
 * PasswordHasher - a PORT (an interface the domain depends on)
 * =============================================================================
 * `UsersService` needs "turn a password into something safe to store, and check
 * a candidate against it". It has no business knowing whether that is bcrypt,
 * scrypt or argon2.
 *
 * WHY AN INTERFACE INSTEAD OF DEPENDING ON `BcryptPasswordHasher` DIRECTLY?
 *
 *   1. IMPLEMENTATION SWAPPING. Password hashing algorithms get deprecated -
 *      that is their life cycle, not a hypothetical. When argon2id replaces
 *      bcrypt, the change is ONE LINE in `users.module.ts`. `UsersService` does
 *      not recompile differently, and neither does anything else.
 *
 *   2. TESTABILITY. A spec substitutes a fake that hashes instantly, so a suite
 *      with 50 registrations does not spend 12 seconds burning CPU.
 *
 *   3. DEPENDENCY INVERSION (the D in SOLID), stated precisely: the high-level
 *      policy (`UsersService`) and the low-level detail (`BcryptPasswordHasher`)
 *      BOTH depend on this abstraction. The arrow that used to point from
 *      policy to detail now points from both to the interface - which is why
 *      the detail can be replaced without touching the policy.
 *
 * THIS IS ALSO THE STRATEGY PATTERN.
 *   - Problem it solves: several interchangeable algorithms for one job, chosen
 *     without `if/else` at every call site.
 *   - How DI expresses it: the strategy is selected once, in the module; every
 *     consumer just injects the token.
 *   - Alternative: a `switch (algorithm)` inside one class. Simpler for two
 *     cases; it becomes a maintenance problem when each branch needs its own
 *     dependencies and its own tests.
 *   - Trade-off: one more file and one more indirection. Worth it exactly when
 *     the implementation is genuinely likely to change or genuinely expensive
 *     in tests. Both are true here; neither is true for, say, a date formatter -
 *     do not apply this pattern reflexively.
 *
 * -----------------------------------------------------------------------------
 * AND NOW THE CRITICAL NESTJS LESSON
 * -----------------------------------------------------------------------------
 * You cannot inject an interface:
 *
 *     constructor(private readonly hasher: PasswordHasher) {}   // ❌ fails at boot
 *
 * TypeScript erases interfaces. At runtime the emitted metadata for that
 * parameter is `Object`, which is not a registered token, so Nest throws
 * "Nest can't resolve dependencies of the UsersService (..., ?)".
 *
 * The fix is to supply the runtime key yourself:
 *
 *     constructor(@Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher) {}
 *
 * The interface still gives you compile-time safety; the token gives the
 * container something to look up. Two systems, two jobs. Understanding this
 * distinction is what makes the rest of custom providers obvious rather than
 * arbitrary.
 * =============================================================================
 */
export interface PasswordHasher {
  /**
   * Hash a plaintext password. The returned string is SELF-DESCRIBING: it
   * carries the algorithm, its parameters and the salt, so verification needs
   * nothing else stored alongside it.
   */
  hash(plaintext: string): Promise<string>;

  /**
   * Verify a candidate against a stored hash.
   *
   * Implementations MUST use a constant-time comparison. `derived === stored`
   * leaks information through timing: an attacker measures how long the compare
   * takes and learns how many leading bytes were correct.
   */
  compare(plaintext: string, hash: string): Promise<boolean>;

  /**
   * A name for logs and health output, e.g. `bcrypt(12)`.
   *
   * Small but genuinely useful: when you are mid-migration and half your users
   * are on the old algorithm, this is what tells you which one a given instance
   * is configured with.
   */
  readonly algorithm: string;
}
