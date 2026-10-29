# Phase 10 — Redis caching and rate limiting

> **Goal:** a cache that stays correct, and a rate limiter that still works when you run more than one
> instance.

Verified: `lint` ✅ · `tsc` ✅ · **119 tests passing** (was 105) ✅ · `build` ✅

```
src/cache/cache.keys.ts                key conventions
src/cache/cache.service.ts             cache-aside, stampede defence, degradation
src/cache/redis-throttler.storage.ts   shared counters + in-memory fallback
src/cache/smart-throttler.guard.ts     key by user, not IP
src/cache/throttler-storage.module.ts  ...and the DI error that forced it to exist
src/cache/*.spec.ts                    14 tests
```

---

## 1. Cache-aside, and why not the alternatives

```
read:   hit  → return
        miss → read the database, WRITE the cache, return
write:  write the database, then INVALIDATE
```

| Pattern | Trade-off |
| --- | --- |
| **Cache-aside** (this) | Explicit, works with any store, a cache outage degrades to *slow* |
| Read/write-through | Less application code, less control, needs library support |
| Write-behind | Very fast writes; **you can lose data on a crash** |

**What is cached:** `ProjectsService.findById` — frequently read (`ProjectAccessGuard` calls it, then
the handler calls it again — the duplicate query named as debt in Phase 8), rarely changed.

**What is deliberately *not* cached:** `findAll`. A list keyed by filter, page, sort *and the
caller's membership* has an enormous key space, a poor hit rate, and an invalidation story that must
consider every write. Caching lists is where most caching layers go wrong.

---

## 2. The three hard parts

### Invalidation

**Delete, don't update.** Writing the new value into the cache means two writers can interleave and
leave the cache holding an *older* version than the database — a disagreement no TTL will fix.
Deleting is idempotent and impossible to get subtly wrong. It costs one extra read next time.

**Order matters:** database write **first**, then invalidate. Invalidating first leaves a window
where a concurrent read repopulates the cache with the old value.

**`SCAN`, never `KEYS`.** Redis is single-threaded; `KEYS pattern` walks the entire keyspace in one
blocking operation and stalls every other client for its duration. Running it in production is a
well-known way to cause an outage — and it is still the first thing most examples show. `SCAN` is a
cursor with a weaker guarantee (a key may be returned more than once; keys changed mid-scan may or
may not appear), which is exactly the right trade for invalidation.

> **The ioredis `keyPrefix` trap:** ioredis prefixes keys you *write*, but the SCAN `MATCH` pattern
> is sent raw and the returned keys come back **fully prefixed**. So the pattern needs the prefix and
> the results must be un-prefixed before `del`, or the prefix is applied twice and nothing is
> deleted.

### Stampede

Fifty concurrent misses on the same key become fifty database reads — and that happens precisely when
a popular key expires under load. That is how a cache expiry becomes an outage.

`getOrSet` keeps an **in-flight map**: the first caller starts the work, the other forty-nine await
the same promise. The `finally` that clears the entry matters too — a rejected promise left in the
map would give every later caller the same error, a *cached failure*.

**Its limit, honestly:** this is per-process. Ten instances means ten rebuilds instead of five
hundred — a 50× improvement, not a fix. The cross-instance version needs a distributed lock
(`SET NX PX` + token, released with a Lua compare-and-delete), which brings lock-expiry and fencing
problems of its own. Worth it for genuinely expensive keys; overkill for a 2ms document read.

### TTL jitter

A hundred entries written in one burst with the same TTL all expire in the same second, and the
database sees a synchronised spike — the stampede again, caused by the *cache* rather than by
traffic. It is self-reinforcing: the spike slows the rebuilds, the rebuilds finish together, and the
next expiry is synchronised too. ±10% breaks the synchronisation. The exact number matters far less
than it not being zero.

---

## 3. Degradation is the design

Every method swallows connection errors and behaves as though the key was absent. That is Phase 3's
rule made concrete: **Redis makes us faster, it does not make us correct**, so an outage must never
produce a 500. Asserted in the spec.

Note the log level: `debug`, not `error`. During an outage this fires on *every request*, and an
error-per-request will bury the one line that says Redis went away.

**Why `null` is not cached** — and the hole that leaves. Caching a negative result makes a record
created a second later invisible for the whole TTL, which looks like "the API is eventually
consistent with itself". But *not* caching it leaves **cache penetration**: an attacker requesting
random non-existent ids bypasses the cache entirely. The standard answers are a short negative TTL
(5–30s) or a Bloom filter — worth knowing by name, not worth the complexity until traffic justifies
it.

---

## 4. Rate limiting

**The in-memory default is wrong the moment you run two instances.**

```
limit 100/min, 4 instances → the real limit is 400/min
```

…and not even consistently 400: a client whose requests land on one instance is limited at 100,
another spread evenly gets 400. The limit becomes a function of load-balancer luck. A **shared
counter** is the only correct answer.

### The algorithm, and its known flaw

```
INCR key                          # atomic; Redis is single-threaded
if PTTL == -1 → PEXPIRE key ttl   # INCR creates the key WITHOUT an expiry
```

> That `-1` case is the bug worth remembering: miss it and the counter never resets, so every client
> is permanently blocked after their first `limit` requests. It passes a short test and locks out
> production.

**Fixed window** lets a client send `limit` requests at 11:59:59 and `limit` again at 12:00:00 —
twice the limit across the boundary. The alternatives, in order of cost: **sliding window log**
(exact, one entry per request), **sliding window counter** (nearly exact, O(1) — the usual production
choice), **token bucket** (allows controlled bursts, often what an API actually wants). Knowing
*which* flaw you chose is the point.

### Key by user, not by IP

IP is a poor identity: everyone behind one NAT shares it (an office, a university, a mobile carrier's
CGNAT), it is trivial to rotate with a proxy pool, and IPv6 gives one customer a /64. So key by user
id when authenticated, IP only for anonymous traffic.

This is also why the throttling guard is registered **last** of the three globals — it needs
`request.user`, which the JWT guard populates. (The counter-argument — reject before verifying the
token — matters only if the limit is your flood defence, and a flood belongs at the CDN/WAF, not in
the application.)

`request.ip` is the real client address **only because** `main.ts` sets `trust proxy`. Without it,
every request behind a load balancer shares one bucket — the most common way a rate limiter is
silently broken.

### Fail open, fail closed, or degrade?

| | Cost |
| --- | --- |
| Fail **open** | API stays up; the limit is gone exactly when an attack is underway |
| Fail **closed** | Nobody is abused; nobody is served either |
| **Degrade** (this) | Effective limit becomes `limit × instances` — worse than correct, far better than nothing |

**When degrading would be wrong:** if the limit is the only thing between an attacker and a
brute-force login, or if it enforces a paid quota. The answer depends on what the limit is *for*.

### A separate, stricter limit for auth

10 attempts / 15 minutes on credential endpoints. Login is the one route where an attacker chooses
how much CPU you spend (a bcrypt hash each, ~250ms of single-threaded work), and where the limit is
doing *security* work rather than fairness work.

**Note what it does *not* do: lock the account.** Account lockout on failed attempts is a
denial-of-service vector — anyone who knows your email can lock you out of it.

### Verified live, and one thing to know about the response header

Running the stack in Docker against a real Redis (Phase 17) confirmed the whole path:

```
POST /auth/login ×12 →  401 401 401 401 401 401 401 401  429 429 429 429
```

and in Redis, the counters really are shared and really do expire:

```
taskflow:throttle:auth:0a65f7…      pttl 872271     ← not -1
taskflow:throttle:default:fe4cab…   pttl  51017     ← not -1
```

**Every key had a positive TTL** — which is the first direct proof of the `PTTL == -1` fix above.
That bug does not show up in tests; it shows up as one user locked out forever.

**The header is `Retry-After-auth`, not `Retry-After`.** When you configure *named* throttlers,
`@nestjs/throttler` suffixes the header with the bucket name:

```
HTTP/1.1 429
Retry-After-auth: 900
x-request-id: 2e5581ad-107d-4eb0-9ff5-6f5403e0f954
```

That is library behaviour, not a bug in our code — but it is worth knowing, because **a client
implementing the standard `Retry-After` back-off will not find the header** and will hammer you at
full rate. If you have external consumers, either normalise it to `Retry-After` in the exception
filter or document the suffixed name in your OpenAPI description. Naming your buckets has an
interoperability cost that the docs do not mention.



---

## 5. A DI error worth reproducing

Declaring `RedisThrottlerStorage` in `CacheModule.providers` failed at boot:

```
Nest can't resolve dependencies of the THROTTLER:MODULE_OPTIONS (AppConfigService, ?).
Please make sure that the argument RedisThrottlerStorage at index [1] is available
in the ThrottlerModule module.
```

Read the last words: **in the ThrottlerModule module**. A `forRootAsync` factory resolves inside the
**dynamic module it configures**, not inside the module that called it — and that module cannot see
`CacheModule`'s private providers.

This is the Phase 4 checklist working exactly as written: the class *was* decorated and *was*
registered, but was not **exported from a module the consumer imports**. The fix is a tiny module
with one export, passed via `imports:` — not a `@Global()` sticking plaster.

`AppConfigService` resolved all along because its module is `@Global()`, which is why the error named
only the second argument. *"It works for the other dependency"* tells you about that dependency's
module, not about yours.

---

## 6. Testing a rate limiter you disabled in tests

Throttling is skipped when `isTest` — a realistic limit would fail the e2e suites for the wrong
reason and, worse, *intermittently*, which is how a suite becomes something people re-run until it
goes green.

> "We disabled it in tests" is a smell **unless you can say what you test instead.**

The answer here is `redis-throttler.storage.spec.ts`: the counter, the window initialisation, bucket
separation per client and per named throttler, and the degraded path — which is the more valuable
test anyway, because the interesting behaviour is the algorithm, not the HTTP plumbing.

---

## 7. Phase 10 interview questions

**1. Explain cache-aside and one alternative.** See §1. Cache-aside is explicit and degrades to slow;
write-behind is fast and can lose data.

**2. What do you cache and what do you not?** Frequent reads of rarely-changing data. Not lists with
large key spaces and per-caller filtering.

**3. Invalidate by delete or by update?** Delete. Updating races and can leave the cache older than
the database.

**4. Which comes first, the write or the invalidation?** The write. Otherwise a concurrent read
repopulates the old value.

**5. Why never `KEYS` in production?** Redis is single-threaded; it blocks every other client for the
whole scan.

**6. What is a cache stampede and how do you handle it?** Concurrent misses on one key. In-process
de-duplication, TTL jitter, and — for expensive keys — a distributed lock.

**7. Why jitter a TTL?** To desynchronise expiries written in the same burst.

**8. Should the app fail if Redis is down?** Not for caching — degrade to misses. For a session store
or the only rate limiter on login, arguably yes.

**9. Should you cache negative results?** It bounds cache penetration and costs staleness for
newly-created records. Short TTL if you do; a Bloom filter if the volume justifies it.

**10. Why is an in-memory rate limiter wrong at scale?** Per-instance counters multiply the effective
limit by the instance count, inconsistently.

**11. Which rate-limiting algorithm, and what is its flaw?** Fixed window here; 2× burst across the
boundary. Sliding-window counter is the usual production upgrade.

**12. Key by IP or by user?** User when authenticated — NAT and CGNAT make IP a poor identity, and it
is trivially rotated. IP as the anonymous fallback, and only meaningful with `trust proxy` set.

**13. Where should rate limiting live — app, gateway or CDN?** All three, for different threats. The
app can key by user and by route cost; the edge is the only place that can absorb a flood without
paying for it.

**14. Why not lock an account after N failed logins?** It is a denial-of-service vector against the
account owner. Rate-limit the request, do not lock the identity.

**15. Where does the guard ordering matter?** Throttling must run after authentication if it keys by
user.

---

## 8. Phase 10 scenarios

**A — "Users see stale project names for a minute after editing."** An invalidation path was missed
(or invalidation ran before the write). Grep every write path for the invalidation call; the TTL is
the backstop that turns "wrong forever" into "wrong for at most N seconds", which is why every entry
has one.

**B — "Redis restarted and the API returned 500s."** Something threw instead of degrading. Every
cache method must treat failure as a miss. Assert it in a test — this is the regression a refactor
reintroduces silently.

**C — "Our rate limit does nothing since we scaled to 6 pods."** In-memory storage. Move the counter
to Redis, and decide explicitly what happens when Redis is unavailable.

**D — "An entire customer office got rate limited at 9am."** IP-based limiting plus NAT. Key by user
for authenticated traffic; keep IP only as the anonymous fallback.

**E — "Database load spikes every 60 seconds, exactly."** Synchronised TTL expiry. Add jitter. If it
persists, the key is hot enough to justify a distributed lock or a background refresh.

**F — "Someone is hammering us with random ids and the cache is useless."** Cache penetration.
Short-TTL negative caching or a Bloom filter, plus a rate limit keyed on the anonymous path.

---

**Next:** Phase 11 — SSE and WebSockets. Real-time notification delivery, why SSE is usually the
right default for server-to-client push, what breaks at 10,000 connections, and the Redis Pub/Sub
fan-out that makes either work across instances.
