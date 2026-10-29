# Phase 9 — Middleware, interceptors and exception filters

> **Goal:** the rest of the request pipeline, and — more usefully — knowing which hook to reach for.

Verified: `lint` ✅ · `tsc` ✅ · **105 tests passing** (was 96), incl. 9 pipeline e2e tests ✅ ·
`build` ✅

```
src/common/context/request-context.service.ts        AsyncLocalStorage
src/common/middleware/correlation-id.middleware.ts   class + functional middleware
src/common/interceptors/logging.interceptor.ts       tap, timing, log levels
src/common/interceptors/timeout.interceptor.ts       timeout + catchError
src/common/interceptors/transform-response.interceptor.ts   map (opt-in)
src/common/filters/all-exceptions.filter.ts          one error shape
src/common/common.module.ts                          every global enhancer
src/common/request-pipeline.integration.spec.ts
```

---

## 1. The full pipeline

```
incoming request
  │
  ├─ Express middleware (main.ts app.use)   helmet, cors, compression, cookies
  ├─ Nest MIDDLEWARE (module.configure)     correlation id  ← Phase 9
  ├─ GUARDS            CanActivate          401 / 403       ← Phase 7/8
  ├─ INTERCEPTORS (pre) NestInterceptor     start the timer ← Phase 9
  ├─ PIPES             PipeTransform        400             ← Phase 6
  ├─ ► CONTROLLER → SERVICE → DATABASE
  ├─ INTERCEPTORS (post)                    shape / log
  └─ EXCEPTION FILTERS ExceptionFilter      only if something threw
response
```

## 2. Which hook, and why

| Hook | Sees | Can read route metadata? | Reach for it when |
| --- | --- | --- | --- |
| **Middleware** | raw `req`/`res`, **before routing** | ❌ | It must happen for every request, first, transport-level |
| **Guard** | `ExecutionContext` | ✅ `Reflector` | Allow/deny |
| **Interceptor** | **both sides**, as an Observable | ✅ | Observe or transform the response; timing; timeouts |
| **Pipe** | one bound argument | ✅ | Validate/transform a parameter |
| **Filter** | the thrown error + host | ✅ | Turn errors into responses |

**Why the correlation id is middleware and not an interceptor:** the store must be open for
*everything* that follows, including **guards** — which run before interceptors. An interceptor would
leave every authentication log line without a correlation id, which is exactly the set you most want
correlated.

**Why middleware is registered differently** (`configure(consumer)` instead of an `APP_*` token): it
runs before routing is resolved, so it cannot be attached to a *handler* — only to a **path**. Same
reason it has no `ExecutionContext`.

---

## 3. Per-request context without request scope

Phase 4 ranked the options; this phase implements the middle one.

```ts
this.storage.run({ requestId, startedAt }, () => next());   // AsyncLocalStorage
```

`AsyncLocalStorage` keeps a value alive across an entire async call chain — through `await`,
`setTimeout`, driver internals — without threading a parameter everywhere. A thread-local for a
language with no threads.

**Why it beats `Scope.REQUEST` here:** the service stays a **singleton**, so nothing above it becomes
request-scoped and no provider chain is rebuilt per request. It also works **outside** the HTTP
pipeline — a BullMQ worker (Phase 12) can open its own store and get the same behaviour, which a
request-scoped provider cannot, because there is no request.

**The honest costs:** it is *implicit* (mitigate by storing only cross-cutting fields, never business
data); async_hooks has a small but non-zero cost; and `run()` must wrap the whole request or the
store is empty where it does not.

**The `next()` placement is the mechanism.** Calling it *inside* `run()` is what makes every
downstream continuation inherit the store. Outside, it compiles, runs, and silently yields
`undefined` everywhere.

---

## 4. Interceptors and RxJS

```ts
intercept(context: ExecutionContext, next: CallHandler): Observable<T>
```

Code **before** `next.handle()` runs before the handler; operators piped onto it run **after**. Four
operators cover ~95% of real interceptors:

| Operator | Use |
| --- | --- |
| `tap` | side effect, value untouched — logging, metrics |
| `map` | transform the value — response envelopes |
| `catchError` | handle or rewrite an error |
| `timeout` | fail if it takes too long |

**Why an Observable and not a Promise?** Because a handler can legitimately emit **more than once** —
`@Sse()` (Phase 11) returns a stream of events, and a promise cannot model that. That is the honest
answer to "why does Nest drag RxJS into an HTTP framework". The practical consequence: *if you never
subscribe, the handler never runs* — returning anything other than `next.handle()` (or a pipe of it)
makes the request hang.

**Global interceptor order is counter-intuitive:** registration order on the way **in**, reverse order
on the way **out** — they nest like an onion. So register observation (logging, metrics)
**outermost**, or it logs a body some inner interceptor already transformed and a duration that
excludes it.

**Two details in the logging interceptor worth stealing:**

- `tap({ next, error })`, not just `next` — otherwise **failed** requests produce no timing line, and
  those are the ones whose duration you want.
- **Log level by status class**: 5xx → error, 4xx → **warn**, 2xx → log. Logging 4xx as errors is the
  fastest way to make an error dashboard useless — a bot probing `/wp-admin` should not look like an
  outage.
- It logs the **user id, not the email**. Emails are personal data and end up in aggregators and
  backups. And it logs **no bodies at all** — bodies contain passwords and tokens, and the log
  pipeline is usually the least access-controlled system you own.

---

## 5. Timeouts abandon; they do not cancel

`timeout(ms)` + `catchError` → **504** instead of a hung request. Necessary, because a hung request
holds a socket, an event-loop registration, a database connection from the pool, and a slot in your
concurrency limit. Enough of them and *every* endpoint starts failing — that is how one slow query
takes down a service.

**But it abandons the response, it does not cancel the work.** The query keeps running. Real
cancellation must be pushed down to the operation:

- Mongo → `maxTimeMS` (the server kills it)
- HTTP → `AbortSignal`
- Redis → command timeouts

So the complete answer is **both**: a per-operation timeout that actually cancels, and this
interceptor as the outer bound that guarantees no request lives forever.

**Not registered globally**, deliberately: Phase 11's `@Sse()` returns an Observable that never
completes, and a global 15-second timeout would kill every stream. An interceptor whose correctness
depends on remembering to exclude routes is a trap for the next person.

---

## 6. Response envelopes: a decision, not a default

```
{ "id": "1", "name": "Ada" }
→ { "success": true, "statusCode": 200, "requestId": "…", "data": { … } }
```

**The case against, honestly:**

1. **It duplicates HTTP.** `success` restates the status code; `statusCode` is the same number in two
   places, and they can disagree.
2. **It breaks code generation.** OpenAPI clients expect `GET /users/:id` to return a User; now every
   generated type is `Envelope<User>`.
3. **It encourages `200 { success: false }`.** Once the body carries `success`, someone will — and
   then monitoring cannot see failures and retry logic breaks.
4. **Bytes on every response, forever.**

**What this project does** — and it is the position Stripe and GitHub take:

- **Success** → the plain resource. REST-correct, works with generated clients.
- **Errors** → standardised **globally**, because clients genuinely have to branch on them.

The interceptor is applied to one controller so the mechanism is demonstrable, and the reasoning is
the answer to "would you wrap all your responses?" — "yes, always" and "no, never" are both weaker
than knowing why.

*Detail worth noting:* `response.statusCode` is read **inside** the `map`, not before
`next.handle()` — by then `@HttpCode()` has been applied. Reading it early reports 200 for a 201.

---

## 7. The exception filter

```ts
@Catch()   // everything;  @Catch(HttpException) for a specialised one
```

**Express comparison:** `app.use((err, req, res, next) => …)`. What a Nest filter adds:
`ArgumentsHost` (so the same filter serves HTTP/WS/RPC), dependency injection, and per-scope
registration.

**The security rule it exists to enforce:** never let an unexpected error's message reach the client.
A raw database error can contain a connection string, a collection name, a query with real data, or a
file path; a stack trace hands over your dependency versions. So:

- **Known** errors (`HttpException`, plus the database errors we deliberately translate) keep their
  message.
- **Everything else** → flat `"Internal server error"` for the client, **full stack** in the log,
  joined by the `requestId`.

**Classification order matters** — most specific first, or a Mongoose `ValidationError` (which *is* an
`Error`) becomes a 500:

| Thrown | Becomes |
| --- | --- |
| `HttpException` | its own status; **validation arrays preserved** so a form can show one message per field |
| `CastError` | **400** — a client's malformed id must not be recorded as *our* 500 |
| `ValidationError` | 400, one message per field |
| duplicate key (11000) | **409**, with a *generic* message — the driver's own message contains the conflicting value, which may be someone's email |
| anything else | 500, message withheld |

**Filter registration order reads backwards:** the most recently registered matching filter wins, so a
specialised `@Catch(SomeError)` must be registered **after** the catch-all.

---

## 8. Phase 9 interview questions

**1. Order of middleware, guards, interceptors, pipes, filters?** Middleware → guards →
interceptors(pre) → pipes → handler → interceptors(post) → filters.

**2. Why do guards run before pipes?** So an unauthorised caller is rejected before you spend CPU
validating, and validation errors cannot leak schema details.

**3. Middleware vs interceptor?** Middleware runs before routing (no route metadata, no
ExecutionContext); an interceptor wraps the handler and sees both sides.

**4. Why does an interceptor return an Observable?** Because a handler may emit many times (SSE), and
because it buys `timeout`/`retry`/`catchError`/`map`.

**5. What happens if an interceptor does not return `next.handle()`?** The handler never runs — the
request hangs. Observables are lazy.

**6. Global interceptor order?** Registration order in, reverse order out. Put logging outermost.

**7. How do you get a correlation id into every log line?** Middleware + `AsyncLocalStorage`. Propagate
an incoming `x-request-id` so traces span services; cap its length, because it is untrusted input.

**8. `AsyncLocalStorage` vs `Scope.REQUEST`?** ALS keeps the provider a singleton and works outside
HTTP; request scope is contagious upward and rebuilds the chain per request. ALS is implicit and
costs a little async_hooks overhead.

**9. What must a global exception filter never do?** Leak an unexpected error's message or stack to
the client. Log it fully; return a flat message plus a request id.

**10. How do you keep validation errors useful through a filter?** Preserve the `message` **array**
from `getResponse()`. Flattening it makes forms noticeably worse.

**11. Would you wrap every response in an envelope?** See §6 — the answer is a trade-off, not a rule.

**12. Why is your timeout interceptor not global?** SSE streams never complete; a global timeout kills
them.

**13. Does a timeout cancel the work?** No — it abandons the response. Cancellation needs
`maxTimeMS` / `AbortSignal` / command timeouts.

**14. Why `HttpAdapterHost` instead of `res.json()`?** Platform independence (Fastify), and it handles
the case where the response object is not fully initialised during bootstrap.

**15. Two filters both match. Which wins?** The most recently registered one.

---

## 9. Phase 9 scenarios

**A — "We cannot correlate logs across our services."** Propagate `x-request-id` in **and** out, put
it in an ALS store, include it in every log line and in error bodies, and forward it on outbound
calls. Then adopt W3C `traceparent` when you add a real tracer — the mechanism is identical, the
header is standard.

**B — "Our error dashboard is all noise."** 4xx logged at error level. Split by status class: 5xx is
ours, 4xx is the client's. Alert on the 5xx rate, chart the 4xx rate.

**C — "A customer support ticket says 'it failed' with no detail."** Put the `requestId` in the error
body (as this filter does) and tell support to ask for it. One field turns an unreproducible ticket
into a log query.

**D — "One endpoint gets slow and the whole API degrades."** Connection-pool exhaustion by hung
requests. Add the timeout interceptor as an outer bound *and* `maxTimeMS` on the query so the work is
actually cancelled. Then look at why it is slow (Phase 5 §11).

**E — "We leaked a database connection string to a client."** An unhandled error reached the default
handler. A catch-all filter that withholds unknown messages is the fix; assert it in a test, because
this is the kind of regression a refactor reintroduces silently.

---

**Next:** Phase 10 — Redis caching and rate limiting. Cache-aside with explicit invalidation, TTL and
jitter, the stampede problem, a cache-key convention, and Redis-backed throttling that actually works
across instances.
