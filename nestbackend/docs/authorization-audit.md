# Authorization audit — every endpoint

> Systematic sweep prompted by the collection-scoping bug found in Phase 7.
> **It found something worse than the thing that prompted it.**

---

## Method

Enumerate every route and its decorators, classify by resource, then **test
empirically** with two unrelated users rather than reasoning from the code.

```
Alice   owns a project, a task, and a comment
Mallory authenticated, zero projects, no relationship to Alice
```

Every request made **as Mallory**, against Alice's real resource ids.

Reading the code alone would have missed this. The routes *look* fine — they're
short, they read naturally, and the guard decorators that exist are correct. The
problem is the ones that aren't there, and absence is exactly what code review is
worst at spotting.

---

## Results — before

```
REQUEST (as mallory)                     CODE   VERDICT
GET    /tasks                            0      OK (empty)      ← fixed in Phase 7
GET    /projects                         0      OK (empty)      ← fixed in Phase 7
GET    /notifications                    0      OK (empty)
GET    /users                            403    OK (admin-only)
GET    /activity-logs                    403    OK (admin-only)
GET    /projects/:id                     404    OK (denied)
GET    /tasks/:id                        200    *** LEAK ***
GET    /tasks/:id/comments               200    *** LEAK ***
GET    /tasks/stats?projectId=           200    *** LEAK ***
PATCH  /tasks/:id                        200    *** LEAK ***
PATCH  /tasks/:id/status                 200    *** LEAK ***
PATCH  /tasks/:id/assignee               409    *** LEAK ***
DELETE /comments/:id                     204    *** LEAK ***
DELETE /tasks/:id                        200    *** LEAK ***

--- did alice's data survive? ---
  task title : undefined      ← DELETED
  comments   : undefined      ← DELETED
```

**Mallory read, renamed, reassigned and destroyed Alice's task, and deleted her
comment.** Eight endpoints, no relationship to the data, no error.

This is **strictly worse than the collection leak** that prompted the audit: that
one was a read. This is destructive write access.

---

## Why it survived

`POST /tasks` **was** guarded. `/tasks/:id` was not. The difference:

```
POST  /tasks         body carries projectId  → ProjectAccessGuard can check it
PATCH /tasks/:id     param carries a TASK id → nothing to check against
```

**A task does not hold membership — its project does.** Nobody wrote the guard
that follows that indirection, and no test asked for it.

### The general lesson

> **Object-level authorization has to follow the ownership chain, and the chain
> is different for every resource.**

```
task         → project → membership
comment      → task → project → membership   (or: author)
notification → user directly
project      → membership
```

One guard cannot serve them all. Pretending otherwise is precisely how routes end
up unguarded — the existing `ProjectAccessGuard` *felt* like the answer, so
nobody noticed that half the routes it should cover had no id it could use.

### Why `ProjectAccessGuard` couldn't just be reused

It resolves `params.projectId ?? params.id`. On `/tasks/:id` that `id` is a task
id, so it would look up a *project* by a *task* id, find nothing, and 404.

That would "work" in the sense of denying Mallory — **and deny Alice too**,
because the lookup fails for everyone. A guard that denies everybody is not
secure, it's broken.

---

## The fixes

### 1. `TaskAccessGuard` — new

Resolves `task → projectId → membership`, honouring the **same**
`@ProjectRoles()` metadata key as `ProjectAccessGuard` so the vocabulary is
shared. Applied to all eight `/tasks/:id*` routes.

Returns **404, not 403** — matching the existing guard. 403 confirms a resource
exists to someone who may not have it, letting an attacker map real ids.

### 2. `GET /tasks/stats` — `ProjectAccessGuard`

`projectId` is in the **query**, which that guard already reads. Left unguarded
it leaked that a project exists and how much work is in it.

### 3. `DELETE /comments/:id` — author-or-admin, in the service

The controller previously passed only an id. Now it passes the actor, and the
service checks authorship.

**Why not "project managers may moderate", which is reasonable?** It needs the
`comment → task → project` chain, and `CommentsModule` doesn't import
`ProjectsModule` or `TasksModule`. Adding them creates a **cycle** —
`TasksModule` already imports `CommentsModule` for the cascading-delete
transaction.

Breaking that properly means either a guard on a
`/tasks/:id/comments/:commentId` route in `TasksModule`, or an events-based
approach. Neither is a five-minute change, and author-or-admin closes the hole
completely for the case that matters.

**Flagged rather than hidden:** *"project managers cannot moderate comments"* is
a product decision this code now makes by omission. It should be a deliberate
one.

---

## Results — after

```
REQUEST (as mallory)                     CODE   VERDICT
GET    /tasks                            0      OK (empty)
GET    /projects                         0      OK (empty)
GET    /notifications                    0      OK (empty)
GET    /users                            403    OK (denied)
GET    /activity-logs                    403    OK (denied)
GET    /projects/:id                     404    OK (denied)
GET    /tasks/:id                        404    OK (denied)
GET    /tasks/:id/comments               404    OK (denied)
GET    /tasks/stats?projectId=           404    OK (denied)
PATCH  /tasks/:id                        404    OK (denied)
PATCH  /tasks/:id/status                 404    OK (denied)
PATCH  /tasks/:id/assignee               404    OK (denied)
DELETE /comments/:id                     404    OK (denied)
DELETE /tasks/:id                        404    OK (denied)

--- did alice's data survive? ---
  task title : Alice secret task | status: todo | assignee: null
  comments   : 1
```

### And the owner is not over-restricted

```
GET    /tasks/:id             200      PATCH  /tasks/:id           200
GET    /tasks/:id/comments    200      PATCH  /tasks/:id/status    200
GET    /tasks/stats           200      POST   /tasks/:id/comments  201
DELETE /comments/:id (own)    204      DELETE /tasks/:id           200
```

**This half matters as much as the other.** *"Deny everything"* is the classic
over-correction after a leak, and it would pass every negative test while
breaking the product.

---

## Regression tests

Ten new cases in `authorization.integration.spec.ts` (25 total in that file):

| Category | Cases |
|---|---|
| Outsider denied | read, read comments, stats, patch, status, delete |
| Non-author denied | comment delete — *by a legitimate project member* |
| **Data survived** | reads back as the owner, asserts untouched |
| **Not over-restricted** | member can read + edit; admin passes |

**The "data survived" test is the one that makes the suite mean something.** Every
other test checks a status code — and a status code proves the *response*, not
the *side effect*. A route could 404 the caller and still have written first.

### Proof they work

```
guards removed →  Tests: 9 failed, 16 passed, 25 total
```

A test that has never been seen to fail is not yet a test.

---

## Verified

```
Lint clean · Typecheck clean
Unit  90/90
E2E   82/82   (was 72 → 67 before this work; +15 across both fixes)
Frontend 84/84 unaffected

Bug reinjection: 9 regression tests correctly fail
```

---

## What is still open

1. **`PATCH /tasks/:id/assignee` returned 409, not 404, before the fix.** It's
   guarded now, but that 409 came from assignee validation — meaning the
   *validation* ran before any authorization would have. Worth checking that no
   other route does meaningful work before its guard.

2. **Comment moderation by project managers** — the deliberate omission above.

3. **`GET /health/detail` is `@Public()`** and the code's own comment says it
   *"reveals what your dependencies are — genuine reconnaissance value"*, then
   notes it should carry `@Roles(Role.ADMIN)` or live on an internal port. It
   doesn't. Low severity, but it's a known gap the code already documents.

4. **No rate limiting was assessed.** `@nestjs/throttler` is a dependency;
   whether it's applied to auth routes is a separate audit.

5. **This audit covered authorization only** — not injection, not CSRF coverage
   per route, not secrets handling.
