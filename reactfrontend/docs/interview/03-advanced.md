# Advanced — 25 questions

> Rendering internals, performance you can defend with numbers, auth mechanics,
> caching, testing that actually bites, and accessibility beyond "we run axe".
>
> These are the questions where a candidate either has specific stories or does
> not. Generic answers are audible.

---

### A1. What happens when you call `setState`?

**Answer.** It schedules an update. React re-renders the component (calls the
function), reconciles the new element tree against the previous one, commits only
the differences to the DOM, then runs effects. Updates batch, and an update to
the same value can bail out.

**The follow-up they are waiting for:** *"How is 'the same value' compared?"* —
`Object.is`. Which is why mutation is invisible.

**Common mistake.** "It re-renders the component" and stopping. Re-render is the
uninteresting half; what happens after is the question.

---

### A2. What are the render and commit phases?

**Answer.** **Render** calls your components and builds an element tree — pure,
interruptible, and possibly thrown away. **Commit** applies the diff to the DOM —
synchronous and not interruptible.

**Why it matters.** Side effects belong in commit-phase effects because render
may not "count" — React can start rendering, abandon it, and start again.

**Follow-up.** *"So why is `useLayoutEffect` different?"* — it runs after commit
but **before paint**, so you can read layout and mutate without a visible flash.
It blocks painting, which is why it is the exception.

---

### A3. What is Fiber?

**Answer.** A re-implementation of reconciliation as an interruptible walk over a
linked-list of work units, with each node able to be paused, resumed or
discarded.

**Why it matters.** It is what makes concurrent features possible — before it,
reconciliation was a synchronous recursive walk that could not be interrupted.

**Common mistake.** Going deeper than this. Interviewers want to know you
understand *why* it exists, not that you have read the source.

**Follow-up.** *"Name one thing it enables."* — `useTransition`: marking an update
non-urgent so React can interrupt it and keep typing responsive.

---

### A4. Does "re-render" mean "touch the DOM"?

**Answer.** No — and this is the most common misunderstanding. Re-render means
React called your function and diffed the result. If nothing changed, no DOM is
touched.

**Why it matters.** A re-render is cheap. A re-render that allocates and diffs a
huge tree is not. Optimising the wrong one is why premature memoisation is
common.

---

### A5. How does React decide to update vs remount?

**Answer.** Same position, same type, same key → update. Anything else → unmount
and mount fresh.

**Real-world example.** This is why a component defined **inside** another
component remounts every render: it is a new function identity, therefore a new
type.

**Follow-up.** *"Is `key` on a component a legitimate way to reset state?"* —
yes, it is the documented approach, and clearer than an effect that clears
fields. Just be aware you are unmounting: refs, focus and animations reset too.

---

### A6. What changed about batching in React 18?

**Answer.** All updates batch — including in promises, `setTimeout` and native
event handlers. Before 18, only updates inside React event handlers did.

**Why it matters.** Fewer renders, and one fewer reason to reach for
`useReducer`.

---

### A7. Where do you put the access token, and why?

**Answer.** In **memory**. `localStorage` is readable by any XSS. In-memory dies
on refresh — which is what the refresh cookie is for.

**The sentence that matters:** neither is "secure". They trade different risks,
and saying that is the answer.

**Follow-up.** *"Why httpOnly for the refresh token?"* — JavaScript cannot read
it, so XSS cannot exfiltrate it. It is sent automatically, which is exactly why
CSRF protection is then required.

---

### A8. Explain double-submit CSRF.

**Answer.** The server sets a random value in a readable cookie; the client
copies it into a header. An attacker's cross-origin form can **send** your cookie
but cannot **read** it to set the header.

**Follow-up.** *"Is this still needed with SameSite cookies?"* — SameSite covers
most of it. Double-submit is defence in depth, and it still matters for older
browsers and for same-site subdomain attacks.

---

### A9. What is single-flight refresh, and what breaks without it?

**Answer.** One in-flight refresh promise that every caller awaits.

**Without it:** five requests 401 at once → five refresh calls → with rotation,
four present an already-consumed token → **reuse detection revokes the session**
and logs the user out.

**Why it matters.** The security feature is firing *correctly* on your bug, which
is what makes it confusing to diagnose.

**Real-world example.**

```ts
refreshInFlight ??= performRefresh().finally(() => { refreshInFlight = null; });
```

The `finally` is load-bearing — without it the first result is cached forever,
which is a different feature.

**Follow-up.** *"What must the refresh call itself avoid?"* — going through the
interceptor. If the refresh 401s and triggers a refresh, you have infinite
recursion.

---

### A10. How many conditions guard a 401 retry?

**Answer.** Four, and each is a bug you would otherwise ship:

1. Do not retry the refresh endpoint itself.
2. Do not retry twice.
3. Do not retry when there was never a token.
4. Respect an explicit opt-out — **login must show "wrong password", not attempt
   a refresh**.

**Follow-up.** *"Why does login need the opt-out?"* — a 401 there is the expected
answer, not an expired session.

---

### A11. Where does your frontend's idea of the API contract come from?

**Answer.** Generated from the backend's OpenAPI document, checked in, and
regenerated in CI with a job that fails on a non-empty diff.

**The honest caveat, volunteered:** the document has request schemas but **no
response schemas**, so generation guards what we *send*, not what we *receive*.

**Real-world example.** The drift job caught a real 35th path on its first run —
added during a fix and never regenerated.

**Follow-up.** *"What did the missing response schemas cost you?"* — two
endpoints declared the same response type and returned different shapes. Found by
calling both and diffing, because nothing else could.

---

### A12. Hand-writing a response type — what is the risk beyond being wrong?

**Answer.** Fields become **invisible**. This project's `Task` type omitted
`reference` — the human-readable "AP-1" the whole UI needed — for several phases.
No error anywhere; the field simply did not exist as far as the frontend was
concerned.

**Follow-up.** *"What is the classic date bug?"* — a Node backend types a field
`Date` because that is what the ORM returns, but JSON has no date type, so a
**string** arrives. Typing it `Date` compiles and then fails on `.getTime()`.

---

### A13. How do you approach "the app is slow"?

**Answer.** Refuse to optimise until you know *which* slow: initial load,
interaction latency, or one specific screen. They have unrelated causes.

Then: Profiler for renders, Network for waterfalls, Lighthouse for load. Find the
**biggest** contributor, not the most interesting one.

**Follow-up.** *"What does the Profiler tell you that a stopwatch does not?"* —
which components rendered and **why**. The attribution usually points at a
context or an unstable prop, not the component you suspected.

---

### A14. Your performance fix made things worse. What do you do?

**Answer.** Say so, with the numbers, and then decide whether to keep it for a
different reason — honestly labelled.

**Real-world example.** Code splitting here: 213 → 245 kB gzip on cold load,
because separate gzip streams share no dictionary. Kept for cache stability —
a redeploy costs a returning user ~8.5 kB instead of 213 kB.

**Why it matters.** It is a traffic-shape trade-off, not a win, and stating it
that way is the point.

---

### A15. What is the SPA caching contract?

**Answer.** Content-hashed assets: `immutable`, one year. `index.html`: never
cached.

**Get it backwards** and returning users load yesterday's HTML pointing at chunk
hashes that no longer exist — a blank page after every deploy.

**Follow-up.** *"What is the nginx trap here?"* — `add_header` is inherited
**only if the current level defines none**. A `location = /index.html` block that
sets `Cache-Control` silently discards every server-level security header.

---

### A16. When is virtualization the wrong answer?

**Answer.** When pagination would do — and it usually would.

**And what it costs:** Ctrl+F stops working (off-screen rows are not in the DOM),
anchors and printing break, and accessibility needs explicit work because the
list reports 20 items when it has 10,000.

**Real-world example.** This project's lists are server-paginated at 20.
Virtualizing them would be pure overhead; the `VirtualList` exists for cases
pagination cannot serve — a live log, an infinite feed.

**Follow-up.** *"How do you make one accessible?"* — `aria-setsize` and
`aria-posinset` per row. **Not** `aria-rowcount`, which is grid-family only —
this project shipped that bug and axe caught it.

---

### A17. What is a vacuous test, and how do you find one?

**Answer.** One that passes whether or not the code is correct. You find them by
**reintroducing the bug and confirming the test fails**.

**Real-world example.** Two here. An MSW refresh handler re-validated the old
token, so *"retries with the new token"* passed even when the client replayed the
stale one. Another asserted "no refetch after an optimistic update" and passed
even with `invalidatesTags` added, because the refetch dispatches *after* the
promise resolves.

**Follow-up.** *"What if the mutation does not break the test?"* — check whether
the test is vacuous **or the mutation failed to create the bug**. Assuming the
first once nearly led to weakening a test that was already correct.

---

### A18. What can a jsdom test never catch?

**Answer.** Anything decided by **layout**: z-order, occlusion, clipping, scroll
position, whether a focus ring is visible.

**Why it matters.** jsdom has no layout engine and no hit-testing, so
`user.click(el)` dispatches on `el` whatever visually covers it.

**Real-world example.** A comment in this repo claimed a test was load-bearing
for a `z-index`. It was checked, and it was false. The correction is in the file.

**Follow-up.** *"What can it test faithfully?"* — the DOM tree, ARIA attributes,
and the **focus model**. `document.activeElement` and tab order are implemented
properly, which is why the skip-link tests are honest.

---

### A19. Why MSW rather than mocking `fetch`?

**Answer.** It intercepts at the **network layer**, so the code under test uses
its real transport — headers, status codes, retries and error parsing all
genuinely execute.

**Mocking `fetch` tests that you called a mock.**

**Follow-up.** *"What does `onUnhandledRequest: 'error'` buy you?"* — a page
calling an unmocked endpoint fails loudly and names the URL, instead of rendering
its error state and passing a "did it render" assertion.

---

### A20. "We run axe in CI, so we're accessible." Respond.

**Answer.** Automated tooling finds roughly a **third** of real problems.

**Real-world example.** Here it found four genuine violations in components — and
**zero** in the app shell, where both Level-A failures actually were: no skip
link, and completely silent navigation.

**Follow-up.** *"Give me a case where passing a rule makes it worse."* — a
nameless spinner fails `aria-progressbar-name`; labelling it passes and now the
user hears it twice, because the adjacent status text says the same thing.

---

### A21. What is the canonical SPA accessibility failure?

**Answer.** Navigation is silent. A real page load moves focus to the new
document and the screen reader starts reading; `pushState` does none of that. The
URL changes, the page looks entirely different, and for a screen-reader user
nothing happened.

**Fix:** move focus to `<main>` **and** announce the page in a live region. Focus
says *where*; the announcement says *that you moved*.

**The tell that you have implemented it:** `tabIndex={-1}` on `<main>`. Without
it `.focus()` is a no-op.

---

### A22. Why is invalid ARIA worse than none?

**Answer.** No ARIA falls back to sensible native behaviour. Invalid ARIA is
discarded but **reads as done** — it typechecks, it lints, it reviews well.

**Real-world example.** `aria-rowcount` on `role="list"`, with a correct comment
beside it describing the problem it was not solving.

---

### A23. How do you make a whole card clickable?

**Answer.** Three options, and naming all three is the answer:

1. `onClick` on a `<div>` — no keyboard, no role. Broken.
2. `role="button"` + `tabIndex` + `onKeyDown` — valid **until** the card contains
   its own controls, then it is `nested-interactive` and the inner button is
   announced but unreachable.
3. An **overlay** button that is a *sibling* of the content — real button
   semantics for free.

**And what the overlay costs:** text selection, and right-click "open in new
tab" (use `<a href>` if the card navigates).

---

### A24. What breaks SSE behind a proxy?

**Answer.** nginx buffers proxied responses by default, so events sit in a buffer
until it fills. `proxy_buffering off` is mandatory, and `proxy_read_timeout` must
exceed the heartbeat or nginx closes the connection and the client reconnects in
a loop.

**Follow-up.** *"Why did EventSource need the token in the query string?"* —
`EventSource` cannot set headers. Which means the token lands in server logs and
browser history, so it must be short-lived — a real argument for `fetch`-based
streaming instead.

---

### A25. SSE, WebSockets or polling?

**Answer.** Match the traffic shape.

| | Use when | Cost |
| --- | --- | --- |
| Polling | updates are rare and latency does not matter | wasted requests |
| SSE | one-directional server → client | one connection per user; ~6 per origin |
| WebSockets | genuinely bidirectional | its own protocol, proxies, reconnection, scaling |

**Real-world example.** Notifications here are one-directional, so SSE — plain
HTTP, traverses proxies unchanged, browser reconnects automatically.

**Follow-up.** *"What breaks at scale?"* — connections, not messages. And a
reconnecting client **loses** missed events unless you implement `Last-Event-ID`
with durable ids, which this project does not.

---

## Self-check before moving on

1. What is the difference between the render and commit phases?
2. Why do five simultaneous 401s log the user out?
3. Name a performance change you would keep despite a worse measurement.
4. What did axe fail to find in this codebase, and why?
5. Which of your tests cannot fail, and how do you know?

---

**Next:** [04 — Senior architecture](04-senior-architecture.md)
