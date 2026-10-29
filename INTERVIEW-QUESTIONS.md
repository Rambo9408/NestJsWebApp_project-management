# The question bank

> **Part 57.** 130 questions, consolidated from every phase of this project plus
> the gaps that showed up while writing it.
>
> Each answer is the **short spoken version** — what you'd actually say out loud
> in about thirty seconds. The link goes to the full treatment, usually
> alongside the code that demonstrates it.

**How to use this.** Cover the answer, say yours out loud, then compare. Reading
answers feels productive and isn't; the failure mode in interviews is knowing a
thing and not being able to say it in order.

Questions marked **★** are ones where this project has a *specific, concrete*
story — a bug, a measurement, a trade-off you personally made. Those are worth
memorising, because a specific answer is worth five general ones.

Questions marked **⚠** are traps: the obvious answer is wrong or incomplete.

---

## Contents

| §                                                       | Questions | Theme                              |
| ------------------------------------------------------- | --------- | ---------------------------------- |
| [1. The React mental model](#1-the-react-mental-model)  | 1–12      | Coming from Angular                |
| [2. Components, props, state](#2-components-props-and-state) | 13–24 | Composition and data flow          |
| [3. Hooks](#3-hooks)                                    | 25–42     | The rules and the reasons          |
| [4. Rendering and reconciliation](#4-rendering-and-reconciliation) | 43–54 | What React actually does |
| [5. State management](#5-state-management)              | 55–68     | Local, Redux, RTK Query            |
| [6. Routing and forms](#6-routing-and-forms)            | 69–78     | React Router 7, RHF, Zod           |
| [7. API integration](#7-api-integration)                | 79–88     | Talking to NestJS                  |
| [8. Auth and security](#8-auth-and-security)            | 89–100    | Tokens, CSRF, the boundary         |
| [9. Performance](#9-performance)                        | 101–110   | Measured, not assumed              |
| [10. Testing](#10-testing)                              | 111–118   | And what tests cannot see          |
| [11. Accessibility](#11-accessibility)                  | 119–124   | Beyond "we run axe"                |
| [12. Production](#12-production)                        | 125–130   | Docker, nginx, CI                  |

Backend questions live in [`nestbackend/docs/phase-21-interview-questions.md`](nestbackend/docs/phase-21-interview-questions.md);
architecture and system design in [`ARCHITECTURE-QUESTIONS.md`](ARCHITECTURE-QUESTIONS.md).

---

## 1. The React mental model

**1. You've worked in Angular. What's the single biggest adjustment?** ★

Change detection. Angular watches object *properties* and re-renders when a value
differs. React compares *references* — mutating an object and setting it back
does nothing, because `prev === next`. Everything else follows from that: why
state is immutable, why `useMemo` has a dependency array, why `key` matters.

**2. So why is immutability required rather than just recommended?** ⚠

Because React's bailout check is `Object.is(prev, next)`. Mutating and re-setting
the same reference is indistinguishable from no change, so the component doesn't
re-render — silently. It's not a style preference; it's the mechanism.
→ [phase 2](reactfrontend/docs/phase-02-components-jsx-props-state.md)

**3. What is JSX, actually?**

Sugar for `React.createElement` (or `jsx()` with the modern transform). It
produces a plain object describing what to render — not DOM, not HTML. That's why
you can return it from a function, store it in a variable, and pass it as a prop.

**4. Why can a component return JSX as a prop, and why does that matter?**

Because JSX is data. A `ReactNode` prop is a slot — inversion of control without
a framework feature. Angular needs `ng-content` and `TemplateRef` for the same
thing.
→ `EmptyState`, `TaskCard`'s `actions`

**5. What replaces Angular's dependency injection?**

Nothing does, exactly — and that's the honest answer. Imports replace most of it;
Context replaces the "ambient value many levels down" case. What you lose is
constructor-injected, per-instance, hierarchically-overridable services. What you
gain is that a module is a module and you can see where things come from.

**6. What replaces `@Output()` / `EventEmitter`?**

A callback prop. It *is* the function — no emitter, no subscription, no `.emit()`.
Genuinely simpler.

**7. What replaces RxJS?**

For server state, RTK Query. For local state, `useState`. For the genuinely
stream-shaped cases — an SSE feed, debounced input — a hook with an effect. React
has no built-in stream primitive, which is a real gap when you're used to
operators.

**8. What replaces `ngIf` / `ngFor`?** ⚠

`&&`/ternary and `.map()`. The trap: `{count && <X/>}` renders `0` when count is
zero, because `0` is falsy but a valid ReactNode. Use `count > 0 &&`.

**9. What are the "rules of hooks" and why do they exist?**

Call them unconditionally, at the top level, from a component or another hook.
React stores hook state in an array indexed by call order — a conditional call
shifts every subsequent index onto the wrong slot.

**10. What is a "controlled" component?**

One whose value comes from React state and whose changes go through a handler.
The alternative — uncontrolled, with a ref — is closer to how Angular template
forms feel, and is what React Hook Form uses for performance.

**11. Class components — do you need to know them?**

Enough to read them and to answer *why* hooks replaced them: logic reuse. HOCs
and render props both worked and both produced wrapper hell; a custom hook is
just a function call. Error boundaries are still class-only.

**12. What's the honest state of your React experience?** ★

Two-plus years professional TypeScript/Node, Angular day to day; React learned
properly a couple of years ago and rebuilt seriously in this project. The
transferable half is large — component architecture, RxJS→async state, DI→module
design, forms, routing, auth, testing. The React-specific half is what this
project is for. Say that; it's stronger than a padded number and it survives
follow-up questions.
→ [POSITIONING.md](POSITIONING.md)

---

## 2. Components, props and state

**13. When does a value belong in state?** ⚠

When you cannot derive it. If it's computable from props and other state,
compute it during render. Storing derived values creates a second source of truth
that is always one render stale.
→ `TaskCard`'s `isOverdue`

**14. The most common unnecessary `useEffect`?**

Syncing state from props. `useEffect(() => setX(props.y), [props.y])` renders
twice and is stale in between. Just use `props.y`.

**15. What is "lifting state up", and what does it cost?**

Moving state to the nearest common ancestor so siblings share it. It costs
re-renders of everything in between, which is when you reach for context or a
store — not before.

**16. Prop drilling — when is it actually a problem?**

When intermediate components take props they don't use. Three levels of a prop
something genuinely needs is fine. The fix isn't automatically Context — often
it's composition (pass the rendered element down instead of the data).

**17. Why pass a whole object rather than fifteen scalar props?**

Prop explosion: every new field edits the component *and* every call site, and
nothing in the type system stops one task's title being paired with another's
status. The counter-argument is real — it couples the component to that shape.
Pass the object when the component is *about* the object.

**18. What's the `key` prop for?** ★

Identity across renders, not uniqueness in a list. React uses it to decide
whether to update an existing component or unmount and remount. Wrong keys mean
state attached to the wrong row.

**19. When is the array index a valid key?**

When the items have no identity to preserve: stateless, never reordered, never
filtered. Skeleton placeholders qualify. A list of anything with state does not.

**20. `key` on a component to force a reset — good idea?**

It's the documented way to reset state deliberately, and it's clearer than an
effect that clears fields. Just be aware you're unmounting: refs, focus and
animations all reset too.

**21. Composition vs configuration — how do you decide a component's API?**

If callers need different *shapes*, take a `ReactNode` slot. If they need
different *values*, take props. `onEdit`/`onDelete` callbacks serve one caller and
grow forever; an `actions` slot serves all of them.

**22. What makes a component "presentational", and why bother?**

No fetching, no dispatch, no router. Four concrete pay-offs: renders anywhere,
tests need no providers, every state is reachable without contriving backend
data, and it survives data-layer rewrites — this project changed its data layer
twice and `TaskCard` didn't change.

**23. Why is an N+1 in the UI worse than one in a query?**

It's invisible. Fifty cards each fetching their assignee is fifty requests spread
across fifty components — no single place looks wrong. Resolve it in the parent,
or have the API return what the list needs.

**24. `null` vs `undefined` in props — do you distinguish?**

Yes, and consistently: `assigneeId: string | null` means present-and-empty
("unassigned" is a real state), `description?: string` means may-be-absent. They
read identically in JSX and mean different things in the domain.

---

## 3. Hooks

**25. `useState` vs `useReducer` — where's the line?**

When the next state depends on the previous in more than a trivial way, or
several values change together, or the transitions have names. A reducer also
makes the state machine testable without React.

**26. What's a stale closure?** ★

A callback captured a render's variables and is called later, after those values
changed. It sees the old values because that's genuinely what it closed over.
Fixes: functional updates, correct dependency arrays, or a ref for
"latest value" cases.

**27. When must you use the functional form of `setState`?**

Whenever the new value depends on the old one and the update might batch or fire
from a closure — `setCount(c => c + 1)`, not `setCount(count + 1)`.

**28. What does the `useState` initialiser argument do?**

`useState(expensiveInit())` calls it on *every* render and throws the result away.
`useState(() => expensiveInit())` calls it once. Easy to miss, real cost.

**29. What actually goes in a dependency array?** ⚠

Every reactive value the effect reads. Not "what I want it to run on". Lying to
the linter is how you get bugs that only appear on the second interaction —
which is why `react-hooks/exhaustive-deps` is an **error** in this project, not a
warning.

**30. `useEffect` cleanup — what breaks without it?** ★

Subscriptions, timers and in-flight requests outlive the component. Delete the
cleanup from the SSE hook here and you leak an EventSource per mount and get
duplicate notifications.

**31. Why does an effect run twice in development?**

StrictMode mounts, unmounts and remounts to surface missing cleanup. It's a
feature: if double-invocation breaks your effect, the effect wasn't idempotent
and would have broken in production eventually.

**32. `useMemo` vs `useCallback`?**

`useMemo` memoises a value; `useCallback` memoises a function (it's
`useMemo(() => fn, deps)`). Both are for referential stability, mostly to keep a
memoised child from re-rendering.

**33. When is `useMemo` actively harmful?** ⚠

When the computation is cheaper than the comparison — which is most of them. It
adds allocation, a dependency array to keep correct, and noise. Memoise when
you've measured, or when the *identity* is what matters.

**34. `useRef` — two distinct uses?**

A DOM handle, and a mutable box that survives renders without causing them.
The second is the one people forget: "remember this across renders but don't
render it" — like the `isFirstRender` flag in this project's route announcer.

**35. Why doesn't changing a ref re-render?**

Because it's a plain mutable object, not state. That's the point. Using a ref for
something the UI displays is the classic misuse.

**36. `useLayoutEffect` — when?**

When you must read layout and mutate before paint, to avoid a visible flash. It
blocks painting, so it's the exception. Also: it doesn't run during SSR.

**37. What makes a good custom hook?**

It has a reason to exist beyond "extracting lines". Good ones own a piece of
behaviour with its own lifecycle — a subscription, a debounce, a fetch. Signals
of a bad one: it takes eight arguments, or it's called once.

**38. Does extracting a hook share state between components?** ⚠

No. Each call gets its own state. Hooks share *logic*, not *state* — a genuinely
common misconception, and the reason people reach for a store.

**39. Write `useDebounce`.**

```ts
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);   // the cleanup IS the debounce
  }, [value, delay]);
  return debounced;
}
```
The cleanup cancelling the previous timer is the whole mechanism.

**40. Write `usePrevious`, and say why it isn't in React.**

```ts
function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T>(undefined);
  useEffect(() => { ref.current = value; });
  return ref.current;
}
```
It's not in core because writing a ref during render is unsafe under concurrent
rendering, and this pattern encourages exactly that. React's lint rules flag it.

**41. What's `useId` for?**

Stable, SSR-safe unique ids for `htmlFor`/`aria-describedby`. Not for keys.

**42. `useTransition` — what problem?**

Marking an update non-urgent so React can interrupt it and keep typing
responsive. It's the right answer to a janky filter over a large list — more so
than throttling the handler.

---

## 4. Rendering and reconciliation

**43. What are the render and commit phases?**

Render calls your components and builds a tree — pure, interruptible, may be
thrown away. Commit applies the diff to the DOM — synchronous, not interruptible.
Side effects belong in commit-phase effects because render may not "count".

**44. What is Fiber, in one sentence?**

A re-implementation of reconciliation as an interruptible linked-list walk with
per-node units of work, which is what makes concurrent features possible.

**45. Does "re-render" mean "touch the DOM"?** ⚠

No — and this is the most common misunderstanding. Re-render means React called
your function and diffed the result. If nothing changed, no DOM is touched. A
re-render is cheap; a re-render that allocates and diffs a huge tree isn't.

**46. What triggers a re-render?**

State change, a new context value, a parent re-rendering, or a store subscription
firing. Notably *not* prop mutation.

**47. Why does a parent re-render its children even if props are identical?**

Because rendering is calling the function, and the parent's JSX creates new child
elements. `React.memo` opts a child out by comparing props.

**48. How does React decide to update vs remount?**

Same position, same type, same key → update. Anything else → unmount and mount
fresh. That's why a component defined *inside* another component remounts every
render: it's a new function identity, so a new type.

**49. Two lists, same items, different order. What happens with index keys?**

React thinks item 0 changed its content rather than moved. State bound to
position — a checkbox, focus, an open menu — attaches to the wrong row. Visually
correct, behaviourally wrong.

**50. When is `React.memo` worth it?**

When the component is expensive *and* re-renders often with equal props. It costs
a props comparison every render, and it's defeated instantly by an inline object,
array or arrow-function prop.

**51. What defeats `React.memo` silently?**

`<Child style={{...}} onClick={() => x} items={[...]}/>` — three new references
per render. This is the main reason memo "doesn't work" for people.

**52. What's the significance of batching in React 18+?**

All updates batch, including in promises, timeouts and native handlers — not just
React event handlers as before. Fewer renders, and one fewer reason to reach for
`useReducer`.

**53. Why is virtualization sometimes the wrong answer?** ★

Because pagination usually solves it more cheaply, and virtualization breaks
Ctrl+F, anchors, print, and accessibility (a list that reports 20 items when it
has 10,000). This project's lists are server-paginated at 20; virtualizing them
would be pure overhead.

**54. How do you make a virtualized list accessible?**

`aria-setsize` and `aria-posinset` on each row, carrying the true position in the
full list. **Not** `aria-rowcount` — that's grid-family only, and putting it on
`role="list"` is invalid ARIA that gets discarded. This project shipped that bug
and axe caught it.
→ [phase 18–19](reactfrontend/docs/phase-18-19-security-and-accessibility.md)

---

## 5. State management

**55. How do you decide where state goes?**

Four buckets, and most bugs come from confusing the first two: **server state**
(RTK Query — it's a cache, not state), **URL state** (filters, page, sort),
**global client state** (session, theme, toasts), **local state** (everything
else). Default to local.

**56. Why is server state different in kind?**

You don't own it. It's stale the moment it arrives, it's shared, and it needs
caching, invalidation, deduplication and refetching. Storing it in `useState` and
syncing by hand is re-implementing a cache badly.

**57. Why put filters in the URL rather than state?** ★

A filtered view becomes shareable, bookmarkable, and survives refresh; back/
forward work. It's the single highest-value state decision in a list-heavy app
and it costs almost nothing.

**58. Redux Toolkit — what does it actually remove?**

Hand-written action types and creators, `switch` reducers, immutable spread
gymnastics (Immer), and store setup. `createSlice` generates actions from
reducers.

**59. Immer lets you write `state.x = 1` in a reducer. Is that mutation?** ⚠

No — you're mutating a Proxy draft; Immer produces a new immutable state from the
recorded changes. Which is why it's safe *there* and still forbidden everywhere
else.

**60. When do you actually need Redux now?**

Rarely for server state (RTK Query, or React Query). Reach for it when several
distant parts of the app share client state with non-trivial transitions, or when
you want the devtools/time-travel and middleware seams. Session and toasts here;
not much else.

**61. What is RTK Query's cache keyed on?**

Endpoint + serialised argument. Same args → same cache entry → deduplicated
request. Different args → different entry. This is why unstable argument objects
cause mysterious refetching.

**62. Explain tags and invalidation.**

Queries `provideTags`, mutations `invalidateTags`. Invalidation marks entries
stale so active subscribers refetch. It's declarative cache dependency — the
alternative is remembering to refetch by hand at every call site.

**63. `providesTags` for a list — what's the LIST id for?**

`[{type:'Task', id:'LIST'}, ...items]` lets a create-mutation invalidate just the
list without touching every individual entry, and lets an update invalidate one
item without refetching the list.

**64. How do optimistic updates work, and when are they wrong?**

`onQueryStarted` + `updateQueryData` applies the change immediately and
`.undo()`s on failure. Right for high-confidence, low-stakes, instantly-visible
actions (toggling done). Wrong when the server computes something you can't
predict, or when being wrong is expensive.

**65. Optimistic update plus `invalidatesTags` — what happens?** ⚠ ★

You get the instant update *and* a refetch, which defeats the point. This project
has a test asserting no refetch occurs — and that test was **vacuous** at first:
it passed even with `invalidatesTags` added, because the refetch dispatches after
the mutation promise resolves. Fixed by waiting.

**66. `useSelector` returning a new object — what breaks?**

It re-renders on every store change, because the default comparison is reference
equality. Fix: select primitives, or use `createSelector`, or
`shallowEqual`.

**67. What's a selector for, beyond tidiness?**

Decoupling components from state shape (you can restructure the store without
touching components) and memoising derived computations across components.

**68. Context vs Redux?**

Context is dependency injection, not state management — it has no reducers, no
devtools, and every consumer re-renders when the value changes. It's right for
low-frequency, tree-scoped values: theme, locale, a service handle.

---

## 6. Routing and forms

**69. What's a data router, and why use it?**

Routes declare `loader`/`action`, so data fetching moves into the route
definition and starts *before* the component renders — removing the
render-then-fetch waterfall. It also gives you `errorElement` per route.

**70. Why does a hard refresh of `/tasks/abc` 404 without server config?** ★

There's no file at that path. The server must fall back to `index.html`
(`try_files $uri $uri/ /index.html`). Until this project was containerised, that
was an open bug that soft navigation hid.

**71. `<Link>` vs `<a href>`?**

`<a>` triggers a full page load — bundle re-downloads, every store resets.
`<Link>` pushes history and lets the router swap the element. It still *renders* a
real anchor, which is what keeps middle-click, "open in new tab" and screen
readers working.

**72. How do you protect a route?**

A wrapper component that checks the session and redirects. And say the important
part unprompted: **it is not security**. It hides UI. The backend guard is the
boundary.

**73. What's the three-state problem in an auth guard?** ★

`authenticated | unauthenticated | restoring`. Model it as two and every page
reload flashes the login screen for an already-signed-in user while the refresh
call is in flight.

**74. `?next=` redirect after login — what's the risk?**

Open redirect: `?next=https://evil.example`. Validate it's a same-origin *path*
before navigating.

**75. Why React Hook Form rather than controlled inputs?**

It keeps inputs uncontrolled and subscribes to them, so typing doesn't re-render
the form. On a large form that's the difference between smooth and laggy.

**76. Why Zod instead of RHF's built-in validation?**

One schema gives you validation *and* the TypeScript type
(`z.infer`), so they can't drift. And the same schema shape mirrors the NestJS
DTO, which is the contract you're actually bound by.

**77. Client-side validation — what is it for?** ⚠

Feedback speed. Not correctness, not security. The server validates the same
rules because the client can be bypassed with one `curl`.

**78. How do you show a server-side field error (e.g. "email taken")?**

Map the API error onto the form with `setError('email', ...)`. Showing it as a
toast instead is the common lazy version and it's much worse — the user has to
remember which field it was about.

---

## 7. API integration

**79. Where does your frontend's idea of the API contract come from?** ★

The NestJS backend, generated from its OpenAPI document — not hand-written
guesses. And the honest caveat: the document has request schemas but **no
response schemas**, so generation guards what we *send*, not what we *receive*.
Closing that is a backend change.

**80. How do you stop generated types drifting from the API?**

Regenerate in CI and fail on a non-empty diff. This project's job caught real
drift on its first run — a 35th path added during a fix and never regenerated.

**81. You hand-write a response type. What's the risk beyond being wrong?** ★

Fields become *invisible*. This project's `Task` type omitted `reference` for
several phases — the human-readable "AP-1" that the whole UI needed. No error
anywhere; the field simply didn't exist as far as the frontend was concerned.

**82. Where do you put the access token?** ⚠

In memory, not `localStorage`. `localStorage` is readable by any XSS. In-memory
dies on refresh, which is what the refresh-token cookie is for. Neither is
"secure" — they trade different risks, and saying that is the answer.

**83. Why an httpOnly cookie for the refresh token?**

JavaScript can't read it, so XSS can't exfiltrate it. It's sent automatically,
which is exactly why you then need CSRF protection.

**84. Explain double-submit CSRF.**

Server sets a random value in a readable cookie; client copies it into a header.
An attacker's cross-origin form can *send* your cookie but can't *read* it to set
the header. Same-site cookies cover much of this now; double-submit is the
belt-and-braces.

**85. What is single-flight refresh and why does it matter?** ★

Five requests 401 at once → five refresh calls → with rotation, four use a token
already consumed → reuse detection revokes the session and logs the user out.
Fix: one in-flight promise everyone awaits.

**86. What must the refresh call itself avoid?**

Going through the interceptor. If the refresh 401s and triggers a refresh, you
have infinite recursion. Use a raw client for that one call.

**87. How many conditions guard a 401-retry?**

Four, and each one is a bug you'd otherwise ship: don't retry the refresh
endpoint, don't retry twice, don't retry when there was never a token, and
respect an explicit opt-out (login must show "wrong password", not attempt a
refresh).

**88. Two HTTP clients in one app — what went wrong here?** ★

`fetchBaseQuery` with a relative `baseUrl` threw `Failed to parse URL` under
undici while the hand-rolled `fetch` wrapper worked fine — the two transports
resolved relative URLs differently. Fixed by resolving to absolute. The lesson:
"it works in the browser" isn't the same as "it works".

---

## 8. Auth and security

**89. Is the frontend part of the security boundary?** ⚠ ★

No. Never. Every control in the UI is a *usability* feature — it stops honest
users doing pointless things. The backend guard is the boundary, and this project
proved it: an audit found eight endpoints where the API enforced nothing and a
second user could read, rename, reassign and **delete** another user's data.

**90. So why do RBAC in the UI at all?**

So people don't see buttons that will fail. That's it. It's worth doing and it's
worth being clear about what it isn't.

**91. Hide or disable an unavailable action?**

Hide when the user can never have it (an admin area). Disable, with a reason,
when they could have it — otherwise the UI looks broken. Hiding also avoids
advertising the existence of admin functionality.

**92. What's the difference between authentication and authorization here?**

Authentication is the JWT: who are you. Authorization is two systems sharing one
enum — a *global* role (admin/member) and a *per-project* role (manager/member) —
and the second is the one that's easy to get wrong.

**93. What's a collection-endpoint authorization bug?** ★

The single-item endpoint checks ownership, and the *list* endpoint doesn't. Here,
`GET /tasks` returned every task in the database: a brand-new user could see
another user's tasks and projects. The scoping must come from the token, not from
a query parameter.

**94. Subtle detail in that fix?**

The repository check is `!== undefined`, not truthiness. An empty array of
accessible projects must return **nothing** — with a truthy check it would mean
"no filter" and return everything. Exactly backwards, for the least privileged
user.

**95. How do you test an authorization fix?** ★

Two real users, and try the attack. Not "does Alice see her task" but "does
Mallory get 403 when she tries to delete Alice's". Then reintroduce the bug and
confirm the test fails. This project's backend went 67 → 90 e2e tests doing that.

**96. XSS in React — what's actually protected?**

Interpolated content is escaped. What isn't: `dangerouslySetInnerHTML`,
`javascript:` URLs in `href`, and injected `<script>` via third-party HTML.
There's zero use of the first in this codebase, deliberately.

**97. How do you rate-limit a login endpoint?** ★

Per-IP/per-user request limits with a much tighter budget than the general API.
Then say the three things that show you've done it: account lockout is a **DoS
vector** (anyone who knows your email locks you out); **probes must be exempt**;
and per-IP does **not** stop distributed credential stuffing.

**98. Why must a health probe never be rate-limited?** ★

Feedback loop. Throttled probe → container marked unhealthy → restarted → less
capacity → survivors throttled sooner → the deployment collapses under load it
could otherwise serve. This project shipped that bug: a 30-second healthcheck
against a 10-per-15-minute limit meant the container rate-limited **its own
liveness probe** permanently.

**99. You configure two named throttlers in `@nestjs/throttler`. Which routes
does each apply to?** ⚠ ★

Both, to every route. The array isn't a menu you opt into — every entry is
enforced everywhere. `@Throttle` *reconfigures* a named throttler for a handler;
`@SkipThrottle` opts out. Getting this backwards capped this entire API at ten
requests per fifteen minutes.

**100. What security headers does a static SPA need, and what's the nginx
trap?** ★

`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, ideally a CSP. The
trap: nginx `add_header` is inherited **only if the current level defines none**.
A `location = /index.html` block that sets `Cache-Control` silently discards every
server-level security header — on the entry page, which via the SPA fallback is
every route.

---

## 9. Performance

**101. How do you approach a "the app is slow" report?**

Measure first, and establish *which* slow: initial load, interaction latency, or
a specific list. They have completely different causes and fixes. Profiler for
renders, Network for waterfalls, Lighthouse for load.

**102. What does the React Profiler actually tell you?**

Which components rendered, why, and how long the commit took. The "why did this
render" attribution is the valuable part — it usually shows a context or an
unstable prop, not the component you suspected.

**103. Code splitting made your bundle *worse*. Explain.** ⚠ ★

Measured here: 213 kB → 245 kB gzip on cold load, because separate gzip streams
share no dictionary — compression is worse across many small files than one large
one. Kept anyway, for cache stability: a redeploy costs a returning user ~8.5 kB
instead of 213 kB. **It's a traffic-shape trade-off, not a win.**

**104. So when is code splitting genuinely right?**

When routes are genuinely independent and users only visit some, when you deploy
often (cache stability dominates), or when a heavy dependency is used on one
screen. Not reflexively.

**105. What's the SPA caching contract?**

Content-hashed assets: `immutable`, one year. `index.html`: never cached. Get it
backwards and returning users load yesterday's HTML pointing at chunk hashes that
no longer exist — a blank page after every deploy.

**106. What is a bundle budget for?**

Noticing. The number is arbitrary; having one is not. Without it a dependency
that doubles the bundle gets discovered six months later.

**107. `useMemo` everywhere — why is that a bad instinct?**

Every memo has a cost and a correctness burden (the dependency array). Most
computations are cheaper than the comparison. Optimise what you measured.

**108. How do you fix a laggy filter over a large list?**

In order: is it actually the list (measure)? Then debounce the *input*, virtualize
or paginate the *list*, and mark the update non-urgent with `useTransition`.
Throttling the scroll handler is usually the wrong lever.

**109. What are the Core Web Vitals and which does a component affect?**

LCP, CLS, INP. A component affects CLS directly: a spinner replaced by content of
a different height shifts the page under someone's finger. A skeleton matching the
real layout scores zero shift.

**110. Where does SSR/RSC fit, and why doesn't this project use it?**

They move work to the server for LCP and SEO. This is an authenticated internal
tool: no SEO value, and every page needs a session anyway. Knowing when *not* to
adopt something is the answer.

---

## 10. Testing

**111. What are you testing at each layer here?**

Unit (a component with fakes injected), integration (real fetch against MSW, no
React), flow (page + store + router + transport), and — missing, honestly — real
browser E2E. The third layer catches "everything works in isolation and nothing
is connected".

**112. Why MSW rather than mocking fetch?**

It intercepts at the network layer, so your code under test uses its real
transport — headers, status codes, retries all exercised. Mocking `fetch` tests
that you called a mock.

**113. What's a vacuous test, and how do you find one?** ★

One that passes whether or not the code is correct. You find them by
**reintroducing the bug and confirming the test fails**. This project found two of
its own that way — including an MSW handler that made the old token valid again,
so "retries with the *new* token" passed even when the client replayed the stale
one.

**114. What can a jsdom test never catch?** ⚠ ★

Anything decided by layout: z-order, occlusion, clipping, scroll position,
whether a focus ring is visible. jsdom has no layout engine and no hit-testing, so
`user.click(el)` dispatches on `el` whatever covers it. I claimed a test here was
load-bearing for a z-index, checked, and it wasn't.

**115. What *can* jsdom test faithfully?**

The DOM tree, ARIA attributes, and the **focus model** — `document.activeElement`
and tab order are implemented properly. Focus isn't layout, which is why the
skip-link tests here are honest.

**116. Testing Library's guiding principle?**

Query the way a user finds things — by role and accessible name — so tests break
when the experience breaks, not when the markup is refactored. It also makes
accessibility failures show up as test failures.

**117. How do you test something asynchronous without flake?**

`findBy*` and `waitFor` on the assertion you care about. Never a fixed
`setTimeout`, and never assert on an intermediate loading state you didn't cause.

**118. A test suite is green and you don't trust it. What do you do?**

Mutation-test it by hand: break the code in ways that matter and see what fails.
Anything that stays green is either untested or vacuous. Cheap, and uncomfortable
in a useful way.

---

## 11. Accessibility

**119. "We run axe in CI, so we're accessible." Respond.** ⚠ ★

Automated tooling finds roughly a third of real problems. Here it found four
genuine violations in components — and **zero** in the app shell, where the two
Level-A failures actually were. It's a floor, not a certificate.

**120. What's the canonical SPA accessibility failure?** ★

Navigation is silent. A real page load moves focus to the new document and the
screen reader starts reading; `pushState` does none of that. The URL changes, the
page looks entirely different, and for a screen-reader user nothing happened.
Fix: move focus to `<main>` **and** announce the page in a live region.

**121. What's the detail that shows you've actually implemented that?**

`tabIndex={-1}` on `<main>`. Without it `.focus()` is a no-op and a skip link
moves scroll but not focus — so the next Tab goes straight back to the nav.

**122. Why is invalid ARIA worse than no ARIA?** ★

No ARIA falls back to sensible native behaviour. Invalid ARIA is discarded but
*reads as done* — it typechecks, it lints, it reviews well. This project shipped
`aria-rowcount` on `role="list"`, where it does nothing, with a correct comment
beside it explaining the problem it wasn't solving.

**123. How do you make a whole card clickable?**

Three options, and name all three: `onClick` on a div (broken for keyboard and
screen readers), hand-rolled `role="button"` (valid *until* the card contains its
own controls — then it's `nested-interactive` and the inner button becomes
unreachable), or an overlay button that's a sibling of the content. Then say what
the overlay costs: text selection.

**124. When does passing an axe rule make the experience worse?** ★

A nameless spinner fails `aria-progressbar-name`. Adding `aria-label="Loading"`
passes — and now the user hears it twice, because the adjacent status text says
the same thing. `aria-hidden` on the decorative animation is better and also
passes. Rules encode intent imperfectly.

---

## 12. Production

**125. Why multi-stage Docker?**

The runtime image should contain what runs, not what built it. Here: ~1.1 GB of
toolchain → an 89 MB nginx image with no Node, no npm and no source. Every removed
package is removed attack surface.

**126. Same technique, different conclusion for the backend — why?**

The API image *ends* on `node:22-alpine` because a Nest server genuinely needs a
Node runtime. The technique isn't the point; asking "what does this actually need
at runtime?" is.

**127. Why run a container as non-root?**

An escape from root is a far better starting position for an attacker. It costs
you an unprivileged port — nginx on 8080 rather than 80.

**128. What breaks SSE behind a proxy?** ★

nginx buffers proxied responses by default, so events sit in a buffer until it
fills. `proxy_buffering off` is mandatory, and `proxy_read_timeout` must exceed the
heartbeat interval or nginx closes the connection and the client reconnects in a
loop.

**129. Why did EventSource need the token in the query string?** ⚠

Because `EventSource` can't set headers. Which means the token lands in server
logs and browser history — so it must be short-lived, and this is a real argument
for `fetch`-based streaming instead.

**130. Name three bugs that only running the thing would find.** ★

From this project: the bundle visualiser's `stats.html` shipping to production;
`sed -i` exiting 0 on no match so a Dockerfile patch silently never applied;
`curl -s -o` overwriting a checked-in OpenAPI spec with a 404 body. None would be
caught by lint, typecheck or tests.

---

## Where to go next

- [ARCHITECTURE-QUESTIONS.md](ARCHITECTURE-QUESTIONS.md) — 20 system-design
  discussions
- [SENIOR-SCENARIOS.md](SENIOR-SCENARIOS.md) — 40 "what would you do" situations
- [CODING-EXERCISES.md](CODING-EXERCISES.md) — 50 standalone implementations
- [MOCK-INTERVIEW.md](MOCK-INTERVIEW.md) — a full loop, with follow-ups
- [POSITIONING.md](POSITIONING.md) — how to talk about your experience honestly
