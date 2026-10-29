# Phase 12 — Projects and the reusable Data Table

> Covers brief Parts 29 and 30. The permission model from Phase 10–11 finally
> does real work, because project-scoped rules need a project.

---

## 1. Why the table got extracted now

The users page and the projects page were about to grow the same six branches:
loading, error, empty, filtered-empty, rows, pagination.

That's the **Rule of Three** arriving — two near-identical implementations plus a
third on the way. Extracting before that is speculation.

**And the rewrite is the proof.** An abstraction with exactly one consumer hasn't
been shown to be reusable, so `AdminUsersPage` was moved onto `DataTable` too.
What that removed: the loading branch, the error branch, the empty branch, the
`isFetching` dimming, the `TableContainer` boilerplate, and the `scope="col"`
headers that are easy to forget. What it kept: the columns — the only part
genuinely about users.

### What it deliberately does *not* do

| Omission | Why |
|---|---|
| No data fetching | RTK Query owns the request. A table that fetches can't render a list you already have. |
| No filter UI | Filters live in the URL and differ per page. |
| No client-side sorting or paging | Both are server concerns — see below. |

Each omission keeps it **presentational**, which is what makes it testable with
a plain array.

---

## 2. Three decisions inside the table

### `render` rather than `field: keyof T`

Most real columns aren't a bare value — they're a chip, a link, a formatted
date, two fields joined. A `field` key covers the easy half and forces an escape
hatch for the rest; a render function covers both with one concept. And because
`Column<T>` is generic, `render` receives a fully-typed row, so `row.naem` is a
compile error rather than `undefined` in a cell.

### The table reports sort intent; it never sorts

> With server-side pagination, sorting in the browser sorts **the current page
> only**. On page 3 of 40 that orders fifty rows out of two thousand.

It's a bug people ship constantly because it's invisible on a single-page dataset
during development. There's a test asserting the rows are *unchanged* after a
sort click.

**Mixing server pagination with client sorting is the one combination that is
always wrong.** If the whole dataset fits in the client, sort there and don't
paginate.

### Branch order: error → loading → empty

This looks arbitrary in review and isn't:

```tsx
if (error) ...      // ← must come first
if (isLoading) ...
if (!rows?.length) ...
```

A failed refetch leaves stale rows in the RTK Query cache, so `rows` is non-empty
**and** `error` is set. Checking rows first renders the stale table and silently
hides the failure — **the user reads data that's quietly wrong**, which is worse
than an error and worse than an empty state.

There's a test for exactly that: `error` + stale `rows` must show the alert and
*not* the data.

---

## 3. `useProjectRole` — the missing half of the permission model

Phase 10 built `can(user, capability, { projectRole })` and argued *"is this user
a manager?"* is unanswerable without naming a project. This is where the answer
comes from.

**Returns `Role | null`, and the null is meaningful** — "checked, not a member",
which `can()` treats differently from `undefined` ("didn't ask"). Returning
`undefined` would collapse that distinction at the one place it can be resolved.

### The owner trap

The backend's scope filter matches **owner OR member**:

```js
{ $or: [{ ownerId: memberId }, { 'members.userId': memberId }] }
```

So a project can name you as owner without a `members` row, and a naive
`members.find(...)` would tell the **owner** they're not a member of their own
project — hiding every management button from the one person who definitely has
permission.

**Verified live:**
```
ownerId : 4a235cdc
members : 4a235cdc:manager, 4a235ce3:member
owner has a members row? true
```

So the owner fallback is **belt-and-braces on current data, not load-bearing** —
`ProjectsService.create` adds the owner as a MANAGER member. Worth being precise
about: it guards data created before that behaviour, or by a migration. Being
explicit documents that *"owner"* and *"manager member"* are two representations
of one authority, which isn't obvious from either type alone.

---

## 4. Permissions doing real work

Every gate on the detail page passes context:

```tsx
<RequirePermission capability="project:archive" context={{ projectRole }}>
```

Forget the context and it denies — silently, and in the safe direction. **You
hide a button; you never wrongly show one.**

Verified against the running backend:

```
As a plain MEMBER               As the OWNER
PATCH  /projects/:id     403    PATCH  /projects/:id     200
POST   /:id/archive      403    POST   /:id/archive      200
POST   /:id/members      403    GET    /projects         200
```

The client's rules and the server's agree — which is the whole point, and only
checkable by running both.

### The role banner

```
Your role in this project: member — managers can edit, archive and change members.
```

Hiding a control without explaining the rule is the most common way
permission-driven UI confuses people: **they can't tell a missing feature from a
forbidden one.** One line of copy turns "this app is broken" into "I need manager
access".

---

## 5. Two things I left visible rather than hidden

**The member list shows truncated user ids, not names.** The backend returns
`members` as `{userId, role, joinedAt}` with no join. Resolving names would mean
one request per member — the N+1 problem from Phase 2, at the member list this
time. The honest options are to ask the backend to populate members (as it
already does for task assignees) or fetch the user list once and look up locally.
Showing the id makes the gap visible instead of hiding it behind fifty requests.

**`ProjectsPage` uses `useSearchParams` directly, not a filter hook.**
`useUrlTaskFilters` exists because task filters are complex — five fields, enum
parsing, a page-reset invariant. Projects have two. A second hook for two fields
is abstraction ahead of need; *"we have a hook for that"* is how a codebase grows
six near-identical filter hooks.

---

## 6. A cache-invalidation case worth knowing

```ts
removeProjectMember: invalidatesTags: [Project(id), Project(LIST), Task(LIST)]
```

The task list is **scoped by project membership on the backend**. Remove yourself
from a project and the tasks you could see a moment ago are no longer yours — but
the cached list keeps showing them until something refetches.

> **A cache that outlives the permission it was fetched under** is a genuinely
> subtle bug: the data is stale *and* the staleness is an access-control problem,
> not just a freshness one.

This only works because there's **one** api slice with a shared tag namespace —
the reason `apiSlice` is defined empty and features inject into it.

---

## 7. Interview questions

1. **When do you extract a shared component?** Rule of Three — and prove it by
   migrating an existing consumer, not just building a new one.
2. **Client or server sorting?** Match your pagination. Server pagination +
   client sorting sorts one page and is always wrong.
3. **Why does branch order matter in a table?** A failed refetch leaves stale
   rows cached; checking rows first hides the error behind wrong data.
4. **Why does a permission check need a subject?** Project-scoped rules are
   meaningless without a project. `can('project:archive')` with no context must
   deny.
5. **What happens to cached data when permissions change?** It goes stale in an
   access-control sense. Invalidate across entities — membership changes affect
   task lists.
6. **How do you avoid N+1 in a member list?** Have the API populate the join, as
   it already does for task assignees. Don't fetch per row.

---

## 8. Exercises

1. Reorder `DataTable`'s branches to check `rows` first. Run the tests; explain
   which one fails and why it matters more than it looks.
2. Make `DataTable` sort `rows` itself. Paginate to page 2 and sort. Explain
   what the user sees.
3. Remove the owner fallback from `useProjectRole`, then create a project
   directly in Mongo with an empty `members` array. Watch every button vanish.
4. Drop `Task(LIST)` from `removeProjectMember`. Remove yourself from a project
   and navigate to /tasks without reloading.
5. Pass `isFetching` where `isLoading` goes. Switch tabs and watch the table
   blank.
6. Remove `label` from a `<DataTable>`. Find the compile error, then explain why
   it's required rather than optional.

---

## Verified

```
lint ✅   typecheck ✅   117/117 tests ✅   build ✅

Live:
  member → PATCH/archive/members 403 (all three)
  owner  → PATCH/archive 200, scoped list 200
  owner has a members row: true (fallback is belt-and-braces)

Routes: /projects /projects/:id /tasks /admin/users /dashboard → 200
```

Bundle 642 kB / 198 kB gzip.

---

## Quiz

1. `DataTable` branches error → loading → empty. Why is that order load-bearing?
2. Why does a task list need **two** different empty states?
3. Client-side or server-side pagination, and why?
4. What must be true of the sort field, and what happens otherwise?
5. Why does `TaskCard` take `assigneeName` as a prop rather than fetching it?
6. What breaks if you change a filter while on page 4?
7. Columns are passed as data rather than as JSX children. What does that buy?

<details>
<summary>Answers</summary>

1. A failed request leaves `data` undefined, so an empty check placed first
   reports "no results" for what is actually a **server error** — telling the
   user something false and hiding a problem they could retry.
2. "You have no tasks yet" and "no tasks match these filters" call for different
   actions — create one, versus widen the filter. Showing the first when the
   second is true makes the user think their data was deleted.
3. **Server-side.** Client-side means downloading every row to display twenty.
4. It must be **total** — a unique tiebreaker. Sorting by a non-unique field
   gives non-deterministic ordering, and every pagination bug traces back to it.
5. The **N+1 problem**. Fifty cards each fetching their assignee is fifty
   requests spread across fifty components, so no single place looks wrong.
6. You ask for page 4 of a result set that may have one page, get nothing, and
   see "no results" for a filter that matches plenty. **Reset to page 1.**
7. A generic, reusable table: the same component serves users, projects and
   activity logs, and the row type stays type-safe via `Column<T>`.

</details>

---

**Next: Phase 15 — SSE notifications.** That exercises the
`fromUrlQueryParameter('access_token')` extractor found in Phase 1, because
`EventSource` cannot set an `Authorization` header.
