# Phase 15 — Real-time notifications (SSE)

> Covers brief Part 32. Exercises the `fromUrlQueryParameter('access_token')`
> extractor found in Phase 1 — the last major backend capability the frontend
> hadn't touched.

---

## A bug found by capturing a real frame

The live test pushed an actual notification through the stream:

```
event: notification
id: 6a86e55fcf48f265ee8dbab5
data: {"id":"...","userId":"...","type":"task_assigned","title":"OPS-1 assigned to you",
       "body":"\"Assigned via SSE test\" is now yours.",
       "meta":{"taskId":"...","reference":"OPS-1"},"createdAt":"2026-08-20T11:30:39.163Z"}
```

**No `readAt`.** The backend publishes `NotificationEvent`, which is *narrower*
than the `NotificationView` the REST endpoints return:

```
NotificationView (REST)   id userId type title body meta readAt createdAt
NotificationEvent (SSE)   id userId type title body meta        createdAt
```

Defensible server-side — a just-published notification is unread by definition.
But my client parsed the frame as a full `Notification`, so `readAt` was
`undefined`, not `null`. Every unread check in the app is `readAt === null`, so:

- the item rendered as **already read** — no bold, no tint
- clicking it did **nothing**, because the mark-read guard is also `=== null`
- the badge counted it anyway

Visibly inconsistent, entirely caused by a client type claiming a field the wire
doesn't send.

**The fix is normalisation at the boundary** — parse as `NotificationEvent`,
convert explicitly:

```ts
export function notificationFromEvent(event: NotificationEvent): Notification {
  return { ...event, readAt: null };
}
```

`readAt: null` is an **assertion about the domain**, not a default. Writing it
explicitly makes the reasoning reviewable.

> **The wider lesson, and the same one as Phase 7's missing `reference`:** two
> endpoints describing "the same" resource may not send the same shape. Model
> each wire format separately and convert, rather than hoping one type covers
> both.

There's a regression test using the captured payload verbatim. Reinstating the
naive cast makes it fail — verified.

---

## 1. Why SSE, not WebSockets or polling

| | SSE | WebSocket | Polling |
|---|---|---|---|
| Direction | server → client | bidirectional | client pulls |
| Protocol | plain HTTP | upgrade to `ws://` | plain HTTP |
| Reconnection | **automatic** | you write it | n/a |
| Proxies | works (it's HTTP) | often blocked | works |
| Auth | **awkward** | handshake payload | normal headers |
| Cost at rest | 1 connection | 1 connection | a request per tick |

Notifications are one-way, so SSE is the right default. Reach for WebSockets when
the client must send a stream too — chat, presence, collaborative editing.

**The one real gotcha:** HTTP/1.1 allows six connections per origin and an open
stream holds one. Open a few tabs and the app stops loading images. HTTP/2
removes it — which in practice means *"make sure production is HTTP/2"*.

---

## 2. The token in the URL — a trade-off, stated honestly

`EventSource` **cannot set headers.** There's no options argument for them, so
`Authorization: Bearer` is simply unavailable. The backend anticipated this:

```ts
ExtractJwt.fromExtractors([
  ExtractJwt.fromAuthHeaderAsBearerToken(),
  ExtractJwt.fromUrlQueryParameter('access_token'),   // ← for EventSource
])
```

**What putting a token in a URL actually costs:**

- lands in **server access logs**, and log aggregation ships it onward
- lands in **proxy and CDN logs** you may not control
- can leak via the **`Referer` header** on outbound links
- visible in browser history and in a screen-shared address bar

**Why it's acceptable here:** the access token lives 900 seconds; the refresh
token — the credential worth stealing — stays in an httpOnly cookie and is never
in a URL.

**The mitigation worth naming when an interviewer pushes:** issue a single-use,
30-second **stream ticket** from a normal authenticated POST and put *that* in
the URL. Same mechanism, much smaller blast radius.

Verified: `GET /notifications/stream` with no token → **401**.

---

## 3. The bug this hook mainly exists to prevent

> `EventSource` reconnects automatically — **to the same URL**, which still
> carries the **expired** token.

It 401s. Reconnects. 401s. Forever. The URL was fixed at construction, so the
built-in retry can *never* pick up a fresh token.

**And it only appears ~15 minutes into a session** — long after anyone testing
manually has moved on.

So the hook takes over: close the socket, refresh via Phase 7's single-flight
`refreshAccessToken`, build a **new** `EventSource` with a **new** URL. There's a
test asserting the second connection carries `access-token-2`.

Reusing the single-flight refresh matters: a stream reconnect coinciding with six
401'd queries still produces **one** refresh — not seven, and not a token-reuse
revocation.

### Backoff

1s → 2s → 4s → 8s → 16s → 30s ceiling.

A fixed 1-second retry against a downed backend is a self-inflicted DoS — every
client looping against a server already struggling. The **ceiling matters as much
as the growth**: without one, an overnight outage leaves clients retrying hourly
and the app appears dead long after recovery.

Production adds **jitter** so a thousand clients that dropped together don't
reconnect on the same second. Omitted for clarity; named because it's the part
people forget.

---

## 4. Small decisions that carried weight

**`addEventListener('notification')`, not `onmessage`.** The backend names its
events, so the 30-second `ping` heartbeat is filtered *for free* — no parsing, no
branch. That's why the backend bothers to name them, and the client half is one
line. There's a test asserting a `ping` produces no toast.

**Dedupe by id, in a ref.** SSE has a `Last-Event-ID` replay mechanism, and a
reconnect racing an optimistic insert can deliver the same notification twice. A
ref because writing to it must *not* re-render — Phase 3's rule exactly.

**Push into the cache, don't invalidate.** `invalidateTags` is one line and fires
*two* requests per arriving notification, for data already in our hands. The
event payload **is** the notification.

**`skip` until the menu opens.** The list is only seen inside the dropdown, so
fetching it on every page load is a request nobody looks at. The badge uses the
much cheaper `unread-count`.

**A "live" dot.** A stream that has silently died is worse than no stream — the
user believes they're up to date and they aren't.

---

## 5. Two lint rules that changed the design

**`set-state-in-effect`** flagged `setState({connected:false})` in the
unauthenticated early return. The fix wasn't a disable — it was to **derive**:

```ts
return isAuthenticated ? state : { connected: false, reconnects: 0 };
```

Phase 2's rule applied to a hook: if you can calculate it, calculate it. It also
removes a bug class — stored state can't disagree with the session when there's
nothing stored.

**A test-setup trap worth remembering:** `updateQueryData` against a cache entry
that doesn't exist is a **silent no-op**. `upsertQueryData` is async, so
dispatching without awaiting left a window where the entry wasn't there — two
tests failed with *"expected [] to have a length of 1"*, which reads like a bug
in the hook and was a bug in the setup.

> When a cache assertion fails, check the cache was actually populated before
> blaming the code under test.

---

## 6. Interview questions

1. **SSE, WebSocket or polling?** One-way → SSE. Bidirectional → WebSocket.
   Neither available → polling. Mention the six-connection limit.
2. **How do you authenticate an EventSource?** You can't use headers. Token in
   the query string, with the logging trade-off — or better, a short-lived
   single-use stream ticket.
3. **What breaks when the token expires mid-stream?** The built-in reconnect
   reuses the original URL and loops forever on 401. Take over the reconnect.
4. **How do you avoid duplicates?** Dedupe by event id. `Last-Event-ID` replay
   and reconnect races both cause them.
5. **Push into cache or invalidate?** Push — the payload *is* the data.
   Invalidating costs two requests per event.
6. **Why exponential backoff with a ceiling and jitter?** Fixed retries DoS your
   own backend; no ceiling means the app looks dead after recovery; no jitter
   means a thundering herd.
7. **Why must the bell mount once?** The hook owns the connection. Two mounts =
   two streams = two of six slots.

---

## 7. Exercises

1. Delete the `onerror` handler and rely on the browser's reconnect. Expire the
   token (or set it to garbage) and watch the 401 loop.
2. Remove `notificationFromEvent` and cast instead. Watch a new notification
   render as read and refuse to be clicked.
3. Replace `addEventListener('notification')` with `onmessage`. Wait 30 seconds.
4. Remove the cleanup, navigate between pages six times, then load an image.
5. Change the backoff to a fixed 1s, stop the backend, and watch the network tab.
6. Mount `<NotificationBell />` twice and count the connections.

---

## Verified

```
lint ✅   typecheck ✅   127/127 tests ✅   build ✅
backend 90/90 unaffected

Live, against the running stack:
  GET /notifications/stream (no token)  → 401
  GET /notifications/stream?access_token=...  → stream opens
  assign a task → event: notification frame delivered with full payload

Bug reinjection: naive cast → the readAt test correctly fails
```

Bundle 686 kB / 212 kB gzip — past the 500 kB warning. **Phase 35 is now
genuinely needed, not just scheduled.**

---

## Quiz

1. SSE, WebSockets or polling — and what decides it?
2. Why does the access token go in the query string, and what does that cost?
3. What happens without the effect's cleanup?
4. Why does the stream need Redis pub/sub on the backend?
5. What breaks SSE behind nginx, and what are the two settings?
6. A client reconnects after 30 seconds offline. What does it miss?
7. Why dedupe events by id when the transport already delivers in order?

<details>
<summary>Answers</summary>

1. **The traffic shape.** One-directional server → client is SSE: plain HTTP, it
   traverses proxies unchanged, and the browser reconnects automatically.
   WebSockets earn their complexity only when you need client → server messages.
2. `EventSource` **cannot set headers**. The cost is that the token lands in
   server logs and browser history, so it must be short-lived — a real argument
   for `fetch`-based streaming instead.
3. You leak an `EventSource` per mount, and get duplicate notifications forever.
4. Without it, a user connected to instance A never sees an event raised on
   instance B. It is what makes the stream work with more than one API instance.
5. **Response buffering** — events sit in a buffer until it fills. Fix with
   `proxy_buffering off`, and a `proxy_read_timeout` longer than the heartbeat,
   or nginx closes the connection and the client reconnects in a loop.
6. **Everything it missed.** `Last-Event-ID` with durable ids and a replay window
   would fix it; that is not implemented here, and it is acceptable only because
   notifications are also readable from the REST endpoint.
7. Because a **reconnect** can replay events, and because the browser retries
   automatically after a network blip. Dedupe is what makes reconnection safe.

</details>

---

**Next: Phase 16 (performance) and Phase 35 (code splitting)** — the bundle has
earned the attention. Then testing strategy with MSW, and the production Docker
and CI work.
