# Roadmap — what's done, what's left

Measured against the 28-phase build order in the original brief (Part 63), plus
the deliverables in Parts 55–61.

**28 of 28 phases complete.** Everything in the original 28-phase build order and
Parts 55–61 has been delivered. What remains is listed under *known issues*.

---

## Complete

| #   | Phase                                    | Where                                                               |
| --- | ---------------------------------------- | ------------------------------------------------------------------- |
| 1   | React + TypeScript + Vite + architecture | [doc](reactfrontend/docs/phase-01-setup-and-architecture.md)        |
| 2   | Components, JSX, props, state            | [doc](reactfrontend/docs/phase-02-components-jsx-props-state.md)    |
| 3   | Hooks                                    | [doc](reactfrontend/docs/phase-03-hooks.md)                         |
| 4   | Rendering + reconciliation               | [doc](reactfrontend/docs/phase-04-rendering-reconciliation-keys.md) |
| 5   | React Router                             | [doc](reactfrontend/docs/phase-05-06-routing-and-forms.md)          |
| 6   | Forms + RHF + Zod                        | ↑ same                                                              |
| 7   | NestJS API integration                   | [doc](reactfrontend/docs/phase-07-api-integration.md)               |
| 8   | Redux Toolkit                            | [doc](reactfrontend/docs/phase-08-09-redux-and-rtk-query.md)        |
| 9   | RTK Query                                | ↑ same                                                              |
| 10  | Authentication                           | [doc](reactfrontend/docs/phase-07-api-integration.md)               |
| 11  | Authorization / RBAC                     | [doc](reactfrontend/docs/phase-10-11-authorization-rbac.md)         |
| 12  | Users / Projects / Tasks                 | [doc](reactfrontend/docs/phase-12-projects-and-data-table.md)       |
| 13  | Reusable component architecture          | ↑ same (DataTable, badges, feedback, forms)                         |
| 14  | Custom hooks                             | [doc](reactfrontend/docs/phase-03-hooks.md)                         |
| 15  | SSE notifications                        | [doc](reactfrontend/docs/phase-15-sse-notifications.md)             |
| 16  | Performance                              | [doc](reactfrontend/docs/phase-16-35-performance-and-splitting.md)  |
| 17  | Testing                                  | [doc](reactfrontend/docs/phase-44-45-testing-and-msw.md)            |
| 18  | Security consolidation                   | [doc](reactfrontend/docs/phase-18-19-security-and-accessibility.md) |
| 19  | Accessibility consolidation              | ↑ same                                                              |
| 20  | Docker                                   | [doc](reactfrontend/docs/phase-20-22-docker-nginx-ci.md)            |
| 21  | CI/CD                                    | ↑ same                                                              |
| 22  | Production architecture                  | ↑ same                                                              |
| 23  | React internals                          | folded into phase 4                                                 |
| 28  | Mock interview                           | [MOCK-INTERVIEW.md](MOCK-INTERVIEW.md)                              |
| 35  | Code splitting                           | folded into phase 16                                                |

---

## Remaining — engineering

### ~~20–22. Docker, CI/CD, production architecture~~ — **DONE**

[phase-20-22](reactfrontend/docs/phase-20-22-docker-nginx-ci.md).

- **`reactfrontend/Dockerfile`** — multi-stage, 89 MB, no Node in the runtime
  image, nginx running non-root on 8080.
- **`nginx.conf`** — the SPA fallback (`try_files`, flagged in phase 4 and
  outstanding until now), the two-rule cache contract, gzip, security headers,
  and an SSE block with `proxy_buffering off`.
- **`docker-compose.yml`** — a `web` service under the `app` profile; the whole
  stack runs containerised.
- **CI** — 5 jobs. Backend and frontend run in parallel, plus a
  **contract-drift** job that boots the API, regenerates the types and fails on a
  non-empty diff, and a **bundle budget** (245 kB against a 260 kB ceiling).

Four real bugs found by *running* it rather than reading it: `stats.html` served
in production, a `sed` that silently did nothing, nginx dropping every security
header, and `api:types` overwriting the checked-in contract with a 404 body.

The contract-drift job immediately caught genuine drift — a 35th path
(`DELETE /tasks/{id}/comments/{commentId}`) added during the comment-moderation
fix and never regenerated.

### ~~18–19. Security and accessibility~~ — **DONE**

[phase-18-19](reactfrontend/docs/phase-18-19-security-and-accessibility.md).

The prediction here was that an honest pass _"would find gaps"_. It found
**seven real defects**:

- **A global throttler capped the entire API at 10 requests / 15 minutes.** In
  `@nestjs/throttler` v5+ every named throttler in the array applies to every
  route — the array is not a menu to opt into. `@Throttle` appeared nowhere in
  the codebase except inside the comment claiming it was used.
- **The container was rate-limiting its own liveness probe** and had been sitting
  at `unhealthy`, failing streak 11, unexplained. In an orchestrator that is a
  crash loop that gets worse under load.
- **Four axe violations**, of which the sharpest was `aria-rowcount` on
  `role="list"` — invalid, discarded, and therefore doing nothing, while the
  comment beside it described the problem it was supposed to solve correctly.
- **No skip link and completely silent navigation** — both Level A, both in the
  app shell, where axe reported zero violations.

Also corrected one of my own **false "verified load-bearing" claims**: jsdom has
no layout, so no test can cover the overlay's z-index. Documented rather than
papered over.

---

## ~~Remaining~~ — written material, **DONE**

| Part  | Target                       | Delivered                                                          |
| ----- | ---------------------------- | ------------------------------------------------------------------ |
| 57    | 120+ interview questions     | **130** — [INTERVIEW-QUESTIONS.md](INTERVIEW-QUESTIONS.md)          |
| 58    | 40 senior scenarios          | **40** — [SENIOR-SCENARIOS.md](SENIOR-SCENARIOS.md)                 |
| 59    | 50 coding exercises          | **50** — [CODING-EXERCISES.md](CODING-EXERCISES.md)                 |
| 60    | 20 architecture questions    | **20** — [ARCHITECTURE-QUESTIONS.md](ARCHITECTURE-QUESTIONS.md)     |
| 28    | Mock interview               | 5 rounds — [MOCK-INTERVIEW.md](MOCK-INTERVIEW.md)                   |
| 53–54 | Angular↔React, positioning   | [POSITIONING.md](POSITIONING.md)                                    |

**The Part 59 distinction was kept.** The 66 exercises inside the phase docs are
_"delete the cleanup and watch the race condition"_ — excellent for understanding
this codebase, useless as whiteboard practice. `CODING-EXERCISES.md` is the other
kind: 50 problems that start from an empty file. Both exist now, and they are not
the same thing.

**What makes these usable rather than generic:** 28 of the 130 questions and most
of the scenarios are marked ★, meaning this project has a specific story for them
— a bug, a measurement, a trade-off with a number attached. Generic answers are
free; the ★ ones are the reason to have built the thing.

**On positioning:** `POSITIONING.md` refuses to inflate React years, on the
grounds that inflation doesn't survive the follow-up question. It documents the
gaps (no SSR shipped, no large-team React, no screen-reader testing) as things to
volunteer rather than hide.

---

## The completeness audit — four gaps found and closed

A pass over the original brief's Part 61 checklist, checking the **code** rather
than the documentation, found four specified features that were never built. All
four are now implemented, tested and verified against the live API.

| Gap | What was actually there |
| --- | --- |
| **Task detail `/tasks/:taskId`** | `paths.taskDetail` declared since Phase 5, **referenced nowhere**. No route, so it fell through to `path: '*'` and rendered a plausible 404. `TaskCard.onSelect` — with its keyboard handler and its own tests — had never been passed by any caller. |
| **Comments** | Backend had three endpoints. Frontend had **zero** — no slice, no UI. |
| **Activity log** | Backend had `/activity-logs`. Frontend had only the string `'activity-logs:read'` in `permissions.ts`, with a passing unit test asserting only admins hold it — a correctly-guarded route to a page that did not exist. |
| **Modals** | `components/modals/` was an **empty directory** and there was no `Dialog` anywhere in the app. Part 39's compound `<Modal.Header/>` did not exist. |

### The pattern worth naming

All three of the "declared but not wired" cases — plus the never-applied
`@Throttle` from Phase 18–19 — are the same thing:

> **A declaration that reads as an implementation.**

Each was individually valid, so nothing could see it. The constant typechecks.
The capability has a passing test. The decorator is imported. The catch-all route
turns the failure into a legitimate-looking page rather than an error.

The defence is a test that asserts the **connection** rather than either end of
it. [`router.test.tsx`](reactfrontend/src/app/router.test.tsx) now checks that
every entry in `paths` resolves to something other than the 404 — and it found a
**second** dead constant on its first run (`paths.admin`, so bare `/admin` 404'd
for a section that exists).

### The activity log recorded every event as `"unknown"`

Found by building the UI and looking at real data: all 25 records in the
development database had `event: "unknown"`. The audit trail captured who, when,
and the payload — and never **what happened**.

The listener used `@OnEvent('**')` with a handler signature of
`(payload, eventName?: string)`, and a comment asserting Nest passes the matched
name as that second parameter. **It does not** — the decorator passes the emitted
values only. A `?? 'unknown'` fallback then turned the missing value into
plausible data.

```
it typechecked   `eventName?: string` is legal whether or not anything passes it
it never threw   the ?? fallback supplied a value
it looked fine   rows appeared, with correct actors, subjects and timestamps
the comment      described the mechanism confidently and wrongly
```

Fixed with `EventEmitter2.onAny`, which delivers the name as its **first**
argument by design (and as an array of segments under `wildcard: true`, so it
needs re-joining). The `'unknown'` fallback is gone — a missing name now refuses
to write and logs.

> **A default value standing in for something you failed to read is a disabled
> bug detector.** Same instinct as `catch {}`.

Verified against the running stack: a registration now records
`event: 'user.registered'`. Six new tests in
[`activity-log.listener.spec.ts`](nestbackend/src/activity-logs/activity-log.listener.spec.ts)
— the listener previously had **none**, which is why it survived. Four of the six
fail if the event name becomes unavailable again.

**The test has to include the real `EventEmitter2`.** Calling `record()` directly
with a name passes against the broken version, because the bug was never in
`record` — it was in how the name was obtained. When a defect lives in the wiring
between a framework and your code, only a test containing the framework can see
it.

### "Do all the pages work?" — now answerable

They do, and until [`routes.smoke.test.tsx`](reactfrontend/src/app/routes.smoke.test.tsx)
existed, nothing in this project could show it.

The evidence that looked like proof — every route returning **200** through
nginx — proved only that the SPA fallback served `index.html`.
`/total-nonsense` returns 200 too. **No page had ever been rendered.**

The smoke test mounts all **15 routes** through the real route table with MSW
answering, and asserts three things per route: the page's own heading renders,
data-driven pages show real data, and **no `console.error` occurs** — which is
how React reports invalid nesting, key warnings, and an error boundary catching
a crash while rendering a fallback that otherwise looks like success.

`onUnhandledRequest: 'error'` is the sharpest part. With `'bypass'`, a page
calling an unmocked endpoint would render its error state and pass a
"did it render" assertion. With `'error'` it fails and names the URL — which is
how `/health/live` was found (version-neutral, outside `/api/v1`).

**What it does not prove:** that any page is *usable*. No layout, no real
backend, no interaction past first paint. It is a floor.

### And a backend inconsistency the integration surfaced

Verified against the running API: `POST /tasks/:id/comments` returns
`"author": null` while `GET` returns the populated author. Both are declared
`CommentView`. The cause is in `comments.repository.ts` — `list()` calls
`.populate()`, `create()` does not.

**Nothing in either codebase could have caught it.** TypeScript believed the two
responses were identical because the backend said so, and the OpenAPI document
carries no response schemas to contradict it. It took calling both endpoints and
diffing the JSON.

It does not affect the app, because the mutation invalidates rather than writing
its response into the cache — but an "obvious" optimisation to an optimistic
insert would render every new comment as "Unknown user". There is a regression
test pinning that, verified by making the change and watching it fail.

---

## Known issues, deliberately open

Carried forward from earlier phases rather than quietly dropped:

1. **Bundle is 245 kB gzip eager**, of which MUI is ~210 kB. Splitting made cold
   load _worse_ (measured); the win was cache stability. Only a library change
   moves the number.
2. **Comment moderation by project managers** works via the nested route, but the
   deprecated `DELETE /comments/:id` still enforces the narrower author-or-admin
   rule. Deprecate → migrate → delete.
3. **The backend test harness diverged from `main.ts`** (global prefix `exclude`).
   Fixed in one spec; the durable fix is a shared `configureApp(app)` called by
   both, which touches every integration spec.
4. ~~**Backend has no rate-limit audit.**~~ **Done in Phase 18–19** — and it was
   the most serious finding in the project. See above.

   What remains open is narrower and worth stating: per-IP limits do not stop
   **distributed** credential stuffing, and there is no breached-password check
   and no MFA. Rate limiting raises the cost of an attack; it does not prevent
   it.
5. **Missing joins: ids shown where names belong** — in two places now. Project
   member lists, and the activity log's `actorId` column. Both need the backend
   to populate the reference; showing a partially-resolved name column would be
   worse than showing the id honestly.
6. **No real-browser E2E.** Playwright against a running stack is the missing
   layer above the current three — and Phase 18–19 gave it a concrete first job.
   jsdom cannot test the `TaskCard` overlay's z-index, because jsdom has no
   layout and no hit-testing. Playwright's actionability check fails on an
   obscured element, which is exactly that assertion.

7. **Accessibility has not been checked with a screen reader or a real
   keyboard.** axe covers roughly a third of real problems, and `color-contrast`
   is disabled under jsdom because there is no layout engine to compute colours.
8. **No real-device performance testing.** Every number is a desktop build
   measurement.
9. **`POST /tasks/:id/comments` does not populate `author`** while `GET` does,
   though both are typed `CommentView`. Fix at the source: add `.populate()` to
   `create()` in `comments.repository.ts`.
10. **`listComments` takes the wrong DTO** — `@Query() query: ListTasksQuery`,
    so the published contract advertises `status`, `priority` and `overdue`
    filters on a comments endpoint, where they mean nothing. Harmless, and still
    a contract that lies.
11. **Seven of nine declared domain events are never emitted.** `DomainEvent`
    declares `COMMENT_ADDED`, `PROJECT_ARCHIVED`, `PROJECT_MEMBER_ADDED`,
    `TASK_CREATED`, `TASK_DELETED`, `TASK_STATUS_CHANGED` and `TASK_ASSIGNED` —
    and only `USER_REGISTERED` and `USER_DELETION_REQUESTED` have an `emit` call
    anywhere in application code.

    So the "activity log" is, in practice, a registration log. Every event type
    has a fully-defined payload interface and no producer.

    **The fifth instance of the same pattern** — a declaration that reads as an
    implementation. The others: `paths.taskDetail`, `paths.admin`, the
    `activity-logs:read` capability, and the never-applied `@Throttle`. Each was
    individually valid and invisible to the toolchain.

    The fix is one `this.events.emit(...)` per state change in the relevant
    service. The durable fix is a test asserting every `DomainEvent` value has a
    producer — the backend equivalent of `router.test.tsx`.

12. **One unreproduced flaky frontend test.** A single full-suite run reported
    `1 failed | 206 passed`; three subsequent full runs and five runs of the
    most-suspected file all passed, and the summary output did not name the test.

    Recorded rather than dismissed, because "it passed on rerun" is how a suite
    stops being trusted — and a flake usually reports a real race. The likely
    candidates are the `waitFor`-based assertions added with the comments flow.
    The fix is to capture it: run the suite with `--reporter=verbose` in CI so a
    failure names the test, and re-run in a loop rather than once.

---

## Suggested order

1. ~~Docker + nginx + CI~~ — done
2. ~~Consolidated security + accessibility pass~~ — done, and it found seven
   real defects including a whole-API outage
3. **Interview material** — questions, scenarios, standalone exercises, mock
4. **Playwright E2E** — now unblocked: there is a container to run it against
