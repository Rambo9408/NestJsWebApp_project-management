# Phase 20 — Microservices architecture & migration strategy

> **Goal:** be able to argue *both* sides. The valuable answer is not "microservices are good" or
> "monoliths are good" — it is knowing which forces push you across the line, and what it costs to
> cross it.

No new code. This phase names what the previous nineteen were quietly setting up.

---

## 1. The honest starting position

**This project is a modular monolith, and that is the right default.** Not a compromise, not a
stepping stone you are embarrassed by — the right answer for a team of this size and a product at
this stage.

The reason is that microservices trade a *local* problem (a large codebase) for a set of *distributed
systems* problems (network partitions, partial failure, eventual consistency, distributed tracing,
data consistency across stores). Those are strictly harder. You take that trade when the local
problem is genuinely worse than the distributed one — which is a real threshold, but it is much
further away than most teams believe.

The failure mode to name explicitly: **a distributed monolith.** Services split by *noun* rather than
by *boundary*, so every request fans out to four of them synchronously. You get every cost of
distribution and none of the independence — worse latency, worse reliability (four 99.9% services in
series is 99.6%), and deploys that still have to be coordinated.

---

## 2. What actually forces a split

Not "the codebase is big". These:

| Force | The concrete symptom |
| --- | --- |
| **Independent scaling** | One workload needs 10× the resources of the rest — e.g. video transcoding, or a notification fan-out to millions |
| **Team autonomy** | Conway's law, in the direction that matters: **you split services to let teams deploy independently.** Below ~3 teams this force barely exists |
| **Independent deployability** | One module changes daily and another is regulated and changes quarterly |
| **Technology mismatch** | The ML pipeline genuinely wants Python; the trading engine genuinely wants Go |
| **Fault isolation** | A crash in one area must not take the rest down — though a well-built monolith with timeouts and circuit breakers achieves most of this |
| **Regulatory isolation** | Payment or health data that must live in a separately audited system |

**Not on the list:** "it's more modern", "it'll scale better" (a monolith scales horizontally
perfectly well — see Phase 19), and "the codebase is big" (that is a modularity problem, and
extracting it into a network call does not fix a bad boundary — it hardens it).

---

## 3. What this codebase already did to make a split *possible*

This is the part that makes the answer credible rather than theoretical. Every one of these was a
Phase 2–13 decision with a stated reason at the time:

| Decision | Phase | Why it matters for extraction |
| --- | --- | --- |
| **Repository ports as abstract classes** | 2, 3 | `UsersRepository` is an interface with a Mongo implementation. Swapping in an **HTTP** implementation is a new provider and one line in the module — no consumer changes. **This is the single most important one.** |
| **Modules own their models** | 5 | No module reads another's collection. Data ownership already follows the module boundary, so extraction does not require untangling a shared schema. |
| **Domain events instead of direct calls** | 13 | `USER_DELETION_REQUESTED` is already a message. Moving from `EventEmitter2` to Redis Streams, RabbitMQ or Kafka is a transport swap, not a redesign. |
| **`forwardRef` deleted** | 13 | A circular dependency between two modules means they cannot be separated — a cycle across a network is a distributed deadlock. Getting the count to **zero** was not tidiness; it was a precondition. |
| **Correlation IDs propagated** | 9, 18 | Debugging a request across services is impossible without them, and retrofitting them is painful. |
| **Stateless HTTP layer** | 7, 10, 11 | Every service you extract is already horizontally scalable for free. |
| **Config validated at boot** | 1 | Each extracted service fails fast on a missing value instead of at 3am. |

The interview version of this: *"the module boundaries are enforced by the DI container at runtime,
data ownership follows them, and cross-module communication is already events plus interfaces — so
extraction is a transport change rather than a rewrite."*

---

## 4. Where the seams are, in this project

If a split became necessary, in the order I would actually do it:

### 1. Notifications — extract first

The textbook candidate: **already asynchronous, already event-driven, no synchronous caller waiting
on it, and a genuinely different scaling profile** (a fan-out to 100,000 users has nothing in common
with serving a task list).

It already consumes `TASK_ASSIGNED` and `COMMENT_CREATED` rather than being called directly. The
change is: publish those events to a broker instead of an in-process emitter, and let a separate
process subscribe. **No caller changes at all.**

### 2. Activity logs / audit — extract second

Write-heavy, read-rarely, and its retention rules (a 180-day TTL) have nothing to do with the rest of
the system. It already listens on a wildcard `@OnEvent('**')`, so it is a pure subscriber. Extracting
it also removes a large, fast-growing collection from the primary database.

### 3. Background jobs — arguably already separate

BullMQ workers can run in their own process *today* — `WorkerModule` bootstrapped without the HTTP
adapter. The queue is already the boundary. This is the cheapest "microservice" available, and it is
mostly a deployment topology decision.

### What I would **not** extract

**Users, Projects, Tasks and Comments belong together.** They are one transactional cluster: creating
a task checks project membership; deleting a project cascades to tasks and comments. Split them and
every one of those operations becomes a distributed transaction, which means sagas, compensating
actions and reconciliation jobs — a large, permanent complexity cost to solve a problem you did not
have.

> The heuristic: **a boundary that a transaction crosses is a bad boundary.** If two things must be
> consistent *now*, they belong in the same service.

---

## 5. How Nest actually does microservices

Nest's microservices support is deliberately thin — a **transport abstraction**, not a framework:

```ts
const app = await NestFactory.createMicroservice<MicroserviceOptions>(NotificationsModule, {
  transport: Transport.REDIS,
  options: { host, port },
});
```

The controller barely changes:

```ts
@MessagePattern('task.assigned')       // instead of @Post('...')
handleTaskAssigned(@Payload() data: TaskAssignedEvent) { ... }
```

Two patterns, and the distinction is load-bearing:

| | Semantics | Use for |
| --- | --- | --- |
| `@MessagePattern` | **Request/response** — the caller waits for a reply | A query you need an answer to |
| `@EventPattern` | **Fire and forget** — no reply, caller does not wait | Notifications, audit, anything reactive |

Choosing `@MessagePattern` where `@EventPattern` would do is how you build a distributed monolith one
handler at a time: each synchronous hop adds its latency *and* its failure probability to the caller.

### Transports, and how to choose

| Transport | Choose when |
| --- | --- |
| **TCP** | Simple internal RPC. No broker to run. No durability, no fan-out. |
| **Redis Pub/Sub** | You already run Redis (we do) and can tolerate **at-most-once** — a subscriber that is down misses the message permanently. |
| **Redis Streams / BullMQ** | Same infrastructure, but with persistence, consumer groups and retries. The natural next step here. |
| **RabbitMQ** | You need routing, acknowledgements, dead-letter queues and **at-least-once**. The sensible default for genuine work distribution. |
| **Kafka** | High throughput, replayable log, multiple independent consumers reading the same stream at their own pace. Powerful and operationally heavy — do not run it for a message a second. |
| **gRPC** | Typed contracts via protobuf, streaming, and cross-language teams. |

**The delivery-semantics question is the one that separates a real answer from a buzzword tour.**
Almost everything practical is *at-least-once*, which means **your handlers must be idempotent** —
the same reasoning as the `jobId` deduplication in Phase 12. Exactly-once delivery does not exist;
exactly-once *processing* is at-least-once delivery plus an idempotent consumer.

---

## 6. The problems you inherit on day one

Each of these is solved (or unnecessary) in the monolith:

**Data consistency.** No cross-service transactions. `withTransaction` (Phase 5) stops working the
moment the two collections live in different databases. The replacement is a **saga**: a sequence of
local transactions with compensating actions for each step. Compensation is not rollback — refunding
a payment is a new fact, not an erasure — and designing compensations is genuinely hard.

**Dual writes.** "Save to the database, then publish an event" is not atomic: crash in between and
the systems diverge permanently. The fix is the **transactional outbox** — write the event to an
`outbox` collection *in the same transaction* as the state change, and have a separate relay publish
it. Phase 13 named this as the durable answer, and it is the single most useful pattern in this
section.

**Partial failure.** In-process, a call either returns or throws. Over a network it can also hang
forever, succeed after the caller gave up, or succeed twice. You need timeouts on **every** call
(never rely on a default), retries with **exponential backoff and jitter**, circuit breakers so a
failing dependency does not exhaust your own capacity, and bulkheads so one slow dependency cannot
consume every worker.

**Debugging.** One stack trace becomes N log streams. This is why correlation IDs (Phase 18) are a
precondition, and why OpenTelemetry stops being optional.

**Operational multiplication.** N services means N pipelines, N dashboards, N alert routes, N on-call
runbooks, N sets of secrets. This tax is per-service and permanent, and it is the cost most often
left out of the pitch.

**Local development.** "Run the whole system on a laptop" quietly stops being possible somewhere
around service six.

---

## 7. How to migrate, if you must

### The strangler fig

Never a big-bang rewrite. Put a facade in front, move one capability at a time, delete the old path
once traffic has moved.

```
                    ┌──────────────┐
   clients ────────►│   gateway    │
                    └──────┬───────┘
                     ┌─────┴─────┐
                     ▼           ▼
              ┌────────────┐  ┌───────────────┐
              │  monolith  │  │ notifications │  ← extracted first
              └────────────┘  └───────────────┘
```

The concrete sequence for Notifications in this codebase:

1. **Publish the domain events to a broker** as well as in-process. Nothing consumes them yet — pure
   addition, zero risk.
2. **Stand up the new service** consuming from the broker, writing to its own store. Run it in
   parallel and **compare its output** with the monolith's; do not switch on anything yet.
3. **Move the read path** — the notifications API — to the new service behind the gateway.
4. **Turn off the in-process listener** in the monolith.
5. **Delete the code and the collection.** This step is the one teams skip, and skipping it means you
   now maintain both.

Note steps 1–3 are all reversible. That is the property that makes the migration safe, and it is
worth stating explicitly.

### Rules that make it survivable

- **Extract the leaves first** — things nothing else depends on. Notifications and audit qualify;
  Users does not.
- **One service at a time**, in production, before starting the next.
- **Never share a database.** A shared database means a shared schema means coordinated deploys — you
  have paid for distribution and kept the coupling. If the new service needs data it does not own, it
  asks over the API or subscribes to events.
- **Keep it reversible** for as long as you can.
- **Extract the boundary that hurts**, not the one that is easy.

---

## 8. Why?

| Question | Answer |
| --- | --- |
| **Why a modular monolith?** | One deploy, one database, real transactions, one place to debug — with module boundaries strict enough that extraction stays cheap. |
| **Why not microservices now?** | The forces in §2 are absent: one team, no divergent scaling profile, no regulatory isolation. The costs in §6 are all present from day one. |
| **Trade-offs** | Everything scales together; a memory leak anywhere affects everything; the codebase grows in one repository; module boundaries are enforced by the container and by review, not by the network. |
| **When to split** | When a *specific* module has a *specific* independent scaling, deployment or ownership need — and you can name it. |
| **When not to** | "The codebase is big." That is a modularity problem, and a network call does not fix a bad boundary; it makes it permanent. |

---

## 9. Express comparison

Express has no microservices story at all — you would reach for a message-broker client directly and
hand-roll the handler dispatch. Nest gives you the same controllers, providers, guards, pipes,
interceptors and filters over a different transport, which has one very practical consequence:

**the extracted service is the same code with a different decorator.** `@Post('notifications')`
becomes `@EventPattern('notification.requested')`, the service underneath is untouched, and the tests
for the service layer do not change at all — because they never knew about HTTP in the first place.

That is the payoff for keeping controllers thin, which Phase 2 asked for on the grounds that
"business logic in a controller can only ever be triggered by an HTTP request". This phase is where
that bill comes due, and it is the difference between an extraction that takes a week and one that
takes a quarter.

---

**Next:** [Phase 21 — 100+ interview questions](phase-21-interview-questions.md)
