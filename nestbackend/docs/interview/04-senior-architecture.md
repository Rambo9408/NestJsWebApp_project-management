# Senior / architecture — 20 questions

> These have no single right answer. What is being assessed is whether you can name the forces, pick a
> side, and state what it costs. **A confident answer with an acknowledged trade-off beats a
> textbook-correct answer with none.**

---

### S1. Modular monolith or microservices for a new product?

**Answer.** Modular monolith, with boundaries strict enough that extraction stays cheap. One deploy,
one database, real transactions, one place to debug.

**Why it matters.** Microservices trade a *local* problem (a large codebase) for *distributed systems*
problems — partial failure, eventual consistency, distributed tracing, cross-store consistency. Those
are strictly harder. You take that trade when the local problem is genuinely worse, which is much
further away than most teams believe.

**Real-world example.** This project keeps module boundaries enforced by the DI container: modules own
their models, communicate through events and interfaces, and have **zero** circular dependencies. The
answer to "how long would extraction take?" is therefore concrete.

**Common mistake.** The **distributed monolith** — services split by noun, so every request fans out
synchronously to four of them. You get every cost of distribution and none of the independence, plus
worse reliability (four 99.9% services in series is 99.6%).

**Follow-up.** *"What would make you split?"* — a named module with a genuinely different scaling
profile, a second team needing independent deploys, or a regulatory isolation requirement.

---

### S2. Which module would you extract first here, and which would you never split?

**Answer.** **Notifications first**: already asynchronous, already event-driven, no synchronous caller
waiting on it, and a completely different scaling profile. Then **activity logs**: write-heavy,
read-rarely, its own retention rules, and already a pure wildcard subscriber.

**Never split Users/Projects/Tasks/Comments.** They are one transactional cluster — creating a task
checks project membership; deleting a project cascades. Split them and every one of those becomes a
distributed transaction requiring sagas and compensating actions.

**Why it matters.** The heuristic is compact and defensible: **a boundary that a transaction crosses
is a bad boundary.**

**Real-world example.** Extracting notifications requires no caller changes at all — it already
consumes `TASK_ASSIGNED` rather than being called.

**Common mistake.** Extracting the *easy* thing rather than the thing that hurts.

**Follow-up.** *"How do you extract without a big bang?"* — strangler fig: dual-publish events, run the
new service in parallel and compare, move the read path behind a gateway, then turn off the old
listener and **delete the code** — the step teams skip.

---

### S3. How do you keep events reliable when a service crashes mid-operation?

**Answer.** The **transactional outbox**. Write the event into an `outbox` collection *in the same
transaction* as the state change, and have a separate relay publish and mark it sent.

**Why it matters.** "Save, then publish" is a **dual write** and is not atomic. Crash in between and
the two systems diverge permanently, with no way to detect it after the fact.

**Real-world example.** Phase 13 names this explicitly as the durable answer beyond `EventEmitter2`,
which is in-process and in-memory: if the process dies between the state change and the listener, the
event is simply gone.

**Common mistake.** Trying to make it atomic with retries or a try/catch. Neither closes the window.

**Follow-up.** *"What does the consumer need?"* — **idempotency**, because the outbox gives
at-least-once. Exactly-once delivery does not exist; exactly-once *processing* is at-least-once plus an
idempotent consumer.

---

### S4. Design a multi-tenant version of this system.

**Answer.** Three models, in increasing isolation and cost: a **`tenantId` column** on every document
(cheapest, one database, the isolation is entirely your query discipline); a **database per tenant**
(strong isolation, easy per-tenant backup and deletion, connection-pool pressure at scale); a **cluster
per tenant** (for regulated or very large customers only).

Start with `tenantId` and make it structurally impossible to forget: a base repository that injects
the filter, plus **Mongoose query middleware** as a second layer, so a hand-written query cannot
bypass it.

**Why it matters.** The failure mode is catastrophic and quiet — one missing filter leaks another
customer's data, and it will not show up until you have two customers whose data looks similar.

**Real-world example.** `RequestContextService` (`AsyncLocalStorage`) is already the right vehicle for
the current tenant: no request scope, and it works in workers where there is no request.

**Common mistake.** Reading the tenant from a request header or body. It comes from the validated
token, always.

**Follow-up.** *"When does per-tenant database become right?"* — a compliance requirement, a
"delete everything about us" clause, or one tenant large enough to need its own capacity.

---

### S5. How do you do zero-downtime deployments with schema changes?

**Answer.** **Expand → migrate → contract**, across three deploys, because during any rolling deploy
**both versions run at once**:

1. **Expand** — add the new field; write both; read the old. Safe with either version live.
2. **Migrate** — backfill; switch reads to the new field.
3. **Contract** — stop writing the old field; remove it. Only once no running version reads it.

**Why it matters.** A migration that drops a field the old version still reads takes production down
*during* the rollout — the moment you are least able to reason about it.

**Real-world example.** Combined with readiness probes gating the rollout: a pod that fails readiness
never receives traffic, so a broken release **stalls** instead of serving errors.

**Common mistake.** Running the migration in the same step as the deploy, and treating rename as a
single operation. A rename is always add + backfill + remove.

**Follow-up.** *"What makes rollback safe?"* — never make a deploy irreversible with a destructive
migration in the same step, keep the previous image pullable, and **rehearse** it. A rollback plan
nobody has run is a hope.

---

### S6. How would you add observability properly?

**Answer.** Three pillars, and logs alone is the weakest configuration. **Logs** (pino → Loki) answer
"what happened in this request". **Metrics** (`prom-client` → Prometheus) answer "what is the p99 and
is it worse than yesterday". **Traces** (OpenTelemetry → Jaeger) answer "*where* did those 400ms go".

**Why it matters.** You cannot alert on logs cheaply, and you cannot debug a latency distribution from
individual lines.

**Real-world example.** The correlation id built in Phases 9 and 18 is the hand-rolled version of a
`traceparent`. OTel would propagate it automatically through the Mongo driver, Redis and outbound HTTP
— which is exactly why building it by hand first is instructive.

**Common mistake.** Alerting on infrastructure (CPU, memory) rather than on **user-visible symptoms**
(error rate, p99 latency). CPU at 90% with everyone served is fine; CPU at 20% with a queue backing up
is an outage.

**Follow-up.** *"Which three metrics would you add first?"* — RED per endpoint; **event-loop lag**
(nothing else reveals a blocking operation); and **queue depth**, which rises before latency does and
is therefore the best leading indicator you get for free.

---

### S7. Walk me through how you'd debug "the API is slow" with no other information.

**Answer.** Narrow before you profile. (1) Is it *everything* or one endpoint? Check RED metrics
per route. (2) Is it latency or saturation — is the pool full, is the queue deep? (3) Turn on the
MongoDB **slow-query log** (`slowms: 100`); this finds it 80% of the time. (4) Check event-loop lag;
if p99 lag is high, something is blocking and no horizontal scaling will help. (5) Only then take a CPU
profile of the specific endpoint.

**Why it matters.** The ordering is the answer. "I'd profile it" without a narrowing strategy means a
flame graph of the whole application, which tells you very little.

**Real-world example.** The arithmetic that shortcuts most of this: an endpoint taking 800ms while
doing four indexed queries (~5ms each) is not slow because of the queries. Go and look at what else it
does.

**Common mistake.** Adding a cache first. Caching a query that is slow because it has no index means
you now have a slow query *and* a stale-data problem.

**Follow-up.** *"What if it is slow only in production?"* — data volume (a scan that is invisible at
1,000 rows), cold caches, network topology, or connection-pool exhaustion under concurrency. All four
are invisible on a laptop.

---

### S8. When is caching the wrong solution?

**Answer.** When the query is slow because it is unindexed — fix the index. When the data must be
current: balances, permissions, stock levels. When writes vastly outnumber reads — you pay
invalidation cost for no hit rate. When the hit rate would be low; below roughly 80% a cache is often
a net loss once you count the extra round trip on every miss.

**Why it matters.** Caching converts a performance problem into a **correctness** problem, and stale
authorization data is a security bug, not a trade-off.

**Real-world example.** Project metadata is cached here; permission checks are not.

**Common mistake.** Caching by default and discovering the invalidation requirements later, in
production, from a support ticket.

**Follow-up.** *"How do you decide the TTL?"* — from the business tolerance for staleness, not from a
round number. And jitter it, so a batch written together does not expire together.

---

### S9. How do you design an API that survives its own success?

**Answer.** Five properties, all present in this project: **everything paginated** (no unbounded
collection endpoint, ever); **cursor pagination** where deep paging is plausible, since `skip(n)` is
O(n); **projections** so you return the fields the client needs; **versioning** from day one; and
**rate limits** keyed by user, not IP.

**Why it matters.** An unbounded query is a bug that only appears in production, when the collection is
large — which is also when you can least afford it.

**Real-world example.** Every list endpoint here takes a validated `limit` with a maximum enforced by
the DTO, so a client cannot ask for a million rows.

**Common mistake.** Offset pagination everywhere. It is also **incorrect** under concurrent inserts —
the same item appears on two pages — not merely slow.

**Follow-up.** *"What do you lose with cursor pagination?"* — "jump to page 500". Most APIs do not need
it; most UI designs assume it. That conversation is the real work.

---

### S10. Two teams need to change the same module constantly. What do you do?

**Answer.** First ask whether the module boundary is wrong — constant contention usually means it
encodes two responsibilities. Split it along the axis of change, not along the noun. Only if the
boundary is genuinely right do you address it socially: clear ownership, and interfaces that let each
team change its own side.

**Why it matters.** This is Conway's law in the useful direction: **you split services to let teams
deploy independently**, not to make a diagram tidier. Below about three teams the force barely exists.

**Real-world example.** In this codebase the axis-of-change split is why `RedisModule` owns the
connection while `CacheModule`, `QueueModule` and the SSE layer own the *uses* of it. Putting the
connection in `cache/` would have forced `queue/` to import `cache/` — a dependency that states
something false about the architecture.

**Common mistake.** Extracting a microservice to solve a merge-conflict problem, thereby converting a
social problem into a distributed-systems problem.

**Follow-up.** *"What if the boundary is right and they still collide?"* — the collision is probably in
shared *data*, not shared code. That is a different fix.

---

### S11. How do you handle a third-party API that is slow and unreliable?

**Answer.** Four layers, all of them required: **timeouts on every call** (never rely on a default —
"hangs forever" is a real failure mode over a network), **retries with exponential backoff and
jitter** (jitter, or every client retries in lockstep and you build your own thundering herd), a
**circuit breaker** so a failing dependency stops consuming your capacity, and **bulkheads** so one slow
dependency cannot occupy every worker.

Then get it off the request path entirely: enqueue it.

**Why it matters.** Without a circuit breaker, a dependency that takes 30 seconds to fail consumes your
entire connection pool and takes *you* down. Their outage becomes your outage.

**Real-world example.** Notification delivery here is queued with backoff and a retry limit, so a
provider outage delays notifications instead of failing requests.

**Common mistake.** Retrying non-idempotent operations without an idempotency key — you charge the card
twice.

**Follow-up.** *"Should their outage fail your readiness probe?"* — no. You have then handed a vendor
the ability to remove your service from rotation.

---

### S12. What is your testing strategy, and what do you deliberately not test?

**Answer.** Unit-test logic exhaustively (cheap, precise). Integration-test the **assumptions about
infrastructure** — that the unique index exists, that the transaction rolls back, that `$inc` is
atomic under concurrency. E2E-test the **critical paths and the interactions**: guard order, auth flows.

Deliberately not tested: framework behaviour (Nest's own routing), getters, and anything whose test
would merely restate the implementation.

**Why it matters.** Coverage percentage is a poor target. **Branch** coverage on decision-heavy code —
guards, filters, retry logic — is worth far more than line coverage on mappers.

**Real-world example.** 157 tests, 19 suites, ~32 seconds; thresholds set at achievable levels and
enforced in CI rather than aspirational ones everybody overrides.

**Common mistake.** The inverted pyramid: a slow e2e suite that tells you *that* something broke and
never *why*.

**Follow-up.** *"What is the most valuable test in this repository?"* — probably the transaction
rollback test, because it verifies a guarantee that is invisible in code review and catastrophic when
wrong.

---

### S13. A junior submits a PR with business logic in the controller. What do you do?

**Answer.** Explain the *why*, not the rule. "This logic can currently only be triggered by an HTTP
request. When we need it from the queue worker — and Phase 12 says we will — it has to move. Moving it
now is five minutes; moving it later is five minutes plus a regression risk." Then show the pattern in
an existing controller.

**Why it matters.** Rules without reasons are cargo-culted and applied wrongly. This question is
assessing whether you can raise the team's level rather than just gate merges.

**Real-world example.** The controllers here delegate to services which delegate to repositories, and
the payoff arrived in Phases 11–13 when the same rules ran from three different transports.

**Common mistake.** "That's not how we do it here." Correct and useless.

**Follow-up.** *"What if they push back?"* — ask what the alternative buys. Sometimes they are right —
a trivial read-through endpoint does not need a service layer, and insisting on ceremony has a cost
too.

---

### S14. How do you decide between an event and a direct method call?

**Answer.** Ask: **does the caller need to know the outcome?**

- Needs the result, and it must be consistent now → direct call.
- Does not care, other things may want to react, and it must not slow the caller → **event**.
- Needs a *decision* but not the coupling → `emitAsync` with a veto payload.

**Why it matters.** Events buy decoupling and cost traceability: "what happens when a user is deleted?"
becomes a search across listeners rather than a call graph you can read.

**Real-world example.** All three exist here. `USER_DELETION_REQUESTED` uses the veto pattern —
listeners push blockers onto the payload and the emitter throws 409 if any were added — which is
exactly how the `forwardRef` cycle was eliminated.

**Common mistake.** Making everything an event, and losing the ability to reason about what a request
does.

**Follow-up.** *"What is the cost of the veto pattern?"* — the emitter now depends on listener latency,
so you have kept a synchronous coupling while removing the compile-time one. Say that out loud; it is
the honest version.

---

### S15. Where do you put validation: DTO, service, or database?

**Answer.** **All three, for different things.** DTO: shape and format — is this a well-formed email,
is `limit` within bounds. Service: business rules requiring context — can this user assign a task in
this project. Database: **invariants that must hold regardless of the code path** — unique indexes,
required fields.

**Why it matters.** Only the database constraint survives a race. Two concurrent registrations both
pass the service's "is this email taken?" check; the unique index is what actually prevents the
duplicate.

**Real-world example.** Unique email index plus 11000 → 409 translation, *plus* a friendlier service
check on the common path. Both, deliberately.

**Common mistake.** Believing the service check is the guarantee. It is a nicer error message.

**Follow-up.** *"Isn't that duplication?"* — no: they are different guarantees. The duplication to
avoid is the *same* rule expressed twice at the same layer.

---

### S16. How do you make a system debuggable at 3am?

**Answer.** Five things, roughly in order of value: **correlation IDs** on every line and echoed to
the client; **structured logs** you can query rather than grep; **useful error responses** (a stable
code and a request id, never a stack trace); **health endpoints that say what is wrong**, not just
that something is; and **logged degradation** at `warn`, so a fallback that has been active for three
weeks is visible.

**Why it matters.** Every one of these is nearly free at build time and impossible to retrofit during
an incident.

**Real-world example.** `/health/detail` reports Redis as `down` with a latency figure while
`/health/ready` stays `ok` — alerting sees the degradation, the load balancer does not act on it.

**Common mistake.** Silent fallbacks. The cache that has been down for weeks, discovered via the
database bill, is the canonical story.

**Follow-up.** *"What is the single highest-value thing?"* — the correlation id, propagated. Nothing
else turns "a user reports an error" into one log query.

---

### S17. Sketch how you would take this to 10× traffic.

**Answer.** In order of value per unit of effort: (1) find and fix the missing index — usually
10–100× on the affected endpoint; (2) fix N+1s, add `.lean()` and projections — 2–5×; (3) cache
genuinely hot, genuinely stale-tolerant reads; (4) move slow work to the queue; (5) scale horizontally
— cheap and immediate **because the app is stateless**; (6) read replicas for reporting, accepting
eventual consistency; (7) shard or split a service.

**Why it matters.** The ordering puts the expensive architectural answers last. Someone who reaches
for microservices at step 1 is describing a résumé.

**Real-world example.** Step 5 is nearly free here only because sessions, cache, rate limits, queue and
real-time fan-out all live in Redis or MongoDB rather than in process memory. That was paid for
incrementally across Phases 7–12.

**Common mistake.** Scaling out first. Ten instances all running the same collection scan is ten times
the load on the database that was already the bottleneck.

**Follow-up.** *"What breaks first at 10×?"* — almost always the database: connection pool exhaustion,
then an unindexed query that was fine at small volume.

---

### S18. What would you change about this codebase if it were going to production tomorrow?

**Answer.** Honestly, five things, and being able to list them is the point:

1. **Migrations.** There is no migration tool. Index creation is implicit and `autoIndex` must be off
   in production, so index management needs to become a deliberate, reviewable step.
2. **Secrets management.** Config validation is solid, but nothing is wired to a real secret store or
   to rotation.
3. **Metrics and tracing.** Logging is in place; RED metrics and OpenTelemetry are not.
4. **Backups and restore, rehearsed.** An unrehearsed restore is not a backup.
5. **Load testing.** Every performance claim in the docs is reasoning from mechanism, not measurement
   under load. I would want numbers before committing to any of them.

**Why it matters.** "Nothing, it's production ready" is the wrong answer to this question every time.

**Real-world example.** The docs already flag the unverifiable parts — the Docker daemon was not
running in this environment, so the image build was never executed, and that is stated rather than
implied.

**Common mistake.** Listing only technical debt in the code and none in the operational surface.

**Follow-up.** *"Which one first?"* — migrations, because it blocks safe schema evolution and every
later change depends on it.

---

### S19. How do you decide what belongs in a shared library versus duplicated?

**Answer.** Share things with a **stable contract and a single owner** — auth token verification, the
error response shape, correlation-id propagation. Duplicate things that are *coincidentally* similar:
two DTOs with the same fields today that will diverge for different reasons.

**Why it matters.** A shared library becomes a coordination point: every consumer must upgrade
together, which is exactly the coupling you split services to avoid. Premature sharing recreates the
distributed monolith at the dependency level.

**Real-world example.** The port/adapter pattern here is the lightweight version: the *interface* is
shared (`UsersRepository`), the implementations are not.

**Common mistake.** DRY applied to code that looks alike rather than code that *changes together*.
Duplication is cheaper than the wrong abstraction.

**Follow-up.** *"How do you version a shared library across services?"* — semver plus a deprecation
window plus consumer contract tests. If that sounds heavy, it is — which is the argument for sharing
less.

---

### S20. You have 2+ years of Node/Express and this is a 4–5 year NestJS role. How do you answer
"how much NestJS experience do you have?"

**Answer.** Directly and without hedging:

> *"About two and a half years of professional Node and TypeScript — Express, MongoDB, JWT auth,
> Angular on the front end. NestJS specifically I've gone deep on more recently: I built a full
> production-style backend with it — DI and custom providers, the guard/interceptor/pipe/filter
> pipeline, Passport auth with refresh-token rotation, Redis caching and distributed rate limiting,
> BullMQ, SSE, event-driven decoupling, and a test suite with real MongoDB integration tests. So the
> Node fundamentals are the 2+ years; the Nest-specific depth is more recent but it's hands-on, not
> tutorial-deep. Happy to go as deep as you like on any of it."*

**Why it matters.** Three reasons this is the strong play, not the safe one:

1. **It is verifiable.** Everything in it is true and you can be interrogated on any clause. An
   inflated claim collapses at the first "walk me through how you handled X", and that collapse costs
   you the interview *and* the reference.
2. **Most of the skill transfers, and saying so shows judgement.** HTTP, async, MongoDB, auth,
   caching, testing and debugging are framework-independent. Nest is a structure over things you
   already do.
3. **Depth beats duration, and interviewers know it.** Someone who can explain *why* `forwardRef` is
   the wrong first answer, or why a liveness probe must not check the database, demonstrates more than
   someone with five years of CRUD.

**Real-world example.** When they ask something you have not done, the strong form is:
*"I haven't run that in production. Here's how I'd approach it, and here's the closest thing I have
done."* Then answer well. That is a better signal than a fluent bluff, and interviewers can tell the
difference far more often than candidates expect.

**Common mistake.** Two, in opposite directions. **Inflating** — unrecoverable when probed, and it
poisons everything else you said. **Apologising** — *"I only have two years, I'm probably not what
you're looking for"* — which invites the interviewer to agree with you. State the facts and move
straight to what you can do.

**Follow-up.** *"The job says 4–5 years and you have 2+. Why should we consider you?"* —
*"Because what you actually need is someone who can own a Nest service end to end — design the
modules, get the auth right, keep it fast, and debug it at 3am. I can walk you through every one of
those in a codebase I built. The year count is a proxy for that; I'd rather be measured on the thing
itself."*

---

**Next:** [30 scenario-based questions](05-scenarios.md)
