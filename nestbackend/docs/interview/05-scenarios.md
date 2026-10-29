# 32 scenario-based questions

> "Here's a situation — what do you do?" These are the questions that separate a candidate who has
> *read* about a topic from one who has been on call for it. Each answer states the **diagnosis**, the
> **fix**, and the **trade-off**, because a fix without a stated cost is not a senior answer.

---

### SC1. Production is throwing `Nest can't resolve dependencies of the TasksService (?, NotificationsService)`. Diagnose it.

The `?` marks the parameter that could not be resolved — index 0 here. Four causes, in the order I'd
check:

1. The provider is **not registered** in any module in scope.
2. It is registered but **not exported** by the module that owns it (`imports` gives you exports, not
   providers).
3. A **circular import** — the class binding was `undefined` when the module was evaluated. This one
   also produces "appears to be undefined at runtime".
4. Missing `@Injectable()` on the dependency, so `design:paramtypes` was never emitted.

**Trade-off note.** This is a *bootstrap* failure, not a runtime one — which is the property you want.
Fail fast in front of a pipeline that can roll back, not on the first request that needs it.

---

### SC2. A `forwardRef` fixed a circular dependency. Six months later two more appear. What is happening?

`forwardRef` made the error go away without making the coupling go away, so the design pressure that
produced the first cycle is still there and is now producing more.

I'd stop adding them and ask why the cycle exists — usually one module is doing another's job. The
four ways out, ranked: extract the shared logic into a third module; **invert with an event** so the
dependency disappears; use an interface/token so only one side knows the other's shape; `forwardRef`
last.

**Real example.** This codebase built a `UsersService ↔ ProjectsService` cycle deliberately, then
deleted it by having `UsersService` emit `USER_DELETION_REQUESTED` and `ProjectsModule` listen. Count
is now zero — which was also a precondition for ever extracting a service.

**Trade-off.** The event version is harder to trace: "what happens when a user is deleted?" becomes a
search across listeners rather than a call graph you can read.

---

### SC3. Response times degrade over a week and recover on every deploy. What is it?

A **leak**, and the deploy is masking it. In order:

1. Check **RSS vs heap**. Heap growing → a JavaScript leak (a Map that never evicts, listeners added
   per request, closures held by a cache). RSS growing while heap is flat → native: unclosed sockets,
   buffers, a leaking driver.
2. `--heapsnapshot-signal` and diff two snapshots an hour apart.
3. Check **listener counts** — `emitter.listenerCount()`. A listener registered per request rather
   than per module is the classic Nest version of this.
4. Check for unbounded in-memory state: in-flight maps, dedupe caches without TTLs.

**Real example.** The stampede-protection map in `CacheService` is exactly the shape that leaks if
entries are not deleted in a `finally`.

**Trade-off.** Restarting on a schedule "fixes" it and is a legitimate short-term mitigation — but only
with a ticket, because you are now blind to the next leak.

---

### SC4. Users report being logged out randomly after you scaled to three instances.

Almost certainly **state in process memory**. Candidates, in order of likelihood: an in-memory session
store, an in-memory refresh-token store, or a JWT secret that differs per instance (e.g. generated at
boot rather than injected).

The fix is the design constraint: nothing per-user lives in the process. Here, JWTs are self-contained,
refresh tokens live hashed in MongoDB, and both secrets come from validated config — so any instance
can serve any request.

**Trade-off.** Self-contained JWTs cannot be revoked before expiry. That is why the access token is
short-lived and revocation happens at the refresh boundary. If you need instant revocation you need a
denylist, and you have just reintroduced a per-request lookup.

---

### SC5. The rate limiter allows 5× the configured limit. Why?

You have five instances and an **in-memory** counter. Each keeps its own tally, so a limit of 100
becomes 500. It works perfectly in development, where there is one.

Fix: shared counters in Redis (`RedisThrottlerStorage` here).

**The trap inside the fix:** after `INCR`, check `PTTL == -1` and set the expiry. A key created by a
race without a TTL lives **forever**, and that user is rate-limited permanently — a much worse bug
than the one you set out to fix.

**Trade-off.** You have added a hard dependency to the request path. Decide deliberately: fail **open**
for general traffic (availability), **closed** for login (the limit *is* the brute-force defence).

---

### SC6. A single endpoint takes 4 seconds. Everything else is fine.

Not infrastructure — something specific to that handler.

1. `.explain('executionStats')` on its queries. Compare `totalDocsExamined` to `nReturned`; 50,000:20
   means a missing or wrong index. `COLLSCAN` is the alarm.
2. Count the queries. 51 round trips means an **N+1** — a `populate` or a `findById` inside a loop.
3. Check for **sequential awaits** of independent operations; `Promise.all` collapses three round trips
   into one.
4. Check the payload size. Returning 30 fields where 3 are needed costs disk, network and
   serialisation.

**Real example.** The arithmetic first: four indexed queries at ~5ms cannot account for 4 seconds. If
they do not add up, the time is somewhere else — go and look before profiling.

**Trade-off.** Adding the index costs write throughput and RAM on every insert. Usually trivially worth
it; occasionally not, on a write-heavy collection.

---

### SC7. A background job runs twice and sends two emails.

At-least-once delivery is the norm, so this is expected behaviour meeting a non-idempotent handler.

Causes: a **stalled job** recovered after its worker died (note this is *not* a retry, so `attempts: 1`
does not prevent it), a retry after a partial failure, or the same job enqueued twice.

Fix, in order of strength: a deterministic `jobId` so BullMQ deduplicates at enqueue; and — the real
one — an **idempotent handler** that records "email sent for event X" and checks before sending.

**Trade-off.** Idempotency needs a store and a key, so it is real work. But exactly-once delivery does
not exist; exactly-once *processing* is at-least-once plus an idempotent consumer. There is no version
of this you can skip.

---

### SC8. A queue is backing up. Jobs are being added faster than they are processed.

1. **Is it throughput or failure?** Check the failed count. A job failing and retrying forever looks
   like a backlog and is a different problem.
2. If throughput: raise worker `concurrency`, or add worker processes. Workers scale independently of
   the API — that is the point of the queue.
3. If each job is slow: is it slow because of an external call? Then concurrency helps a lot, because
   the workers are I/O-bound and idle.
4. If jobs are CPU-bound, concurrency in one process does **not** help — Node is single-threaded.
   Separate processes or worker threads.

**Real example.** Queue depth is the best leading indicator you get for free: it rises *before* latency
does.

**Trade-off.** More concurrency means more database connections and more load on whatever the jobs
touch. You can move the bottleneck rather than remove it.

---

### SC9. SSE works locally and not in production.

Four candidates, and I'd check them in this order:

1. **A proxy buffering the response.** nginx needs `proxy_buffering off` and
   `X-Accel-Buffering: no`, or events are held until the buffer fills.
2. **An idle timeout** at the load balancer closing the connection. Fix with periodic heartbeat
   comments; they also keep intermediaries from reaping the socket.
3. **Compression.** gzip can buffer, so exclude the SSE route.
4. **Multiple instances** — the event is published on instance 3 and the client is connected to
   instance 1. Needs Redis Pub/Sub fan-out.

**Trade-off.** Heartbeats cost a little bandwidth per connection per interval and are worth it. And
remember the client-side ceiling: **HTTP/1.1 allows six connections per origin**, so multiplex one
stream rather than opening one per feature.

---

### SC10. WebSocket connections drop when you deploy.

Expected: rolling deploys replace instances, and a WebSocket is pinned to one.

Mitigations: client-side reconnect with **exponential backoff and jitter** (non-negotiable); a longer
`terminationGracePeriod` so in-flight connections drain; and Socket.IO's Redis adapter plus sticky
sessions so a reconnect lands somewhere useful.

**Trade-off.** You cannot make this invisible; you can make it fast and unremarkable. And this is one
of the strongest arguments for **SSE over WebSockets** when you only need server→client: SSE
reconnects automatically in the browser, and needs no sticky sessions.

---

### SC11. A user says "I get a 500 sometimes." No reproduction.

1. **Ask for the request id.** This is why every response carries `x-request-id` and why the error body
   includes it — it turns an unreproducible ticket into a log query.
2. Query the logs for that id and read the whole request.
3. If they have no id: filter 5xx by that user and time window, which works because logs are structured
   and carry `userId`.
4. Look for the pattern — a specific input, a race, a dependency timeout.

**Real example.** A 500 in this system means something *unexpected* threw. Expected failures are
already mapped: 11000 → 409, `CastError` → 400. So a 500 is always worth reading.

**Trade-off.** Correlation ids are nearly free to build and impossible to retrofit during an incident.

---

### SC12. After a deploy, 2% of requests fail with connection errors.

2% smells like **one instance**, or one connection pool.

1. Is it uniform across instances or concentrated? If concentrated, that instance failed readiness and
   should not be receiving traffic — check whether the probe is wired up at all.
2. Check **pool exhaustion**: requests waiting for a connection appear as latency with an idle
   database, which is the most confusing profile there is.
3. Check whether the old version is still draining and whether shutdown is graceful. If `SIGTERM` is
   not reaching Node — `npm run start:prod` as `CMD` — in-flight requests are cut on every deploy.

**Real example.** `CMD ["node", "dist/main"]` exists precisely to avoid this, and the symptom is nowhere
near the cause.

**Trade-off.** A longer grace period makes deploys slower and safer. Pick a number and know why.

---

### SC13. A migration needs to rename a field on 10 million documents.

Never in one step, and never as part of the deploy. **Expand → migrate → contract**, across three
deploys, because both versions run at once during a rollout:

1. **Expand** — add `newField`; write both; read `oldField`. Safe with either version live.
2. **Migrate** — backfill in **batches**, with a cursor, throttled, resumable, off-peak. Then switch
   reads.
3. **Contract** — stop writing `oldField`; drop it once no running version reads it.

**Trade-off.** Three deploys instead of one, and a window where both fields exist. That is the cost of
not taking production down during the rollout — and a rename is *always* add + backfill + remove.

---

### SC14. Someone proposes caching user permissions for 5 minutes.

I would push back. Stale authorization data is a **security bug**, not a performance trade-off: revoke
someone's access and they keep it for five minutes, which is exactly the window that matters when you
are revoking access from a leaver or a compromised account.

Alternatives: cache for **seconds** rather than minutes if the load genuinely demands it; cache the
*data* and re-evaluate the *decision*; or put permissions in the access token and keep the token short
(which is the same trade with a clearer name).

**Trade-off.** The honest version: if permission checks are genuinely the bottleneck, a very short TTL
plus explicit invalidation on revocation is defensible. What is not defensible is choosing five minutes
because it is a round number.

---

### SC15. The cache hit rate is 40%. Is the cache working?

Probably not worth having. Below roughly 80% you are often net-negative once you count the extra round
trip on every miss plus the invalidation complexity.

Diagnose before removing:

1. Is the **TTL too short** for the access pattern?
2. Is the **key too specific** — including a timestamp or a full filter object, so nothing ever repeats?
3. Are you **invalidating too aggressively** — clearing a whole namespace on every write?
4. Is the data simply not hot? Then remove the cache.

**Trade-off.** Removing a cache is a real option and an underused one. A cache nobody hits is pure
complexity plus a staleness risk.

---

### SC16. Two requests update the same document and one change disappears.

A classic lost update: both read version A, both write, second write wins.

Three fixes, by situation:

- **Atomic operators** — `$inc`, `$push`. Best when it fits: the server does the arithmetic.
- **Conditional update** — `updateOne({ _id, status: 'open' }, ...)` and treat `matchedCount === 0` as
  a 409. The precondition is checked server-side, atomically.
- **Optimistic concurrency** — a version field, incremented on write, matched on update.

**Common misunderstanding worth stating.** A transaction does *not* fix this. It gives isolation, not a
guarantee that your read is still current at write time — you still need the precondition.

**Trade-off.** Optimistic concurrency pushes retries onto the client. Pessimistic locking avoids that
and costs throughput; in MongoDB it usually means the document model is wrong.

---

### SC17. A `$lookup` aggregation times out on a large collection.

1. **`$match` first.** A `$match` after `$group` or `$lookup` scans everything; before them, it can use
   an index and the pipeline works on the smallest possible set.
2. Ensure the **foreign field is indexed** — `$lookup` without one is a collection scan per input
   document.
3. `$limit` early where semantics allow.
4. Ask whether you need the join at all. If reads dominate and the field rarely changes, **denormalise**
   — store `assigneeName` on the task.

**Trade-off.** Denormalisation trades write complexity (update in N places) for read speed, and needs a
backfill plan when the source changes. It is often right, and it is never free.

---

### SC18. A test suite passes locally and fails in CI, intermittently.

Ordered by how often it is actually the cause:

1. **Shared state between tests** — tests passing only in a particular order. Run with
   `--randomize` to expose it.
2. **Real timers or real sleeps** racing a slower machine.
3. **Test parallelism** — suites sharing a database. Fix with a distinct database name per suite, as
   here.
4. **A leaked handle** keeping the process alive past the assertion.

**Real example.** The liveness test in this project was intermittently failing because the probe
checked **process heap** — and under Jest the process is the *runner*, not the app. The fix was to
remove the threshold from liveness entirely, which was independently the right design.

**Trade-off.** Retrying flaky tests hides real races. Fix the test or delete it; a test nobody trusts is
worse than no test.

---

### SC19. You inherit a service with 15% coverage and no types. Where do you start?

Not by rewriting, and not by chasing a coverage number.

1. **Characterisation tests on the critical paths first** — money, auth, data loss. Assert current
   behaviour, bugs included, so you have a safety net.
2. **Types at the boundaries** — the DTOs and the repository interfaces. `strict` mode incrementally,
   file by file, not repo-wide on day one.
3. **Then refactor**, with the net in place.
4. Coverage is an outcome, not a target. Branch coverage on decision-heavy code (guards, retries) beats
   line coverage on mappers.

**Trade-off.** This is slower than a rewrite feels, and it is the only version that ships continuously.
A rewrite means a long branch, a big-bang cutover, and rediscovering every bug the original had already
fixed.

---

### SC20. A dependency has a critical CVE and the fix is a major version bump.

1. **Am I affected?** Is the vulnerable code path reachable from my usage? Many CVEs are in features
   nobody uses. This is the question that decides urgency.
2. **Mitigate now if reachable** — a WAF rule, an input restriction, disabling the feature — to buy time
   for a safe upgrade.
3. **Upgrade on a branch**, read the migration guide, run the suite, deploy behind a canary.
4. If it is untenable: pin, patch (`patch-package`), or vendor it, with a ticket and a date.

**Trade-off.** Rushing a major bump to close a CVE you are not exposed to can cause a worse outage than
the CVE. Both haste and paralysis are failure modes; the reachability question is what separates them.

---

### SC21. The team wants GraphQL instead of REST. How do you evaluate it?

Ask what problem it solves *here*:

- **Over/under-fetching with many clients** → genuine win.
- **Rapidly changing frontend requirements** → genuine win.
- **"It's modern"** → not a reason.

Then price the costs honestly: N+1 by default (you will need DataLoader), query-complexity limits or a
single query can take you down, caching is much harder (no HTTP cache, no CDN), file uploads are
awkward, and error handling is 200-with-errors, which every monitoring tool gets wrong by default.

**Real example.** Nest supports both, and they can coexist — a GraphQL layer over the same services,
since the services never knew about HTTP.

**Trade-off.** Introducing GraphQL alongside REST means maintaining two API surfaces. Sometimes right;
never free.

---

### SC22. A stakeholder wants a feature that requires a cross-service transaction.

I would first try to avoid needing one: can the two changes live in the same service? **A boundary a
transaction crosses is a bad boundary**, and this is evidence about the boundary, not just the feature.

If they genuinely cannot: a **saga** — a sequence of local transactions with a compensating action for
each step. And be clear that compensation is not rollback: refunding a payment is a new fact, not an
erasure, and the customer sees both.

**Trade-off.** Sagas are a large, permanent complexity cost — orchestration, compensation logic,
reconciliation jobs, and a window of visible inconsistency. That cost is exactly the argument for the
modular monolith in the first place.

---

### SC23. Logs show `ECONNREFUSED 127.0.0.1:27017` in a container.

`localhost` inside a container is **the container itself**. In Docker Compose the hostname is the
**service name** — `mongodb://mongodb:27017` — resolved by Docker's embedded DNS.

Also check `depends_on` uses `condition: service_healthy`, not the default `service_started`: without
it the API starts before MongoDB accepts connections, exhausts its retries and exits, which looks like
an application bug and is a startup-ordering one.

**Trade-off.** `service_healthy` slows startup by the health check's start period. Worth it.

---

### SC24. The Docker image is 1.2GB. Reduce it.

1. **Multi-stage build.** Ship only `dist` plus production `node_modules` — nothing that can compile,
   lint or test code should exist in the image facing the internet.
2. **`npm prune --omit=dev`** in the build stage.
3. **Alpine or slim** base. Alpine saves ~40MB but uses musl; safe with no native modules, a real risk
   with `bcrypt`, `sharp` or `canvas`.
4. **`.dockerignore`** — `node_modules` and `.git` alone are usually most of the excess.

**Bonus that matters more than size:** copy the manifests and run `npm ci` *before* copying the source,
so the install layer is cached until a dependency changes. A 3-minute rebuild becomes 20 seconds.

**Trade-off.** Multi-stage builds are harder to debug — `--target build` gets you a shell in an
intermediate stage.

---

### SC25. CI takes 25 minutes and people are pushing straight to main to avoid it.

The social symptom tells you the technical problem is real. Fix the loop, not the behaviour.

1. **Order by cost.** Lint and typecheck (~35s combined) before a 20-minute test run. Most failures
   then report in under a minute.
2. **Cache dependencies** — one line, turns a 60s install into 10s.
3. **Parallelise** independent jobs; **shard** the test suite.
4. **Find the fixed cost.** Here, three suites each starting their own `mongod` was ten minutes; one
   shared instance made it thirty seconds.
5. `cancel-in-progress` so three pushes do not run three full pipelines.

**Trade-off.** Splitting jobs adds per-job setup overhead. Past a point, parallelism stops paying.

---

### SC26. A security review flags "no CSRF protection". The API is bearer-token authenticated.

I would push back with the precondition, not the conclusion: CSRF exists because browsers attach
**cookies** automatically. The browser never attaches `Authorization` by itself, and the same-origin
policy stops an attacker's script from adding it. So bearer-authenticated endpoints are not vulnerable.

Then I would show them the ones that *are*: any endpoint authenticated by a cookie — here, exactly
`POST /auth/refresh` and `POST /auth/logout`, because the refresh token is deliberately an httpOnly
cookie. Those have double-submit CSRF tokens with a constant-time comparison.

**Trade-off.** Applying CSRF everywhere would break every non-browser client for no security benefit.
"Here is exactly where it applies and why" is a stronger answer than "we added it everywhere" — and it
survives the follow-up question.

---

### SC27. A penetration test reports user enumeration on the login endpoint.

Real finding, and the fix has two halves that must both be done:

1. **Identical responses** — "Invalid credentials" for both unknown user and wrong password, never "no
   account with that email".
2. **Identical timing** — compare against a precomputed **dummy bcrypt hash** when the user does not
   exist. Otherwise "not found" returns in 2ms and "wrong password" in 250ms, and an attacker
   enumerates your user list with a stopwatch.

Same treatment for password reset and resend-verification: *"if that address exists, we've sent an
email"*.

**Trade-off.** Slightly worse UX — users cannot tell whether they mistyped their email or their
password. That is the accepted cost, and it is the industry norm.

---

### SC28. Someone asks you to log every request body for debugging.

I would say no as stated, and offer what they actually need.

The problem: request bodies contain passwords, tokens and personal data. Logs are replicated, retained
for a year, shipped to a vendor and readable by anyone with a dashboard login — so this turns your log
store into a credential store and a GDPR liability in one step.

What I would do instead: **redact at the logger** (`req.body.password`, `authorization`, `cookie`,
`set-cookie`) so it is structural rather than a habit; log **metadata** — endpoint, status, duration,
correlation id — which answers most debugging questions anyway; and if full bodies are genuinely needed
for one investigation, enable them behind a flag, for one endpoint, with a short retention.

**Trade-off.** Slightly harder debugging for a much smaller blast radius. And note redaction must be
configured *before* auto-logging is switched on — the default leaks.

---

### SC29. You need to add a feature to a module you do not own, and the team is unavailable.

1. **Can it be done from outside?** Listen to an existing event rather than modify the module. That is
   what the event-driven boundary is for, and it needs no coordination.
2. If it needs a change: small PR, tests, and a description that explains the *why* so review is cheap
   when they return.
3. If it needs a **breaking** change: do not. Add alongside, deprecate later — that is the same
   expand/contract discipline as a schema migration.

**Real example.** Activity logging was added to this system without touching a single feature module,
because it subscribes with `@OnEvent('**')`.

**Trade-off.** The event route is more decoupled and less discoverable — the owning team may not know
anyone is listening. Tell them.

---

### SC30. Traffic will 100× for one day (a launch). What do you do in the week beforehand?

1. **Load test first** — find the actual breaking point rather than guessing at it. Everything else
   depends on knowing which resource saturates.
2. **Fix the top bottleneck**, which is almost always a missing index or an N+1.
3. **Pre-scale** — instances and connection pool. Do not rely on autoscaling to react fast enough to a
   step change; scaling up takes minutes and a launch spike takes seconds.
4. **Check pool arithmetic**: instances × `maxPoolSize` must stay under the database's connection
   limit. This is the one people miss, and scaling out is what triggers it.
5. **Shed load deliberately** — rate limits, and a queue in front of anything expensive, so you degrade
   instead of collapsing.
6. **Cache the hot read paths** with short TTLs.
7. **Rehearse the rollback**, and have a feature flag to disable the expensive feature.

**Trade-off.** Pre-scaling costs money for a day. Far less than the launch failing.

---

### SC31. Your service is fine, but a downstream service is timing out and your error rate is 40%.

1. **Stop making it worse.** A circuit breaker: once failures cross a threshold, fail fast instead of
   holding a connection for 30 seconds each time. Without it, a slow dependency exhausts *your* pool
   and takes you down too.
2. **Degrade if you can.** Serve stale cached data, or a reduced response, rather than an error. This is
   the same principle as Redis-down here: degrade on what only makes you faster.
3. **Queue it** if the work can be deferred — the user gets a 202 and the work happens when they
   recover.
4. **Do not** fail your readiness probe on their outage; that removes you from rotation and hands a
   vendor the ability to page your on-call.

**Trade-off.** Serving stale data is a product decision, not a technical one. Ask what is worse for the
user: slightly old data, or an error page.

---

### SC32. You are asked to hit a deadline by skipping tests. How do you respond?

Not with a principle — with a specific, priced trade.

*"I can hit the date. Here's what I'd cut and what it costs: I'd keep tests on the auth path and the
payment path, because a bug there is unrecoverable, and skip them on the admin screens, which are
internal and low-traffic. That saves about a day. What I'd rather not skip is the integration test on
the transaction rollback, because that is a guarantee we cannot verify by reading code."*

**Why this works.** It gives them the decision with real information instead of a veto, and it shows you
understand that shipping is also a requirement. It also creates a record of what was traded, which is
what stops the debt from becoming invisible.

**Trade-off.** Sometimes shipping on time genuinely *is* the right call — a demo, a contractual date, a
competitor. The failure mode is not making the trade; it is making it silently and never paying it back.

---

**Back to:** [the question bank index](../phase-21-interview-questions.md)
