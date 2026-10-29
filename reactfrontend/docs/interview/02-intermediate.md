# Intermediate — 25 questions

> The working middle of a React interview: hooks beyond `useState`, where state
> belongs, routing, forms, and the first performance questions.
>
> This is where a rusty candidate is separated from a current one — not by
> knowing more APIs, but by knowing **when not to use them**.

---

### I1. `useState` vs `useReducer` — where is the line?

**Answer.** Reach for a reducer when the next state depends on the previous in a
non-trivial way, when several values change together, or when the transitions
have names worth writing down.

**Why it matters.** A reducer also makes the state machine **testable without
React** — it is a pure function of `(state, action)`.

**Real-world example.** The auth slice models `authenticated | unauthenticated |
restoring` as a union. Three booleans would permit
`{ loading: true, authenticated: true }`, a state that cannot happen but that
every component must nonetheless handle.

**Common mistake.** Using a reducer for a single boolean because it feels more
architectural.

**Follow-up.** *"How does that relate to Redux?"* — `useReducer` is the same
shape at component scope. Redux adds a single store, middleware and devtools.

---

### I2. What is a stale closure?

**Answer.** A callback captured a render's variables and runs later, after those
values changed — so it sees the old ones, because that is genuinely what it
closed over.

**Why it matters.** It is the root cause of most "why is my state wrong?"
questions, and it is not a bug in React. It is how closures work.

**Real-world example.** `useEventListener` keeps the handler in a ref updated by
an effect. Without that indirection you either re-subscribe on every render or
capture a stale handler forever.

**Common mistake.** Fixing it by removing dependencies, which is the cause
dressed as the cure.

**Follow-up.** *"Three ways to fix one?"* — a functional update, a correct
dependency array, or a latest-value ref.

---

### I3. `useMemo` and `useCallback` — when do they earn their place?

**Answer.** When the computation is genuinely expensive, or when the **identity**
matters — the value is a dependency of another hook, or a prop to a memoised
child.

**Why it matters.** Both cost an allocation, a comparison, and a dependency array
to keep correct. Most computations are cheaper than the comparison.

**Real-world example.** `MainNav` memoises its filtered link array — not for
speed with five links, but because `can` is `useCallback`'d upstream, so the memo
actually holds. An unstable `can` would make it pure overhead.

**Common mistake.** "Always memoise." It adds noise and correctness burden for no
measured gain.

**Follow-up.** *"How would you know it helped?"* — the Profiler, before and
after. If you cannot show the difference, remove it.

---

### I4. What defeats `React.memo`?

**Answer.** Any new reference passed as a prop: an inline object, an inline
array, or an arrow function.

```tsx
<Child style={{ margin: 8 }} onClick={() => go(id)} items={[...]} />
```

Three new references per render — the memo compares, finds differences, and
re-renders every time.

**Why it matters.** This is the main reason people conclude "memo doesn't work".

**Real-world example.** Same failure mode as Angular's `OnPush` being defeated by
a mutated `@Input`. If you have debugged one, you understand the other.

**Follow-up.** *"So should everything be `useCallback`'d?"* — no. Memoise the
props of components you actually memoised, and measure first.

---

### I5. When should you **not** use `useEffect`?

**Answer.** Four cases, and this is the highest-value question in the set:

1. **Deriving state from props** — calculate during render.
2. **Responding to a user event** — put it in the handler.
3. **Fetching data** — that is what a query library does.
4. **Transforming data for display** — a plain expression, or `useMemo`.

**Why it matters.** Unnecessary effects cause double renders, stale intermediate
states, and race conditions.

**Real-world example.** `TaskCard`'s `isOverdue` is computed during render. In
state it would be a second source of truth, always one render behind — so the
card would briefly show a stale badge after the due date changed.

**Common mistake.** `useEffect(() => setFiltered(items.filter(...)), [items])`.
Just `const filtered = items.filter(...)`.

**Follow-up.** *"What is left for effects?"* — synchronising with systems outside
React. Subscriptions, timers, imperative DOM, analytics.

---

### I6. `useRef` — what are its two distinct uses?

**Answer.** A DOM handle, and a mutable box that survives renders without causing
one.

**Why it matters.** The second is the one people forget, and it has a precise
signature: "remember this across renders but do not render it."

**Real-world example.** `RouteAnnouncer` uses `isFirstRender` to skip the initial
mount. State there would re-render for no visual reason — and
`react-hooks/set-state-in-effect` would reject it.

**Common mistake.** Using a ref for something the UI displays. Changing it does
not re-render, so the screen silently disagrees with the value.

**Follow-up.** *"Is writing a ref during render safe?"* — technically impure and
discouraged under concurrent rendering, which is precisely why `usePrevious` is
not in React core.

---

### I7. What is the difference between `isLoading` and `isFetching`?

**Answer.** `isLoading` is true only on the **first** load of a cache key, when
there is no data to show. `isFetching` is true for **any** in-flight request,
including a background refetch with data already on screen.

**Why it matters.** Rendering a skeleton on `isFetching` blanks the list every
time the window regains focus — throwing away content the user was reading.

**Real-world example.** `TasksPage` renders a skeleton on `isLoading` and dims
slightly on `isFetching`.

**Follow-up.** *"What is the right treatment for a background refetch?"* — subtle:
a dimmed list or a thin progress bar. Never a full replacement.

> A reliable signal someone has actually used RTK Query rather than read about
> it.

---

### I8. Where does state belong?

**Answer.** Four buckets, and most state bugs come from confusing the first two:

| Bucket | Home | Why |
| --- | --- | --- |
| Server state | RTK Query | a **cache**: stale on arrival, shared, needs invalidation |
| URL state | search params | shareable, bookmarkable, survives refresh |
| Global client state | a Redux slice | session, theme, toasts |
| Local state | `useState` | everything else — **the default** |

**Why it matters.** The decision rule is one question: *who else needs this, and
does it survive a refresh?*

**Real-world example.** Task filters live in the URL, so a filtered view is a link
you can paste into a ticket, and back/forward work.

**Follow-up.** *"Why is URL state underused?"* — because it costs nothing and
nobody thinks of it. It is the highest-value state decision in a list-heavy app.

---

### I9. Why is server state different in kind?

**Answer.** You do not own it. It is stale the moment it arrives, it is shared
between users, and it needs caching, deduplication, invalidation and refetching.

**Why it matters.** Putting it in `useState` and syncing by hand is
re-implementing a cache, badly, per component.

**Common mistake.** Copying an RTK Query result into a Redux slice "so other
components can use it". They can already — the cache is global and keyed by
argument.

**Follow-up.** *"When would you copy server data into local state?"* — when the
user is editing it. A form's draft is genuinely local until submitted.

---

### I10. What does `useGetTasksQuery(query)` actually do?

**Answer.** Four things:

1. Serialises the argument into a **cache key**.
2. Looks it up — hit and fresh returns immediately with no request; hit and stale
   returns immediately and refetches in background; miss starts a request.
3. **Subscribes** this component. A second component asking with the same
   argument joins the same subscription — one request, two consumers.
4. On unmount, decrements the reference count; at zero the entry is evicted after
   `keepUnusedDataFor`.

**Why it matters.** It serialises by **value**, so an inline object argument is
safe — unlike a hand-rolled `useEffect` fetch, where a fresh object every render
is an infinite loop.

**Real-world example.** That difference is documented in `tasksApiSlice.ts`,
because the Phase 7 version of the same page needed two memos to avoid exactly
that loop.

---

### I11. Explain tags and invalidation.

**Answer.** Queries `provideTags`, mutations `invalidateTags`. Invalidation marks
entries stale, so active subscribers refetch.

**Why it matters.** It is declarative cache dependency. The alternative is
remembering to refetch by hand at every call site.

**Real-world example.** Comments use `id: LIST-${taskId}` rather than a shared
`LIST`. A single shared tag would mean posting on task A invalidates the comment
list of every open task — invisible while testing one task, obvious with two.

**Common mistake.** Tagging everything with one type and id, so every mutation
refetches everything.

**Follow-up.** *"What is the `LIST` id convention for?"* — it lets a create
invalidate the list without touching each item, and an update invalidate one item
without refetching the list.

---

### I12. How do optimistic updates work, and when are they wrong?

**Answer.** `onQueryStarted` + `updateQueryData` applies the change immediately
and `.undo()`s on failure.

**Right for** high-confidence, low-stakes, instantly-visible actions — toggling a
task to done.

**Wrong when** the server computes part of the result, when failure is expensive
to explain, or when the user expects confirmation anyway.

**Real-world example.** Comments deliberately do **not** use one. The server
assigns `id`, `createdAt`, and resolves the author join — and it was later
confirmed that `POST` returns `author: null` while `GET` populates it. An
optimistic insert would render every new comment as "Unknown user".

**Follow-up.** *"What happens if you add `invalidatesTags` to an optimistic
mutation?"* — you get the instant update **and** a refetch, defeating the point.

---

### I13. Context or Redux?

**Answer.** Context is dependency injection for values. Redux is a state
container with reducers, middleware and devtools.

**Use Context** for low-frequency, tree-scoped values: theme, locale, a service
handle.
**Use Redux** when distant parts of the app share state with non-trivial
transitions, or when you want the middleware and devtools seams.
**Use neither** for server state.

**Why it matters.** Context has no reducers and no selector granularity — every
consumer re-renders when the value changes.

**Real-world example.** This project's store holds only session, theme and
toasts. Everything else is RTK Query or local.

**Follow-up.** *"How do you reduce Context re-renders?"* — push consumption down
to the leaf that needs it, before splitting the context or memoising consumers.

---

### I14. Why does `useSelector` returning a new object cause re-renders?

**Answer.** The default comparison is reference equality, so a fresh object each
call always differs.

**Fixes:** select primitives, use `createSelector` to memoise, or pass
`shallowEqual`.

**Follow-up.** *"What does a selector buy beyond tidiness?"* — it decouples
components from state shape, so you can restructure the store without touching
consumers.

---

### I15. What is a data router, and why use it?

**Answer.** Routes declare `loader` and `action`, so fetching moves into the
route definition and can start **before** the component renders — removing the
render-then-fetch waterfall. It also enables per-route `errorElement`.

**Real-world example.** This project uses `createBrowserRouter` but deliberately
**not** loaders, because RTK Query already owns server state. Two caching layers
that both think they own the same data is an architecture mistake.

**Follow-up.** *"So when would you use loaders?"* — when you have no query
library, or when the pre-render fetch genuinely matters for LCP.

---

### I16. Why does a hard refresh of `/tasks/abc` 404 without server config?

**Answer.** There is no file at that path. The server must fall back to
`index.html` — `try_files $uri $uri/ /index.html` in nginx.

**Why it matters.** Soft navigation hides it completely, so the app appears to
work until someone shares a link or presses F5.

**Real-world example.** This was an open bug in this project until it was
containerised.

**Follow-up.** *"And what does that 200 prove about the page?"* — nothing. The
fallback serves `index.html` for every path, including nonsense ones.

---

### I17. How do you protect a route?

**Answer.** A wrapper component that reads the session and renders either its
children or a `<Navigate>`.

**Why it matters — say this unprompted:** it is **not** security. It hides UI. The
backend guard is the boundary.

**Real-world example.** An audit on this project's API found eight endpoints
where the server enforced nothing while the UI looked correct.

**Follow-up.** *"What is the three-state problem?"*
`authenticated | unauthenticated | restoring`. Model it as two and every reload
flashes the login screen for an already-signed-in user.

---

### I18. `?next=` after login — what is the risk?

**Answer.** Open redirect. `?next=https://evil.example` sends the user off-site
immediately after authenticating.

**Fix.** Validate it is a same-origin **path** before navigating.

**Follow-up.** *"Why is this worse than a normal phishing link?"* — it comes from
your domain, after a successful login, so it carries your trust.

---

### I19. Why React Hook Form rather than controlled inputs?

**Answer.** It keeps inputs uncontrolled and subscribes to them, so typing does
not re-render the form.

**Why it matters.** On a large form that is the difference between smooth and
laggy.

**Follow-up.** *"What do you give up?"* — live derived UI is slightly more work,
because the value is not in React state by default.

---

### I20. Why Zod rather than RHF's built-in validation?

**Answer.** One schema gives validation **and** the TypeScript type via
`z.infer`, so they cannot drift. And the schema shape mirrors the NestJS DTO,
which is the contract you are actually bound by.

**Common mistake.** Believing client validation is a control. It is feedback
speed. The server validates the same rules because the client is bypassable with
one `curl`.

**Follow-up.** *"What can generated types not catch?"* — a changed **constraint**.
OpenAPI records `maxLength`; TypeScript cannot express it.

---

### I21. How do you show a server-side field error?

**Answer.** Map it onto the form with `setError('email', ...)`.

**Why it matters.** A toast saying "email already in use" makes the user remember
which field it referred to. Attaching it to the field does not.

**Real-world example.** `applyServerErrors` does this mapping in one place, so
every form behaves the same way.

---

### I22. What makes a good custom hook?

**Answer.** It owns a piece of behaviour with its own lifecycle — a subscription,
a debounce, a fetch. Not merely "some extracted lines".

**Signals of a bad one:** eight arguments, or exactly one call site with no
prospect of a second.

**Common mistake.** Believing extraction shares state. Two components calling
`useCounter()` get two counters.

**Follow-up.** *"How do you share state between components, then?"* — lift it,
Context it, or store it. Hooks share logic.

---

### I23. What is the four-state rule?

**Answer.** Every API-driven feature handles **loading, error, empty and
success** — and empty is not an error.

**Why it matters.** Components that only handle success are the single most
common gap in real applications.

**Real-world example.** Branch order in `DataTable` and `CommentList` is
load-bearing: **error → loading → empty**. A failed request leaves `data`
undefined, so an empty check placed first reports "no comments yet" for a server
error.

**Follow-up.** *"What is the fifth state?"* — submitting, which is separate from
the list's loading state and must not blank the list.

---

### I24. How do you debounce a search box, and what does the cleanup do?

```ts
useEffect(() => {
  const id = setTimeout(() => setDebounced(value), delay);
  return () => clearTimeout(id);
}, [value, delay]);
```

**Answer.** The **cleanup cancelling the previous timer is the entire
mechanism** — not an afterthought.

**Why it matters.** RTK Query deduplicates identical arguments; it does not merge
different ones. Typing "authentication" is 14 distinct cache keys, so without a
debounce it is 14 real requests.

**Follow-up.** *"Debounce or throttle?"* — debounce waits for quiet; throttle
guarantees a rate. Search is debounce; scroll position is throttle.

---

### I25. What is code splitting, and where do you split?

**Answer.** `lazy(() => import('./Page'))` inside a `<Suspense>` boundary. The
bundler emits a separate chunk fetched on first visit.

**Where, in order of value:** routes, heavy dependencies behind an interaction,
rarely-opened dialogs. **Not** tiny components — each chunk is a network request.

**Real-world example, and the honest part:** splitting made cold load *worse*
here — 213 → 245 kB gzip, because separate gzip streams share no dictionary. It
was kept for cache stability: a redeploy costs a returning user ~8.5 kB instead
of 213 kB.

**Follow-up.** *"So is splitting good?"* — it depends on your traffic shape. That
answer is worth more than a yes.

---

## Self-check before moving on

1. Name three cases where `useEffect` is the wrong tool.
2. What is the difference between `isLoading` and `isFetching`?
3. Why must the error branch come before the empty branch?
4. What defeats `React.memo`?
5. Why is a route guard not security?

---

**Next:** [03 — Advanced](03-advanced.md)
