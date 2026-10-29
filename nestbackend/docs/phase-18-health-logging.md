# Phase 18 — Health checks, structured logging & observability

> **Goal:** make the application *operable*. Two probes that mean different things, and logs a
> machine can query.

Verified: `lint` ✅ · `tsc --noEmit` ✅ · **157 tests, 19 suites** ✅ · `npm run build` ✅ ·
probes exercised against a live server ✅

Files: [health.controller.ts](../src/health/health.controller.ts) ·
[process.health.ts](../src/health/indicators/process.health.ts) ·
[redis.health.ts](../src/health/indicators/redis.health.ts) ·
[health-check.filter.ts](../src/health/health-check.filter.ts) ·
[logging.module.ts](../src/common/logging/logging.module.ts) ·
[health.integration.spec.ts](../src/health/health.integration.spec.ts)

---

## 1. Liveness vs readiness — the distinction that prevents self-inflicted outages

These are not two names for the same thing.

| | Question | Failing it means | May check dependencies? |
| --- | --- | --- | --- |
| **Liveness** `/health/live` | "Is this process alive, or wedged?" | The orchestrator **kills and restarts** the container | **No** |
| **Readiness** `/health/ready` | "Can this instance serve traffic *right now*?" | The load balancer **stops routing** to it; the process keeps running | Yes |

### The failure mode, concretely

Put a MongoDB check in the liveness probe. The database has a 30-second blip:

1. Every instance fails liveness simultaneously.
2. Kubernetes restarts **all** of them — they were perfectly healthy.
3. They all reconnect at once, hammering a database that was already struggling.
4. A blip becomes a total outage, plus a restart loop that outlives it.

With the split done correctly, the same blip removes the instances from the load balancer, they keep
running, they reconnect when the database recovers, and traffic returns by itself. **No human
involved.**

> The one-sentence test: *"if this check fails, is restarting the process the right response?"*
> Almost nothing passes it.

### The third probe

Kubernetes also has a **startup probe**, which holds off liveness until the app has finished booting.
Without it you must set `initialDelaySeconds` high enough for the worst-case boot — which delays
detection of a real hang by that same amount.

---

## 2. Liveness checks *nothing*, and that is the finished implementation

```ts
liveness(): Promise<HealthCheckResult> {
  return this.health.check([() => this.processIndicator.isAlive('process')]);
}
```

`isAlive` is always up. That looks like a joke until you notice **the real signal is whether the
handler ran at all**: if the event loop is blocked, this endpoint does not return `down` — it does
not return, and the probe fails by *timeout*. An HTTP liveness probe detects a wedged event loop for
exactly that reason.

### Why the memory check was removed — a finding from running the suite

The first version used `MemoryHealthIndicator.checkHeap(512MB)`. Two problems:

1. **It measures the *process*, not the app.** Under Jest the test runner shares the process, so the
   probe was reporting the *runner's* heap, and the liveness test failed intermittently for reasons
   unrelated to the application.
2. **The threshold duplicates the container memory limit**, in a second place, in a different unit,
   that nobody updates when the limit changes. Too low and you restart healthy pods; too high and
   the kernel's OOM killer gets there first — which is the better mechanism anyway, because it is
   enforced by the platform rather than by the process diagnosing itself.

So memory moved to `/health/detail`, where a number informs a human and does not trigger a restart.

---

## 3. Readiness checks MongoDB but deliberately **not** Redis

```ts
readiness() {
  return this.health.check([() => this.mongoose.pingCheck('mongodb', { timeout: 1_500 })]);
}
```

Phase 10 made every Redis path degrade rather than fail — a cache miss reads MongoDB, the throttler
falls back to permitting, queued work falls back to inline. So an instance without Redis is
**slower, not wrong**. Gating readiness on it would remove every instance from the load balancer over
a cache outage: a performance problem converted into a total one.

Same rule as the boot-time decision in `redis.module.ts`:

> **Fail fast on dependencies you cannot function without. Degrade gracefully on dependencies that
> only make you faster.**

**The timeout on `pingCheck` is the load-bearing part.** Mongoose *queues* operations while
disconnected, so without one the check sits in the buffer until `serverSelectionTimeoutMS` expires —
and the probe **hangs** rather than failing. A probe that hangs is worse than one that fails: the
platform's own timeout fires and you get no diagnostic at all.

Also **not** checked: downstream third-party APIs. Include one and their outage takes *your* service
out of rotation — you have handed a vendor the ability to page your on-call. Report them in the
detail endpoint and alert on them; never gate readiness on them.

---

## 4. `/health/detail` — because silent degradation is the real failure

```
GET /health/ready   200  { mongodb: up }
GET /health/detail  503  { mongodb: up, redis: down, memory_rss: up, memory_heap: down }
```

Both are correct at the same time, and the pair *is* the design: alerting sees the degradation, the
load balancer does not act on it. A silent fallback is how a cache that has been down for three
weeks gets discovered by the database bill.

`/health/detail` is `@Public()` here so the behaviour is demonstrable. **In production it should
require authentication** — it reports internal topology, which dependencies exist and which are
failing, and that is genuine reconnaissance value.

---

## 5. Writing a custom indicator (Terminus 11 changed the API)

```ts
const indicator = this.healthIndicatorService.check(key);
return indicator.up({ latencyMs, connection: this.redis.status });
```

The pre-11 pattern — extend `HealthIndicator`, call `this.getStatus()`, **throw** `HealthCheckError`
— is what most tutorials still show, and it does not compile against Terminus 11. `HealthIndicatorService`
is **injected**, not inherited.

Beyond syntax: the old API signalled failure by *throwing*, so a "down" result and a genuine bug in
your indicator looked identical from outside. Returning a value keeps the distinction.

Two details from the Redis indicator worth carrying:

- **`PING`, not `INFO` and not `SET`/`GET`.** It exercises the full round trip — socket, auth, event
  loop — and costs Redis nothing. Checking `client.status === 'ready'` is worse than useless: that is
  ioredis's own opinion of the connection, not evidence the server answered.
- **The timeout is the point.** A Redis that accepts connections but never replies — common under
  memory pressure — leaves the promise pending and the endpoint hangs. `.unref()` on the timer so it
  cannot hold the process open.
- **Report latency, not just up/down.** "Redis is up" and "Redis is up and answering in 340ms" are
  very different operational facts, and the second tells you an incident is starting.

> Gotcha with a genuinely unhelpful error message: `status` is a **reserved key** in the indicator
> payload. Using it gives you `Type 'RedisStatus' is not assignable to type 'never'`. The field here
> is called `connection`.

---

## 6. The bug the health e2e test found

`/health/detail` was returning this:

```json
{ "success": false, "statusCode": 503, "message": "Service Unavailable", "path": "/health/detail" }
```

The entire diagnostic payload was gone. **The one endpoint whose purpose is to say *what* is wrong
had been reduced to saying *that* something is.**

**Cause:** Terminus signals unhealthy by throwing `ServiceUnavailableException` whose body *is* the
report. The global `AllExceptionsFilter` (Phase 9) then rewrote it into the project's standard error
envelope — correctly, by its own rules.

**Fix:** a controller-scoped filter, [health-check.filter.ts](../src/health/health-check.filter.ts).

The general lesson is worth more than the fix: **a global enhancer is a policy, and some endpoints
have a different contract** — health checks, webhook receivers that must answer in a provider's
format, and file downloads are the usual three. Scoping is how you say so, rather than adding an `if`
to the global filter and making one file responsible for knowing about every exception to its own
rule.

### Filter precedence — two different rules people conflate

```
@UseFilters() on the HANDLER  →  on the CONTROLLER  →  APP_FILTER (global)
```

- **Across scopes:** the most specific matching filter wins; the global one never sees the exception.
- **At the same scope:** the *last registered* wins.

Mixing those up is a common source of "my filter never runs".

---

## 7. Stable probe paths: `exclude` + `VERSION_NEUTRAL`

```ts
app.setGlobalPrefix(apiPrefix, { exclude: ['health/live', 'health/ready', 'health/detail'] });

@Controller({ path: 'health', version: VERSION_NEUTRAL })
```

```
/health/live         stable forever
/api/v1/health/live  coupled to two decisions that WILL change
```

Infrastructure — a Kubernetes manifest, a target group, the Dockerfile's `HEALTHCHECK` — is
configured once, in YAML, often by a different team. Coupling it to your prefix and version means the
day you ship `/api/v2`, someone must remember to edit an ingress manifest; if they do not, the
platform declares every instance unhealthy **during a routine deploy**.

**Both halves are required.** `exclude` drops the prefix; only `VERSION_NEUTRAL` drops the version.
Doing one leaves `/v1/health/live`, the worst of both.

Two syntax notes that cost time:

- `@Version()` is a **method** decorator. A controller-wide version goes in the
  `@Controller({ path, version })` options object; putting `@Version()` on the class is a compile
  error whose message ("expects 3 arguments") does not point at the fix.
- The excluded paths are listed **literally**, not as a wildcard. Nest 11 runs on Express 5, whose
  path-to-regexp v8 changed wildcard syntax (`*` → `{*splat}`).

And the test that keeps it honest, because YAML is not type-checked against the app:

```ts
it('does NOT serve it under the prefixed, versioned path', async () => {
  await request(http()).get('/api/v1/health/live').expect(404);
});
```

---

## 8. Structured logging with pino

### Why replace the built-in logger

```
Human-readable:  [Nest] 1234 - LOG [UsersService] created user 68f...
Structured:      {"level":30,"time":...,"context":"UsersService","req":{"id":"c1f..."},"msg":"created user"}
```

Production logs are not read by a human scrolling — they are **ingested and queried**. The second
form lets you ask *"every error for user X in the last hour, grouped by endpoint"*. The first lets
you grep, and grep across twelve instances is not an observability strategy.

**Why pino over winston:** it serialises to JSON with minimal work and, with `transport`, moves
formatting to a **separate worker thread**. Winston formats on the main thread, so pretty-printing
costs event-loop time on every line. At a few thousand requests a second that is measurable.

The honest cost: JSON is unpleasant to read locally, which is why `pino-pretty` is wired in for
non-production — and never in production, where it would burn CPU rendering output no human reads.

### The two lines that matter in `main.ts`

```ts
const app = await NestFactory.create(AppModule, { bufferLogs: true });
...
app.useLogger(app.get(PinoLogger));
```

`useLogger` makes pino the logger the **framework** uses. Without it, framework lines (route mapping,
Mongoose connection, shutdown) still print in the default format — and two formats in one stream is
worse than either.

`bufferLogs: true` holds bootstrap lines until pino is installed. Without it, a crash during module
initialisation produces output your aggregator cannot parse — precisely when you need it most.

### Redaction is not optional

```ts
redact: { paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]', ...] }
```

Without this, `autoLogging` writes the whole header block — so **every log line contains a bearer
token and a session cookie**. Logs then become a credential store: replicated, retained for a year,
shipped to a vendor, readable by anyone with a dashboard login.

This happens **by default rather than by mistake**, which is why it is worth being emphatic about.

### Log level by outcome

| Status | Level | Why |
| --- | --- | --- |
| 5xx | `error` | Our fault. Alert on these. |
| 4xx | `warn` | The client's fault. Interesting in aggregate (a spike in 401s is an attack or a broken deploy), not individually actionable. |
| 2xx | `info` | |

Logging 4xx at `error` makes your error rate track how many people mistype their password, and the
alert becomes noise everyone mutes.

### Ignore the probes

Kubernetes probes every instance every ten seconds. On ten instances that is ~250,000 lines a day
saying "the app is up" — drowning the signal and costing real money on a per-GB ingestion plan.

---

## 9. Correlation IDs

Already built in Phase 9 (`CorrelationIdMiddleware` + `AsyncLocalStorage`); Phase 18 joins pino to it
via `genReqId`, which mirrors the same logic:

1. **Honour an incoming `x-request-id`** so a trace spans services. Generating a fresh one at our
   boundary breaks the chain — and that chain is the difference between "the checkout failed" and
   "the checkout failed here, because payments timed out there".
2. **Echo it in the response header**, so a client can quote it in a bug report. That turns an
   unreproducible ticket into a log query.
3. **Treat it as untrusted** — length-capped, and used only as a log field, never in a query or a
   path. An attacker who can write a 10MB string into every log line has a cheap denial-of-service
   against your log bill.

### Why `AsyncLocalStorage` and not `Scope.REQUEST`

Restating Phase 4's conclusion because this is where it pays off: request scope would make every
provider that touches the logger request-scoped (scope is contagious upward) and rebuild the provider
chain on every request. `AsyncLocalStorage` keeps everything a singleton — and works **outside** HTTP
too, so a BullMQ worker can open its own store and get the same correlation behaviour, which a
request-scoped provider cannot do because there is no request.

### The deliberate overlap with `LoggingInterceptor`

Both log a line per request, and that is documented rather than accidental:

| | Sees |
| --- | --- |
| `LoggingInterceptor` (inside the pipeline) | the handler, the controller class, the resolved user |
| `pino-http` (outside it) | also requests that never reach a handler — 404s, anything middleware rejects |

In a real project you would pick one. Keeping both here makes the difference visible.

---

## 10. What real observability adds beyond this

Logging is one of three pillars, and the weakest one alone.

| Pillar | Tool | Answers |
| --- | --- | --- |
| **Logs** | pino → Loki/CloudWatch | "What happened in *this* request?" |
| **Metrics** | `prom-client` → Prometheus | "What is the p99 latency, and is it worse than yesterday?" |
| **Traces** | OpenTelemetry → Jaeger | "*Where* did those 400ms go?" |

The natural next step for this project is **OpenTelemetry**, and the reason is specific: it would
replace the hand-rolled correlation id with a real `traceparent` (W3C Trace Context), propagated
automatically through the Mongo driver, the Redis client and outbound HTTP. The correlation id built
here is the *manual* version of exactly that — which is why building it by hand first is worth doing.

Three metrics worth naming, because they are what an SRE asks for:

- **RED**: Rate, Errors, Duration — per endpoint.
- **Saturation**: event-loop lag (`perf_hooks.monitorEventLoopDelay`), Mongo pool utilisation, BullMQ
  queue depth. Queue depth in particular is the leading indicator: it rises before latency does.
- **Business**: tasks created per minute. A deploy that breaks task creation while keeping every HTTP
  metric green is the outage no technical dashboard catches.

---

## 11. Why?

| Question | Answer |
| --- | --- |
| **Why Terminus over a hand-written endpoint?** | It standardises the response shape, handles timeouts and aggregation, and ships indicators for the things you would otherwise write badly. |
| **Why not another approach?** | A hand-rolled `GET /health` is fine for one dependency and becomes a mess at four. |
| **Trade-offs** | Another dependency; an API that changed shape in v11; the response format is Terminus's, not yours. |
| **When to use** | Any service behind a load balancer or orchestrator. |
| **When to avoid** | A cron job or worker with no HTTP surface — there, health is "did the job report in", which is a different mechanism. |

| Question | Answer |
| --- | --- |
| **Why pino over winston?** | Faster, worker-thread transports, JSON-first, first-class Nest integration. |
| **Why not another approach?** | Winston has richer transports if you need to write to twelve destinations — but in a container you should write to stdout and let the platform route. |
| **Trade-offs** | JSON is unreadable raw; `pino-pretty` is a dev-only dependency; a transport is a real worker thread and needs a teardown path. |
| **When to avoid** | A CLI tool, where a human *is* the consumer. |

---

## 12. Express comparison

| Express | NestJS |
| --- | --- |
| `app.get('/health', (req,res) => res.json({ok:true}))` — and it usually stays that shallow forever | Indicators are injectable providers, so a real dependency check is as easy as a fake one |
| `morgan` for request logs, `console.log` everywhere else — two formats, no correlation | One logger the framework itself uses, so every line has the same shape and the same request id |
| Correlation ids are a middleware you wrote plus a parameter threaded through every function | Middleware + `AsyncLocalStorage`, injected wherever it is needed |

The structural point: in Express, observability is something bolted on at the edges and therefore
covers only the edges. In Nest the framework already routes every request through a pipeline you can
instrument once — so the logger, the correlation id and the error shape apply to code you have not
written yet.

---

**Next:** [Phase 19 — performance & scalability](phase-19-performance-scalability.md)
