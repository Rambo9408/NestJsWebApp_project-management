# Intermediate — 30 questions

> Where most 4–5 year interviews actually live. The theme throughout: you are expected to know the
> mechanism, not just the API.

---

### I1. Explain the three custom provider recipes and when you use each.

**Answer.** A provider is a `{token, recipe}` pair. `useClass` — "construct this class for this
token". `useValue` — "here is the finished object". `useFactory` — "run this function, possibly async,
to produce it", with `inject` supplying the factory's own dependencies **positionally**.

**Why it matters.** They are the difference between a container that can only build classes and one
that can wire real infrastructure.

**Real-world example.** `REDIS_CLIENT` is a `useFactory` — it needs config injected, has to construct
an ioredis client with specific options, and is async. `appMetadata` is a `useValue`. `PASSWORD_HASHER`
is a `useClass` swapped by environment.

**Common mistake.** Getting the `inject` array out of order. It is positional, and a mismatch fails at
runtime with a confusing type error, not at compile time.

**Follow-up.** *"What is `useExisting` for?"* — aliasing. `useClass` on an already-registered class
creates a **second instance**; `useExisting` points a new token at the same object. Testable with
`expect(a).toBe(b)`.

---

### I2. How do you inject something that has no class to reference — an interface?

**Answer.** You cannot inject an interface: it does not exist at runtime. Two options — a **token**
(string or symbol) plus `@Inject(TOKEN)`, or an **abstract class**, which is both a type *and* a
runtime value.

**Why it matters.** The abstract class is usually the better answer: it serves as the token *and* the
type, so consumers need no `@Inject()` at all, and the compiler enforces that implementations are
complete.

**Real-world example.** `UsersRepository` is an abstract class. `UsersService` writes
`private readonly usersRepository: UsersRepository` — clean constructor, full type safety, and the
module decides between the Mongo and in-memory implementation.

**Common mistake.** `@Inject('UsersRepository')` with a magic string typed nowhere, so a typo is a
runtime failure and there is no compile-time link between token and shape.

**Follow-up.** *"When is a symbol token better?"* — when collision across libraries is a real risk.
For application code, an abstract class is almost always nicer.

---

### I3. What are provider scopes, and what is scope bubbling?

**Answer.** `DEFAULT` (singleton, one per application), `REQUEST` (one per request), `TRANSIENT` (a
new one per injection site). **Scope bubbles upward**: if a request-scoped provider is injected into
a singleton, that consumer becomes request-scoped too, and so on up the chain.

**Why it matters.** That contagion is the cost. One innocuous request-scoped provider deep in the
graph can quietly make half your application rebuild on every request.

**Real-world example.** This project uses `AsyncLocalStorage` for request context precisely to avoid
it — `RequestContextService` stays a singleton with per-request *storage*.

**Common mistake.** Reaching for `Scope.REQUEST` to hold a correlation id or the current user. It
works and it is the most expensive of the three options.

**Follow-up.** *"How do you get a request-scoped provider from `ModuleRef`?"* — `resolve()`, not
`get()`, and you must pass the `contextId` to land in the same request's sub-tree.

---

### I4. How do you resolve a circular dependency, and is `forwardRef` the right answer?

**Answer.** `forwardRef(() => Other)` on **both sides** — a cycle has two edges, and doing one leaves
`undefined at index [n]` at runtime. But `forwardRef` is the *last* option, not the first.

The four ways out, ranked:
1. **Extract the shared logic** into a third module both depend on.
2. **Invert with an event** — the dependency disappears rather than being deferred.
3. **Use an interface/token** so only one side knows the other's shape.
4. `forwardRef` — works, but the cycle is still there and it is a design smell you have annotated.

**Why it matters.** `forwardRef` makes the error go away without making the coupling go away.

**Real-world example.** This codebase deliberately built a `UsersService ↔ ProjectsService` cycle in
Phase 4 with `forwardRef`, then **deleted it entirely** in Phase 13 by having `UsersService` emit
`USER_DELETION_REQUESTED` and `ProjectsModule` listen. The `forwardRef` count in the repository is
now **zero**.

**Common mistake.** Adding `forwardRef` to one side only, and concluding Nest is broken.

**Follow-up.** *"Why does the cycle exist in the first place?"* — usually because a module is doing
someone else's job. The cycle is the symptom.

---

### I5. What is a global module and when should you use one?

**Answer.** `@Global()` registers a module's exports in the root injector, so consumers do not need to
import it. It is still a normal module in every other respect.

**Why it matters.** The point is to avoid importing the same infrastructure module into forty feature
modules — noise that communicates nothing.

**Real-world example.** Config, Redis, the database connection and `CommonModule` are global. Feature
modules are not, and that is deliberate: `@Global()` on a domain module destroys the boundary that
makes the architecture legible.

**Common mistake.** Making everything global "for convenience", which turns the module graph into
decoration and hides real coupling.

**Follow-up.** *"Does `@Global()` make the provider a singleton?"* — no. Scope and globality are
orthogonal; providers are singletons by default regardless.

---

### I6. Explain `APP_GUARD`, `APP_PIPE`, `APP_INTERCEPTOR`, `APP_FILTER`.

**Answer.** Special tokens that register a **global** enhancer as a provider, which means it can be
injected into. `app.useGlobalGuards(new RolesGuard(...))` in `main.ts` cannot inject anything —
you constructed it yourself, outside the container.

**Why it matters.** This is a very common interview question, and the answer is exactly that
distinction.

**Real-world example.** `AllExceptionsFilter` injects `HttpAdapterHost` and `RequestContextService`.
Registered by hand, it could have neither.

**Common mistake.** Registering the same enhancer both ways and running it twice.

**Follow-up.** *"Where should they be declared?"* — anywhere; `APP_*` providers are hoisted regardless
of the declaring module. So choose the file a reader will look in. Here, guards live with the auth
module, everything else in `CommonModule`.

---

### I7. `whitelist`, `forbidNonWhitelisted`, `transform` — what does each do?

**Answer.** `whitelist` strips properties with no validation decorator. `forbidNonWhitelisted` rejects
the request instead of stripping. `transform` converts the plain body into an actual DTO instance and
applies type conversions.

**Why it matters.** `whitelist` is the structural fix for **mass assignment**: `{"role": "admin"}` in
the body never reaches the model. `forbidNonWhitelisted` turns a silent drop into a 400 that names the
field — safer *and* kinder.

**Real-world example.** The global pipe here uses all three, with `enableImplicitConversion: false`.

**Common mistake.** Turning on `enableImplicitConversion` because it "just works". It coerces
aggressively and surprisingly — `"false"` becoming `true` is the classic. Explicit `@Type()` is
predictable.

**Follow-up.** *"With `transform: true`, is the object a real DTO instance?"* — yes, so class methods
and defaults work. Without it you get a plain object that merely passed validation.

---

### I8. How do you validate a nested object in a DTO?

**Answer.** `@ValidateNested()` **and** `@Type(() => Child)`. Both. Always.

**Why it matters.** This is a **silent** hole. Without `@Type()`, `class-transformer` does not know
what to instantiate, so the nested object stays a plain object, `class-validator` finds no metadata on
it, and it passes validation completely unvalidated.

**Real-world example.** Any DTO with an array of child objects: `@ValidateNested({ each: true })` plus
`@Type(() => ChildDto)`.

**Common mistake.** Exactly the above — writing only `@ValidateNested()` and believing the nested
rules are enforced. Nothing errors.

**Follow-up.** *"How do you distinguish `null` from absent?"* — `@ValidateIf((o, v) => v !== undefined)`
or `@IsOptional()` depending on which you mean. `@IsOptional()` skips validation for **both**, which
is often not what you want for a PATCH.

---

### I9. What is the difference between `PartialType`, `PickType` and `OmitType`?

**Answer.** Mapped types that derive one DTO from another: all fields optional; a chosen subset; the
complement of a chosen subset. They preserve the validation decorators.

**Why it matters.** They keep one source of truth. Hand-copying `CreateUserDto` into `UpdateUserDto`
means the day someone adds a field, one of the two is wrong.

**Real-world example.** `UpdateUserDto extends PartialType(CreateUserDto)`.

**Common mistake.** Importing them from `@nestjs/mapped-types` when you use Swagger. Import from
**`@nestjs/swagger`** or the OpenAPI metadata is lost.

**Follow-up.** *"How do you compose them?"* — they nest:
`PartialType(OmitType(CreateUserDto, ['email']))`.

---

### I10. How does a global auth guard know to skip public routes?

**Answer.** A `@Public()` decorator sets metadata via `SetMetadata`; the guard reads it with
`Reflector.getAllAndOverride(IS_PUBLIC_KEY, [handler, class])` and returns `true` early.

**Why it matters.** This is the **deny-by-default** pattern, and it is the single highest-value
security structure in the project: a new endpoint is protected because you did nothing, and exposing
it requires a decorator that shows up in review.

**Real-world example.** Login, register and the health probes carry `@Public()`. Everything else is
protected without anyone remembering to protect it.

**Common mistake.** Opt-in guards. Every "we forgot to protect that one endpoint" incident is this
mistake.

**Follow-up.** *"`getAllAndOverride` vs `getAllAndMerge`?"* — override takes the first match, so the
handler wins over the class; merge combines them. Use override for on/off flags, merge for
accumulating roles.

---

### I11. How do you implement role-based access control?

**Answer.** A `@Roles(...)` decorator writing metadata, a `RolesGuard` reading it with the `Reflector`
and comparing against `request.user.roles`, registered globally **after** the auth guard.

**Why it matters.** Order is load-bearing: global guards run in registration order, and `RolesGuard`
needs the user the auth guard attached.

**Real-world example.** `@Roles(Role.ADMIN)` on the `UsersController` class, so every route inherits
it and specific routes can relax it.

**Common mistake.** Reading roles from the request body or a client-supplied header. Roles come from
the validated token or a fresh database read — never from the client.

**Follow-up.** *"Where does RBAC stop being enough?"* — when permission depends on the **resource**,
not the user. That needs a resource guard (`ProjectAccessGuard` here) or a policy layer (CASL).

---

### I12. How do you authorize per-resource, not just per-role?

**Answer.** A guard that extracts the resource id from params/body/query, loads the membership, and
compares the caller's role *on that resource* against `@ProjectRoles()` metadata.

**Why it matters.** "Is this user an admin?" and "is this user allowed to touch *this* project?" are
different questions, and only the second one is usually the real requirement.

**Real-world example.** `ProjectAccessGuard`, with an admin bypass that is explicitly audited —
because an unlogged super-power is how privilege escalation goes unnoticed.

**Common mistake.** Doing the check in the service "since it has the data anyway". Then it is one
`if` away from being forgotten in the next endpoint, and it is not visible in the route's decorators.

**Follow-up.** *"404 or 403 for a project you are not a member of?"* — **404.** A 403 confirms the
project exists, which leaks the existence of resources you have no relationship with.

---

### I13. How does cache-aside work, and what are its failure modes?

**Answer.** Read: check cache → miss → read database → write cache with a TTL. Write: update the
database → **invalidate** the key.

**Why it matters.** The read path stays correct if the cache is empty, stale or entirely gone —
which is why it degrades instead of failing.

**Real-world example.** `ProjectsService.findById` is cache-aside; every write calls
`invalidateProject()`. `CacheService` catches every Redis error and returns a miss, logging at `warn`
so degradation is visible.

**Common mistake.** Invalidating *before* the write commits. A concurrent read then repopulates the
cache with the old value and it stays wrong until the TTL.

**Follow-up.** *"What is a cache stampede?"* — a hot key expires under load and every concurrent
request hits the database at once. Fix: dedupe in-flight loads to one promise per key, and jitter your
TTLs so a batch does not expire in the same second.

---

### I14. How do you implement distributed rate limiting?

**Answer.** `@nestjs/throttler` with a **Redis** storage implementation, so all instances share the
counters. Fixed window via `INCR` plus a TTL set on first increment.

**Why it matters.** An in-memory limiter with five instances turns a limit of 100 into 500 — and it
works perfectly in development, where there is one.

**Real-world example.** `RedisThrottlerStorage` here, with the trap handled: after `INCR`, check
`PTTL == -1` and set the expiry, or a key created by a race lives forever and the user is locked out
permanently.

**Common mistake.** Keying by IP only. That punishes everyone behind one NAT and does nothing against
a botnet. Key by user when authenticated.

**Follow-up.** *"Fail open or closed when Redis is down?"* — depends on what the limit protects.
General API: fail open (availability). Login: fail closed, because the limit *is* the brute-force
defence.

---

### I15. How does SSE work, and when do you choose it over WebSockets?

**Answer.** Server-Sent Events is a long-lived HTTP response with `Content-Type: text/event-stream`.
In Nest, `@Sse()` returns an Observable that **never completes** — completing closes the stream.

**Why it matters.** SSE is one-directional and plain HTTP, so it works through proxies, is trivially
load-balanced with no sticky sessions, and reconnects automatically in the browser. WebSockets buy
you bidirectionality, and you pay for it.

**Real-world example.** Notifications here are SSE: the server pushes, the client never needs to push
back over the same channel.

**Common mistake.** One SSE stream per feature. **HTTP/1.1 allows six connections per origin**, so
four streams leave two connections for the rest of the app. Multiplex one stream.

**Follow-up.** *"Why can't you send an `Authorization` header with `EventSource`?"* — the browser API
does not allow it. Options: a cookie, or a short-lived token in the query string, which then appears
in access logs.

---

### I16. How do you fan out real-time events across multiple instances?

**Answer.** Redis Pub/Sub (or the Socket.IO Redis adapter). An instance publishes; every instance
subscribes and forwards to its own connected clients.

**Why it matters.** An in-process `EventEmitter` only reaches clients connected to the same box. This
works flawlessly in development and breaks the moment you scale to two.

**Real-world example.** This project provisions **two** Redis connections — `REDIS_CLIENT` and
`REDIS_SUBSCRIBER` — because a connection in subscriber mode cannot run normal commands.

**Common mistake.** Trying to reuse one client and getting cryptic "only (P)SUBSCRIBE / (P)UNSUBSCRIBE
allowed in this context" errors.

**Follow-up.** *"Redis Pub/Sub gives at-most-once — is that acceptable?"* — for a live notification
toast, usually yes, because the durable copy is in MongoDB. For anything that must not be lost, use
Streams or a real broker.

---

### I17. Why use a queue, and what does BullMQ give you?

**Answer.** To get slow, retryable, or failure-prone work off the request path. BullMQ (Redis-backed)
adds retries with backoff, delayed and repeatable jobs, concurrency control, priorities, and
observability of what is pending.

**Why it matters.** The user should not wait for an email to be sent, and the request should not fail
because a third party is slow.

**Real-world example.** Notification dispatch is queued; the HTTP handler enqueues and returns in
milliseconds.

**Common mistake.** Catching errors inside the processor and logging them. **You retry by throwing**
— swallow the error and BullMQ marks the job completed, so it never retries.

**Follow-up.** *"What BullMQ-specific Redis options are mandatory?"* — `maxRetriesPerRequest: null`
(BullMQ blocks on `BRPOPLPUSH`, and ioredis's default retry cap kills it) and, here,
`enableOfflineQueue: false` so a Redis outage fails fast instead of queueing commands in memory.

---

### I18. How do you make a job handler safe to run twice?

**Answer.** Idempotency. Either a deterministic `jobId` so BullMQ deduplicates on enqueue, or a
handler that checks whether the effect already happened before applying it.

**Why it matters.** At-least-once delivery is the norm. A worker that dies after doing the work but
before acknowledging it *will* re-run.

**Real-world example.** `jobId` derived from the domain event, so an event emitted twice enqueues one
job.

**Common mistake.** Assuming "we set retries to 0, so it runs once". Stalled-job recovery re-runs
jobs whose worker died — that is not a retry, and it is not covered by the retry setting.

**Follow-up.** *"How do you shut a worker down safely?"* — `worker.close()` inside Nest's shutdown
hooks, which stops taking new jobs and waits for in-flight ones. That is also why the Dockerfile uses
`CMD ["node", ...]` — via `npm run`, the SIGTERM never reaches Node.

---

### I19. What does `@nestjs/event-emitter` give you, and when is it the wrong tool?

**Answer.** In-process pub/sub with decorator-based listeners (`@OnEvent`). It decouples the emitter
from the handler.

**Why it matters.** It is how the circular dependency in this project was removed: `UsersService` no
longer knows `ProjectsService` exists.

**Real-world example.** `USER_DELETION_REQUESTED` uses `emitAsync` with a **veto** pattern — listeners
push blockers onto the payload, and the emitter throws a 409 if any were added. That gives you a
synchronous decision without a synchronous dependency.

**Common mistake.** Using it for anything that must not be lost. It is **in-process and in-memory**:
if the process dies between the state change and the listener running, the event is gone forever.

**Follow-up.** *"How do you make it durable?"* — the **transactional outbox**: write the event to a
collection in the same transaction as the state change, and have a relay publish it. That is the real
answer to dual writes.

---

### I20. `emit` vs `emitAsync`?

**Answer.** `emit` is fire-and-forget and returns immediately; `emitAsync` awaits every listener and
collects their results.

**Why it matters.** With `emit`, a listener that throws produces an **unhandled rejection** and the
emitter never knows. With `emitAsync`, you can react — which is what makes the veto pattern possible.

**Real-world example.** Audit logging uses `emit` (never block a request for a log line); the deletion
veto uses `emitAsync`.

**Common mistake.** Using `emitAsync` everywhere, which quietly couples the request's latency to every
listener and re-creates the synchronous dependency you were removing.

**Follow-up.** *"Wildcards?"* — enable them in the module options, and note the syntax: `**` matches
across delimiters; `*` matches a single segment. The audit listener uses `@OnEvent('**')`.

---

### I21. How do you test a guard?

**Answer.** Construct it directly with a fake `Reflector` and a hand-built `ExecutionContext`
(`switchToHttp: () => ({ getRequest: () => ({ user }) })`, `getHandler`, `getClass`).

**Why it matters.** A guard is a pure function of metadata and request. Every branch — no metadata, no
user, wrong role, right role — is one cheap assertion. Testing them through HTTP is a whole round trip
per branch.

**Real-world example.** `roles.guard.spec.ts` covers four cases in milliseconds.

**Common mistake.** Only testing the happy path. The interesting branches in a guard are all the
denials.

**Follow-up.** *"When is an e2e test the right level instead?"* — when the thing under test is the
**interaction**: guard order, or that a 401 beats a 400.

---

### I22. What is `getModelToken` for?

**Answer.** `MongooseModule.forFeature` registers models under a generated token. `getModelToken('User')`
gives you that token so a test can override it with a fake.

**Why it matters.** Without it you cannot substitute a model, and every service test needs a database.
(`getQueueToken` is the BullMQ equivalent.)

**Real-world example.** Repository unit tests bind `getModelToken(User.name)` to a stub.

**Common mistake.** Trying to override by class name. The token is generated, not the class.

**Follow-up.** *"Is a fake model a good idea?"* — for the service above it, yes. For the repository
itself, no — use a real `mongod`, because the behaviour under test *is* MongoDB's.

---

### I23. How do you run e2e tests against a real database without Docker?

**Answer.** `mongodb-memory-server` downloads and runs a real `mongod` binary. For transactions and
change streams you need a **replica set** (`MongoMemoryReplSet`), because those features require one.

**Why it matters.** It is a real MongoDB, so unique indexes, atomic `$inc` and transactions genuinely
work — a hand-written fake would be a fiction that agrees with you.

**Real-world example.** This suite starts **one** replica set in a Jest `globalSetup` and gives each
suite its own database name. Three separate instances took ~10 minutes; one shared instance takes
**30 seconds**.

**Common mistake.** Starting a fresh instance per suite file. That is where the ten minutes went.

**Follow-up.** *"How do you isolate suites that share one server?"* — separate database names, and
clean collections in `beforeEach` rather than dropping the database.

---

### I24. What are `onModuleInit`, `onApplicationBootstrap`, `onModuleDestroy` and
`beforeApplicationShutdown` for?

**Answer.** Lifecycle hooks. Init runs when the module's dependencies are resolved; bootstrap after
*everything* is initialised; the destroy hooks on shutdown, in reverse dependency order.

**Why it matters.** Anything holding a socket, a timer or a thread needs a shutdown path, or every
deploy drops in-flight work.

**Real-world example.** `RedisModule` implements `OnApplicationShutdown` and quits **both** clients.
A `useFactory`-created object is a plain value and never receives lifecycle calls — so the *module*
has to inject its own provider and close it.

**Common mistake.** Forgetting `app.enableShutdownHooks()`. Without it, none of the destroy hooks ever
run.

**Follow-up.** *"Init or bootstrap for warming a cache?"* — bootstrap, so every other module is ready.

---

### I25. How do you version an API in Nest?

**Answer.** `app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })`, then
`@Version('2')` on a controller (or `version` in the `@Controller()` options) to run both side by side.

**Why it matters.** Versioning is how you ship a breaking change without a coordinated client
migration — which for a public or mobile API you cannot have.

**Real-world example.** `/api/v1/tasks` here; the health probes are `VERSION_NEUTRAL` because
infrastructure wants one stable path forever.

**Common mistake.** Putting `@Version()` on a class. It is a **method** decorator; controller-wide
versions go in the `@Controller({ path, version })` options object.

**Follow-up.** *"URI vs header vs media type?"* — URI is visible in logs and trivial to test by hand;
header keeps URLs clean but is invisible; media type is the most RESTfully pure and the least
practical.

---

### I26. What is the difference between `populate` and `$lookup`?

**Answer.** `populate` is Mongoose-level: it issues a **second query** and stitches the results.
`$lookup` is a server-side aggregation stage: one round trip, and the joined data is available to
subsequent stages.

**Why it matters.** `populate` cannot filter or sort by the joined data, because the join happens
after the fact. If you need `tasks where assignee.department = 'X'`, you need `$lookup`.

**Real-world example.** Task lists use `populate` for assignee names; reporting aggregations use
`$lookup`.

**Common mistake.** `populate` inside a loop — the N+1 problem, 51 round trips to list 50 tasks.

**Follow-up.** *"How do you make an aggregation fast?"* — `$match` **first**, so an index can be used
and the pipeline works on the smallest possible set. A `$match` after a `$group` scans everything.

---

### I27. How do transactions work with Mongoose, and what is the footgun?

**Answer.** Start a session, use `session.withTransaction(async () => ...)`, and pass the session to
**every** operation inside. Requires a replica set.

**Why it matters.** An operation that forgets the session runs **outside** the transaction and is not
rolled back — silently.

**Real-world example.** `TransactionRunner` here centralises it, and the integration tests assert
**both** commit and rollback, because a transaction test that only checks the happy path proves
nothing.

**Common mistake.** `Model.create(doc, { session })`. With a single document that signature means
something else; you need `Model.create([doc], { session })`.

**Follow-up.** *"When do you not need a transaction?"* — when a single document update is enough.
MongoDB is atomic at the document level, so a well-designed embed often removes the need entirely.

---

### I28. How do you prevent a lost update under concurrency?

**Answer.** Three tools: atomic operators (`$inc`, `$push`) rather than read-modify-write; a
**conditional update** (`updateOne({ _id, status: 'open' }, ...)` so the precondition is checked
server-side); or optimistic concurrency with a version field.

**Why it matters.** `find` → mutate in JS → `save` is a race. Two concurrent requests both read 5,
both write 6, and one increment vanishes.

**Real-world example.** Counters here use `$inc`; state transitions use a conditional update and treat
`matchedCount === 0` as a conflict.

**Common mistake.** Assuming a transaction fixes it. A transaction gives isolation, not a guarantee
that your read is still current when you write — you still need the precondition.

**Follow-up.** *"When is pessimistic locking right?"* — when conflicts are frequent and retrying is
expensive. In MongoDB that usually means rethinking the document model instead.

---

### I29. How do you avoid leaking secrets in logs?

**Answer.** Redact at the logger, not at the call site. Pino's `redact` takes a list of paths
(`req.headers.authorization`, `req.headers.cookie`, `res.headers["set-cookie"]`, `req.body.password`)
and replaces them before serialisation.

**Why it matters.** With request auto-logging on and no redaction, **every log line contains a bearer
token and a session cookie**. Logs are then a credential store: replicated, retained for a year,
shipped to a vendor, readable by anyone with a dashboard login. It happens by *default*, not by
mistake.

**Real-world example.** The redaction list in `logging.module.ts`, plus an audit listener that redacts
before writing events to the activity log.

**Common mistake.** Relying on developers to not log the wrong object.

**Follow-up.** *"What else leaks?"* — error messages from drivers (schema, hostnames, values), stack
traces in responses, and a 403 where a 404 was needed.

---

### I30. What is a correlation ID and how do you implement one?

**Answer.** A single id attached to every log line for one request, propagated to downstream services
via a header. Implemented with middleware that mints or adopts an `x-request-id` and stores it in
`AsyncLocalStorage`, so every layer can read it without threading a parameter.

**Why it matters.** Without it, debugging across twelve instances is grep. With it, one query gives
you the whole request.

**Real-world example.** This project honours an incoming id (so traces span services), echoes it in
the response header (so a user can quote it in a bug report), and **caps its length** — a
client-supplied header that lands in every log line is a cheap DoS against your log bill.

**Common mistake.** Two components each generating one. Running the server live here showed the
interceptor and pino minting **different** ids for the same request. The rule: exactly one place may
mint it; everything else adopts it.

**Follow-up.** *"How does this relate to OpenTelemetry?"* — it is the hand-rolled version of
`traceparent`. OTel propagates it automatically through the Mongo driver, Redis and outbound HTTP.

---

**Next:** [Advanced — 30 questions](03-advanced.md)
