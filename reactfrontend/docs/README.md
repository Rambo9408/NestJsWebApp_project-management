# Frontend documentation

The index for `reactfrontend/docs/`. Start at
[`../README.md`](../README.md) if you want the reference guide instead — this
page is a map of the phase-by-phase material.

---

## Why phases are merged here

The backend has one document per phase. This side merges several, because some
phases of the original build order are two halves of one idea — routing and
forms are the same page, Redux and RTK Query are the same decision. Merging
where the material is genuinely continuous beats fourteen stubs.

The cost is that "which doc covers phase 14?" is not answerable from filenames,
so the table below maps **every** phase number to where it actually lives.

---

## Phase map

| Phase | Topic                                    | Document                                                                    |
| ----- | ---------------------------------------- | --------------------------------------------------------------------------- |
| 1     | React + TypeScript + Vite + architecture | [phase-01](phase-01-setup-and-architecture.md)                              |
| 2     | Components, JSX, props, state            | [phase-02](phase-02-components-jsx-props-state.md)                          |
| 3     | Hooks                                    | [phase-03](phase-03-hooks.md)                                               |
| 4     | Rendering + reconciliation               | [phase-04](phase-04-rendering-reconciliation-keys.md)                       |
| 5     | React Router                             | [phase-05-06](phase-05-06-routing-and-forms.md)                             |
| 6     | Forms + React Hook Form + Zod            | ↑ same                                                                       |
| 7     | NestJS API integration                   | [phase-07](phase-07-api-integration.md)                                     |
| 8     | Redux Toolkit                            | [phase-08-09](phase-08-09-redux-and-rtk-query.md)                           |
| 9     | RTK Query                                | ↑ same                                                                       |
| 10    | Authentication                           | [phase-07](phase-07-api-integration.md) — tokens, refresh, single-flight    |
| 11    | Authorization / RBAC                     | [phase-10-11](phase-10-11-authorization-rbac.md)                            |
| 12    | Users / Projects / Tasks                 | [phase-12](phase-12-projects-and-data-table.md)                             |
| 13    | Reusable component architecture          | ↑ same — DataTable, badges, feedback states                                  |
| 14    | Custom hooks                             | [phase-03](phase-03-hooks.md) — the second half                             |
| 15    | SSE notifications                        | [phase-15](phase-15-sse-notifications.md)                                   |
| 16    | Performance                              | [phase-16-35](phase-16-35-performance-and-splitting.md)                     |
| 17    | Testing                                  | [phase-44-45](phase-44-45-testing-and-msw.md)                               |
| 18    | Security                                 | [phase-18-19](phase-18-19-security-and-accessibility.md)                    |
| 19    | Accessibility                            | ↑ same                                                                       |
| 20    | Docker                                   | [phase-20-22](phase-20-22-docker-nginx-ci.md)                               |
| 21    | CI/CD                                    | ↑ same                                                                       |
| 22    | Production architecture                  | ↑ same                                                                       |
| 23    | React internals                          | [phase-04](phase-04-rendering-reconciliation-keys.md) — Fiber, render/commit |
| 24    | Senior architecture                      | [../../ARCHITECTURE-QUESTIONS.md](../../ARCHITECTURE-QUESTIONS.md)          |
| 25    | 120+ interview questions                 | [../../INTERVIEW-QUESTIONS.md](../../INTERVIEW-QUESTIONS.md) — 130          |
| 26    | 50 coding exercises                      | [../../CODING-EXERCISES.md](../../CODING-EXERCISES.md)                      |
| 27    | Senior scenarios                         | [../../SENIOR-SCENARIOS.md](../../SENIOR-SCENARIOS.md) — 40                 |
| 28    | Mock interview                           | [../../MOCK-INTERVIEW.md](../../MOCK-INTERVIEW.md)                          |
| 35    | Code splitting                           | [phase-16-35](phase-16-35-performance-and-splitting.md)                     |

---

## Companion documents

| Document                                            | What it is                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------- |
| [angular-vs-react.md](angular-vs-react.md)          | The translation layer. Every Angular concept, its React counterpart, and where the mapping breaks down. |
| [frontend-audit.md](frontend-audit.md)              | Every defect found in this codebase, how it was found, and why nothing else caught it. |
| [interview/](interview/)                            | Graded question sets: beginner → intermediate → advanced → architecture → scenarios. |

---

## Graded interview material

Sits in [`interview/`](interview/) and is ordered by **difficulty**, unlike the
root-level files which are ordered by **topic**. Both exist because they answer
different questions: "what should I revise next?" versus "what do I say about
hooks?".

| Level                                                       | For                                                       |
| ------------------------------------------------------------ | --------------------------------------------------------- |
| [01 — Beginner](interview/01-beginner.md)                   | Shaking off rust. Fundamentals you must not fumble.       |
| [02 — Intermediate](interview/02-intermediate.md)           | The working middle: hooks, state, routing, forms.         |
| [03 — Advanced](interview/03-advanced.md)                   | Rendering internals, performance, caching, auth.          |
| [04 — Senior architecture](interview/04-senior-architecture.md) | Decisions, trade-offs, and what you would change.     |
| [05 — Scenarios](interview/05-scenarios.md)                 | "Here is a broken situation. What do you do?"             |

---

## How to read a phase document

Each follows the same shape:

1. **What the phase is about**, and why it matters at interview level
2. **The Angular bridge** — what transfers and what does not
3. **The code**, with the reasoning in the comments rather than around them
4. **Trade-offs**, including the ones where the measured answer was unflattering
5. **Interview questions**
6. **Exercises** — modify *this* codebase and observe the result
7. **Quiz** — short recall check

> **On the exercises.** They are deliberately "delete this line and watch what
> breaks", not standalone challenges. Both kinds matter and they are different
> skills; the standalone set is
> [CODING-EXERCISES.md](../../CODING-EXERCISES.md).

---

## The convention that runs through all of it

Where something was **measured**, the number is here — including when the result
was bad. Code splitting made cold load *worse* (213 → 245 kB gzip) and the
document says so, because a trade-off you cannot state honestly is one you do
not understand.

Where a claim turned out to be **false**, the correction sits next to the
original rather than replacing it. There is at least one comment in this
codebase that says "I asserted this, checked it, and was wrong."
