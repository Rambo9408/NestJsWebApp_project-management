# Frontend audit

> The companion to the backend's
> [`authorization-audit.md`](../../nestbackend/docs/authorization-audit.md) and
> [`security-fix-collection-authorization.md`](../../nestbackend/docs/security-fix-collection-authorization.md).
>
> Every defect found in this codebase, **how it was found**, and — the part
> worth more than the fixes — **why nothing else caught it**.

---

## Table of contents

1. [Why this document exists](#1-why-this-document-exists)
2. [The pattern: declarations that read as implementations](#2-the-pattern-declarations-that-read-as-implementations)
3. [Accessibility findings](#3-accessibility-findings)
4. [The findings automation could not make](#4-the-findings-automation-could-not-make)
5. [Completeness findings](#5-completeness-findings)
6. [Contract findings](#6-contract-findings)
7. [Things I asserted and got wrong](#7-things-i-asserted-and-got-wrong)
8. [What each method actually caught](#8-what-each-method-actually-caught)
9. [Still open](#9-still-open)
10. [Interview questions](#10-interview-questions)
11. [Quiz](#11-quiz)

---

## 1. Why this document exists

The backend's audits are about **authorization** — a category with a clear
threat model. This side has no equivalent single category, because the frontend
is not a security boundary. What it has instead is a collection of defects that
share one property:

**Every single one passed typecheck, lint and the test suite.**

None was found by reading code. Each was found by running something, looking at
real output, or pointing a tool at the thing. That is the argument the document
is really making.

---

## 2. The pattern: declarations that read as implementations

Five defects turned out to be the same shape, and noticing that was worth more
than any individual fix.

> **A declaration that is individually valid, wired to nothing, and indexed by
> nothing.**

| # | The declaration | What it was wired to |
| --- | --- | --- |
| 1 | `@Throttle` named throttler `auth` | nothing — the name appeared only inside a comment claiming it was used |
| 2 | `paths.taskDetail` | no route. Fell through to `path: '*'` and rendered a plausible 404 |
| 3 | `paths.admin` | same, found by the test written for #2 |
| 4 | capability `'activity-logs:read'` | a page that did not exist — with a passing unit test asserting only admins hold it |
| 5 | 7 of 9 `DomainEvent` values | no `emit` call anywhere |

**Why nothing catches this class.** Each half is legal on its own. A string
constant typechecks. A capability with a test is *more* convincing than one
without. An imported decorator satisfies the linter. And in #2 and #3 the
catch-all route converts the failure into a **legitimate-looking page** rather
than an error — there is no red anything.

**The only defence is a test that asserts the connection.**
[`router.test.tsx`](../src/app/router.test.tsx) checks that every entry in
`paths` resolves to something other than the 404, and it found #3 on its first
run. The backend equivalent — asserting every `DomainEvent` has a producer —
does not exist yet and is in the roadmap.

---

## 3. Accessibility findings

`axe-core` against every user-facing component, WCAG 2.0/2.1 A and AA.
See [phase-18-19](phase-18-19-security-and-accessibility.md) for the full
treatment.

| Rule | Impact | Where | The actual consequence |
| --- | --- | --- | --- |
| `nested-interactive` | serious | `TaskCard` | The overflow menu was announced but **unreachable**. Enter fired the outer handler, so the feature did not exist for keyboard and screen-reader users — while working perfectly with a mouse. |
| `aria-allowed-attr` | critical | `VirtualList` | `aria-rowcount` on `role="list"` is invalid and discarded. The attribute that existed to fix virtualization's central a11y problem **was doing nothing.** |
| `aria-progressbar-name` | serious | `LoadingState` | A nameless progressbar announces "progress bar" and nothing else. |
| `aria-prohibited-attr` | serious | `LoadingState` | `aria-label` on a roleless `<div>` is prohibited — a name with no role has nothing to attach to, so it was silently ignored. |
| *(no rule)* | serious | `Modal` | MUI's low-level `<Modal>` assigns **no** `role`; only `<Dialog>` does. The dialog announced as an unnamed generic group. Caught by a `getByRole('dialog')` assertion, not by axe. |

### The most instructive one

`aria-rowcount` deserves singling out. It **typechecked** (React accepts any
`aria-*`), it **linted**, it **rendered**, and the comment beside it described
the real problem correctly:

> *"A virtualized list lies to assistive tech by default — it says '20 items'
> when there are 10,000."*

All true. The fix underneath it was inert. `aria-setsize` on each row was
already carrying the real work, which is why removing the invalid attribute
changed no behaviour at all — only the false impression that a second mechanism
was helping.

> **Invalid ARIA is worse than no ARIA.** No ARIA falls back to sensible native
> behaviour. Invalid ARIA is discarded but *reads as done*.

### And one where passing the rule made it worse

A nameless spinner fails `aria-progressbar-name`. Adding
`aria-label="Loading..."` passes — and now the user hears it **twice**, because
the adjacent status text says the same thing. `aria-hidden` on the decorative
animation also passes and is better.

**Passing a rule and improving the experience are not automatically the same
action.** Choosing between them is the judgement automation cannot make.

---

## 4. The findings automation could not make

axe reported **zero** violations on the application shell. Two Level-A failures
lived there.

### No way to bypass the chrome (WCAG 2.4.1)

Header, three nav links, notification bell, session menu, theme toggle — a
keyboard user traversed all of it before reaching content, on every page.

**Why axe passed it:** the `bypass` rule is satisfied by *any* of a skip link, a
landmark, or a heading — and this layout has `<main>` and an `<h1>`. The rule
checks that bypassing is possible for someone navigating by **landmark**. It
cannot check whether it is possible for a **sighted keyboard user**, who has
only Tab.

### Navigation was completely silent

The canonical single-page-application failure, and invisible to every automated
tool ever written.

A real page load moves focus to the top of the new document and the screen
reader begins reading. `history.pushState` does **none of that**. React swaps the
subtree, the URL changes, the visible page is entirely different — and for a
screen-reader user, *nothing happened*. Focus is still on the link they
activated, which may no longer exist.

**The fix needs both halves:** focus moved to `<main>`, **and** the page name
announced in a live region. Focus tells the user *where* they are; the
announcement tells them *that* they moved.

Three details make it work rather than merely exist:

- **`tabIndex={-1}` on `<main>`.** Without it `.focus()` is a no-op and the skip
  link moves scroll but not focus, so the next Tab returns to the nav. This is
  the tell that someone has implemented this before.
- **Keyed on `location.pathname`, not `location`.** `location` is a new object
  on every search-param change, so a URL-synced filter box would have focus
  ripped out of it on every keystroke.
- **Skipped on first render** (a ref, not state). On initial load the browser
  has already done the right thing; stealing focus *interrupts* it.

---

## 5. Completeness findings

An audit against the original brief's feature checklist, reading **code** rather
than documentation, found four specified features that were never built.

| Gap | What was actually there |
| --- | --- |
| Task detail `/tasks/:taskId` | A dead route constant (§2). `TaskCard.onSelect` — with a keyboard handler and its own tests — had never been passed by any caller. |
| Comments | Backend had three endpoints. Frontend had **zero** — no slice, no UI. |
| Activity log | Backend had `/activity-logs`. Frontend had only the capability string. |
| Modals | `components/modals/` was an **empty directory**; no `Dialog` anywhere in the app. |

**These were connected, not four independent omissions.** The task detail page is
where comments live; create/edit flows are where modals live. It was one missing
slice of the application.

**The most interesting part:** `TaskCard`'s interactive branch was dead code
reachable only by its own unit test. Two halves of one feature, each
individually complete and individually tested, never connected to each other —
which is precisely the gap the "flow" test layer exists to catch and precisely
why testing each half in isolation could not.

---

## 6. Contract findings

### `POST` and `GET` return different shapes under one type

Verified against the running API:

```
POST /tasks/:id/comments  ->  "author": null
GET  /tasks/:id/comments  ->  "author": { "id": "...", "name": "ram" }
```

Both are declared `CommentView`. `list()` calls `.populate()`; `create()` does
not, so the shared mapper takes its null branch for a user who plainly exists.

**Nothing in either codebase could have caught this.** TypeScript believed the
two responses were identical because the backend said so, and the OpenAPI
document carries **no response schemas** to contradict it. It took calling both
endpoints and diffing the JSON.

It does not affect the app, because the mutation invalidates rather than caching
its own response — but the "obvious" optimisation to an optimistic insert would
render every new comment as "Unknown user". A regression test pins that,
verified by making the change and watching it fail.

### The comments list endpoint publishes filters that do nothing

`listComments` is declared `@Query() query: ListTasksQuery` — the **task** DTO.
So the generated contract advertises `status`, `priority` and `overdue` on a
comments endpoint.

Found by **reading the generated contract while writing the client**, not by
reading the controller. Generated artefacts make copy-paste errors visible in a
way that source review does not.

### The audit trail recorded every event as `"unknown"`

All 25 records in the development database. The listener used `@OnEvent('**')`
with a `(payload, eventName?: string)` signature and a comment asserting Nest
passes the matched name as that second parameter. **It does not.** A
`?? 'unknown'` fallback turned the missing value into plausible data.

> **A default value standing in for something you failed to read is a disabled
> bug detector.** Same instinct as `catch {}`.

Found by building the UI, looking at real data, and noticing every row said the
same thing.

---

## 7. Things I asserted and got wrong

Kept deliberately, because a corrected claim is more useful than one that
happened to be right.

### "VERIFIED LOAD-BEARING: removing `zIndex: 2` makes this fail"

**False.** The test still passed with the z-index deleted.

**jsdom implements no layout and no hit-testing.** Every element has zero size at
0,0 and there is no such thing as "on top", so `user.click(el)` dispatches
directly on `el` whatever visually covers it.

That gives the suite a *shape* of blindness, not just gaps:

| jsdom cannot see | jsdom sees faithfully |
| --- | --- |
| z-order, occlusion, clipping | the DOM tree and ARIA attributes |
| whether a focus ring is visible | `document.activeElement`, tab order |
| anything decided by CSS layout | live region text content |

Focus is *not* layout, which is why the skip-link tests are honest while that
one was not. The real guard is Playwright's actionability check, which fails on
an obscured element.

### "Every route returns 200, so the pages work"

Also false, and a better example of the same error. Those `200`s came from
nginx's SPA fallback serving `index.html`. `/total-nonsense` returns 200 too.
**No page had ever been rendered.**

[`routes.smoke.test.tsx`](../src/app/routes.smoke.test.tsx) now mounts all 15
routes and asserts each page's own heading, its data, and that no
`console.error` occurs.

### And once in the other direction

A mutation that moved the skip link "below the AppBar" did **not** fail its test.
The tempting conclusion is that the test is vacuous. It was not — everything
before that point is non-focusable, so the link was still the first thing Tab
reached, which is the correct property to assert.

> When a mutation does not break a test, check whether the test is vacuous **or
> the mutation failed to create the bug.**

---

## 8. What each method actually caught

The summary worth remembering.

| Method | Found |
| --- | --- |
| **Typecheck / lint** | none of the above |
| **Unit tests** | none of the above |
| **axe** | 4 component violations — all real, all mechanical |
| **Querying by role in tests** | the Modal's missing `role="dialog"` |
| **Reading generated artefacts** | the wrong DTO on the comments endpoint |
| **Calling the live API and diffing** | the `author: null` inconsistency |
| **Looking at real data** | `event: "unknown"` across every record |
| **Writing a connection test** | two dead route constants |
| **Checking the brief against code** | four unbuilt features |
| **Reintroducing bugs** | two vacuous tests, one false claim |

**Not one was found by reading code.** Each was found by running the thing and
looking at what came out.

---

## 9. Still open

Listed rather than glossed. Full list in [ROADMAP.md](../../ROADMAP.md).

- **No real-browser E2E.** All three test layers run in jsdom. There are
  assertions in this repo that are *impossible* until Playwright runs.
- **No screen reader or keyboard walkthrough.** axe covers roughly a third of
  real problems, and `color-contrast` is disabled under jsdom entirely.
- **Seven of nine domain events are never emitted** — the activity log is in
  practice a registration log.
- **`POST` comment `author: null`** — fix belongs in the backend repository.
- **Missing joins** — activity log shows raw `actorId`; project members show ids.
- **One unreproduced flaky test.**

---

## 10. Interview questions

1. **"We run axe in CI, so we're accessible." Respond.** Roughly a third of real
   problems, and here it found nothing in the shell where both Level-A failures
   were.
2. **Why is invalid ARIA worse than none?** No ARIA falls back to native
   behaviour; invalid ARIA is discarded but reads as done.
3. **What's the canonical SPA accessibility failure?** Silent navigation. Name
   `tabIndex={-1}`.
4. **What can a jsdom test never catch?** Anything decided by layout. Knowing
   which of your tests *cannot fail* is the skill.
5. **How do you find a vacuous test?** Reintroduce the bug. If it stays green,
   check whether the test is empty or the mutation missed.
6. **A route constant exists with no route. What catches it?** Nothing standard —
   the catch-all makes it a plausible page. You need a test asserting the
   connection.
7. **Two endpoints share a response type and return different shapes. How would
   you find out?** Call both and diff. Types cannot help; they are downstream of
   the same wrong assumption.
8. **When does passing an accessibility rule make things worse?** Naming a
   decorative spinner that duplicates adjacent status text.
9. **What does a `?? 'unknown'` fallback cost you?** It converts a loud failure
   into 25 rows of plausible data.
10. **How do you verify a page works?** Render it and assert its own heading and
    data. A 200 from an SPA server proves the fallback works, nothing more.

---

## 11. Quiz

1. What HTTP status does an SPA server return for a route that does not exist in
   the app?
2. Which ARIA attribute conveys the true size of a virtualized **list**?
3. `role="dialog"` — does MUI's `<Modal>` set it?
4. Name the two halves of fixing silent SPA navigation.
5. Why must `<main>` carry `tabIndex={-1}`?
6. Can a jsdom test verify that a button is covered by an overlay?
7. What is the accessibility failure of `role="button"` on a card containing an
   overflow menu?
8. Why does `location` as an effect dependency break a URL-synced search box?
9. What did every activity log record contain before the fix?
10. Which is a stronger signal a test is good: coverage, or that it fails when
    you break the code?

<details>
<summary>Answers</summary>

1. **200** — the SPA fallback serves `index.html` for everything. It proves
   nothing about the page.
2. **`aria-setsize`** (with `aria-posinset`) on each row. **Not**
   `aria-rowcount`, which is grid/table-family only.
3. **No.** `<Modal>` is the low-level primitive — portal, focus trap, backdrop.
   Only `<Dialog>` assigns the role.
4. **Move focus to `<main>`**, and **announce the page name in a live region.**
5. `<main>` is not focusable by default, so `.focus()` and `href="#main"` would
   move scroll but not focus.
6. **No.** jsdom has no layout and no hit-testing.
7. `nested-interactive` — the inner control is announced but unreachable, and
   Enter fires the outer handler.
8. `location` is a **new object** on every search-param change, so the effect
   re-runs on every keystroke and steals focus.
9. **`event: "unknown"`** — all 25 of them.
10. **That it fails when you break the code.** Coverage is a floor, not a target.

</details>

---

**Related:** [phase-18-19](phase-18-19-security-and-accessibility.md) ·
[ROADMAP.md](../../ROADMAP.md) ·
[backend authorization audit](../../nestbackend/docs/authorization-audit.md)
