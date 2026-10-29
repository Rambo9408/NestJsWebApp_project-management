# Phase 11 — SSE and WebSockets

> **Goal:** real-time delivery that survives a second instance, a proxy timeout, and a deploy.

Verified: `lint` ✅ · `tsc` ✅ · **124 tests passing** (was 119) ✅ · `build` ✅ — including a real
SSE connection opened against a listening server, with a notification delivered over it.

```
src/notifications/schemas/notification.schema.ts     durable record + TTL index
src/notifications/notification-stream.service.ts     Redis Pub/Sub fan-out
src/notifications/notifications.controller.ts        @Sse + REST history
src/notifications/notifications.gateway.ts           WebSocket gateway
src/notifications/notification-channel.provider.ts   extracted so it stays testable
src/redis/redis.module.ts                            + REDIS_SUBSCRIBER
```

---

## 1. Three layers, and the order is the design

```
1. PERSIST    MongoDB   ← the source of truth
2. PUSH       Redis     ← fan-out to every instance
3. OUT-OF-BAND channel  ← email / console (the Phase 3 strategy)
```

Persist **first**. If the process dies immediately afterwards, the notification still exists and the
user sees it on their next request. A test asserts the ordering.

That is also what makes Redis Pub/Sub's **at-most-once, no-replay** delivery an acceptable choice: a
dropped message costs a refresh, not a notification. Choosing fire-and-forget is only defensible when
something else is durable — and that is the interview answer.

**The client's correct algorithm:** on load *and on reconnect*, `GET` the unread list; then apply
stream events. Anything relying on the stream alone loses notifications to a dropped connection, a
closed tab or a deploy — invisibly.

---

## 2. The fan-out problem

> A connection is held by **one process**.

Ana's browser has a stream open to instance #3. Ben adds her to a project; that request is
load-balanced to instance #7, which holds no connection to her.

On one instance an in-memory `Subject` is enough. On two it is **silently broken** — delivery works
only when writer and reader happen to land on the same process, so it works perfectly in development
and about half the time in production. That reads like a flaky network rather than a design error,
which is what makes it nasty.

```
instance #7 ──publish──▶ Redis Pub/Sub ──▶ every instance
                                            └─ #3 holds Ana's stream ──▶ Ana
```

**Redis Pub/Sub's honest limits:** fire-and-forget, no persistence, no acknowledgement, no replay,
at-most-once. Acceptable *because* MongoDB is durable. If the push itself had to be reliable you
would need Redis Streams (consumer groups + replay), Kafka, or NATS JetStream.

**Two connections are required.** A Redis connection in *subscriber mode* cannot issue normal
commands — sharing one client between `SUBSCRIBE` and `GET` breaks both. That is why `REDIS_CLIENT`
and `REDIS_SUBSCRIBER` are separate tokens, and it is the purest example of why provider tokens
exist: same class, two instances, and only the token can tell them apart.

*Detail:* `publish()` does **not** also call `local$.next()`. The publisher receives its own message
back through the subscription, so there is exactly one delivery path and no "works locally, not
remotely" asymmetry to debug.

---

## 3. SSE vs WebSockets

| | SSE | WebSocket |
| --- | --- | --- |
| Direction | server → client **only** | bidirectional |
| Protocol | plain HTTP | upgrade to `ws://` |
| Reconnection | **automatic**, built in | you write it |
| Corporate proxies | works — it is just HTTP | often blocked |
| HTTP/2 | multiplexed | its own connection |
| Auth | awkward (no headers) | handshake payload |
| Binary | no | yes |
| Browser limit | 6 per origin on HTTP/1.1 | not affected |

> **Default to SSE for server→client push.** Reach for WebSockets when the client must send a stream
> too — chat, collaborative editing, presence, live cursors.

This module runs both, deliberately: notifications are one-way (SSE), while `task:typing` and
presence are genuinely bidirectional (gateway).

**Two SSE gotchas that bite in production:**

- **The six-connection limit.** A browser allows six connections per origin on HTTP/1.1 and an open
  stream holds one. Open a few tabs and images stop loading. HTTP/2 removes it — which in practice
  means *make sure production is HTTP/2*.
- **Heartbeats are not optional.** ALB defaults to a 60s idle timeout, nginx's `proxy_read_timeout`
  is 60s, and mobile carriers are worse. Because EventSource reconnects automatically, the symptom is
  a connection cycling every 60 seconds rather than an obvious failure. A comment frame every 30
  seconds fixes it.

Also note what is *absent* from the SSE handler: `timeout()`. Phase 9's TimeoutInterceptor is applied
per-controller precisely so it never reaches a stream that is supposed to live for hours.

---

## 4. Authenticating a stream

**EventSource cannot set headers.** There is no `new EventSource(url, { headers })`. Three options:

| | Trade-off |
| --- | --- |
| Cookie | Sent automatically — safest, but CSRF-exposed; needs SameSite |
| **Query parameter** (used here) | Simple; a real security downgrade — see below |
| fetch-based polyfill | Can set headers; you lose native auto-reconnect and ship a library |

**Why a query parameter is genuinely worse:** tokens land in **access logs** (nginx, the LB, the CDN,
your own logging), can leak via `Referer`, and are visible in history.

**What makes it acceptable here:** the access token lives **15 minutes** — a concrete payoff of the
two-token design — only one endpoint is reachable this way, and in production you exclude that path's
query string from access logs or issue a narrowly-scoped stream token. The header extractor is listed
**first**, so ordinary API calls never fall back to the query string.

**WebSocket auth is different again:** `JwtAuthGuard` extends Passport's HTTP guard, which reads
`request.headers` — and a Socket.IO handshake is not an Express request. So the gateway verifies the
token itself, once per **connection**. Consequence worth knowing: a token that expires mid-connection
does **not** end the session.

---

## 5. What breaks at 10,000 connections

| Limit | Reality |
| --- | --- |
| **Memory** | ~10–40KB per idle socket → a few hundred MB at 10k, before doing anything |
| **File descriptors** | one per connection; the default `ulimit -n` of 1024 stops you first |
| **Sticky sessions** | Socket.IO starts with HTTP polling and upgrades; without affinity the handshake and upgrade can hit different instances and fail *intermittently*. Force `transports: ['websocket']` or enable affinity |
| **Deploys** | every rolling restart drops every socket at once, and they all reconnect together — a thundering herd against your own auth endpoint. Client backoff **with jitter** is not optional |
| **Fan-out cost** | `filter` per subscriber is O(subscribers) per event. Fine for thousands; at 100k, shard the channel per user (`taskflow:notifications:{userId}`) so an instance only receives what it can deliver |

**Rooms** are the mechanism that makes targeted delivery cheap — but a room lives in **one process**,
which is the same fan-out problem again. `@socket.io/redis-adapter` solves it at the adapter level;
this project reuses its own stream service instead, so SSE and WebSockets share **one** fan-out
mechanism rather than two that can disagree.

---

## 6. Two things this phase made visible

**A refactor forced by testability.** `NotificationsModule` grew a Mongoose model and a gateway, so
importing it in a unit test now drags in a database. Rather than spin up MongoDB to test a
`useFactory`, the provider was **extracted** into its own file. When a module accumulates
infrastructure, the pure decisions inside it should move out — otherwise they quietly become
untestable.

**An authorization hole, left visible.** `project:watch` does **not** verify project membership.
Over HTTP that is `ProjectAccessGuard`'s job, and a WebSocket message bypasses the HTTP pipeline
entirely. It is commented rather than silently fixed because *"we forgot the socket path"* is one of
the most common real authorization holes — and it is exactly Phase 8's argument for putting rules
that must hold for non-HTTP callers into a **service** rather than a guard.

---

## 7. Phase 11 interview questions

**1. SSE or WebSockets?** SSE for server→client push — less code, survives proxies, browser handles
reconnection. WebSockets when the client sends a stream too.

**2. Your real-time feature works locally and fails half the time in production. Why?** Connections
are held per process; without a shared bus, delivery only works when the writer and the connection
holder are the same instance.

**3. How do you fan out across instances?** A message bus every instance subscribes to — Redis
Pub/Sub here, or a Socket.IO Redis adapter. Know that Pub/Sub is at-most-once with no replay.

**4. Why two Redis connections?** A connection in subscriber mode cannot issue normal commands.

**5. Why persist notifications if you push them?** Push is best-effort; the record is the guarantee,
and it is what makes at-most-once delivery acceptable.

**6. How do you authenticate an SSE stream?** Cookie, query parameter, or a fetch-based polyfill.
Query parameters put tokens in access logs — mitigate with short TTLs and log exclusion.

**7. Why does an SSE endpoint need a heartbeat?** Proxies and load balancers kill idle connections
(~60s), and auto-reconnect hides it as a cycling connection.

**8. What is the HTTP/1.1 six-connection limit?** A browser allows six per origin; an SSE stream
holds one, so several tabs starve the rest of the app. HTTP/2 removes it.

**9. What happens to sockets during a deploy?** All dropped, all reconnecting together. Backoff with
jitter, and drain gracefully.

**10. Why do interceptors need `context.getType()` checks?** They run for WebSocket and RPC contexts
too, where `switchToHttp()` returns nothing meaningful.

**11. Why doesn't the global JwtAuthGuard protect the gateway?** It extends Passport's HTTP guard,
which reads an Express request; a handshake is not one.

**12. What breaks at 10,000 connections?** File descriptors first, then memory, then sticky-session
assumptions, then deploy-time herds.

**13. Why is `Subject` used and not `ReplaySubject`?** A late subscriber must not receive history —
that is what the REST endpoint is for, and a replay buffer is an unbounded leak.

**14. Why a TTL index on notifications?** Otherwise the collection grows forever — one row per user
per event. "Which collection is 400GB?" is usually notifications, logs or sessions.

---

## 8. Phase 11 scenarios

**A — "Users get notifications only sometimes since we scaled to 3 pods."** No shared bus. Add
Pub/Sub fan-out (or the Socket.IO Redis adapter), and confirm the durable record + refetch-on-connect
path exists so nothing is actually lost.

**B — "Our SSE connections drop every 60 seconds."** An idle timeout at the LB or nginx. Add a
heartbeat below that interval; raise `proxy_read_timeout` if you control it.

**C — "10,000 SSE connections — how do you scale?"** Horizontally, with a shared bus. Then: raise
file-descriptor limits, budget ~10–40KB per connection, shard the Pub/Sub channel per user so
instances only receive what they can deliver, terminate on HTTP/2, and make sure deploys drain rather
than dropping everyone at once. If it grows beyond that, put the connection layer in its own service
that does nothing else (Phase 20).

**D — "Notifications appear twice."** Usually the publisher also delivering locally *and* receiving
its own Pub/Sub message — one delivery path, not two. Or a client resubscribing without tearing down
the previous stream.

**E — "We need guaranteed delivery."** Pub/Sub is the wrong tool. Redis Streams with consumer groups,
or a broker with acknowledgements — plus an inbox table and client-side deduplication by
notification id.

---

**Next:** Phase 12 — BullMQ. Moving delivery off the request path, retries with exponential backoff,
delayed jobs, dead-letter handling, graceful worker shutdown, and idempotency — because a job *will*
be delivered twice.
