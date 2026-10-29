# Advanced — 30 questions

> Mechanism, not API. These are the questions where the interviewer is checking whether you have
> actually debugged the thing or only read about it.

---

### A1. How does Nest's dependency injection actually work under the hood?

**Answer.** Three pieces. (1) `emitDecoratorMetadata` in `tsconfig.json` makes TypeScript emit a
`design:paramtypes` array — the runtime constructor parameter types — for any class with a decorator.
(2) `reflect-metadata` provides the `Reflect.getMetadata` API to read it. (3) At bootstrap Nest walks
the module graph, and for each provider reads `design:paramtypes`, resolves each token to an instance
(recursively, depth-first), and calls the constructor.

**Why it matters.** Every DI limitation follows from this: interfaces cannot be injected because they
have no runtime representation, `@Inject()` exists to override the emitted type with an explicit
token, and a missing `@Injectable()` means no metadata was emitted at all.

**Real-world example.** Deleting `@Injectable()` from a class with dependencies produces
`Nest can't resolve dependencies... at index [0]` — not because the class is unknown, but because
`design:paramtypes` was never written.

**Common mistake.** Believing Nest "reads the TypeScript". It reads compiler-emitted metadata, and
only where a decorator triggered emission.

**Follow-up.** *"Why does a type-only import break injection?"* — `import type` is erased, so the
emitted metadata is `Object`. That is why this codebase imports injectable classes normally.

---

### A2. Walk through Nest's five-step provider resolution.

**Answer.** For each constructor parameter: (1) read the token from `design:paramtypes` or an explicit
`@Inject()`; (2) look in the **current module's** providers; (3) look in the providers **exported by
its imported modules**; (4) look in the global injector (`@Global()` modules and `APP_*`); (5) if it
is still unresolved, throw at bootstrap.

**Why it matters.** Step 3 is the one people miss: importing a module gives you only its **exports**,
not its providers. That is the encapsulation rule stated as an algorithm.

**Real-world example.** `UsersModule` exports `UsersService` but not `UsersRepository`, so the
repository is unreachable from outside — enforced by the container, not by convention.

**Common mistake.** Assuming `imports` means "I can see everything in there".

**Follow-up.** *"What is the `?` in `The dependency at index [1] appears to be undefined`?"* — a
circular import: the module evaluated before the other side's class binding existed. Hence
`forwardRef`, on both sides.

---

### A3. What exactly does `forwardRef` do?

**Answer.** It defers evaluation. Instead of passing the class reference (which is `undefined` at that
point in an ES module cycle), you pass a **thunk** that Nest calls later, after both modules have
finished evaluating.

**Why it matters.** It is not a Nest feature so much as a workaround for JavaScript module semantics.
Understanding that is why you know it must be on both sides — both edges of the cycle have the same
problem.

**Real-world example.** Removed from this codebase entirely by inverting the dependency with a domain
event. The count is zero, and that was a precondition for the extraction story in Phase 20.

**Common mistake.** Treating it as the solution rather than the annotation of a problem.

**Follow-up.** *"Why can a cycle across services be worse than in-process?"* — over a network it is a
distributed deadlock, and there is no `forwardRef` for that.

---

### A4. When would you genuinely need `Scope.REQUEST`, and what does it cost?

**Answer.** When a provider must hold per-request state that cannot be passed as an argument and
cannot live in `AsyncLocalStorage` — most commonly multi-tenancy where a database connection or a
schema is selected per request.

The cost: the provider **and every consumer above it** is re-instantiated per request. Nest builds a
per-request sub-tree, so the whole chain up to the controller is rebuilt.

**Why it matters.** Scope is contagious *upward*, and that contagion is easy to introduce accidentally
and hard to notice.

**Real-world example.** This project chose `AsyncLocalStorage` for the correlation id specifically to
avoid it — and gained something extra: it works in a **BullMQ worker**, where there is no request at
all, so a request-scoped provider could not exist.

**Common mistake.** Injecting `REQUEST` into a service just to read the user, thereby making that
service and everything using it request-scoped.

**Follow-up.** *"How do you get a request-scoped instance from a singleton?"* — `moduleRef.resolve(T,
contextId)`, and you must pass the right `contextId` or you get a fresh, unrelated sub-tree.

---

### A5. `useClass` vs `useExisting` — what is the observable difference?

**Answer.** `useClass` **constructs a new instance** for that token. `useExisting` is an **alias** to
an already-registered provider — the same object.

**Why it matters.** With `useClass` you can end up with two instances of a class that was meant to be
a singleton — two Redis clients, two caches, two sets of in-flight state.

**Real-world example.** Testable in one line: `expect(app.get(TOKEN_A)).toBe(app.get(ServiceB))` is
true for `useExisting` and false for `useClass`.

**Common mistake.** Registering the same class under two tokens with `useClass` and wondering why
state is not shared.

**Follow-up.** *"When is a second instance what you want?"* — `REDIS_CLIENT` and `REDIS_SUBSCRIBER`
here: a connection in subscriber mode cannot issue normal commands, so two are genuinely required.

---

### A6. How would you build a dynamic module, and what is `forRootAsync` doing?

**Answer.** A static method returning a `DynamicModule` — `{ module, providers, exports, imports }`.
`forRootAsync` accepts `useFactory`/`inject` so the module's own configuration can come from the
container.

**Why it matters.** It is how a library is configured without global state, and it is the pattern
behind `MongooseModule`, `JwtModule` and `ThrottlerModule`.

**Real-world example.** `ScopesDemoModule.registerIf(condition)` returns an **empty** dynamic module in
production, so the diagnostics controller does not merely 403 — the route does not exist.

**Common mistake.** A subtle one this project hit: a `forRootAsync` factory resolves **inside the
dynamic module it configures**, so it cannot see providers from the module that is importing it.
`THROTTLER:MODULE_OPTIONS could not resolve RedisThrottlerStorage` was exactly that. The fix is to
pass `imports: [ThrottlerStorageModule]` in the async options.

**Follow-up.** *"`forRoot` vs `forFeature`?"* — `forRoot` configures the shared infrastructure once;
`forFeature` registers per-module pieces (models, queues) and can be called many times.

---

### A7. Why is `.lean()` faster, mechanically?

**Answer.** Mongoose hydration constructs a document instance per result: prototype wiring, getters
and setters, change tracking (`$__` internals), validation hooks and casting. `.lean()` returns the
driver's plain BSON-decoded objects.

**Why it matters.** Typically **3–5×** less CPU and memory on a list endpoint, for machinery you never
use if you are not going to `.save()`.

**Real-world example.** Every read-only query in this project is lean; only paths that mutate hydrate.

**Common mistake.** Leaning and then calling a schema method or virtual. Neither exists on a plain
object.

**Follow-up.** *"What do you lose?"* — virtuals, `id` getters, `toJSON` transforms, and document
methods. Which is why the repositories here map explicitly to `PublicUser` rather than relying on a
transform.

---

### A8. Explain the ESR rule for compound indexes.

**Answer.** Order compound index keys **Equality → Sort → Range**. Equality fields narrow the scan to
a contiguous region of the B-tree; the sort field then yields results already ordered; a range field
must come last because it scatters the scan.

**Why it matters.** Put a range field before the sort field and the index can no longer satisfy the
sort, so MongoDB does an in-memory sort — which **fails outright above 32MB**.

**Real-world example.** `{ projectId: 1, status: 1, dueAt: 1 }` on tasks: two equalities, then the
sort/range field.

**Common mistake.** Ordering keys by "importance" or by how they read in the query.

**Follow-up.** *"How do you verify?"* — `.explain('executionStats')` and compare `totalDocsExamined`
with `nReturned`. Near 1:1 is right; 50,000:20 means the index is wrong. `COLLSCAN` in the winning
plan is the alarm.

---

### A9. What is the index prefix rule, and why does it prevent index sprawl?

**Answer.** A compound index `{a, b, c}` also serves queries on `{a}` and `{a, b}` — any **prefix**.
It does **not** serve `{b}` or `{b, c}`.

**Why it matters.** Three indexes where one suffices costs write throughput on every insert and update,
plus RAM, because indexes want to be in memory.

**Real-world example.** Tasks have one compound index instead of three single-field ones.

**Common mistake.** Adding an index per query. Look for a superset first.

**Follow-up.** *"When is a single-field index still right?"* — when the field is queried alone and is
not a prefix of anything, or for a TTL or unique constraint.

---

### A10. What silently removed a unique constraint in this project?

**Answer.** Declaring the index twice. `@Prop({ index: true })` **and** `TaskSchema.index({reference: 1},
{unique: true})` produce two definitions for the same key. MongoDB threw
`SyncIndexesError: An existing index has the same name` — and the dangerous version of this is when it
does *not* throw and the non-unique definition wins.

**Why it matters.** You then believe you have a uniqueness guarantee that does not exist, and you find
out from duplicate data.

**Real-world example.** Fixed by removing `index: true` and keeping the explicit `schema.index()` call
as the single source of truth.

**Common mistake.** Mixing `@Prop({ index })`, `@Prop({ unique })` and `schema.index()` in one schema.
Pick one place.

**Follow-up.** *"Should `autoIndex` be on in production?"* — no. It builds indexes at boot, which on a
large collection can lock things up at exactly the wrong moment. Build them deliberately, ideally
in the background, as a migration step.

---

### A11. Why did `idToString` cause a stack overflow?

**Answer.** The helper checked `value._id` before `value.toHexString`. BSON's `ObjectId` exposes an
`_id` accessor that **returns itself**, so the recursion never terminated — `RangeError: Maximum call
stack size exceeded`, surfacing as a 500.

**Why it matters.** It is a good example of a bug that no type signature catches: the types were
correct, the runtime shape was surprising.

**Real-world example.** Fixed by checking `toHexString` **first**.

**Common mistake.** Assuming a library's runtime object matches its declared interface.

**Follow-up.** *"How would you catch that class of bug?"* — an integration test against real driver
objects, not hand-built fixtures. That is what found it.

---

### A12. How do you translate a duplicate-key error into a useful HTTP response?

**Answer.** Catch `MongoServerError` with `code === 11000` in the exception filter and map it to
**409 Conflict**.

**Why it matters.** Otherwise it is a 500 — a client's perfectly reasonable "this email is taken"
recorded as a server error, polluting your error rate and your alerting.

**Real-world example.** `AllExceptionsFilter` does this, with a **deliberately generic** message. The
driver's own message contains the index name and the conflicting **value**, which for an email index
is a user-enumeration oracle.

**Common mistake.** Checking for the duplicate first with a `findOne`. That is a race — two concurrent
requests both find nothing and both insert. The unique index is the real guarantee; the error handler
is how you report it.

**Follow-up.** *"So the check-then-insert pattern is always wrong?"* — as a *guarantee*, yes. As a
nicer error message on the common path, it is fine — but the index must still exist.

---

### A13. Why is `strictQuery` not a connection option?

**Answer.** It is a **Mongoose** option, not a driver option. Passing it to
`MongooseModule.forRootAsync`'s connection options gives `MongoParseError: option strictquery is not
supported`, because those options are forwarded to the MongoDB driver.

**Why it matters.** It is a good illustration of the two-layer stack: Mongoose options and driver
options look interchangeable and are not.

**Real-world example.** Moved into `baseSchemaOptions`, applied per schema.

**Common mistake.** Assuming everything in the Mongoose docs is a connection option.

**Follow-up.** *"What does `strictQuery: true` buy you?"* — an undeclared field in a filter is
stripped rather than silently matching nothing, which turns a typo from "empty result" into a visible
behaviour.

---

### A14. How do you design a refresh-token scheme that survives theft?

**Answer.** Four properties together: **rotation** (every refresh issues a new token and invalidates
the old one), **families** (rotated tokens share a family id), **reuse detection** (presenting an
already-rotated token means someone has a copy → revoke the entire family), and **hashed storage**
(SHA-256, so a database dump is not a set of live credentials).

**Why it matters.** Rotation alone does not detect theft; it just moves the window. The family plus
reuse detection is what turns a stolen token into a forced logout for the attacker *and* a signal.

**Real-world example.** Implemented here with a TTL index on the token collection so expired records
are removed by MongoDB rather than by a cron job you forgot to write.

**Common mistake.** Deleting the old token on rotation. Then a reused token is simply "not found",
indistinguishable from an expired one, and you lose the detection.

**Follow-up.** *"What about a legitimate race — two tabs refreshing at once?"* — a short grace window
where the immediately-previous token is accepted without triggering revocation. It is a real
trade-off, and saying so is the senior answer.

---

### A15. Why equalise login timing, and how?

**Answer.** If "user not found" returns in 2ms and "wrong password" takes 250ms (the bcrypt cost),
an attacker enumerates your entire user list with a stopwatch. The fix is to compare against a
**precomputed dummy hash** when the user does not exist, so both paths do the same work.

**Why it matters.** Enumeration turns a password-spray attack from guesswork into a targeted list, and
it is a privacy leak in its own right (who has an account here?).

**Real-world example.** `DUMMY_HASH` in `auth.service.ts`, with an identical error message —
"Invalid credentials" — on both paths.

**Common mistake.** Fixing the message and not the timing, or vice versa. You need both.

**Follow-up.** *"Where else does this apply?"* — password reset, "resend verification", and any
endpoint that behaves differently for a known address. The standard answer is to always respond
"if that address exists, we've sent an email".

---

### A16. When does CSRF apply, and when is it security theatre?

**Answer.** CSRF exists because browsers attach **cookies automatically**. So it applies to any
endpoint authenticated by a cookie, and **not** to one authenticated by `Authorization: Bearer` — the
browser never attaches that header by itself, and the same-origin policy stops an attacker's script
from adding it.

**Why it matters.** Applying CSRF to a bearer API is ceremony that protects nothing and breaks every
non-browser client.

**Real-world example.** Exactly two endpoints here need it — `POST /auth/refresh` and `POST
/auth/logout` — because the refresh token is an httpOnly cookie. `CsrfGuard` is therefore **opt-in**,
the opposite of the global auth guard's deny-by-default.

**Common mistake.** "We protect against CSRF everywhere." That is a weaker answer than the precise
one, because it means the precondition was never checked.

**Follow-up.** *"`SameSite=strict` already stops it — why the token too?"* — `SameSite` is enforced by
the **client**. Old browsers ignore it, and `SameSite=none` becomes necessary the moment the frontend
moves to a different site, silently removing the protection via a config change made for an unrelated
reason.

---

### A17. Why is the CSRF cookie deliberately **not** httpOnly?

**Answer.** Because it is **not a credential**. It carries no authority; it only proves the request
came from a page that could read our origin. Our own JavaScript must read it to echo it in a header —
making it httpOnly would break the pattern.

**Why it matters.** It looks like a mistake in review, and being able to explain why it is correct is
the whole point of the question.

**Real-world example.** `issueCsrfToken` sets `httpOnly: false`, `sameSite: 'strict'`, `secure` in
production — right next to the refresh cookie, which is `httpOnly: true`.

**Common mistake.** "Harden" it by making it httpOnly, which silently disables CSRF protection because
the header can no longer be set.

**Follow-up.** *"What is the known weakness?"* — a subdomain XSS can often set cookies on the parent
domain and forge a matching pair. The stronger variant is a **signed** double-submit: HMAC the token
with a server secret and the session id.

---

### A18. Why is `trust proxy` a security control?

**Answer.** Behind a load balancer, the TCP peer is the proxy. Without `trust proxy`, `req.ip` is the
balancer's address — so **every request looks like one client**, and your rate limiter either buckets
your entire user base together or is switched off.

**Why it matters.** It also drives `req.secure` and therefore whether cookies get the `secure` flag.

**Real-world example.** `app.set('trust proxy', 1)` — a specific hop count, never `true`.

**Common mistake.** `trust proxy: true`. That trusts the whole `X-Forwarded-For` chain, which the
client controls, so anyone can spoof their IP and bypass the limit entirely. It converts a fix into a
vulnerability.

**Follow-up.** *"What if there are two proxies?"* — set the number of trusted hops to match your actual
topology, and re-check it when the topology changes.

---

### A19. Why can't you compare secrets with `===`?

**Answer.** String comparison short-circuits at the first differing character, so the time taken leaks
how many leading characters matched. Over enough samples that reconstructs the value.

**Why it matters.** It applies to CSRF tokens, API keys, HMAC signatures and any token you compare
yourself — anywhere you are not using a comparison function designed for it.

**Real-world example.** `timingSafeEqual` in `CsrfGuard`, with a **length check first**, because
`timingSafeEqual` throws on unequal lengths. (The lengths are not secret — both values are ours.)

**Common mistake.** Assuming the network jitter drowns the signal. Statistical averaging over many
requests recovers it.

**Follow-up.** *"Why is `bcrypt.compare` safe?"* — it derives the hash from the candidate and compares
in constant time internally.

---

### A20. `KEYS` vs `SCAN` in Redis — why does it matter so much?

**Answer.** Redis is single-threaded. `KEYS pattern` is **O(n) over the entire keyspace and blocks the
server** for the whole scan. `SCAN` is cursor-based and incremental, so it interleaves with other
commands.

**Why it matters.** `KEYS` is fine at 100 keys in development and takes production down at 10 million.
It is one of the classic "worked on my machine" outages.

**Real-world example.** `CacheService.deleteByPattern` uses `SCAN`.

**Common mistake.** A second one, specific to ioredis: `keyPrefix` is applied to commands but the keys
**returned** by `SCAN` include the prefix. Delete them without accounting for that and you double-prefix
and delete nothing — silently.

**Follow-up.** *"A better design than pattern deletion?"* — maintain a set of keys per entity and
delete by that set, or version your key namespace so invalidation is a single counter bump.

---

### A21. Redis is down. Which subsystems should fail, and which should degrade?

**Answer.** The rule: **fail fast on dependencies you cannot function without; degrade gracefully on
dependencies that only make you faster.**

Cache → degrade (a miss reads MongoDB). Queue → degrade or fail depending on whether the work can run
inline. Rate limiting → a **policy decision**: fail open for general traffic, closed for login.
Real-time fan-out → degrade; the durable copy is in MongoDB. MongoDB itself → fail, because there is
no correct response to give without it.

**Why it matters.** It is one of the best "do you think about failure?" questions, and the answer is
per-dependency, not global.

**Real-world example.** This project boots and serves with Redis down — which is how the entire test
suite runs green in an environment without it, and which incidentally exercises every degraded path.

**Common mistake.** Making degradation **silent**. Log at `warn`, not `debug`, and surface it —
`/health/detail` reports Redis `down` while `/health/ready` stays `ok`.

**Follow-up.** *"When would you refuse to boot without Redis?"* — if it holds sessions, or is the only
brute-force defence in front of login. Then its outage is a security event, not a performance one.

---

### A22. Liveness vs readiness — why does conflating them cause outages?

**Answer.** Failing liveness makes the orchestrator **restart** the container; failing readiness makes
the load balancer **stop routing** to it. So a liveness probe must never check a dependency.

Put MongoDB in liveness and a 30-second database blip restarts every instance simultaneously; they all
reconnect at once, hammering the struggling database, and a blip becomes an outage plus a restart
loop.

**Why it matters.** The correct split makes the same blip self-healing with no human involved.

**Real-world example.** `/health/live` here checks **nothing** — the real signal is whether the handler
ran at all, since a blocked event loop fails the probe by timeout. `/health/ready` checks MongoDB.
`/health/detail` reports Redis and memory, and is deliberately **not** wired to the balancer.

**Common mistake.** A memory threshold in liveness. It measures the *process*, which under a shared
runtime is not your app — and the threshold silently duplicates the container memory limit in a
second place nobody updates.

**Follow-up.** *"Should readiness check a third-party API?"* — no. Their outage would take your service
out of rotation; you have handed a vendor the ability to page your on-call.

---

### A23. Why did the health endpoint lose its diagnostic payload?

**Answer.** Terminus signals failure by throwing `ServiceUnavailableException` whose response body *is*
the report. The **global** `AllExceptionsFilter` caught it and rewrote it into the project's standard
error envelope — correctly, by its own rules.

**Why it matters.** The general lesson is the valuable part: **a global enhancer is a policy, and some
endpoints have a different contract.** Health checks, webhook receivers that must answer in a
provider's format, and file downloads are the usual three.

**Real-world example.** Fixed with a controller-scoped `@Catch(ServiceUnavailableException)` filter
that passes the report through unchanged — not with an `if` in the global filter, which would make one
file responsible for every exception to its own rule.

**Common mistake.** Not noticing. It only shows up if you actually look at the response body, which is
why the e2e test asserts on `details.redis`.

**Follow-up.** *"State the two precedence rules."* — across scopes, the **most specific** matching
filter wins; at the same scope, the **last registered** wins. They are different rules.

---

### A24. Why does the Swagger CLI plugin not run under Jest?

**Answer.** It is a **build-time AST transform** invoked by `nest build`. It rewrites the TypeScript to
inject `@ApiProperty()` before compilation. `ts-jest` compiles the sources itself and never runs it —
silently, so DTO schemas come out with **no properties at all**.

**Why it matters.** It means the document produced by a test run is not the document you ship. Generate
the OpenAPI JSON from the **built artefact**, or a generated client has empty request bodies.

**Real-world example.** Found by writing an e2e test that asserted DTO properties and got `[]`. The
documented ts-jest workaround (`astTransformers: { before: ['@nestjs/swagger/plugin'] }`) also fails,
with `beforeTransformer.factory is not a function`. The assertion was kept — asserting the *empty*
result — with the reasoning in a comment, so a future fix turns the test red and tells us.

**Common mistake.** Trusting a test-generated document, or deleting the failing test.

**Follow-up.** *"What can a test safely assert?"* — paths, tags and security, which come from decorators
the compiler preserves. For DTO properties that genuinely matter, write explicit `@ApiProperty()`.

---

### A25. How do you write a contract test for two implementations of the same port?

**Answer.** One test suite, parameterised over the implementations — `describe.each([[ 'bcrypt', () =>
new BcryptHasher() ], [ 'scrypt', ... ]])` — asserting only the behaviour the port promises.

**Why it matters.** It is what makes a port a real abstraction rather than an aspiration. If the
in-memory repository behaves differently from the Mongo one, every test using the fake is a lie.

**Real-world example.** `password-hasher.spec.ts` runs the same assertions against both hashers: a hash
never equals the plaintext, verification succeeds for the right password and fails for the wrong one,
and two hashes of the same input differ (proving the salt).

**Common mistake.** Testing only the production implementation and assuming the fake matches.

**Follow-up.** *"Where else would you apply this?"* — the repositories. In-memory and Mongo
implementations should pass the same suite.

---

### A26. Where is the boundary between unit, integration and e2e here?

**Answer.** **Unit**: one class, every branch, fakes for collaborators, milliseconds, no I/O.
**Integration**: real infrastructure, proving your assumptions about it are true. **E2E**: the whole
app through HTTP.

**Why it matters.** A unit test cannot prove anything about MongoDB, because there is no MongoDB in it.
Equally, an e2e test is a terrible place to enumerate branches — every `RolesGuard` case is one cheap
assertion in a unit test and a whole HTTP round trip in an e2e one.

**Real-world example.** Unique indexes, atomic `$inc` under concurrency, `populate`, aggregation, and
**both** transaction commit and rollback are integration-tested against a real `mongod`. 157 tests, 19
suites, ~32 seconds.

**Common mistake.** The inverted pyramid — an e2e suite that takes twenty minutes and tells you *that*
something broke, never *why*.

**Follow-up.** *"Unit tests tell you why it broke; e2e tests tell you that it broke."* — and you need
both, in that ratio.

---

### A27. Your test suite took ten minutes. How would you diagnose it?

**Answer.** Measure per-suite time first (`--verbose`), then look for repeated **setup**, not slow
assertions. In this project three separate suites were each starting their own `mongod`.

**Why it matters.** The fix — one `MongoMemoryReplSet` started in Jest's `globalSetup`, with a distinct
database name per suite — took the run from ~10 minutes to **~30 seconds**.

**Real-world example.** `test/global-setup.ts` and `test/shared-mongo.ts`.

**Common mistake.** Reaching for `--maxWorkers` first. Parallelism does not help when each worker pays
the same fixed startup cost.

**Follow-up.** *"How do suites stay isolated on a shared server?"* — separate database names, and
cleaning collections in `beforeEach` rather than dropping databases.

---

### A28. Why `CMD ["node", "dist/main"]` rather than `npm run start:prod`?

**Answer.** Running through npm puts **npm at PID 1**, and npm does not forward signals to its child.
`docker stop` sends `SIGTERM` to npm, Node never receives it, and ten seconds later Docker `SIGKILL`s
everything.

**Why it matters.** The visible consequence is that `enableShutdownHooks()` never runs: in-flight
requests are cut, connections are left open, BullMQ jobs are abandoned mid-flight. **All of the
graceful-shutdown work is undone by one line of convenience** — and the symptom (jobs occasionally
running twice after a deploy) is nowhere near the cause.

**Real-world example.** The exec form is used here for the same reason — shell form wraps the process
in `/bin/sh -c`, which has the identical problem.

**Common mistake.** Assuming npm forwards signals. It does not, and it is not documented loudly.

**Follow-up.** *"When would you use an init process like tini?"* — when your process spawns children
and you need zombie reaping. Node alone as PID 1 is fine, provided it actually receives the signal.

---

### A29. Why must `.env` be in `.dockerignore`, specifically?

**Answer.** Because `COPY . .` bakes it into a **layer**, and layers are immutable. Deleting the file
in a later instruction does not remove it — anyone with the image can extract it with `docker history`
or by unpacking the layer tarball.

**Why it matters.** **A secret that ever entered an image is leaked permanently and must be rotated.**
There is no way to un-ship it.

**Real-world example.** `.dockerignore` here excludes `.env`, `.env.*` and `.git` (which contains every
secret ever committed and later removed), while keeping `.env.example`.

**Common mistake.** Assuming `.dockerignore` and `.gitignore` are the same file with the same contents.
They serve different mechanisms and diverge — `dist` and `node_modules` matter for one, `.git` for the
other.

**Follow-up.** *"How do secrets get in, then?"* — at runtime from the orchestrator's secret store, or
via BuildKit secret mounts (`--mount=type=secret`) which never persist in a layer.

---

### A30. Where does Nest's overhead actually come from, and does it matter?

**Answer.** The DI container resolves at bootstrap (a one-off cost), but per request you pay for the
guard/interceptor/pipe chain, `Reflector` metadata lookups, and RxJS wrapping of the handler result.
Order of magnitude: a few hundred microseconds.

**Why it matters.** The honest comparison is against a database call measured in **milliseconds**. You
are trading a rounding error of latency for structure that prevents whole classes of bug. Saying that
plainly is a better answer than defending Nest as fast.

**Real-world example.** Phase 1 chose Express over Fastify with the reasoning written down: Fastify
optimises the layer that is fourth on the bottleneck list, behind database, network and event-loop
blocking.

**Common mistake.** Micro-optimising the framework while an unindexed query sits in the same endpoint.

**Follow-up.** *"When would you actually switch to Fastify?"* — after profiling shows the framework is
the constraint: very high request rates with tiny payloads and no database work. It is a one-line
adapter change, so the decision can wait until you have the number.

---

**Next:** [Senior / architecture — 20 questions](04-senior-architecture.md)
