# Phases 8 & 9 — Redux Toolkit and RTK Query

> Covers brief Parts 18, 19, 20 (and 41's "server state in Redux" anti-pattern).
> `useAsyncData` is **deleted**. The five capabilities it lacked now exist.

---

## ⚠️ Two environment findings first

### 1. `DELETE /tasks/:id` returns 500 on your machine

```
Transaction aborted: Transaction numbers are only allowed on a replica set member or mongos
```

**Not a code bug.** Your `docker-compose.yml` deliberately runs MongoDB as a
single-node **replica set** (`command: ['--replSet','rs0']`) because the cascade
delete uses a multi-document transaction. Its own comment predicted this:

> *"Running standalone locally and a replica set in production is a classic
> 'works on my machine' trap."*

But **port 27017 is held by a standalone `mongod` installed on your host** (PID
5768), so the compose container never starts and the backend has been talking to
the standalone the whole time. Every non-transactional route works; the one that
needs a transaction fails.

**Fix:** stop the local MongoDB service, then `docker compose up -d`.

```powershell
Stop-Service MongoDB      # or: net stop MongoDB
```

### 2. The list-endpoint authorization gap from Phase 7 is still open

`GET /tasks` and `GET /projects` remain unscoped — a new user sees everyone's
data. Still flagged, still not fixed by me.

---

## What the concurrency check does — verified live

```
PATCH /tasks/PN-1/status  {"from":"todo","to":"in_progress"}   → 200
PATCH /tasks/PN-1/status  {"from":"todo","to":"done"}          → 409
  "Task PN-1 is in \"in_progress\", not \"todo\" - someone changed it first"
```

That 409 is **exactly the case the optimistic-update rollback exists for**, and
it's a genuinely excellent error message — it names the task, both states, and
the cause.

---

# PHASE 8 — Redux Toolkit

## 1. Why auth moved out of Context

Phase 3 argued Context is right for rarely-changing app-wide values. That was
correct then and is still correct in isolation. **What changed is the
surroundings:**

1. **RTK Query's `baseQuery` needs the token** — it's a plain function, not a
   component, so it can't call `useAuth()`. With auth in the store it calls
   `getState()`.
2. **Mutations need to update it** — `extraReducers` lets a slice react to
   another's actions. Context has no equivalent.
3. **Devtools** — every session transition becomes inspectable and replayable.
   *"Why did I get logged out?"* stops being guesswork.

**Say this honestly in an interview:** it isn't "Redux beats Context". It's *"the
integration cost of keeping them separate exceeded the cost of moving."*

**What did NOT move: the theme.** It has no interaction with data fetching, so
`ThemeModeProvider` stays Context. Redux is not where everything goes.

## 2. Immer — "mutation" that isn't

```ts
state.user = action.payload.user;   // looks like the Phase 2 bug
```

It isn't. `state` is a **draft** — a Proxy that records writes and produces a
brand-new object. There's a test asserting exactly this: input untouched, output
a new reference.

**The one rule:** mutate the draft **or** return a new value. Never both — Immer
throws.

## 3. Actions are events, not setters

Three actions end in the same state, deliberately not merged into `setAuth`:

```
auth/signedOut        the user clicked the button
auth/sessionExpired   the refresh token died
auth/restoreFailed    boot check found no session
```

Scrolling a log of `auth/setAuth` tells you nothing. And an analytics middleware
can react to `signedIn` without firing a "login" event on every page load from
`sessionRestored`.

## 4. `prepare` — where impure work goes

```ts
toastAdded: {
  reducer: (state, action) => { state.toasts.push(action.payload); },
  prepare: (message, severity = 'info') => ({ payload: { id: nanoid(), message, severity } }),
}
```

`nanoid()` inside the reducer would make it **impure**, breaking two things that
aren't negotiable: StrictMode's double-invoke produces different ids, and
time-travel replay produces a different result each run — so the devtools lie.

Same rule as Phase 4's "render must be pure", for the same reason: **anything
replayable must not depend on when it ran.**

## 5. What belongs in Redux — and what doesn't

The toast queue qualifies because it's **raised in one place and rendered in
another**, with no shared ancestor:

```
TaskCard / RegisterForm / a middleware five layers deep
                    ↓
        <Toaster /> in RootLayout
```

| Does **not** belong | Belongs to |
|---|---|
| tasks, projects, users | RTK Query |
| filters, sort, page | the URL (Phase 5) |
| form state | React Hook Form (Phase 6) |
| one component's open/closed | `useDisclosure` (Phase 3) |

**The test:** does state need to be read or written by components sharing no
meaningful ancestor, **and** is it client-owned? Both, or it goes elsewhere.

## 6. The selector re-render trap

```ts
// WRONG — new object every call, re-renders on EVERY store update
const { status, user } = useAppSelector(s => ({ status: s.auth.status, user: s.auth.user }));

// RIGHT — two selectors, each returning an existing reference
const status = useAppSelector(selectAuthStatus);
const user = useAppSelector(selectCurrentUser);
```

It's the Context identity bug from Phase 3 in a Redux costume. **Interview: "why
does my component re-render on every action?"** — a selector returning a new
object or array literal. Extremely common, invisible until you profile.

`useSession()` wraps all of it, so the Context→Redux migration touched the
implementation and **not the twelve call sites.**

---

# PHASE 9 — RTK Query

## 7. What `useAsyncData` couldn't do

| | |
|---|---|
| **Caching** | navigate away and back inside the window → no request |
| **Deduplication** | five components, same query → one request |
| **Invalidation** | create a task → the list refetches itself |
| **Background refetch** | on window focus and reconnect |
| **Reference counting** | evicted `keepUnusedDataFor` seconds after the last unmount |

Each is ~100 lines to build properly, and invalidation across a real app is
genuinely hard.

## 8. The single-flight refresh is *reused*, not reimplemented

`baseQueryWithReauth` calls the same `refreshAccessToken` from Phase 7. So
`httpClient` **and** RTK Query share one in-flight refresh — six queries and one
httpClient call all 401ing produces exactly **one** refresh.

Implementing it separately inside `apiSlice` would give two independent
single-flight guards, which is not single-flight at all: two concurrent
refreshes, the second presenting a spent token, and the backend revoking the
session family for suspected theft.

**Avoided by putting the mechanism in a layer *below* both callers.**

## 9. Tags — invalidation without coupling

```ts
getTasks     provides   [{Task, id:'LIST'}, ...perIdTags]
createTask   invalidates [{Task, id:'LIST'}]
updateTask   invalidates [{Task, id}, {Task, id:'LIST'}]
deleteTask   invalidates [{Task, id}, {Task, id:'LIST'}, {Comment, id:'LIST'}]
```

With `useAsyncData`, a create form had to know the list existed and call its
`refetch` — and that coupling multiplies across modal, board, shortcut and bulk
import. **Tags invert it:** the list declares what it depends on, mutations
declare what they change, neither knows about the other.

`updateTask` invalidates the **list too** — otherwise the table keeps showing the
old title after a save. Classic bug.

`deleteTask` invalidates `Comment` because the backend cascades. That
cross-entity invalidation only works because there's **one** api slice with a
shared tag namespace.

## 10. Optimistic updates — and the half people forget

```ts
const patches = entries.filter(e => e.endpointName === 'getTasks')
  .map(e => dispatch(util.updateQueryData('getTasks', e.originalArgs, draft => {
    const task = draft.items.find(t => t.id === id);
    if (task) task.status = body.to;
  })));
try { await queryFulfilled; } catch { patches.forEach(p => p.undo()); }
```

**Every cached entry is patched, not just the current one** — URL-driven filters
mean each combination is its own cache key, and patching only one leaves the
others stale.

**No `invalidatesTags` on this endpoint.** The patch already wrote the value;
invalidating would refetch to learn what we just wrote, costing a round-trip and
a visible flicker. **Optimistic update or invalidation, not both.**

| Use optimistic | Don't |
|---|---|
| almost always succeeds | payments, deletions, anything irreversible |
| small, easy to reverse | server-computed results (ids, totals) |
| user would notice latency | frequently fails — the flicker is worse |

The rollback isn't theoretical: that 409 above is exactly when it fires.

## 11. `isLoading` vs `isFetching`

```
isLoading   first load of this cache key, no data to show    → skeleton
isFetching  ANY in-flight request, including background      → dim slightly
```

Rendering a skeleton on `isFetching` **blanks the list every time the window
regains focus** — throwing away content the user was reading to show a loading
state for data they already have.

**A reliable signal that someone has actually used RTK Query rather than read
about it.**

## 12. The inline object is now safe

```tsx
// Phase 7 — BOTH memos load-bearing; drop either and it refetches forever
const effectiveQuery = useMemo(...); const fetcher = useCallback(...);
useAsyncData(fetcher, [effectiveQuery]);

// Phase 9
useGetTasksQuery({ ...query, search: debouncedSearch || undefined });
```

RTK Query **serialises** the argument into a cache key, so it compares by
**value**. That single design choice deletes the entire bug class the Phase 3
hooks lab exists to demonstrate.

*(Debounce still matters — RTK Query dedupes identical arguments, not different
ones. 14 keystrokes are 14 distinct cache keys.)*

## 13. Middleware — the capability Context can't match

`errorToastMiddleware` toasts every failed **mutation** from one place, no
try/catch at any call site. Middleware sees every action, including ones
dispatched from outside React.

**Mutations only, deliberately.** A failed mutation is a user action that didn't
happen — they pressed Save and nothing saved, and the component often has nowhere
to put the message. A failed **query** has a natural home: `<ErrorState onRetry>`
where the user is already looking. Toasting both would double up, and a
background refetch failing would interrupt over something not on screen.

---

## 14. Interview questions

1. **Redux or Context?** Context is transport for rarely-changing values; Redux
   adds selectors, middleware and devtools. Neither for server data.
2. **Is Redux Toolkit immutable?** Yes — Immer records draft writes and produces
   a new state.
3. **Where do ids/timestamps go?** `prepare` or the dispatching code. Never a
   reducer — it breaks replay and StrictMode.
4. **Why does my component re-render on every action?** A selector returning a
   new object literal.
5. **What does `useGetTasksQuery` do internally?** Serialise arg → cache lookup
   → subscribe → reference-count on unmount.
6. **How does invalidation work?** Queries provide tags, mutations invalidate
   them; RTK Query refetches every affected entry.
7. **`isLoading` vs `isFetching`?** First load vs any in-flight request.
8. **How do you implement optimistic updates?** Patch the cache, keep the undo
   handle, revert on failure. Volunteer the rollback case.
9. **Why not both optimistic update and `invalidatesTags`?** You'd refetch to
   learn what you just wrote.
10. **Why is server state not in a slice?** You'd hand-build caching, dedup and
    invalidation, and own a second copy that can go stale.

---

## 15. Exercises

1. Delete `apiSlice.middleware` from the store. The first render still works;
   nothing ever refetches. Explain why that's the confusing failure.
2. Open Redux DevTools, sign in, and read the action log. Then break the refresh
   token and watch `auth/sessionExpired`.
3. Add `invalidatesTags` to `changeTaskStatus` and watch the flicker.
4. Make `changeTaskStatus` send a stale `from` and confirm the 409 rolls the
   patch back.
5. Render a skeleton on `isFetching` instead of `isLoading`. Switch tabs.
6. Change `useSession` to one object-returning selector and profile.
7. Open `/tasks` in two tabs, create a task in one, focus the other.

---

## Verified

```
lint ✅   typecheck ✅   84/84 tests ✅   build ✅ (6 chunks)

Live:  register → project → task → status transition → 200
       stale `from` → 409 with a precise message
       DELETE → 500 (host MongoDB is standalone; see the note at the top)
```

---

## Quiz

1. Why is `state.items.push(item)` safe inside a `createSlice` reducer and
   forbidden everywhere else?
2. What is an RTK Query cache entry keyed on?
3. Why is an inline object argument safe for `useGetTasksQuery` but an infinite
   loop for a hand-rolled `useEffect` fetch?
4. What is the difference between `isLoading` and `isFetching`?
5. What does the `LIST` id in `providesTags` let you do?
6. You add `invalidatesTags` to a mutation that already does an optimistic
   update. What happens?
7. `useSelector` returns a new object. What breaks, and why?
8. Name three things RTK Query gives you that a `useEffect` fetch does not.

<details>
<summary>Answers</summary>

1. Immer gives you a **mutable draft** (a Proxy) and produces a new immutable
   state from the recorded changes. Elsewhere you would be mutating the real
   object, which `Object.is` cannot see.
2. **The endpoint name plus the serialised argument.** Same args → same entry →
   deduplicated request.
3. RTK Query serialises the argument **by value** into a cache key. A `useEffect`
   dependency array compares **by reference**, so a fresh object every render
   differs every render.
4. `isLoading` is the **first** load of a cache key, with no data to show.
   `isFetching` is any in-flight request, including a background refetch with
   data already on screen.
5. Invalidate the list without touching every individual entry, and invalidate
   one item without refetching the list.
6. You get the instant update **and** a refetch — which defeats the point of the
   optimistic update.
7. It re-renders on **every** store change, because the default comparison is
   reference equality. Select primitives, memoise with `createSelector`, or pass
   `shallowEqual`.
8. Any three of: caching, request deduplication, background refetching, tag
   invalidation, loading/error state, subscription reference counting.

</details>

---

**Next: Phases 10–11 — Authorization and RBAC.** `admin`/`manager`/`member`,
`<RequirePermission>`, permission-filtered nav, and the reason none of it is a
security boundary.
