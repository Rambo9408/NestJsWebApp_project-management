/**
 * =============================================================================
 * INJECTION TOKENS
 * =============================================================================
 * A "provider token" is the KEY under which Nest stores a provider in a
 * module's container. One sentence removes most of the mystery from Nest DI:
 *
 *     The container is (conceptually) a Map<Token, Instance>.
 *     A provider is a { token, recipe } pair.
 *     Injection is a lookup by token.
 *
 * A token can be one of three things:
 *
 *   1. A CLASS   -> `providers: [UsersService]`      token = the class object
 *   2. A STRING  -> `{ provide: 'CACHE', useValue: c }`
 *   3. A SYMBOL  -> `{ provide: CACHE, useValue: c }`
 *
 * WHY DO NON-CLASS TOKENS EXIST AT ALL?
 * Because a class token only works when the injected thing IS a class that
 * TypeScript can name in a constructor signature. Three very common cases break
 * that assumption:
 *
 *   a) THE VALUE IS NOT A CLASS - a Redis client instance, a Mongoose
 *      connection, a frozen config object, a feature-flag map.
 *
 *   b) THE VALUE IS TYPED BY AN INTERFACE. This is the big one. Interfaces are
 *      ERASED at compile time. There is no runtime object to use as a key, so:
 *
 *          constructor(private hasher: PasswordHasher) {}   // interface
 *
 *      compiles fine and then fails at boot, because `design:paramtypes`
 *      records `Object` - a token that resolves to nothing. You MUST write:
 *
 *          constructor(@Inject(PASSWORD_HASHER) private hasher: PasswordHasher) {}
 *
 *      The `@Inject()` supplies the runtime key that the type system cannot.
 *      This is the single most common "why doesn't my DI work" question, and
 *      being able to explain *why* (type erasure, not a Nest quirk) is what
 *      separates a memorised answer from an understood one.
 *
 *   c) YOU WANT SEVERAL INSTANCES OF THE SAME CLASS, distinguished by role -
 *      two Redis connections, two HTTP clients pointed at different services.
 *      Same class, so the class token cannot tell them apart. Distinct tokens
 *      can.
 *
 * STRING VS SYMBOL - which to use?
 *   - STRINGS appear verbatim in error messages ("...the argument
 *     PASSWORD_HASHER at index [1]"), which makes debugging pleasant. This is
 *     what most tutorials and most real codebases use.
 *   - SYMBOLS are collision-proof: `Symbol('X')` never equals another symbol
 *     with the same description, so two libraries cannot accidentally claim the
 *     same token. The cost is that error messages read `Symbol(X)` and the
 *     symbol must be imported everywhere (which is a good habit anyway).
 *   - THE PRACTICAL MIDDLE GROUND, used here: EXPORTED STRING CONSTANTS with an
 *     app-specific prefix. Readable errors, and because everyone imports the
 *     constant, a typo is a compile error rather than a runtime mystery.
 *
 * COMMON MISTAKE - writing the raw string in two places:
 *     { provide: 'CACHE_CLIENT', ... }   // registration
 *     @Inject('CACHE_CLENT')             // consumption, typo
 * Those are two different tokens. Nest cannot help you; you get a resolution
 * error at boot (or, worse, a silently different provider). Always import a
 * constant.
 *
 * A NOTE ON ABSTRACT CLASSES AS TOKENS (the fourth option, worth knowing):
 * an abstract class exists at runtime, so it can serve as BOTH the type and the
 * token, with no `@Inject()` needed:
 *
 *     export abstract class PasswordHasherPort { abstract hash(p: string): Promise<string>; }
 *     { provide: PasswordHasherPort, useClass: BcryptPasswordHasher }
 *     constructor(private readonly hasher: PasswordHasherPort) {}   // no @Inject!
 *
 * TRADE-OFF: it is more ergonomic, and it drags a class into a place where you
 * only wanted a contract (you cannot `implements` two abstract classes as
 * cleanly as two interfaces, and it costs a runtime class). Both styles are
 * common in production Nest code. This project uses INTERFACE + STRING TOKEN so
 * that the type-erasure lesson is unavoidable - but say in an interview that
 * you know both, and why you would pick each.
 * =============================================================================
 */

/**
 * The password-hashing strategy used by UsersModule.
 *
 * Registered with `useClass` so the implementation can be swapped in one line
 * (bcrypt today, scrypt or argon2 tomorrow) without touching `UsersService`.
 * See `src/users/hashing/`.
 */
export const PASSWORD_HASHER = 'TASKFLOW_PASSWORD_HASHER';

/**
 * How a notification reaches a human: console in development, "email" in
 * production, nothing during tests.
 *
 * Registered with `useFactory`, because the choice depends on `AppConfigService`
 * - and a `useClass` provider cannot inject anything to make that decision.
 * See `src/notifications/notifications.module.ts`.
 */
export const NOTIFICATION_CHANNEL = 'TASKFLOW_NOTIFICATION_CHANNEL';

/**
 * Immutable build/runtime metadata, registered with `useValue`.
 *
 * The canonical `useValue` case: a plain object with no dependencies and no
 * construction logic, that several modules want to read and that tests want to
 * stub. See `src/common/providers/app-metadata.provider.ts`.
 */
export const APP_METADATA = 'TASKFLOW_APP_METADATA';

/**
 * The shared ioredis client, created by an ASYNC `useFactory` because
 * connecting is I/O. See `src/redis/redis.module.ts`.
 */
export const REDIS_CLIENT = 'TASKFLOW_REDIS_CLIENT';

/**
 * A SECOND ioredis connection, used only for Pub/Sub in Phase 11.
 *
 * It must be separate: a Redis connection in subscriber mode cannot issue
 * normal commands, so sharing one client between GET and SUBSCRIBE breaks both.
 * This is case (c) above in its purest form - same class, two instances, and
 * the only thing that can tell them apart is the token.
 */
export const REDIS_SUBSCRIBER = 'TASKFLOW_REDIS_SUBSCRIBER';
