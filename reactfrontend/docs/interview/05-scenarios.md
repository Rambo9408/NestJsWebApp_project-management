# Scenarios — 25 situations

> "Here is a broken situation. What do you do?"
>
> These are not knowledge questions. Every one can be answered correctly by
> someone who knows less than you and reasons better — which is exactly why they
> get asked.
>
> **The first move is almost never a fix.** If your answer starts with a
> solution, you have skipped the step being assessed.

Scenarios marked **★** happened, in some form, in this project.

---

## Debugging

### SC1. A component renders 20 times after one button click.

**First:** open the Profiler and use "why did this render". Guessing is how you
end up memoising the wrong component.

**The usual causes**, in order: a context value recreated on every parent render;
an unstable prop defeating a `memo`; a `setState` in an effect that depends on
the state it sets; a parent re-rendering for an unrelated reason.

**The senior move:** ask whether 20 renders is actually costing anything.
A re-render is not a DOM write, and optimising a cheap render is how you add a
dependency array you then have to keep correct forever.

---

### SC2. `useEffect` runs twice on mount. ★

**Answer:** StrictMode in development mounts, unmounts and remounts to surface
missing cleanup.

**What not to do:** remove StrictMode. It is telling you the effect is not
idempotent, and that will bite in production when React remounts for a real
reason.

**The fix:** make the effect safe to run twice — return a cleanup that undoes it.

---

### SC3. An API is called twice on page load.

**Diagnose in this order:** StrictMode (dev only)? Two components subscribing
with **different** arguments, so two cache keys? An effect with an unstable
object dependency? A parent and child both fetching?

**Real-world example.** RTK Query deduplicates identical arguments — so two calls
means the arguments differ. An inline object is safe there (it serialises by
value), which is precisely what a hand-rolled `useEffect` fetch cannot do.

---

### SC4. Users are randomly logged out. ★

**Look for concurrency, not expiry.** The shape: several requests 401 at once,
each triggers a refresh, rotation invalidates the earlier tokens, and reuse
detection revokes the session.

**Naming *reuse detection* as the mechanism** is what separates a strong answer —
it shows you understand the security feature is firing *correctly* on your bug.

**Fix:** single-flight refresh.

---

### SC5. It works on your machine but not for QA. ★

**Stop reproducing; start finding the difference.** Environment, data, role,
browser, build mode.

**Role differences are the most common and the easiest to miss**, because you are
testing as an admin.

**Real-world example.** A `DELETE` returned 500 only against a standalone
`mongod`, because transactions require a replica set — a pure environment
difference no amount of code reading would have found.

---

### SC6. A test is flaky. It passes on rerun. ★

**Quarantine it, but file the bug.** A flake usually reports a real race.

**Causes in order:** a fixed `setTimeout` instead of waiting on a condition;
shared state between tests; a genuine race; test-order dependence.

**Say out loud** that "rerun until green" is how a suite stops being trusted —
once people learn to rerun, they rerun past real failures too.

**Honest note:** this project has one unreproduced flake, logged rather than
dismissed.

---

### SC7. A test passes and you do not believe it. ★

**Break the code and confirm the test fails.** That is the only way to find out.

**And the subtler half:** when the mutation does *not* break it, check whether
the test is vacuous **or the mutation failed to create the bug**. Assuming the
first here nearly led to weakening a test that was already correct.

---

### SC8. A memory leak in a long-lived page.

**Three heap snapshots at intervals, compare retained size.** Look for
subscriptions without cleanup, timers, `window` listeners, detached DOM held by a
closure.

**In React specifically:** a missing effect cleanup. Delete it from this
project's SSE hook and you leak an `EventSource` per mount plus duplicate
notifications.

**The senior move:** ask whether the page is *meant* to live that long.

---

## Performance

### SC9. The dashboard takes five seconds to load.

**Establish which five seconds.** Network waterfall, bundle size, or render?

**Then the usual suspects:** a request waterfall (each fetch waiting on the last),
an over-large eager bundle, an unvirtualized list, or an N+1 in the UI — fifty
cards each fetching their own author.

**The senior move:** fix the waterfall before the bundle. Latency compounds;
bytes do not.

---

### SC10. You have 100,000 rows to render.

**Push back first.** Does the user need 100,000 rows, or do they need search and
the top 20? Pagination is cheaper than virtualization and does not break Ctrl+F,
anchors, printing or screen readers.

**If it genuinely must be one continuous list:** virtualize, and handle the
accessibility explicitly — `aria-setsize` and `aria-posinset` per row.

---

### SC11. Typing in a filter box is laggy.

**In order:** is it actually the list (measure)? Then debounce the **input**,
paginate or virtualize the **list**, and mark the update non-urgent with
`useTransition`.

**Not** a throttled scroll handler — that is the reflex answer and usually the
wrong lever.

---

### SC12. Your optimisation made things measurably worse. ★

**Report it, with the numbers.** Then decide whether to keep it for a different,
honestly-labelled reason.

**Real-world example.** Code splitting: 213 → 245 kB gzip cold, because separate
gzip streams share no dictionary. Kept for cache stability — 8.5 kB instead of
213 kB on redeploy.

**The senior move is reporting a negative result at all.** Most people quietly
keep the change and say nothing.

---

## Correctness

### SC13. A list shows the wrong data after deleting a row.

**Suspect keys.** With index keys, deleting the first row makes React think item 0
changed content rather than moved — so state bound to position (a checkbox, an
open menu, focus) attaches to the wrong row.

**Visually plausible, behaviourally wrong**, which is why it survives review.

---

### SC14. A form clears itself when the request fails. ★

**Cause:** the mutation promise resolved with an error object instead of
throwing, so the success path ran anyway.

**Fix:** `.unwrap()`, so a failure is a throw and `reset()` never runs.

**Why it matters:** it destroys the user's text at exactly the moment they most
need it back — and it is invisible until the network fails.

---

### SC15. A search box shows results for the previous query.

**A race.** Type "rea" then "react"; if "rea" resolves last it wins.

**Fixes:** `AbortController` on the stale request, or a request sequence number
that discards out-of-order responses.

**Follow-up you should pre-empt:** a query library handles this for you, which is
one of the strongest arguments for using one.

---

### SC16. A user reports data they should not be able to see. ★

**Treat it as a security incident, not a bug.** Preserve evidence, establish
scope — who else, how long, what data — notify per policy, *then* fix.

**Where to look first:** the **collection** endpoint. Route-level and
object-level checks get attention; the list endpoint that forgot to scope by the
caller leaks quietly.

**Real-world example.** `GET /tasks` here returned every task in the database
while `GET /tasks/:id` checked ownership correctly.

**The senior move:** ask "what else has the same shape?" and audit every list
endpoint, not just the reported one.

---

### SC17. A feature works with a mouse and not with a keyboard. ★

**Almost always one of three:** `onClick` on a non-interactive element; a
hand-rolled `role="button"` that handles Enter but not Space; or nested
interactive elements, where the inner control is announced but unreachable.

**Real-world example.** `TaskCard` had the third. The overflow menu simply did
not exist for keyboard users, and worked perfectly with a mouse — which is why
nobody noticed.

---

### SC18. Every row of an admin table shows the same value. ★

**Suspect a default standing in for something you failed to read.**

**Real-world example.** Every activity record stored `event: "unknown"`, because
the framework did not pass the event name where the code assumed and a
`?? 'unknown'` fallback filled the gap.

**The lesson:** a default value on a field you did not successfully read is a
**disabled bug detector**. Same instinct as `catch {}`.

---

## Incidents and production

### SC19. Production is down and you noticed first.

**Communicate → mitigate → diagnose.** In that order.

Say it is down *before* you start debugging: the second-worst thing in an
incident is five people debugging in silence.

**Mitigate before you understand** — roll back, flag off, scale up. Root cause is
a post-incident activity, and the urge to understand first is the most common
senior mistake.

---

### SC20. A deploy caused it. Roll back or fix forward?

**Default: roll back.** Known-good, and fast.

**Fix forward when** rollback is unsafe — a migration already ran, or the new
version wrote data the old code cannot read.

**Which is exactly why migrations must be backward-compatible.** The senior move
is noticing that "can we roll back?" is a question you answer *before* deploying.

---

### SC21. The container reports unhealthy and nobody knows why. ★

**Treat an unexplained health status as a bug, not noise.**

**Real-world example.** `FailingStreak: 11`, unexplained for hours. Cause: a
misconfigured global rate limit of 10 requests per 15 minutes against a
30-second healthcheck — the container was **rate-limiting its own liveness
probe**.

**Why that shape is dangerous:** in an orchestrator it is a feedback loop.
Throttled probe → restart → less capacity → survivors throttled sooner → collapse
under load it could otherwise serve.

---

### SC22. Every route returns 200 but users say the app is broken. ★

**A 200 from an SPA server proves the fallback works, nothing more.**
`/total-nonsense` returns 200 too — the server is serving `index.html` for
everything, and no page has been rendered.

**What actually answers it:** mount each route and assert its own heading, its
data, and that no `console.error` occurred.

---

## People and process

### SC23. A PR works but you would have built it differently.

**Approve it.** "I would have done it differently" is not a review comment.

**Block only for** correctness, security, or a decision expensive to reverse.
Everything else is an optional comment, or a conversation outside the PR.

**The senior move:** knowing that style debates cost more than the inconsistency
they prevent, and that lint config is where that argument belongs.

---

### SC24. You are asked to ship a hack before a deadline.

**Ask when the fix happens.** "Later" is not a date and everyone knows it.

**Ship it when** the deadline is real, the blast radius is contained, and the
cost is **visible** — a comment, a ticket, a fallback that fails loudly.

**Refuse when** it is in a security boundary, or it is a data-shape decision —
those compound.

**Real-world example.** This project keeps deliberately-open known issues in
`ROADMAP.md`. Debt you have written down is a decision; debt you have not is a
surprise.

---

### SC25. You realise a claim you made in a code review was wrong. ★

**Correct it where you made it, plainly, and move on.**

**Real-world example.** A comment in this repo asserted a test was load-bearing
for a `z-index`. It was checked and it was false — jsdom has no layout or
hit-testing. The correction sits next to the original, along with what jsdom
*can* and cannot see.

**Why this is a good story to have:** "I check my own claims and publish the
correction" is a rarer trait than knowing the limitation.

---

## Self-check

1. What is the first thing you do in an incident, and why is it not debugging?
2. Name three causes of "the API is called twice".
3. Why is a collection endpoint the most likely place for a data leak?
4. What does a 200 from an SPA server actually prove?
5. When a mutation does not break a test, what are the two possibilities?

---

**Back to:** [the interview index](../README.md#graded-interview-material) ·
[01 — Beginner](01-beginner.md)
