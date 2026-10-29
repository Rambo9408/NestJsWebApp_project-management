# Phase 19 — Performance & scalability

> **Goal:** name the bottlenecks in *this* codebase, in the order they will actually bite, and be
> able to defend each decision with a number rather than a preference.

This phase adds no new code. Everything it describes is already built — the point is to connect the
individual decisions into one story, which is exactly what a senior interview asks you to do.

---

## 1. The only correct first answer: **measure**

If you take one thing from this phase, take this: *"I'd measure before optimising"* is not a
deflection, it is the answer — as long as you can say **what** you would measure and **what you'd
expect to find**.

For a Node + MongoDB API, the ranking is remarkably consistent:

| Rank | Bottleneck | Typical share |
| --- | --- | --- |
| 1 | **Database** — missing index, N+1, unbounded query | 80%+ of real problems |
| 2 | **Network** — sequential awaits, chatty external calls | most of the rest |
| 3 | **Event loop blocking** — sync crypto, JSON of huge payloads, regex | rare but catastrophic |
| 4 | Framework overhead (Nest vs Fastify vs raw) | almost never |

This is why Phase 1 chose Express over Fastify and said so explicitly: Fastify is genuinely faster at
JSON throughput, and it optimises the layer that is fourth on this list. *"We'd revisit it after
profiling proves the framework is the constraint"* is a better answer than either "Fastify, it's
faster" or "Express, it's what I know".

**How to actually measure**, in escalating order of effort:

1. **Slow-query log first.** `db.setProfilingLevel(1, { slowms: 100 })`. This finds problem #1, and
   it takes thirty seconds.
2. **RED metrics per endpoint** (rate, errors, duration) — p99, never the mean. The mean hides the
   tail, and the tail is what users experience and what fills your connection pool.
3. **Event-loop lag** — `perf_hooks.monitorEventLoopDelay()`. If p99 lag is above ~50ms, something is
   blocking, and no amount of horizontal scaling fixes it.
4. **A CPU profile** (`node --cpu-prof`, or clinic.js) only once you know *which* endpoint.

> **The trap to avoid in an interview:** jumping to caching. Caching a query that is slow because it
> has no index means you now have a slow query *and* a stale-data problem.

---

## 2. Database — where the time actually goes

### Indexes: the ESR rule

Every compound index in this project follows **Equality → Sort → Range**:

```ts
TaskSchema.index({ projectId: 1, status: 1, dueAt: 1 });
//                 ^equality    ^equality  ^sort/range
```

The reason is mechanical: a B-tree is ordered by its key prefix. Equality fields narrow the scan to a
contiguous region; a range field scatters it. Put the range first and the index can no longer serve
the sort, so MongoDB does an in-memory sort — which fails outright above 32MB.

**The prefix rule** is what stops index sprawl: `{a: 1, b: 1, c: 1}` also serves queries on `{a}` and
`{a, b}`. Three indexes where one suffices costs write throughput and RAM on every insert.

**How to check, not guess:** `.explain('executionStats')`, and look at exactly two numbers —
`totalDocsExamined` vs `nReturned`. If you examined 50,000 documents to return 20, the index is wrong.
A ratio near 1 is the goal; `COLLSCAN` in `winningPlan` is the alarm.

### The N+1 problem

Phase 5 built this deliberately and then fixed it. Listing 50 tasks and fetching each assignee
individually is 51 round trips; at 2ms each that is 100ms of pure latency for data one query could
have returned.

The three fixes, and when each is right:

| Fix | When |
| --- | --- |
| `populate()` | The related documents are small and you need whole objects. Still two queries, not 51. |
| `$lookup` in an aggregation | You need to filter or sort *by* the joined data — `populate` cannot, because it happens after the fact. |
| **Denormalise** (embed `assigneeName`) | Reads vastly outnumber writes and the field rarely changes. Trades write complexity for read speed. |

### `.lean()` — the cheapest single win

```ts
const tasks = await this.taskModel.find(filter).lean();
```

Without it, Mongoose hydrates every result into a full document with getters, setters, change
tracking and validation. For a read-only list endpoint that is **3–5× the CPU and memory** for
machinery you never use. Use it everywhere you are not going to `.save()`.

### Pagination — and why offset pagination is a trap at scale

Every list endpoint here is paginated with `limit`, and there is no endpoint that returns an
unbounded collection. That is the single most important scalability property of the API, because an
unbounded query is a bug that only appears in production, when the collection is large.

But `skip(n)` is **O(n)**: MongoDB walks and discards every skipped document. Page 1 is instant; page
5,000 scans 100,000 documents to return 20. The fix is **cursor (keyset) pagination**:

```ts
// instead of .skip(100_000).limit(20)
.find({ _id: { $lt: lastSeenId } }).sort({ _id: -1 }).limit(20)
```

O(log n), and it is *correct* under concurrent inserts — offset pagination silently shows the same
item twice when a row is inserted between requests. The honest trade-off: you lose "jump to page
500", which most APIs do not need but most UIs assume.

### Connection pool sizing

`maxPoolSize` defaults to 100. The rule that matters:

> **Total connections across all instances must stay below the server's limit.**
> 10 instances × 100 = 1000 connections. MongoDB Atlas M10 allows 1500.

Too small and requests queue for a connection — which shows up as latency with an idle database, the
most confusing profile there is. Too large and you overwhelm the server and pay context-switching
cost for nothing. Start at 10–20 per instance and raise it only when pool-wait time is measurable.

### Projections

`.select('title status dueAt')` — returning three fields instead of thirty is less disk read, less
network, less JSON serialisation, less memory. It is the most boring optimisation on this list and
frequently the largest.

---

## 3. Caching — and when *not* to

Phase 10 built cache-aside with the failure modes handled. The scalability points:

- **Cache-aside, not write-through**, because the read path stays correct if the cache is empty or
  gone. `CacheService` degrades to a miss on any Redis error rather than throwing.
- **Stampede protection**: a popular key expiring under load sends every concurrent request to the
  database at once. The in-flight promise map dedupes them to one.
- **TTL jitter**, so 10,000 keys written in one batch do not expire in the same second.
- **`SCAN`, never `KEYS`** — `KEYS` is O(n) and blocks the single-threaded Redis server for the whole
  scan. It is fine at 100 keys and takes production down at 10 million.

**When caching is the wrong answer**, which is the part worth being able to say:

- The query is slow because it is unindexed. Fix the index.
- The data must be current (balances, permissions, stock levels). Stale authorization data is a
  security bug, not a performance trade-off.
- Write-heavy data with few reads — you pay invalidation cost for no hit rate.
- The hit rate would be low. A cache below ~80% hit rate is often a net loss once you count the extra
  round trip on every miss.

---

## 4. Not blocking the event loop

Node is single-threaded for JavaScript. One blocking operation stalls **every** concurrent request on
that instance — this is the failure mode that looks like "the server is fine, but everything is slow".

What this project does about it:

- **bcrypt via the async API.** `bcrypt.hash` at cost 12 is ~250ms of CPU. Synchronous, that is 250ms
  where the process serves nobody. The async version runs in libuv's thread pool.
- **Cost 4 in tests** — same reasoning inverted: 50 registrations at cost 12 is 12 seconds of a test
  suite spent proving bcrypt is slow.
- **`escapeRegex` on every search input.** A crafted pattern like `(a+)+$` causes catastrophic
  backtracking — one request pinning a core. This is a *performance* control as much as a security
  one.
- **BullMQ for anything slow.** The whole point of Phase 12: the HTTP handler enqueues and returns in
  milliseconds; the work happens in a worker process that can be scaled and restarted independently.

The general rule: **anything above ~10ms of synchronous CPU belongs in a worker thread or a queue.**

And the concurrency point people miss: `await`ing independent operations sequentially is not blocking,
but it is still needless latency.

```ts
// 3 round trips of latency, added up
const project = await this.projects.findById(id);
const tasks = await this.tasks.findByProject(id);
const members = await this.members.findByProject(id);

// 1 round trip of latency
const [project, tasks, members] = await Promise.all([...]);
```

Use `Promise.all` for independent work — and *not* for dependent work, where it silently becomes a
race.

---

## 5. Horizontal scaling — and the thing that makes it possible

**The application is stateless, and that is a design constraint that was paid for repeatedly.**

Every piece of per-request or shared state lives outside the process:

| State | Where it lives | Why it matters |
| --- | --- | --- |
| Sessions | Nowhere — JWTs are self-contained | Any instance can validate any request |
| Refresh tokens | MongoDB (hashed) | Any instance can rotate them |
| Cache | Redis | A cache in process memory would give each instance a different answer |
| Rate-limit counters | Redis | **The clearest case**: an in-memory limiter with 5 instances means a limit of 100 becomes 500 |
| Job queue | Redis (BullMQ) | Workers scale independently of the API |
| SSE fan-out | Redis Pub/Sub | An event published on instance 3 must reach a client connected to instance 1 |

That last one is the one people forget. The moment you have two instances, in-memory event emitters
only reach the clients that happen to be connected to the same box — and it works perfectly in
development, where there is one.

### What still needs care behind a load balancer

- **Socket.IO needs sticky sessions** (or the Redis adapter) because its handshake spans multiple HTTP
  requests. SSE does not — one long-lived connection, one instance.
- **The HTTP/1.1 six-connections-per-origin limit** is a client-side ceiling that no amount of server
  scaling fixes. Over HTTP/2 it goes away. This is why one SSE stream is multiplexed for all
  notification types rather than one stream per feature.
- **`trust proxy`** must be set, or every request appears to come from the load balancer and the
  rate limiter buckets your entire user base as one client.

### Vertical vs horizontal

Node does not use multiple cores in one process. So on an 8-core box the choice is **8 containers** or
**Node's cluster module / PM2**. Prefer containers: the orchestrator already does the process
supervision, health checking and rolling restarts that cluster mode would make you reimplement, and
the scaling unit is then the same locally and in production.

---

## 6. The scaling order — what to do when it gets slow

Roughly in order of value per unit of effort:

1. **Add the missing index.** Usually 10–100× on the affected endpoint.
2. **Fix N+1s and add `.lean()` and projections.** Often 2–5×.
3. **Add caching** to genuinely hot, genuinely tolerable-to-be-stale reads.
4. **Move slow work to the queue** so latency stops being the user's problem.
5. **Scale horizontally** — cheap and immediate, *because* the app is stateless.
6. **Add read replicas** and point analytics/reporting at them. (`readPreference: 'secondaryPreferred'`
   — but understand you are accepting eventual consistency, and never for a read-then-write.)
7. **Shard**, or split a module into its own service (Phase 20). Both are large steps with large
   ongoing costs; steps 1–6 cover almost everything.

> The list is deliberately ordered so that the expensive architectural answers come last. An engineer
> who reaches for microservices at step 1 is describing a résumé, not a solution.

---

## 7. Numbers worth carrying

Not to quote as fact, but as orders of magnitude — the point is being able to reason about whether an
optimisation *can* matter:

| Operation | Order of magnitude |
| --- | --- |
| Indexed MongoDB query, same region | ~1–5 ms |
| Redis GET, same region | ~0.5–1 ms |
| bcrypt cost 12 | ~250 ms of CPU |
| Collection scan, 1M documents | seconds |
| Cross-region round trip | ~50–150 ms |

The useful inference: if an endpoint takes 800ms and does four indexed queries, the queries are not
the problem — go and look at what else it does. That kind of arithmetic is what separates profiling
from guessing.

---

## 8. Why?

| Question | Answer |
| --- | --- |
| **Why stateless over sticky sessions?** | Any instance serves any request: trivial horizontal scaling, zero-downtime deploys, no session loss on restart. |
| **Why not another approach?** | Sticky sessions are simpler day one and become the thing preventing you from deploying without dropping users. |
| **Trade-offs** | Every piece of shared state needs an external store, which is more infrastructure and one more thing that can fail — which is why every one of them degrades rather than throws. |
| **When to use** | Any service with more than one instance, which is any service with an availability target. |
| **When to avoid** | A single-instance internal tool where the operational simplicity genuinely wins. |

---

## 9. Express comparison

| Express | NestJS |
| --- | --- |
| Performance work is per-route and manual | The pipeline is one place to instrument — a timing interceptor covers routes you have not written yet |
| Caching is a middleware you remember to add per route | A cache-aside service injected where it belongs, and a decorator where it does not |
| No structural pressure toward pagination or projections | DTOs make the query contract explicit, so an unbounded query is visible in review |

To be fair about it: **Nest is measurably slower than bare Express** — the DI container, the
interceptor chain and the metadata reflection all cost something on every request. It is a few
hundred microseconds, against database calls measured in milliseconds. You are trading a rounding
error of latency for structure that prevents the mistakes on this page. That is the honest version of
the trade, and it is the version worth saying out loud.

---

**Next:** [Phase 20 — microservices architecture & migration](phase-20-microservices.md)
