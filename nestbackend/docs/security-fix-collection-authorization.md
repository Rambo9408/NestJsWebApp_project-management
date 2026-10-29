# Security fix — collection-level authorization

> Backend change. Closes the data-isolation gap found while verifying Phase 7 of
> the React frontend, and fixes the MongoDB transaction failure found in Phase 9.

---

## 1. The vulnerability

**Any authenticated user could read every task and project in the database.**

Reproduced before the fix:

```
User A: register → project "PH" → 3 tasks
User B: register (brand new, zero projects)

GET /api/v1/tasks    as B → total: 3   ← all of A's tasks
GET /api/v1/projects as B → total: 1   ← A's project
```

**Classification:** Broken Object-Level Authorization — OWASP API1:2023.

### Why it survived

The guard coverage was asymmetric, and in a way that *looks* complete:

| Route | `ProjectAccessGuard` |
|---|---|
| `GET /projects/:id` | ✅ |
| `PATCH /projects/:id` | ✅ |
| `POST /tasks` | ✅ (reads `projectId` from the body) |
| **`GET /projects`** | ❌ |
| **`GET /tasks`** | ❌ |

Two contributing causes:

1. **`ProjectsController.findAll` took `memberId` from the query string.** Omit
   it and there was no filter at all. A client-supplied scope is not a scope.
2. **`TasksService.findAll` passed its filter straight to the repository** with
   no membership constraint anywhere in the path.

**The structural reason:** `ProjectAccessGuard` answers *"may this user touch
THIS project?"* and needs an id from the route. **A list has no id.** Collection
authorization is not a yes/no decision — it is a **filter**, and a filter has to
live in the query.

Guarding `/:id` stops you reading one project you shouldn't see. It does nothing
about a list that hands you all of them.

> **Interview:** *"You guarded `/:id` — why is the list still a problem?"* This
> is the answer, and it separates people who have thought about authorization
> from people who have added a guard.

---

## 2. The fix

### `GET /projects`

```ts
const memberId = user.role === Role.ADMIN ? query.memberId : user.id;
```

A global admin sees everything and may narrow with `?memberId=` — a legitimate
support tool. Everyone else is pinned to their own id.

**A member-supplied `memberId` is discarded, not rejected.** A 400 would confirm
to an attacker that the parameter exists and is being checked. Silently scoping
to self reveals nothing and cannot be bypassed.

### `GET /tasks`

New authorization scope on `TaskFilter`:

```ts
/** Set by the controller from the CALLER'S MEMBERSHIP - never from the query. */
accessibleProjectIds?: string[];
```

Resolved in the controller:

```ts
const accessibleProjectIds =
  user.role === Role.ADMIN ? undefined : await this.projectsService.findAccessibleProjectIds(user.id);
```

Applied in `buildFilter`:

```ts
if (filter.accessibleProjectIds !== undefined) {
  query.$and = [...(query.$and ?? []), { projectId: { $in: ids } }];
}
```

**Three details, each preventing a specific bug:**

1. **`!== undefined`, not a truthiness check.** This is the important one:

   ```ts
   if (filter.accessibleProjectIds?.length) { ... }   // ACTIVELY DANGEROUS
   ```

   An empty array would fall through to *"no scope at all"*, so a user in **no
   projects** would receive **every task in the database** — the exact
   vulnerability, reappearing for precisely the users who should see least.
   `undefined` = unrestricted (admin); `[]` = nothing accessible, and `$in: []`
   correctly matches zero documents.

2. **`$and`, not overwriting `query.projectId`.** If the caller also asked for
   one project, both constraints must hold — otherwise a request for a project
   you can't see would *bypass* the scope rather than return nothing.

3. **`Role.ADMIN` short-circuits, matching `ProjectAccessGuard`'s own rule.** Two
   places disagreeing about what "admin" means is its own bug class.

### New repository method

```ts
abstract findIdsForMember(userId: string): Promise<string[]>;
```

Deliberately **unpaginated and id-only** — it's an authorization scope, not a
user-facing list. A *page* of it would silently under-scope. Implemented in both
the Mongo and in-memory repositories, using `.select({ _id: 1 })` and the same
multikey index on `members.userId` that `buildFilter` uses.

---

## 3. Regression tests — and proof they work

Five cases added to `authorization.integration.spec.ts`:

| Test | Guards against |
|---|---|
| tasks not leaked to a non-member | the original bug |
| projects not leaked to a non-member | the original bug |
| client-supplied `memberId` ignored | the bypass |
| **members still see their own** | over-correction |
| **global admin still sees everything** | the `undefined` branch |

The last two matter as much as the first three. *"Deny everything"* is the
classic over-correction after a leak, and it would pass every negative test while
making the product useless.

**Verified by reintroducing the bug:**

```
Tests: 3 failed, 12 passed, 15 total
```

A test that has never been seen to fail is not yet a test.

### Why these tests and not just the fix

**The failure is silent.** The endpoint returns 200 either way — only the row
count differs. Nothing errors, nothing logs, and a developer testing manually
while a member of the project sees exactly what they expect.

Every *other* test in that file exercises a route with an `:id`. That's why the
gap survived: the test suite had the same blind spot as the guard design.

---

## 4. The MongoDB transaction failure

`DELETE /tasks/:id` returned 500:

```
Transaction aborted: Transaction numbers are only allowed on a replica set member or mongos
```

**Not a code bug.** `docker-compose.yml` deliberately runs MongoDB as a
single-node **replica set** because the cascade delete uses a multi-document
transaction. But port 27017 was held by a locally-installed `mongod`, so the
container silently failed to start and the backend connected to the **standalone**
instead.

The compose file's own comment predicted it:

> *"Running standalone locally and a replica set in production is a classic
> 'works on my machine' trap."*

### Fix: move the host port, don't touch your machine

```yaml
- '127.0.0.1:27018:27017'    # was 27017:27017
```

```
MONGODB_URI=mongodb://127.0.0.1:27018/taskflow?directConnection=true
```

**Why this and not `Stop-Service MongoDB`:** it needs no admin rights, changes
nothing outside the project, and leaves any other work using your local MongoDB
untouched. The port conflict is designed away rather than documented.

**`directConnection=true` is load-bearing.** The replica set advertises itself as
`localhost:27017`; without this flag the driver would follow that address from
the host and land on *the other mongod*. The flag stops topology discovery and
talks to exactly the server named in the URI.

Updated in `.env`, `.env.development`, `.env.example`, `.env.test`.

---

## 5. Verified

```
Containers      mongodb + redis healthy, replica set initialised on :27018
Typecheck       clean          Lint  clean
Unit tests      90/90 passed
E2E tests       72/72 passed   (was 67 - five new)
Bug reinjection 3 regression tests correctly fail

Live, brand-new user:
  GET /tasks    → total 0   (was 3)
  GET /projects → total 0   (was 1)
  ?memberId=<other user>    → total 0   (bypass ignored)
  own project + task        → total 1   FX-1 My own task
  DELETE /tasks/:id         → 200 {"deletedComments":0}   (transaction works)

Owner still sees own data; global admin still sees everything.
```

## 6. Not changed

- **No other endpoint was audited.** `GET /users`, `GET /notifications` and the
  comment routes may have the same shape. A deliberate sweep of every collection
  endpoint is the right follow-up, and it is the kind of review worth doing once,
  systematically, rather than per-bug.
- **The frontend was not touched.** It cannot be: the client is not a security
  boundary, which is exactly what `RequireAuth.tsx` documents.
