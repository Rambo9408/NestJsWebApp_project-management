# Phase 3 — Provider tokens and custom providers

> **Goal:** take the `{ token, recipe }` sentence literally. By the end you can explain why tokens
> exist at all, choose between `useClass` / `useValue` / `useFactory` / `useExisting` for a reason
> rather than by habit, and say precisely why you cannot inject an interface.

Files delivered:

```
src/common/constants/injection-tokens.ts          five real tokens, fully annotated
src/common/providers/app-metadata.provider.ts     useValue
src/users/hashing/password-hasher.interface.ts    the port
src/users/hashing/bcrypt-password-hasher.ts       implementation #1
src/users/hashing/scrypt-password-hasher.ts       implementation #2 (real, zero-dependency)
src/users/hashing/password-hasher.spec.ts         a CONTRACT test over both
src/users/users.module.ts                         useClass
src/notifications/                                useFactory (sync, env-driven strategy)
src/redis/redis.module.ts                         useFactory (ASYNC, real I/O) + shutdown hook
```

Verified: `npm run lint` ✅ · `tsc --noEmit` ✅ · `npm test` ✅ **38 passing** · app boots with Redis
down (degraded mode) ✅ · `app.close()` closes Redis and the process exits cleanly ✅

---

## Table of contents

1. [Why tokens exist](#1-why-tokens-exist)
2. [The four recipes, and how to choose](#2-the-four-recipes-and-how-to-choose)
3. [`useValue`](#3-usevalue)
4. [`useClass`](#4-useclass)
5. [`useFactory` — synchronous](#5-usefactory--synchronous)
6. [`useFactory` — asynchronous](#6-usefactory--asynchronous)
7. [`useExisting`, and the identity bug](#7-useexisting-and-the-identity-bug)
8. [Contract tests: the risk a token introduces](#8-contract-tests-the-risk-a-token-introduces)
9. [What you can see running](#9-what-you-can-see-running)
10. [Phase 3 interview questions](#10-phase-3-interview-questions)
11. [Phase 3 scenario questions](#11-phase-3-scenario-questions)
12. [Self-check before Phase 4](#12-self-check-before-phase-4)

---

## 1. Why tokens exist

A token is the **key** a provider is filed under. Most of the time the key is the class itself, and
you never think about it. Tokens become unavoidable in three situations, and this phase has a real
example of each.

### (a) The value is not a class

```ts
{ provide: REDIS_CLIENT, useFactory: async () => new Redis(opts) }
```

An `ioredis` instance, a Mongoose connection, a frozen metadata object. There is no class of _ours_
to name in a constructor signature.

### (b) The value is typed by an interface — **the big one**

```ts
constructor(private readonly hasher: PasswordHasher) {}   // ❌ interface
```

TypeScript **erases** interfaces. At runtime, `design:paramtypes` for that parameter records
`Object` — a token that resolves to nothing — so Nest throws
`Nest can't resolve dependencies of the UsersService (UsersRepository, ?, AppConfigService)`.

```ts
constructor(@Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher) {}   // ✅
```

The interface supplies the **compile-time type**; the token supplies the **runtime key**. Two
systems, two jobs. Being able to explain _why_ — type erasure, not a Nest quirk — is what separates
a memorised answer from an understood one.

### (c) You need two instances of the same class

```ts
REDIS_CLIENT; // normal commands
REDIS_SUBSCRIBER; // Phase 11 — a connection in subscriber mode cannot issue normal commands
```

Same class, so the class token cannot tell them apart. Distinct tokens can.

### String vs symbol vs abstract class

| Kind                   | Pro                                                         | Con                                                  |
| ---------------------- | ----------------------------------------------------------- | ---------------------------------------------------- |
| **String** (used here) | Appears verbatim in error messages                          | Collisions are possible in principle                 |
| **Symbol**             | Collision-proof by construction                             | Errors read `Symbol(X)`; must be imported            |
| **Abstract class**     | Serves as _both_ type and token — **no `@Inject()` needed** | Drags a runtime class in where you wanted a contract |

This project uses **exported string constants with an app prefix**: readable errors, and because
everyone imports the constant, a typo is a compile error instead of a runtime mystery.

The abstract-class option is worth knowing by name, because a lot of production Nest code uses it:

```ts
export abstract class PasswordHasherPort { abstract hash(p: string): Promise<string>; }
{ provide: PasswordHasherPort, useClass: BcryptPasswordHasher }
constructor(private readonly hasher: PasswordHasherPort) {}   // no @Inject
```

Say in an interview that you know both and why you would pick each.

> **Common mistake:** writing the raw string in two places — `{ provide: 'CACHE_CLIENT' }` and
> `@Inject('CACHE_CLENT')`. Those are two different tokens. Always import a constant.

---

## 2. The four recipes, and how to choose

| Recipe        | Meaning                                       | Reach for it when                                                |
| ------------- | --------------------------------------------- | ---------------------------------------------------------------- |
| `useValue`    | "Here is the finished object"                 | Constants, pre-built SDK clients, **test stubs**                 |
| `useClass`    | "Build one of these for this token"           | The implementation choice is **static**                          |
| `useFactory`  | "Run this function and store what it returns" | The choice needs **injected info**, or construction is **async** |
| `useExisting` | "This token is an **alias** for that one"     | Renaming a token; one instance under two contracts               |

**The decision that actually matters — `useClass` vs `useFactory`:**

> Does deciding _which implementation_ require information that only exists at runtime?
> No → `useClass`. Yes → `useFactory`.

This phase has both side by side, deliberately:

```
PasswordHasher      → useClass    the decision is made at build time, in source
NotificationChannel → useFactory  the decision needs AppConfigService injected
```

That is not a stylistic difference. `useClass` is a static answer written in the source; a factory
is the only recipe that can _ask a question_ before answering.

---

## 3. `useValue`

```ts
export const appMetadataProvider: Provider = { provide: APP_METADATA, useValue: appMetadata };
```

Nest constructs nothing and injects nothing — it just files the value under the token.

**Where you already use it constantly:** every `{ provide: X, useValue: fake }` in a spec. Same
token, different recipe — that substitution _is_ the mechanism behind "DI makes code testable".

### Two traps

**1. It is evaluated at import time.** The object is built when the module file is first
`require`d — before the DI container exists and before `ConfigModule` has validated anything. So a
`useValue` provider may **not** depend on configuration, and reading `process.env` inside one is a
race you will eventually lose. If you need config, you need a factory.

**2. It hands out a shared, mutable reference.** Every consumer gets the same object. One of them
doing `metadata.version = 'x'` mutates it for the whole process — a global variable with extra
steps. Hence:

```ts
export const appMetadata: AppMetadata = Object.freeze({ ... });   // runtime promise
export interface AppMetadata { readonly name: string; ... }        // compile-time promise
```

Use both. `readonly` is erased; `freeze` is not.

---

## 4. `useClass`

```ts
{ provide: PASSWORD_HASHER, useClass: BcryptPasswordHasher }
```

"When someone asks for PASSWORD_HASHER, instantiate `BcryptPasswordHasher` — resolving _its_
constructor dependencies first — and hand them that instance."

To move the entire application onto scrypt, change **one word**:

```ts
{ provide: PASSWORD_HASHER, useClass: ScryptPasswordHasher }
```

`UsersService` does not change. Its tests do not change. Nothing that injects the token changes.
That is Dependency Inversion made mechanical, and the module is the right place for the decision
because it is the composition point.

`ScryptPasswordHasher` is **not a mock** — scrypt (RFC 7914) is a legitimate memory-hard KDF built
into Node, with `timingSafeEqual` for constant-time comparison. Both implementations are real, and
both pass the same contract test.

### The gotcha that costs an afternoon

```ts
providers: [
  BcryptPasswordHasher, // instance A
  { provide: PASSWORD_HASHER, useClass: BcryptPasswordHasher }, // instance B — a DIFFERENT object
];
```

`useClass` means "build one for this token", not "reuse the one you already built". Two instances,
two sets of state. When you want an alias, you want `useExisting` (§7).

`users.module.ts` registers the class **only** through the token — deliberately, because depending
on the concrete class is exactly what the port exists to prevent.

### When _not_ to introduce a port

If there will genuinely only ever be one implementation and it is cheap in tests,
`providers: [TheClass]` is fine. A port for a class you will never swap is architecture theatre.
Here it earns its keep twice: hashing algorithms really do get deprecated, and bcrypt really is too
slow to run in a test suite.

### The honest migration story

You cannot bulk re-hash passwords — you do not have the plaintexts. A real algorithm migration is
gradual: keep verifying old hashes with the old algorithm, and re-hash at the moment of a successful
login, where the plaintext is briefly available. That is why both implementations produce
**self-describing** output (`$2b$12$…` vs `scrypt$…`), and why a production hasher is often a small
facade that delegates by prefix — a fourth implementation of the same interface, composed from the
other two.

---

## 5. `useFactory` — synchronous

```ts
{
  provide: NOTIFICATION_CHANNEL,
  useFactory: (config, consoleChannel, emailChannel, noopChannel) => {
    if (config.isTest) return noopChannel;
    return config.isProduction ? emailChannel : consoleChannel;
  },
  inject: [AppConfigService, ConsoleNotificationChannel, EmailNotificationChannel, NoopNotificationChannel],
}
```

Nest resolves everything in `inject`, calls the function with those values **in that exact order**,
and stores the return value under the token.

**Why a factory and not `useClass`?** Because the decision reads `AppConfigService`. A `useClass`
provider cannot ask a question.

**Why not one class with `if (isProduction) sendEmail() else log()`?** Because every branch drags in
its own dependencies (an SMTP client, a push SDK, a rate limiter), the constructor becomes
unreadable, and the test for the console path still has to satisfy the email path's dependencies.
Separate classes stay small and independently testable; the module composes them.

### Three things to get right

- **`inject` is positional.** Nest matches by index, not by name or type. Reorder one without the
  other and you get a runtime type confusion TypeScript cannot catch — the factory signature is
  checked against what you wrote, not against what Nest will pass. Keep them adjacent.
- **Forgetting `inject` entirely** gives every parameter `undefined`, so you get
  "Cannot read properties of undefined" from _inside_ the factory rather than a helpful DI error.
  If a factory crashes on a dependency, check `inject` first.
- **The factory receives already-constructed instances.** Writing
  `new EmailNotificationChannel(config)` by hand would work today and break the moment that class
  gains a second dependency — the exact problem DI exists to remove.

**The cost, stated honestly:** all three channels are instantiated even though one is used. They are
trivially cheap here. If one opened an SMTP pool at construction, you would inject `ModuleRef` and
resolve the winner lazily instead. Naming that trade-off shows you have thought past the happy path.

### Two supporting patterns worth their names

- **Null Object** (`NoopNotificationChannel`): an implementation that satisfies the contract and
  does nothing, so callers keep **one** code path — no `channel?.send()`, no `if (!isTest)` sprinkled
  through business logic, and nothing to forget. The trade-off is that silence hides bugs, so a test
  that _asserts_ a notification was sent must use a recording fake instead. Null Object is for
  "I don't care"; a spy is for "I care that it happened".
- **Facade** (`NotificationsService`): it exists to **own a rule** — the one `try/catch` guaranteeing
  a failed notification never fails the business operation that triggered it. A facade that only
  forwards should be deleted; this one is also the seam where Phase 12 swaps inline sending for a
  queue without callers noticing.

---

## 6. `useFactory` — asynchronous

```ts
useFactory: async (config: AppConfigService): Promise<Redis> => { ... await client.connect() ... }
```

**If the factory returns a Promise, Nest awaits it before the application finishes booting.** That
single behaviour is why this cannot be `useClass` (constructors cannot be async) or `useValue` (the
value must exist before configuration is even validated).

### The design decision in that file

**Should the app boot if Redis is down?** Our answer: **yes, degraded**, and the reasoning
generalises:

> **Fail fast on dependencies you cannot function without; degrade gracefully on dependencies that
> only make you faster.**

Redis here does caching and background work — a cache miss just means reading MongoDB. Refusing to
start would convert a performance degradation into a total outage. MongoDB (Phase 5) is the
opposite: without it there is no correct response, so failing fast is honest.

Then make the degradation **visible** — the log line is a `warn`, and Phase 18's readiness probe
will report `degraded` rather than pretending.

The opposite choice is defensible when Redis holds sessions or is the only rate limiter in front of
a login endpoint; then an outage is a security problem, not a performance one. Know which case you
are in.

### Four production details in ~20 lines

| Setting                                       | Why                                                                                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lazyConnect: true`                           | Control _when_ the attempt happens, so its failure is catchable instead of an unhandled rejection during module construction                                 |
| `maxRetriesPerRequest: 2`                     | The default retries ~forever, so a cache read during an outage hangs and everything queues behind it. Fail fast at the edge, not slowly in the middle        |
| `retryStrategy` returning `null` after 10     | An uncapped reconnect loop emits an error event every few hundred ms forever — fills disks, costs money in a hosted log platform                             |
| `client.on('error', …)` **before** connecting | A Node EventEmitter that emits `error` with no listener **throws**. This one line is the difference between quiet reconnection and a crash on a network blip |

### Why the _module_ implements the shutdown hook

A factory-created provider is a plain object to Nest — it will not call `onApplicationShutdown` on
the ioredis client, because the client does not implement Nest's interface. So the module closes
what it opened:

```ts
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}
  async onApplicationShutdown() {
    await this.client.quit();
  }
}
```

(A module class can inject providers exactly like any other class.)

Without it, a rolling deploy leaves sockets open until the server times them out, and the process can
outlive `app.close()` because an open handle keeps the event loop from draining — the classic
"my container will not exit" and "Jest did not exit one second after the test run" symptoms.

`quit()` waits for in-flight commands (graceful); `disconnect()` severs immediately. Use `quit` on
shutdown, `disconnect` only when you have given up.

### Why `redis/` and not `cache/`

Three subsystems need a Redis socket and they are not the same concern: caching (Phase 10), BullMQ
(Phase 12), pub/sub fan-out for SSE (Phase 11). If the connection lived in `cache/`, `queue/` would
import `cache/` just to get a socket — a dependency that states something false about the
architecture. Owning the **connection** separately from the **uses** of it keeps every module's
dependencies honest.

---

## 7. `useExisting`, and the identity bug

```ts
useClass:    "build a new one for this token"    → two objects
useExisting: "point this token at that provider" → one object
```

`notifications.module.spec.ts` proves it in nine lines of assertion:

```ts
providers: [ConsoleNotificationChannel, { provide: ALIAS, useClass: ConsoleNotificationChannel }]
expect(viaAlias).not.toBe(viaClass);

await viaAlias.send(...);
expect(viaAlias.sentCount).toBe(1);
expect(viaClass.sentCount).toBe(0);   // ← the "why is my counter zero?" bug
```

```ts
providers: [
  ConsoleNotificationChannel,
  { provide: ALIAS, useExisting: ConsoleNotificationChannel },
];
expect(viaAlias).toBe(viaClass); // one object, one counter
```

**Real uses for `useExisting`:** renaming a token without a breaking change (alias the old one to
the new one for a release); exposing one implementation under several contracts (a single
`AuditLogService` also serving a narrower `ReadOnlyAuditLog` token).

### A testing lesson that came out of building this

The spec originally used `.overrideProvider(AppConfigService)` and failed. **`overrideProvider` can
only replace a provider the graph already contains** — and `AppConfigService` is not one of
`NotificationsModule`'s providers; in the real app it arrives from a `@Global()` module the test
never imported. `overrideProvider` _substitutes_; it does not _supply_.

The honest fix reproduces the real topology:

```ts
@Global()
@Module({ providers: [{ provide: AppConfigService, useValue: cfg }], exports: [AppConfigService] })
class FakeConfigModule {}
```

This is the standard recipe for testing any module that depends on global infrastructure.

---

## 8. Contract tests: the risk a token introduces

Programming against a token means the implementation can be swapped. The corresponding risk is that
a new implementation satisfies the **type** but not the **contract** — it compiles, and it is subtly
wrong. A fake that returns `null` where the real one throws is the classic case: green suite, broken
application.

`password-hasher.spec.ts` is the cheap defence — one suite, `describe.each`, run against **every**
implementation:

```
✓ exposes an algorithm label
✓ never returns the plaintext
✓ produces a DIFFERENT hash for the same password each time (random salt)
✓ verifies a correct password
✓ rejects an incorrect password
✓ returns false — never throws — for a hash from a different algorithm
```

Add argon2 and you get its coverage by adding one line to the array. And if it fails, it fails
_before_ you change the one line in `users.module.ts`.

That last case is not hypothetical: during a migration, `compare` **will** be handed foreign hashes.
Throwing would turn "this user is on the old algorithm" into a 500.

---

## 9. What you can see running

```bash
npm run build && node dist/main.js
```

**With Redis stopped** (which is how this was verified):

```
LOG  [AppService] Booted in "development" mode (v0.1.0, commit local)   ← useValue provider
LOG  [NotificationChannelFactory] Notification channel: console (env=development)   ← useFactory decision
WARN [RedisFactory] Redis unavailable at localhost:6379 - starting in DEGRADED mode
LOG  [InstanceLoader] RedisModule dependencies initialized
```

The startup line naming the selected channel is deliberate: when something is chosen dynamically,
"which one did it pick?" is the first question during an incident, and a log line answers it without
a debugger.

```bash
curl -s localhost:3000/api/v1
# {"name":"taskflow-api","version":"0.1.0","commit":"local","builtAt":"...","uptimeSeconds":15,...}
```

`commit` is not decoration: "which build is actually running?" is one of the first incident
questions, and "the deploy silently did not roll out" is a very common answer.

**Adding a member fires the selected channel:**

```
LOG   [ConsoleNotificationChannel] [notification] to=ada@example.com subject="Added to project WEB"
DEBUG [ConsoleNotificationChannel] You have been added to "Website" as member.
```

**Shutdown closes what the factory opened:**

```
--- calling app.close() ---
LOG [RedisModule] Closing Redis connection (signal: none)
--- closed; process exits, no leaked handles ---
```

---

## 10. Phase 3 interview questions

**1. What is a provider token?**
The key a provider is filed under in the module's container. Usually the class itself; a string or
symbol when the class cannot serve as a key.

**2. Why can't you inject an interface?**
Interfaces are erased at compile time, so `design:paramtypes` records `Object` for that parameter and
there is nothing to look up. Use `@Inject(TOKEN)` with an exported constant, or an abstract class,
which does exist at runtime and can serve as both type and token.
_Follow-up:_ Show me both. — See §1.

**3. String, symbol or abstract class token — which and why?**
Strings for readable error messages (what this project uses, via exported constants so typos are
compile errors). Symbols when collision-safety matters, e.g. a published library. Abstract classes
when you want the ergonomics of no `@Inject()` and do not mind a runtime class standing in for a
contract.

**4. Name the four provider recipes and when you'd use each.**
`useValue` (finished object; constants and test stubs), `useClass` (static implementation choice),
`useFactory` (the choice needs injected info, or construction is async), `useExisting` (alias to an
existing provider).

**5. `useClass` vs `useFactory` — what actually decides it?**
Whether the decision requires runtime information. `useClass` is a static answer written in source;
only a factory can ask a question first.

**6. `useClass` vs `useExisting`?**
`useClass` builds a **new** instance for the token. `useExisting` **aliases** an existing one.
Registering a class directly _and_ with `useClass` gives you two independent objects — separate
state, and a confusing bug when work through one token is invisible through the other.

**7. How does `useFactory` receive its dependencies?**
Through the `inject` array, **positionally** — Nest matches by index, not name or type. Async
factories are awaited before bootstrap completes.

**8. What happens if you forget `inject`?**
Every parameter is `undefined`, so the failure is a TypeError inside your factory rather than a DI
error. Check `inject` first when a factory crashes on a dependency.

**9. What are the two traps with `useValue`?**
It is evaluated at import time (so it cannot depend on validated configuration), and it hands out a
shared mutable reference (so freeze it, and mark the type `readonly`).

**10. Where is `useValue` most used in a real codebase?**
Test doubles. `{ provide: X, useValue: fake }` is the substitution that makes DI's testability claim
concrete.

**11. Can a factory provider be async? What does Nest do with the promise?**
Yes — Nest awaits it during bootstrap, before the server listens. That is the only way to do async
construction, since constructors cannot be async.

**12. Should the app start if Redis is unavailable?**
Depends on Redis's role. As a cache: yes, degrade and report it — refusing to start turns a
performance problem into an outage. As a session store or the only rate limiter on login: no, fail
readiness, because now it is a security problem. Fail fast on what you need; degrade on what makes
you faster.

**13. Why attach the `error` listener before connecting?**
A Node EventEmitter that emits `error` with no listener throws, which would crash the process on a
transient blip.

**14. Why bound `maxRetriesPerRequest` and cap `retryStrategy`?**
Unbounded retries turn "the cache is missing" into "requests hang and pile up", and an uncapped
reconnect loop emits errors forever, filling disks and log budgets.

**15. Who closes a connection created by a factory?**
Not Nest — the returned object is a plain value and does not implement Nest's lifecycle interfaces.
The module registers the hook and injects its own provider to close it. Skipping this leaks handles:
the container will not exit, and Jest warns that it did not exit after the run.

**16. How do you inject two different connections of the same class?**
Two tokens, two factory providers. The class token cannot distinguish them.

**17. Your test calls `.overrideProvider(X)` and Nest still can't resolve X. Why?**
`overrideProvider` replaces a provider that already exists in the compiled graph; it does not supply
a missing one. If X comes from a `@Global()` module the test never imported, declare a small
`@Global()` fake module instead.

**18. What is the risk of programming against a token, and how do you manage it?**
That a new implementation satisfies the type but not the behaviour. Manage it with a contract test
run against every implementation via `describe.each`.

**19. What is the Null Object pattern and where is it here?**
An implementation that satisfies the contract and does nothing, so callers keep one code path.
`NoopNotificationChannel` in tests. The trade-off is that silence hides bugs, so assert-on-send tests
need a recording fake instead.

**20. Why does `NotificationsService` exist at all if it just forwards to a channel?**
It owns the rule that a delivery failure never fails the business operation, in one place instead of
fifteen — and it is the seam where Phase 12 swaps inline sending for a queue without callers
changing. A facade that only forwards should be deleted; one that owns a rule earns its keep.

**21. Why does `addMember` await the notification instead of firing and forgetting?**
Not awaiting creates a floating promise: an unhandled-rejection risk and an untestable race, since
an assertion can run before the send does. (`no-floating-promises` is an ESLint error here for that
reason.) The cost is that the response waits for the channel — which is precisely why delivery moves
to a queue in Phase 12.

---

## 11. Phase 3 scenario questions

**A — "We're migrating from bcrypt to argon2 for 2 million existing users."**
You cannot bulk re-hash — you do not have the plaintexts. Ship a hasher that _verifies_ both formats
(dispatching on the self-describing prefix) and _writes_ only argon2, then re-hash opportunistically
on successful login where the plaintext is briefly available. Track the proportion still on bcrypt as
a metric; force a reset for the long tail that never logs in. Structurally: a third implementation of
the same port, composed from the other two, swapped in one line — and the contract test covers it
before you switch.

**B — "A counter on our service is always zero, but the code that increments it definitely runs."**
Two instances. Almost certainly the class is registered directly _and_ under a token with
`useClass`, or it is declared in two modules. Check every `providers` array for duplicates, and
assert identity in a test (`expect(a).toBe(b)`). Fix with `useExisting` for the alias case, or with
one owning module that exports it.

**C — "The service crashes on boot with 'Cannot read properties of undefined' inside a factory."**
Look at `inject` before anything else — either it is missing, or its order no longer matches the
factory's parameters. TypeScript cannot catch it because the signature is checked against what you
wrote, not against what Nest passes.

**D — "Our container takes 30 seconds to stop and then gets SIGKILLed."**
Something is not closing. Factory-created clients (Redis, Mongo, message brokers) are plain objects
and will never receive Nest's lifecycle calls, so their owning modules must implement
`onApplicationShutdown` and call `quit()`. Also confirm `app.enableShutdownHooks()` is on — without
it, none of the hooks run at all.

**E — "Our staging environment sent real emails to customers."**
The channel decision was not centralised — an `if` somewhere in business logic, or a factory keyed on
something other than the environment. One factory, one decision, and a startup log line naming the
selection. If a `console.log` of the chosen channel had existed, the mistake would have been visible
in the first boot log instead of in a customer's inbox.

**F — "Can we make everything request-scoped so each request gets a fresh hasher?"**
Ask why first — a stateless hasher has no reason to be per-request. Then explain the cost: request
scope is contagious _upward_, so every provider that depends on it is instantiated per request too,
and you lose singleton caching along the whole chain. That is Phase 4, and it is the next thing we
build.

---

## 12. Self-check before Phase 4

- [ ] Explain, from type erasure, why `@Inject()` is required for an interface.
- [ ] Name the four recipes and give a real reason to choose each.
- [ ] State the one question that decides `useClass` vs `useFactory`.
- [ ] Explain the two `useValue` traps and the two-part fix (`readonly` + `Object.freeze`).
- [ ] Predict the instance count for `providers: [X, { provide: T, useClass: X }]` — and for
      `useExisting`.
- [ ] Explain why `inject` being positional is dangerous.
- [ ] Explain who closes a factory-created connection, and what breaks if nobody does.
- [ ] Give the rule for fail-fast vs degrade, and apply it to Redis and to MongoDB.
- [ ] Say why `overrideProvider` cannot supply a missing provider.

**Next:** Phase 4 — provider scopes (`DEFAULT` / `REQUEST` / `TRANSIENT`), how request scope bubbles
up the dependency chain and what it costs, `ModuleRef` and lazy resolution, a full debugging guide
for dependency-resolution errors, and circular dependencies: `forwardRef()`, why it usually signals
a design problem, and the three better fixes — demonstrated on the `UsersService ↔ ProjectsService`
cycle this project has deliberately avoided so far.
