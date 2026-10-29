# Phase 12 — BullMQ background jobs

> **Goal:** move delivery off the request path, and understand why "a job will run twice" is a design
> constraint rather than a bug.

Verified: `lint` ✅ · `tsc` ✅ · **129 tests passing** ✅ · `build` ✅

```
src/queue/queue.module.ts                     the connection + default job options
src/notifications/notification-job.handler.ts the WORK, with no BullMQ in it
src/notifications/notification.dispatcher.ts  the producer + the degraded path
src/notifications/notifications.processor.ts  the consumer
src/notifications/notification.dispatcher.spec.ts
```

---

## 1. What a queue actually buys

| | Before (inline) | After (queued) |
| --- | --- | --- |
| Latency | request waits for SMTP | one Redis write, sub-millisecond |
| Failure | one attempt, swallowed → **lost** | 5 attempts, exponential backoff |
| Spike | thundering herd at a third party | a longer queue |
| Isolation | a broken provider degrades the API | it degrades notifications only |

**What it costs, honestly:** another moving part; at-least-once delivery (so every consumer must be
idempotent); a queue to monitor; and jobs that outlive the code that created them — a payload
enqueued by v1 may be handled by v2, so payload shapes need the same backward-compatibility care as
an API.

---

## 2. Three settings that are load-bearing

**`maxRetriesPerRequest: null`** is *required* by BullMQ. Its blocking commands (`BRPOPLPUSH`) sit
for seconds waiting for work, and a retry limit aborts them:

```
BullMQ: Your redis options maxRetriesPerRequest must be null
```

Our shared cache client deliberately sets `2` so reads **fail fast** during an outage (Phase 3). The
two requirements are incompatible — which is exactly why BullMQ gets its own connections, and the
clearest example of when one shared client is *not* the frugal choice.

**`enableOfflineQueue: false`.** With the default, `queue.add()` on a disconnected client never
rejects — it buffers and waits, and the HTTP request that called it hangs. The producer's fallback
can only work if `add()` actually **fails**. One line, and it is the difference between "the queue is
unavailable" and "the API is unavailable".

**`backoff: { type: 'exponential', delay: 1000 }`** → 1s, 2s, 4s, 8s, 16s. A *fixed* delay retries a
struggling dependency at a constant rate, which is what keeps it struggling. What is missing and
matters at scale: **jitter** — a thousand jobs that fail together retry together, in lockstep,
forever.

Plus the two cleanup settings that are really memory bounds: `removeOnComplete` (completed jobs stay
in Redis **forever** by default) and `removeOnFail` with a *long* age, because a failed job is
evidence you want days later.

---

## 3. Throw to retry — the inversion people get backwards

```ts
// INLINE: must swallow. A notification failure must not fail the user's request.
// IN A JOB: must THROW. That is the only signal that tells BullMQ to retry.
```

A `try/catch` that swallows inside a processor is the single most damaging thing you can write in a
consumer: every job reports success, nothing is retried, the dashboard is green, and the feature is
broken. The spec asserts the handler **propagates**.

That inversion is why moving work to a queue changes the **error handling**, not just the timing.

---

## 4. Idempotency

```ts
await queue.add('send-notification', payload, { jobId: payload.idempotencyKey });
```

BullMQ treats an `add` with an existing `jobId` as a **no-op**, so a deterministic key makes the
*enqueue* side idempotent for free — a retried request, a duplicated event, or a double-clicked
button collapses into one job.

**That covers duplicate production. It does not cover duplicate execution.** A worker that crashes
after sending but before acknowledging gets the job redelivered. Every queue is **at least once**;
exactly-once *delivery* does not exist — what people mean is exactly-once *processing* built on top.

**Making a consumer idempotent, best first:**

1. Make the operation **naturally** idempotent — `$set` not `$inc`, upsert not insert. Nothing to
   remember.
2. Record the key **before** acting, in the same transaction as the effect.
3. Give the downstream system an idempotency key (Stripe, SendGrid and most serious APIs accept one)
   and let *it* deduplicate.

A "have I seen this key?" check in Redis is the common fourth option and the **weakest**: the check
and the effect are not atomic, so a crash between them reintroduces the duplicate. It narrows the
window rather than closing it — fine for an email, not for a payment.

*The key here is a hash of recipient + subject + body, with no timestamp — because including one
would deduplicate nothing. The trade-off: a genuinely repeated notification is suppressed while the
job id is still known. Right for notifications, wrong for a one-time passcode.*

---

## 5. Stalled jobs, and a cause worth knowing

`stalled` means a job was picked up but its lock was not renewed — the process died, **or the handler
blocked the event loop** long enough that the renewal timer never ran.

That second cause catches people out. A CPU-bound job (image processing, a big JSON parse, bcrypt)
starves the timer, BullMQ concludes the worker is dead, and the job is given to someone else — so it
runs **twice**. The fix is not a longer lock; it is to stop blocking the event loop (a worker thread
or a separate process).

---

## 6. Concurrency and graceful shutdown

`concurrency: 5` is five jobs **in this process**. Across four instances that is twenty concurrent
jobs hitting your email provider — so the right number depends on **downstream** capacity, not your
CPU count. For genuinely rate-limited work, BullMQ's `limiter: { max, duration }` is the correct tool
rather than guessing a concurrency that happens to fit.

`WorkerHost` implements `OnModuleDestroy`, so `app.enableShutdownHooks()` (Phase 1) makes a SIGTERM
stop new jobs and drain in-flight ones. Without it a rolling deploy kills the process mid-job — the
job is not lost, but it waits ~30s for its lock to expire before redelivery. *"Notifications are
delayed by exactly 30 seconds after every deploy"* is a real bug report with a one-line cause. And
`terminationGracePeriodSeconds` must exceed your longest job, or Kubernetes SIGKILLs you anyway.

---

## 7. Phase 12 interview questions

**1. Producer vs consumer?** The producer enqueues and returns, knowing nothing about who runs the
job. The consumer pulls and executes, retrying on failure.

**2. Why must a consumer be idempotent?** Retries and stalled-job redelivery mean at-least-once
execution. Exactly-once delivery does not exist.

**3. How do you make one idempotent?** Naturally idempotent operations first; then record-before-act
in the same transaction; then a downstream idempotency key. A Redis "seen" set is the weakest option
and does not close the window.

**4. What does a deterministic `jobId` give you?** Deduplication of *enqueues* — nothing more.

**5. Why exponential backoff, and what is missing?** It gives a struggling dependency room to
recover. Jitter is missing, and it matters once enough jobs fail together.

**6. Why does BullMQ need `maxRetriesPerRequest: null`?** Its blocking commands wait for seconds; a
retry limit aborts them.

**7. Why `enableOfflineQueue: false`?** So `add()` fails fast when Redis is down instead of hanging
the request. Fallback logic requires failure.

**8. What does throwing in a processor do?** Marks the job failed and schedules a retry. Swallowing
marks it complete and silently loses the work.

**9. What is a stalled job?** A job whose lock was not renewed — a dead worker, or a blocked event
loop. It will be redelivered.

**10. How do you shut a worker down cleanly?** Nest lifecycle hooks + `enableShutdownHooks()`, with a
grace period longer than the longest job.

**11. Should `queue.add()` failing fail the user's request?** Depends on the job. For a notification,
no — degrade to inline. For an expensive job, fail loudly and let the caller decide.

**12. Where should retry/backoff live: app or queue?** The queue. Application-level retry loops block
the request, do not survive a restart, and cannot be observed.

**13. How do you monitor a queue?** Depth, oldest-waiting age, failure rate, and jobs that exhausted
their attempts. Alert on the last two — the `failed` event fires on *every* attempt, so alerting on
it directly is noise.

---

## 8. Phase 12 scenarios

**A — "A notification job was processed twice and the user got two emails."** Expected: at-least-once
delivery. Fix at the consumer — a downstream idempotency key, or record-before-act. Also check
whether the job stalled because the handler blocked the event loop.

**B — "Our queue has 400,000 waiting jobs."** Either the producer outpaces the consumer (scale
workers, raise concurrency toward the *downstream* limit) or jobs are failing and retrying forever
(check the failed set and whether `attempts` is bounded). Also verify `removeOnComplete` — a queue
that never cleans up looks like a backlog.

**C — "Redis was down for an hour and we lost every notification."** With `enableOfflineQueue: false`
and no fallback, that is exactly what happens. Either degrade to inline (as here), or persist the
intent first — a transactional outbox — and let a publisher drain it.

**D — "Jobs are delayed by 30 seconds after every deploy."** No graceful shutdown; jobs wait for lock
expiry. Enable shutdown hooks and set an adequate grace period.

**E — "Our email provider started rate-limiting us."** Concurrency multiplied by instance count. Use
BullMQ's `limiter` rather than guessing concurrency, and add jitter to the backoff.

**F — "A job payload from last week crashes the new worker."** Jobs outlive deploys. Version payloads
and keep handlers backward-compatible for at least as long as your longest retry window.
