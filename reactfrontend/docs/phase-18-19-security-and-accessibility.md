# Phases 18–19 — Security and accessibility, audited rather than asserted

> Covers brief Parts 24, 42, 43. Both topics had been applied throughout; this
> is the consolidated pass. The ROADMAP predicted _"an honest one would find
> gaps, because nothing has been checked with an actual screen reader or axe."_
>
> It found **seven real defects**, including one that had been taking the API
> container down and had gone unexplained.

---

## Summary

| #   | Defect                                                | Severity | Found by                  |
| --- | ----------------------------------------------------- | -------- | ------------------------- |
| 1   | Global throttler capped the **entire API** at 10 req/15 min | critical | probing a live container  |
| 2   | Liveness probe rate-limited itself into `unhealthy`   | critical | ↑ same root cause         |
| 3   | `nested-interactive` — card actions unreachable       | serious  | axe                       |
| 4   | `aria-rowcount` on `role="list"` — invalid, inert     | critical | axe                       |
| 5   | Progressbar with no accessible name                   | serious  | axe                       |
| 6   | `aria-label` on a roleless element — silently ignored | serious  | axe                       |
| 7   | No skip link; navigation **completely silent**        | Level A  | thinking, not tooling     |

Tests: **frontend 170**, backend **180 unit + 90 e2e**. All fixes verified by
reintroducing the bug — including one claim that turned out to be **false**.

---

## The security finding: one array entry, whole-API outage

`cache.module.ts` registered two named throttlers:

```ts
throttlers: [
  { name: 'default', ttl: 60_000, limit: 100 },
  { name: 'auth', ttl: 15 * 60 * 1000, limit: 10 },   // <-- "for login"
],
```

with a comment saying a route opts into the strict one via `@Throttle`.

**That mental model is wrong, and it is the most common mistake with this
library.** In `@nestjs/throttler` v5+, **every throttler in the array is
enforced on every route.** The array is not a menu — it is a list of limits that
all apply. `@Throttle({ auth: {...} })` _reconfigures_ a named throttler for one
handler; it does not _enable_ it. Opting out is `@SkipThrottle({ auth: true })`,
per route, everywhere else.

So the strictest entry became the effective limit for the whole application:
**ten requests per fifteen minutes, per user, across every endpoint.** A
dashboard that fires four requests on load spent nearly half of it.

`@Throttle` appeared **nowhere in the codebase** except inside that comment.

### How it was found

Not by reading the file. The code and its comment were internally consistent and
both read as correct — a reviewer would approve it.

It was found by sending fourteen requests to a health endpoint on the running
container:

```
1:200 2:200 3:200 4:200 5:200 6:200 7:200 8:200 9:200 10:200 11:429 12:429 13:429 14:429
```

### The symptom that was already visible

```
$ docker compose ps
api   Up 26 minutes (unhealthy)
```

The container had been sitting at `unhealthy` and nobody had connected it to
anything. `docker inspect` gave the rest:

```json
{ "Status": "unhealthy", "FailingStreak": 11, "Log": [{ "ExitCode": 1, "Output": "" }] }
```

The Dockerfile `HEALTHCHECK` polls `/health/live` every 30 seconds — **30
requests per 15 minutes against a limit of 10**. About five minutes after boot
the container began rate-limiting its own liveness probe, permanently.

**Why that is worse than it sounds.** Under an orchestrator, a failed liveness
probe restarts the container:

```
traffic rises → budget consumed faster → probe throttled → container killed
   → survivors take its traffic → they are throttled sooner → deployment collapses
```

The limit designed to protect the service takes it down, and does so precisely
when the service is busiest. That is the worst available shape for a failure.

### The fix

1. **One global throttler.** A global array is global scope.
2. **Strict limits per route**, next to the route they protect:
   ```ts
   @Throttle({ default: { limit: 10, ttl: 15 * 60 * 1000 } })
   @Post('login')
   ```
   applied to `login` and `register` — both unauthenticated, both costing a
   bcrypt operation (~250 ms of single-threaded CPU an attacker gets to spend).
3. **`@SkipThrottle()` on the health controller.** A request from your own
   platform is not traffic. Probes are control plane and must not compete with
   users for a shared budget.

### Verified on the rebuilt container

```
/health/live   × 20   →  all 200          (was: 429 from the 11th)
POST /auth/login × 13 →  401×10, then 429  (protection intact, correctly scoped)
/api/v1/tasks  × 20   →  all 401, no 429   (general limit, as intended)
docker inspect        →  healthy, failingStreak=0   (was: unhealthy, streak 11)
```

### What this does _not_ fix, stated plainly

`SmartThrottlerGuard` keys anonymous requests by IP, so a **distributed**
credential-stuffing run gets the full budget from every address. Rate limiting
raises the cost; it does not prevent the attack. The controls that actually do —
breached-password rejection, MFA — are not implemented here.

> **Interview.** _"How do you rate-limit a login endpoint?"_ The limit itself is
> the easy half. The answer worth giving covers: why account lockout is a DoS
> vector (anyone who knows your email can lock you out); why probes must be
> exempt; and that per-IP limits are defeated by distribution.

---

## The accessibility findings

`axe-core` against every user-facing component, WCAG 2.0/2.1 A and AA. Four
violations, all real, all fixed. See [`src/a11y.test.tsx`](../src/a11y.test.tsx).

### 1. `nested-interactive` (serious) — a feature that was gone for keyboard users

`TaskCard` put `role="button"` + `tabIndex` + a hand-rolled `onKeyDown` on the
card body. The `actions` slot — an overflow menu — was therefore **inside a
button**.

The previous comment in that file called this _"a genuine design tension, not a
shortcut"_, and argued a real `<button>` was impossible.

**The tension was real; the conclusion was wrong.** A screen reader presents a
control as one unit, so the inner menu was announced but unreachable, and Enter
fired the outer handler. The feature simply did not exist for those users — and
it worked perfectly with a mouse, which is why nobody noticed.

The fix is the **overlay ("stretched link") pattern**: an absolutely positioned
transparent `<ButtonBase>` that is a _sibling_ of the content rather than an
ancestor. Tab, Enter, Space, role and focus all come from the browser; the
hand-rolled key handler is deleted.

What it costs, because the pattern is not free:

- **text selection** — the overlay sits above the content
- anything else interactive must be lifted above it (`zIndex`), or it is dead
- right-click "open in new tab" doesn't work → use `<a href>` if the card
  _navigates_

### 2. `aria-allowed-attr` (critical) — the most instructive of the four

```tsx
<Box role="list" aria-rowcount={items.length}>   // VirtualList
```

`aria-rowcount` belongs to the grid/table family. On `role="list"` it is invalid
and assistive tech discards it.

So the attribute that existed to fix virtualization's central accessibility
problem — a list that claims 20 items when it has 10,000 — **was doing nothing.**
The code typechecked (React accepts any `aria-*`), linted, rendered, and reviewed
well, because the comment beside it described a real problem correctly.

`aria-setsize` on each row was already carrying the true size, which is why
removing it changed no behaviour — only the false impression that a second
mechanism was helping.

> This is the honest answer to _"what does automated accessibility testing
> actually buy you?"_ Not the missing alt text you'd have caught anyway — the
> ARIA that is well-intentioned, plausible and invalid.

### 3 & 4. `LoadingState`, both variants

- **Spinner:** MUI's `CircularProgress` renders `role="progressbar"` with no
  accessible name. Fixed with `aria-hidden`, **not** a label — the spinner is a
  decorative animation whose meaning is already in the adjacent status text.
  Labelling it would pass the rule and announce everything twice. _Passing a rule
  and improving the experience are not automatically the same action._
- **Skeleton:** `aria-label` on a `<Stack>` — a `<div>` with the generic role,
  where `aria-label` is **prohibited**. A name with no role has nothing to attach
  to, so it was silently ignored. Fixed with `role="status"`.

> **Invalid ARIA is worse than no ARIA.** No ARIA falls back to native
> behaviour; invalid ARIA reads as done.

---

## What axe could not find — and it was the worst of it

axe reported **zero** violations on the app shell. Two Level-A failures lived
there.

### No way to bypass the chrome (WCAG 2.4.1)

Header, three nav links, notification bell, session menu, theme toggle — a
keyboard user traversed all of it before reaching content, on every page.

**Why axe passed it:** the `bypass` rule is satisfied by _any_ of a skip link, a
landmark, or a heading — and the layout has `<main>` and an `<h1>`. The rule
checks that bypassing is possible for someone navigating by _landmark_. It cannot
check that it is possible for a **sighted keyboard user**, who has only Tab.

### Navigation was completely silent — the canonical SPA failure

A real page load moves focus to the top of the new document and the screen reader
begins reading. `history.pushState` does **none of that**. React swaps the
subtree, the URL changes, the visible page is entirely different — and for a
screen reader user, _nothing happened_. Focus is still on the link they
activated, which may no longer exist.

Every framework has this. It is why "we use a router" is not an accessibility
answer: the router gives you `pushState`; restoring what a browser navigation did
for free is your job.

Fixed with both halves — focus moved to `<main>`, **and** the page name announced
in a polite live region. Focus tells the user _where_ they are; the announcement
tells them _that_ they moved.

Three details that make it work rather than merely exist:

- **`tabIndex={-1}` on `<main>`.** Without it `.focus()` is a no-op and the skip
  link moves scroll but not focus — so the next Tab goes back to the nav. This is
  the tell that someone has actually implemented this before.
- **Keyed on `location.pathname`, not `location`.** `location` is a new object on
  every search-param change, so a URL-synced filter box would have focus ripped
  out of it on every keystroke.
- **Skipped on first render** (a ref, not state). On initial load the browser has
  already done the right thing; stealing focus _interrupts_ it.

---

## The bit where I was wrong

A comment in `TaskCard.test.tsx` claimed:

> _VERIFIED LOAD-BEARING: removing `zIndex: 2` makes this fail._

**It was false.** Deleting the z-index, the test still passed.

**jsdom implements no layout and no hit-testing.** Every element has zero size at
0,0 and there is no such thing as "on top", so `user.click(button)` dispatches
directly on that element whatever visually covers it.

That gives the test suite a _shape_ of blindness, not just gaps:

| jsdom cannot see                                | jsdom sees fine                      |
| ----------------------------------------------- | ------------------------------------ |
| z-order, occlusion, clipping, scroll position   | the DOM tree and ARIA attributes     |
| whether a focus ring is visible                 | `document.activeElement`, tab order  |
| anything decided by CSS layout                  | text content of a live region        |

Focus is _not_ layout, which is why the skip-link and route-announcer tests are
honest while the z-index one was not.

The corrected comment says what it actually covers, and the real guard —
Playwright's actionability check, which fails on an obscured element — is on the
roadmap.

**And once in the other direction.** A mutation that moved the skip link "below
the AppBar" did _not_ fail its test. The temptation is to call the test vacuous.
It wasn't: everything before that point is non-focusable, so the link was still
the first thing Tab reached — which is the correct property to assert. _When a
mutation doesn't break a test, check whether the test is vacuous **or** the
mutation failed to create the bug._

---

## Verified

```
axe            11 component checks, WCAG 2.0/2.1 A + AA — 4 violations found, 4 fixed
layout a11y     6 checks (skip link, focus, announcement, landmarks)
mutations       5/5 reinjected bugs caught; 1 false claim found and corrected
frontend      170 tests · lint + typecheck clean
backend       180 unit · 90 e2e · build + lint clean
container     healthy, failingStreak 0 (was unhealthy, streak 11)
login         401×10 then 429 · health probe unlimited · normal routes unlimited
```

**Still not done, and not claimed:** no screen reader has been used, no keyboard
walkthrough on a real browser, contrast unverified (jsdom has no layout, so the
`color-contrast` rule is disabled). Automated tooling finds roughly a third of
real accessibility problems. This raises the floor; it is not a certificate.

---

## Interview questions

1. **You configure two named throttlers. Which routes does each apply to?**
   Both, to all routes. The array is not a menu. This is the outage above.
2. **Should a health endpoint be rate-limited?** No — and the reason is the
   feedback loop: throttled probe → restart → less capacity → sooner throttling.
3. **Why not lock an account after N failed logins?** Denial of service. Anyone
   who knows your email locks you out. Limit requests, not accounts.
4. **What does per-IP rate limiting not stop?** Distributed credential stuffing.
   Say so rather than implying the endpoint is safe.
5. **How do you make a whole card clickable?** Name all three options —
   `onClick` on a div (broken), hand-rolled ARIA (valid until the card contains
   controls), overlay button (what you use when it does) — and say what the
   overlay costs.
6. **What's hard about accessibility in an SPA?** Navigation is silent: no focus
   move, no announcement. Mention `tabIndex={-1}`.
7. **Why is invalid ARIA worse than none?** No ARIA falls back to native
   behaviour. Invalid ARIA is discarded but reads as done.
8. **"We run axe in CI, so we're accessible" — respond.** ~1/3 coverage, and it
   found nothing in the shell where the two Level-A failures were.
9. **What can a jsdom test never catch?** Anything decided by layout. Know which
   of your tests cannot fail.
10. **Why is `location.pathname` the effect dependency, not `location`?**
    Reference equality — a new object per search-param change would steal focus
    on every keystroke in a URL-synced input.

---

## Exercises

1. Re-add `{ name: 'auth', ... }` to the throttlers array, rebuild, and send 12
   requests to `/health/live`. Watch the container go unhealthy.
2. Remove `@SkipThrottle()` from the health controller and wait five minutes.
3. Restore `role="button"` to the `CardContent` in `TaskCard` and run the a11y
   suite. Four tests fail; predict which before running.
4. Put `aria-rowcount` back on the `VirtualList` container. Note that typecheck
   and lint stay green.
5. Delete `tabIndex={-1}` from `<main>` and try the skip link in a real browser.
   The page jumps; the next Tab goes back to the nav.
6. Change the announcer's dependency from `location.pathname` to `location`, then
   type in a URL-synced filter box.
7. Give the spinner `aria-label="Loading"` instead of `aria-hidden`, and listen
   to it with a screen reader. axe passes either way.

---

## Quiz

1. You configure two named throttlers in `@nestjs/throttler`. Which routes does
   each apply to?
2. Why must a liveness probe never be rate-limited?
3. Why is invalid ARIA worse than no ARIA?
4. Which ARIA attribute conveys the true size of a virtualized **list**?
5. axe passed the app shell. What two Level-A failures were in it?
6. Why does `<main>` need `tabIndex={-1}`?
7. Why is the route announcer keyed on `location.pathname` rather than
   `location`?
8. Name a case where passing an axe rule makes the experience worse.

<details>
<summary>Answers</summary>

1. **Both, to every route.** The array is not a menu to opt into — every entry is
   enforced everywhere. `@Throttle` *reconfigures* a named throttler;
   `@SkipThrottle` opts out. Getting this backwards capped the whole API at ten
   requests per fifteen minutes.
2. **The feedback loop.** Throttled probe → container marked unhealthy →
   restarted → less capacity → survivors throttled sooner → collapse under load
   it could otherwise serve.
3. No ARIA falls back to sensible **native behaviour**. Invalid ARIA is discarded
   but *reads as done* — it typechecks, lints, renders and reviews well.
4. **`aria-setsize`** with `aria-posinset` on each row. **Not** `aria-rowcount`,
   which is grid/table-family only.
5. **No skip link** (the `bypass` rule is satisfied by a landmark, so it passed)
   and **completely silent navigation**.
6. `<main>` is not focusable by default, so `.focus()` is a no-op and
   `href="#main-content"` moves scroll but **not focus** — the next Tab returns
   to the nav.
7. `location` is a **new object** on every search-param change, so a URL-synced
   filter box would have focus ripped out of it on every keystroke.
8. Labelling a decorative spinner to satisfy `aria-progressbar-name`, when the
   adjacent status text already says "Loading" — the user now hears it twice.

</details>

---

**Remaining:** the interview material (Parts 57–60) and the mock interview. See
[ROADMAP.md](../../ROADMAP.md).
