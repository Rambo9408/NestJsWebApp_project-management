# TaskFlow — React frontend

The client for the [NestJS API](../nestbackend/README.md) in this repository.
A project-management SPA built as a **production-style reference** and as
interview-preparation material, where the source comments carry the reasoning
rather than sitting beside it.

**Status: all 28 phases complete.** 222 tests, lint and typecheck clean,
containerised, and every known defect written down rather than hidden.

> **Start here** for reference material. For the phase-by-phase walkthrough go to
> [`docs/`](docs/); for the repository as a whole go to [`../README.md`](../README.md).

---

## Table of contents

**Getting started** — [1](#1-project-overview) · [2](#2-technology-stack) ·
[3](#3-dependencies-and-why-each-one) · [4](#4-installation) ·
[5](#5-environment-variables) · [6](#6-running-locally) · [7](#7-scripts)

**Architecture** — [8](#8-folder-structure) ·
[9](#9-feature-based-architecture) · [10](#10-component-architecture) ·
[11](#11-the-api-contract) · [12](#12-api-endpoints) ·
[13](#13-end-to-end-request-flow)

**React** — [14](#14-rendering-model) · [15](#15-reconciliation-and-keys) ·
[16](#16-hooks) · [17](#17-custom-hooks) · [18](#18-effects-and-when-not-to-use-them)

**State** — [19](#19-state-architecture) ·
[20](#20-client-state-vs-server-state) · [21](#21-redux-toolkit) ·
[22](#22-rtk-query) · [23](#23-context)

**Application** — [24](#24-routing) · [25](#25-forms-and-validation) ·
[26](#26-authentication) · [27](#27-authorization-and-rbac) ·
[28](#28-real-time-sse) · [29](#29-loading-error-and-empty-states) ·
[30](#30-data-tables-and-pagination) · [31](#31-search-filter-and-sort)

**Quality** — [32](#32-typescript) · [33](#33-testing-strategy) ·
[34](#34-api-mocking-with-msw) · [35](#35-performance) ·
[36](#36-code-splitting) · [37](#37-security) · [38](#38-accessibility) ·
[39](#39-error-handling)

**Delivery** — [40](#40-docker) · [41](#41-nginx) · [42](#42-cicd) ·
[43](#43-production-architecture)

**Reference** — [44](#44-design-patterns-used) ·
[45](#45-anti-patterns-and-what-to-do-instead) ·
[46](#46-design-decisions-and-trade-offs) · [47](#47-common-mistakes) ·
[48](#48-debugging-guide) · [49](#49-angular--react-mapping) ·
[50](#50-known-issues) · [51](#51-interview-preparation)

---

## 1. Project overview

A project-management application: users belong to projects, create and assign
tasks, comment on them, receive real-time notifications, and administrators
review an audit trail.

```
User
 ├── belongs to Projects        (with a per-project role)
 ├── creates Tasks
 ├── assigns Tasks
 ├── comments on Tasks
 ├── receives Notifications     (over SSE)
 └── generates Activity Logs    (admin-visible)
```

**What makes it a reference rather than a demo:** it talks to a real API with
real authentication, real authorization at three levels, generated types, a
container, and a CI pipeline. And where something was measured and the result
was unflattering, the number is here.

---

## 2. Technology stack

| Layer | Choice | Version |
| --- | --- | --- |
| Library | React | 19 |
| Language | TypeScript (strict) | 6 |
| Build | Vite | 8 |
| Routing | React Router (data router) | 7 |
| Client state | Redux Toolkit | 2 |
| Server state | RTK Query | (in RTK) |
| Forms | React Hook Form | 7 |
| Validation | Zod | 4 |
| Components | MUI | 9 |
| Tests | Vitest + Testing Library + MSW | 4 / 2 |
| Lint | ESLint flat config + Prettier | 9 |

**TypeScript is configured strictly**, including `noUncheckedIndexedAccess` (so
`array[0]` is `T | undefined`) and `erasableSyntaxOnly` (no parameter properties,
no enums with runtime behaviour beyond const objects).

---

## 3. Dependencies, and why each one

The brief for this project asked for a justification per dependency. Here it is,
including the ones that would not survive a second look.

### React Router 7 — *keep*

**Problem it solves:** client-side navigation without a page reload.
**Alternative:** TanStack Router (better type safety), or none for a single-page
tool.
**Trade-off:** the data-router API is the fourth thing "React Router" has meant,
so most material online describes a different library.
**Every app?** Any app with more than one screen.

### Redux Toolkit + RTK Query — *keep*

**Problem:** two problems. RTK is a state container with devtools and middleware;
RTK Query is a **server-state cache** with deduplication, tag invalidation and
background refetching.
**Alternative:** Zustand or Jotai for client state; React Query for server state.
React Query is the better *standalone* choice — RTK Query wins here because the
store already exists.
**Trade-off:** a large dependency and Redux concepts to learn, for an app whose
store holds three slices.
**Every app?** **No.** Most apps need the server-state half and nothing else.

### React Hook Form + Zod — *keep*

**Problem:** form state without re-rendering on every keystroke, and validation
that also produces the TypeScript type.
**Alternative:** Formik (slower, controlled), or plain `useState` for small
forms.
**Trade-off:** RHF's uncontrolled model is less obvious than controlled inputs
and occasionally fights libraries that expect a controlled value.
**Every app?** Not for a two-field form.

### MUI 9 — *the one to revisit*

**Problem:** accessible, complete components without building a design system.
**Alternative:** Radix + Tailwind (much smaller, unstyled), Mantine, or
hand-rolled.
**Trade-off — measured:** **~210 kB of the 245 kB gzip bundle.** It bought
correct focus management, portals and ARIA that would have taken weeks; it costs
most of the payload.
**Every app?** No, and this is the dependency I would reconsider first.

### Vite — *keep*

**Problem:** dev server startup and HMR.
**Alternative:** Next.js if you need SSR (see §35), Rspack, or webpack.
**Trade-off:** the dev server uses native ESM and the production build uses
Rollup, so they are not identical — a class of "works in dev" bug.

### What is deliberately absent

- **No date library.** `Intl.DateTimeFormat` via `toLocaleDateString` is built
  in, costs nothing, and respects the user's locale. Date *maths* across time
  zones is where a library earns its place.
- **No `axios`.** `fetch` plus a thin wrapper does the job; the wrapper is where
  interceptor behaviour lives anyway.
- **No virtualization library.** A ~40-line `VirtualList` exists to demonstrate
  the mechanism. **Use `react-window` or `@tanstack/virtual` in production** —
  variable row heights, scroll restoration and RTL are real work.

---

## 4. Installation

```bash
npm install
```

Node 20+. The repository root has convenience scripts that drive both halves —
see [`../README.md`](../README.md).

---

## 5. Environment variables

Everything is in [`.env.example`](.env.example). There is exactly one variable,
and it should normally stay unset.

> ### Everything here is public
>
> Vite substitutes `VITE_*` values as **string literals into the bundle** served
> to every browser. There is no such thing as a private value in a frontend
> build. API keys, signing secrets and database URLs belong on the NestJS side.
>
> The `VITE_` prefix is a guard rail against accidental exposure, **not** a
> security boundary.

| Variable | Default | When to set it |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `/api/v1` (relative) | Only to point a local frontend at a **remote** backend |

**Leave it unset for normal development.** The relative default is forwarded by
the Vite dev proxy and reverse-proxied by nginx in production — one path,
correct in both, no CORS, and cookies attach automatically.

Setting it makes requests cross-origin, so that origin must appear in the
backend's `CORS_ORIGINS` allow-list.

---

## 6. Running locally

```bash
# from the repository root — starts MongoDB, Redis, the API and this app
npm run infra:up
npm run dev
```

Then open **http://localhost:5173**.

```
Browser ──► :5173  Vite dev server
                   │  proxies /api and /health
                   ▼
            :3000  NestJS  ──►  MongoDB :27018   Redis :6379
```

**Same-origin in dev and production, deliberately.** No CORS preflight, cookies
attach without ceremony, and one relative `/api/v1` is correct in both.

---

## 7. Scripts

| Script | What it does |
| --- | --- |
| `dev` | Vite dev server with HMR |
| `build` | `tsc -b` then `vite build` — types are a build gate, not a suggestion |
| `preview` | serve the production build locally |
| `lint` / `lint:fix` | ESLint, `--max-warnings 0` |
| `typecheck` | `tsc -b --noEmit` |
| `format` / `format:check` | Prettier |
| `test` / `test:watch` / `test:cov` | Vitest |
| `api:types` | regenerate request types from the running API's OpenAPI document |
| `analyze` | build with the bundle visualiser (opt-in — see §35) |

> **Use `npm run typecheck`, not bare `npx tsc --noEmit`.** This project uses
> project references, so the bare form silently checks nothing. A missing
> identifier once went undetected because of exactly that.

---

## 8. Folder structure

```
src/
├── app/                 store, router, providers
│   └── providers/       theme mode, app-wide composition
├── components/          reusable, domain-agnostic UI
│   ├── auth/            RequirePermission
│   ├── feedback/        Empty / Error / Loading states, ErrorBoundary
│   ├── forms/           form primitives
│   ├── modals/          the compound Modal
│   ├── tables/          DataTable, VirtualList
│   └── ui/              badges and small display components
├── config/              env parsing, constants
├── features/            domain slices — the important directory
│   ├── activity/  auth/  comments/  notifications/
│   ├── projects/  tasks/  ui/  users/
├── hooks/               generic hooks (useDebounce, useLocalStorage, …)
├── layouts/             RootLayout, AuthLayout, SettingsLayout
├── pages/               route components — thin, compose features
│   ├── admin/  settings/
├── routes/              path constants and route guards
├── services/            httpClient, refreshClient, apiSlice
├── test/                setup, axe helper, MSW handlers
├── types/               api.ts (hand-written), requests.ts (generated)
└── utils/
```

---

## 9. Feature-based architecture

**Group by feature, not by type.** `features/tasks/` holds its components, hooks,
API slice and types together.

**Why:** features are how work arrives. "Add a due-date filter" touches one
directory. In a type-first layout (`components/`, `hooks/`, `types/` at the top)
the same change touches four, and nothing tells you which files belong together.

**The boundary rules** — the part that actually scales:

- A feature may import from `components/` and `services/`, **never** from another
  feature's internals.
- Shared code moves **down** into `components/` when a second feature needs it —
  not in anticipation.
- Cross-feature communication goes through the store or the router.

**What is missing, honestly:** an ESLint import-boundary rule enforcing the
above. Conventions that live only in a README erode within two quarters.

---

## 10. Component architecture

### Presentational vs container

`TaskCard` is presentational: it receives a `Task` and renders it. No fetching,
no dispatch, no router.

**Four concrete pay-offs**, not a principle:

1. It renders identically in a list, a search result and a detail page.
2. Its tests need no store, no router and no network.
3. Every state (overdue, unassigned, urgent) is reachable without contriving
   backend data.
4. When the data layer changed — twice in this project — it did not.

### Slots over configuration

```tsx
<TaskCard task={task} actions={<OverflowMenu id={task.id} />} />
```

A `ReactNode` prop serves a list view, a board and a detail page.
`onEdit`/`onDelete` callback props serve one and then grow forever.

### Compound components

```tsx
<Modal open={open} onClose={close} title="Delete comment">
  <Modal.Body>…</Modal.Body>
  <Modal.Footer>…</Modal.Footer>
</Modal>
```

The parent owns **behaviour** (open state, escape, focus, the accessible-name
wiring); the caller owns **content**. Context rather than `cloneElement`, so a
part still works when wrapped in a layout div.

**Its cost, stated:** `Modal.Footer` is a property access, so bundlers cannot
tree-shake unused parts. Fine here; for a shipped library, named exports are the
better trade.

→ [phase-12](docs/phase-12-projects-and-data-table.md)

---

## 11. The API contract

**The backend is the source of truth.** Nothing here invents an endpoint.

| | Source | Guards |
| --- | --- | --- |
| `types/requests.ts` | **generated** from OpenAPI | what we **send** |
| `types/api.ts` | hand-written, verified against live responses | what we **receive** |
| `types/contractCheck.ts` | compile-time assertions | that the two agree |

```ts
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
                   (<T>() => T extends B ? 1 : 2) ? true : false;
export type _RegisterPayloadMatchesBackend = Expect<Equal<RegisterPayload, RegisterRequest>>;
```

**Drift is a CI failure.** The `contract-drift` job boots the API, regenerates,
and fails on a non-empty diff. It caught a real 35th path on its first run.

> ### The honest limitation
>
> The OpenAPI document has request schemas but **no response schemas**. So
> generation guards one direction and looks like it guards both.
>
> That gap produced a real defect: `POST /tasks/:id/comments` returns
> `author: null` while `GET` populates it — **both declared `CommentView`**.
> Nothing in either codebase could have caught it; it took calling both endpoints
> and diffing the JSON.

---

## 12. API endpoints

45 operations, of which this client uses the following. Full definitions in
[`openapi/openapi.json`](openapi/openapi.json).

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/auth/register` `/auth/login` | strict rate limit: 10 / 15 min |
| `POST` | `/auth/refresh` `/auth/logout` `/auth/logout-all` | rotation + reuse detection |
| `GET` `PATCH` | `/auth/me` | session restore, profile edit |
| `POST` | `/auth/password` | |
| `GET` | `/users` `/users/{id}` | admin-scoped |
| `PUT` | `/users/{id}/role` | admin only |
| `GET` `POST` | `/projects` | list is scoped from the token |
| `GET` `PATCH` | `/projects/{id}` | |
| `POST` | `/projects/{id}/archive` `/projects/{id}/members` | |
| `DELETE` | `/projects/{id}/members/{userId}` | |
| `GET` `POST` | `/tasks` | list is scoped from the token |
| `GET` `PATCH` `DELETE` | `/tasks/{id}` | `TaskAccessGuard` |
| `PATCH` | `/tasks/{id}/status` `/tasks/{id}/assignee` | status takes `{from,to}` |
| `GET` `POST` | `/tasks/{id}/comments` | |
| `DELETE` | `/tasks/{id}/comments/{commentId}` | author / manager / admin |
| `GET` | `/notifications` `/notifications/unread-count` | |
| `GET` | `/notifications/stream` | **SSE** |
| `PATCH` `POST` | `/notifications/{id}/read` `/notifications/read-all` | |
| `GET` | `/activity-logs` | admin only |
| `GET` | `/health/live` | version-neutral, **outside** `/api/v1` |

**Not used, deliberately:** `DELETE /comments/{id}` is deprecated and enforces a
narrower rule (author-or-admin) than the nested route, so a project manager
moderating a comment would get a 403 for no visible reason.

---

## 13. End-to-end request flow

### Creating a task

```
User → React Hook Form → Zod validation
     → RTK Query mutation → httpClient (bearer + CSRF)
     → POST /tasks
     → NestJS: ValidationPipe → JwtAuthGuard → RolesGuard → ProjectAccessGuard
     → TasksService → Mongoose → MongoDB
     → response → RTK Query cache → invalidatesTags → list refetches → UI
```

### A real-time notification

```
Task assigned → NestJS emits a domain event
              → NotificationService persists + publishes to Redis
              → every API instance's SSE handler pushes to its own connections
              → EventSource in the browser
              → dedupe by id → Redux notification state → the bell
```

**The Redis step is what makes it work with more than one instance.** Without
pub/sub, a user connected to instance A never sees an event raised on B.

### An expired access token

```
Any request → 401
  → is this the refresh endpoint?      → no
  → have we already retried?           → no
  → was there ever a token?            → yes
  → did the caller opt out?            → no
  → single-flight refresh (one promise, everyone awaits)
  → retry the original with the NEW token
```

**Four guard conditions, each a bug you would otherwise ship.** The opt-out
matters most: login must show "wrong password", not attempt a refresh.

---

## 14. Rendering model

**Render** calls your components and builds an element tree — pure,
interruptible, possibly discarded. **Commit** applies the diff to the DOM —
synchronous.

**"Re-render" does not mean "touch the DOM".** It means React called your
function and diffed the result. If nothing changed, no DOM is written.

**What triggers one:** a state change, a new context value, a parent rendering,
or a store subscription firing. Notably **not** mutating a prop — the bailout is
`Object.is`, so mutation is invisible.

→ [phase-04](docs/phase-04-rendering-reconciliation-keys.md)

---

## 15. Reconciliation and keys

Same position, same type, same key → **update**. Anything else → **unmount and
remount**.

`key` is **identity**, not uniqueness. State, focus, scroll position and
animations attach to a component instance; `key` tells React which instance is
which.

**When the index is correct:** the items are indistinguishable, stateless and
never reordered — the skeleton rows in `LoadingState`. There is no identity to
preserve because there is none.

**When it is a bug:** anything that can reorder or filter. Delete the first row
of a list of inputs and every value shifts up one. Visually plausible,
behaviourally wrong.

---

## 16. Hooks

The rules exist because React stores hook state in an array indexed by **call
order**. A conditional call shifts every subsequent hook onto the wrong slot.

That is why `TaskDetailPage` uses RTK Query's `skip` option rather than an early
return — the hook still runs, it just does not fire a request.

| Hook | Use here |
| --- | --- |
| `useState` | local state, everywhere |
| `useReducer` | via Redux slices |
| `useEffect` | subscriptions, focus management, timers |
| `useRef` | DOM handles, and "remember without rendering" |
| `useMemo` / `useCallback` | referential stability where it is consumed |
| `useContext` | theme, and the compound Modal |
| `useId` | form-label and `aria-labelledby` wiring |
| `useSyncExternalStore` | the pattern for external sources |

---

## 17. Custom hooks

| Hook | What it owns |
| --- | --- |
| `useDebounce` | a value delayed by N ms — the cleanup **is** the mechanism |
| `useLocalStorage` | lazy read, try/catch (Safari private mode throws) |
| `usePrevious` | the previous render's value |
| `useDisclosure` | open/close state for dialogs |
| `useSession` | the auth slice, read-only |
| `usePermissions` | a stable `can(capability, context)` |
| `useProjectRole` | the viewer's role in a given project |
| `useNotificationStream` | the SSE connection, with backoff and dedupe |
| `useUrlTaskFilters` | filters synced to search params |

**A good one owns behaviour with a lifecycle.** Signals of a bad one: eight
arguments, or one call site with no prospect of a second.

**The misconception worth naming:** extracting a hook does **not** share state.
Two components calling `useDisclosure()` get two independent dialogs.

---

## 18. Effects, and when not to use them

**Most `useEffect` calls should not exist.** Four cases where it is the wrong
tool:

| Instead of an effect | Do this |
| --- | --- |
| deriving state from props | compute during render |
| responding to a user event | put it in the handler |
| fetching data | use the query library |
| transforming for display | a plain expression |

`TaskCard`'s `isOverdue` is computed during render. In state it would be a second
source of truth, always one render behind — so the card would briefly show a
stale badge after the due date changed.

**What is left for effects:** synchronising with systems outside React. That is
the whole list.

`react-hooks/exhaustive-deps` is an **error** here, not a warning, because a lie
there produces bugs that appear on the second interaction and nowhere in testing.

---

## 19. State architecture

```
Does only one component need it?          → useState
Do a parent and its children need it?     → lift it
Would a user want to share this view?     → the URL
Is it genuinely app-wide?                 → a Redux slice
Did it come from the server?              → RTK Query
```

**Default to local.** Every other option costs re-renders, indirection, or both.

---

## 20. Client state vs server state

| Client state | Server state |
| --- | --- |
| modal open, theme, sidebar, form drafts, selection | users, projects, tasks, comments, notifications |
| you own it | you do **not** own it |
| `useState` / a slice | RTK Query |

**Server state is a cache**: stale on arrival, shared between users, needing
deduplication, invalidation and refetching. Putting it in `useState` and syncing
by hand is re-implementing a cache per component.

**The store here holds three slices:** session, UI/toasts, theme. That is the
whole of the genuinely global client state.

---

## 21. Redux Toolkit

```
Component → dispatch(action) → reducer → store → selector → Component
```

`createSlice` generates actions from reducers and applies **Immer**, so

```ts
state.items.push(item);   // a mutable DRAFT, not the state
```

is safe — you are mutating a Proxy, and Immer produces a new immutable object
from the recorded changes. Which is exactly why it is safe *there* and forbidden
everywhere else.

**`useSelector` returning a new object re-renders on every store change**,
because the default comparison is reference equality. Select primitives, or
memoise with `createSelector`.

---

## 22. RTK Query

`useGetTasksQuery(query)` does four things: serialises the argument into a
**cache key**, looks it up, **subscribes** this component, and decrements the
reference count on unmount.

It serialises by **value**, so an inline object argument is safe — unlike a
hand-rolled `useEffect` fetch, where a fresh object every render is an infinite
loop.

### Tags

Queries `provideTags`, mutations `invalidateTags`.

```ts
providesTags: (result, _e, { taskId }) => [
  ...result.items.map(({ id }) => ({ type: 'Comment' as const, id })),
  { type: 'Comment' as const, id: `LIST-${taskId}` },
]
```

**The list tag is scoped to the task.** A shared `LIST` would mean posting on
task A invalidates the comment list of every open task — invisible while testing
one, obvious with two.

### `isLoading` vs `isFetching`

`isLoading` is the **first** load of a cache key. `isFetching` is any in-flight
request, including a background refetch with data on screen.

Render a skeleton on `isFetching` and the list blanks every time the window
regains focus.

---

## 23. Context

**Context is dependency injection for values, not state management.** No
reducers, no devtools, and every consumer re-renders when the value changes.

Used here for the theme mode and the compound `Modal`'s shared handlers — both
low-frequency and tree-scoped.

**The re-render fix, before splitting or memoising:** push consumption **down**.
`ThemeModeToggle` reads the theme; `RootLayout` does not, so toggling does not
re-render the nav.

---

## 24. Routing

`createBrowserRouter` — the data-router API, for `errorElement` and the option of
loaders.

**Loaders are deliberately unused.** RTK Query owns server state, and two caching
layers that both think they own the same data is an architecture mistake rather
than a style one.

| Path | Guard |
| --- | --- |
| `/login` `/register` | public, `AuthLayout` |
| `/dashboard` `/tasks` `/tasks/:taskId` `/projects` `/projects/:projectId` | authenticated |
| `/settings/profile` `/settings/security` | authenticated |
| `/admin` `/admin/users` `/admin/activity` | admin |
| `/lab/*` | public — teaching demos with local fixtures |
| `*` | 404 |

**Route guards are not security.** They hide UI. An audit on this API found eight
endpoints where the server enforced nothing while the UI looked correct.

**`try_files` is required in production**, or a hard refresh of `/tasks/abc`
returns a real 404 from disk.

---

## 25. Forms and validation

React Hook Form keeps inputs **uncontrolled** and subscribes to them, so typing
does not re-render the form. Architecturally that is closer to Angular's
*template-driven* forms than to reactive ones.

Zod supplies validation **and** the type:

```ts
const schema = z.object({ body: z.string().trim().min(1).max(5000) });
type Values = z.infer<typeof schema>;
```

One source, so they cannot drift — and the shape mirrors the NestJS DTO.

> **Client validation is feedback speed, not correctness and not security.** The
> server validates the same rules because anything here is bypassable with one
> `curl`.

**Server-side field errors** are mapped onto the form with `setError`, not shown
as a toast — a toast makes the user remember which field it referred to.

---

## 26. Authentication

| Token | Stored | Why |
| --- | --- | --- |
| Access | **in memory** | `localStorage` is readable by any XSS |
| Refresh | **httpOnly cookie** | JavaScript cannot read it, so XSS cannot exfiltrate it |
| CSRF | readable cookie → header | double-submit; an attacker can send your cookie but cannot read it |

**Neither storage choice is "secure".** They trade different risks, and saying so
is the answer.

**Refresh uses rotation with reuse detection**, which creates the failure mode
worth knowing: five requests 401 at once → five refreshes → four present a
consumed token → the session is revoked. The fix is **single-flight**:

```ts
refreshInFlight ??= performRefresh().finally(() => { refreshInFlight = null; });
```

The `finally` is load-bearing. Without it the first result is cached forever.

**The refresh call uses a raw `fetch`**, not the interceptor — otherwise a 401 on
refresh triggers a refresh, recursively.

**Session state is a union**, not `user | null`:
`authenticated | unauthenticated | restoring`. Model it as two and every reload
flashes the login screen for an already-signed-in user.

---

## 27. Authorization and RBAC

**Two role systems sharing one enum**, because they answer different questions:

- **Global** (`admin` / `member`) — what kind of account is this?
- **Project** (`manager` / `member`) — what may you do *here*?

Collapsing them means either a project manager becoming a global admin, or admins
needing membership in every project.

One pure function answers both:

```ts
can(user, capability, context)   // exhaustive over capabilities via `never`
```

```tsx
<RequirePermission capability="project:create">
  <CreateProjectButton />
</RequirePermission>
```

> ### The frontend is not the security boundary
>
> Every control here is a **usability** feature — it stops honest users doing
> pointless things. Deleting the check changes nothing about what the server
> permits.
>
> Authorization has three levels: **route** (may you call this?), **collection**
> (which rows do you get?), and **object** (may you touch *this* one?). The
> collection level is the one that leaks quietly — `GET /tasks` here once
> returned every task in the database while `GET /tasks/:id` checked ownership
> correctly.

---

## 28. Real-time (SSE)

```
NestJS → Redis pub/sub → SSE endpoint → EventSource → dedupe → Redux → bell
```

**Why SSE rather than WebSockets:** the traffic is one-directional, SSE is plain
HTTP so it traverses proxies unchanged, and the browser reconnects automatically.
WebSockets earn their complexity when you need client → server messages.

**The hook handles:** connection, cleanup, exponential backoff, dedupe by event
id, and refresh-then-reconnect when the token expires.

**Two honest caveats:**

- `EventSource` **cannot set headers**, so the token goes in the query string —
  where it lands in server logs and browser history. It must be short-lived, and
  this is a real argument for `fetch`-based streaming.
- A reconnecting client **loses** events it missed. `Last-Event-ID` with durable
  ids would fix it and is not implemented.

**Behind nginx:** `proxy_buffering off` is mandatory, and `proxy_read_timeout`
must exceed the heartbeat.

---

## 29. Loading, error and empty states

**Every API-driven feature handles four states**, and empty is not an error.

**Branch order is load-bearing: error → loading → empty.**

A failed request leaves `data` undefined, so an empty check placed first reports
"no comments yet" for what is actually a server error — telling the user
something false and hiding a problem they could retry.

**Two different empty states**, because they call for different actions:

- "You have no tasks yet" → offer to create one
- "No tasks match these filters" → offer to clear them

Showing the first when the second is true makes the user think their data was
deleted.

**And the fifth state:** *submitting*, which is separate from the list's loading
state and must not blank the list.

---

## 30. Data tables and pagination

`DataTable` is generic over the row type and takes columns as data. It owns
loading, error, empty, sorting, pagination and the accessible markup.

**Server-side pagination**, because client-side means downloading everything to
show twenty rows.

| | Offset (`?page=2`) | Cursor (`?after=…`) |
| --- | --- | --- |
| Jump to page N | yes | no |
| Total count | yes | usually not |
| Cost | `O(offset)` | constant |
| Under concurrent writes | **skips or repeats rows** | stable |

Offset is used here — small datasets, and admin users want page numbers.

**The detail that matters either way:** the sort must be **total**. Sorting by a
non-unique field without a tiebreaker gives non-deterministic order, and every
pagination bug traces back to it.

**Reset to page 1 whenever a filter changes**, or filtering from page 4 asks for
page 4 of a one-page result and shows "no results" for a filter that matches
plenty.

---

## 31. Search, filter and sort

All server-side, via query parameters, with **the filter state in the URL**.

**Why the URL:** a filtered view becomes shareable, bookmarkable, and survives
refresh; back and forward work. It is the highest-value state decision in a
list-heavy app and it costs almost nothing.

**Search is debounced** — RTK Query deduplicates *identical* arguments but does
not merge different ones, so typing "authentication" is 14 distinct cache keys
and therefore 14 real requests.

**`all` is a UI sentinel, never sent.** `?status=all` fails `@IsEnum` with a 400,
so both the query builder and the URL hook drop it.

---

## 32. TypeScript

Strict, plus:

- **`noUncheckedIndexedAccess`** — `array[0]` is `T | undefined`. Verbose, and it
  is what makes `useParams` return an honest type.
- **`erasableSyntaxOnly`** — no parameter properties, no runtime enums. Types
  erase cleanly.

**Used throughout:** discriminated unions for state machines, generics for
`DataTable<T>` and `VirtualList<T>`, `Pick`/`Omit`/`Record` for derived shapes,
and type-level equality assertions for the contract check.

**A gotcha worth knowing:** `as const` on the paths object narrows to literal
types, so `new Set(Object.values(paths)).has(someString)` is a compile error —
TypeScript refuses to check membership of a value that could not be in the set.
Widen deliberately rather than casting the argument.

---

## 33. Testing strategy

222 tests across four layers.

| Layer | Example | Catches |
| --- | --- | --- |
| **Unit** | `LoginForm` with an injected `onLogin` | validation, submit state, messages |
| **Integration** | `httpClient` against MSW, no React | headers, retry, error parsing |
| **Flow** | page + store + router + transport | **wiring** — everything works alone and nothing is connected |
| **Smoke** | all 15 routes mounted | a page that throws, or queries a nonexistent endpoint |
| **E2E** | *missing* | anything decided by layout |

### Two things this suite does that most do not

**1. It asserts on roles and accessible names**, so a test breaks when the
*experience* breaks. That is also how the `Modal`'s missing `role="dialog"` was
found — a test id would have passed while the accessibility was entirely absent.

**2. Fixes are verified by reintroducing the bug.** That caught two vacuous tests
of my own — including an MSW handler that re-validated the old token, so
"retries with the **new** token" passed even when the client replayed the stale
one.

### What jsdom cannot see

| Invisible | Faithful |
| --- | --- |
| z-order, occlusion, clipping, scroll | the DOM tree and ARIA attributes |
| whether a focus ring is visible | `document.activeElement`, tab order |
| anything decided by CSS layout | live region text |

There is a comment in this repo that claimed a test was load-bearing for a
`z-index`, was checked, and was wrong. The correction sits next to it.

---

## 34. API mocking with MSW

MSW intercepts at the **network layer**, so the code under test uses its real
transport — `httpClient` genuinely builds the URL, attaches the bearer token,
reads the CSRF cookie, retries on 401 and normalises the error.

**Mocking `fetch` tests that you called a mock.**

**`onUnhandledRequest: 'error'` is the sharpest setting.** With `'bypass'`, a page
calling an unmocked endpoint renders its error state and passes a "did it render"
assertion. With `'error'` it fails and names the URL — which is how `/health/live`
was discovered as an undeclared dependency.

**Handlers should mirror the real backend, including its bugs.** The comment POST
handler returns `author: null` because the real one does. A handler returning the
*convenient* shape tests a backend that does not exist.

---

## 35. Performance

### Measured, including the unflattering result

| | Before splitting | After |
| --- | --- | --- |
| Cold load (gzip) | 213 kB | **245 kB** |
| App-only redeploy | 213 kB | **8.5 kB** |

**Code splitting made cold load worse** — separate gzip streams share no
dictionary, so compression is worse across many small files than one large one.
It was kept for **cache stability**, which is a traffic-shape trade-off rather
than a win.

Of the 245 kB, **~210 kB is MUI**. Only a library change moves that number.

**A bundle budget exists** (260 kB) — the number is arbitrary; having one is not.
Without it, a dependency that doubles the bundle is noticed six months later.

### The approach

Measure first, and establish *which* slow: initial load, interaction latency, or
one screen. Profiler for renders, Network for waterfalls, Lighthouse for load.

**`useMemo` everywhere is a bad instinct.** Most computations are cheaper than the
comparison, and every memo adds a dependency array to keep correct.

**The visualiser is opt-in** (`npm run analyze`) because it writes into `dist/`,
which is exactly what the Dockerfile copies into nginx — it was being served in
production.

---

## 36. Code splitting

```tsx
const TasksPage = lazy(() => import('@/pages/TasksPage').then(m => ({ default: m.TasksPage })));
```

**Where to split, in order of value:** routes, heavy dependencies behind an
interaction, rarely-opened dialogs. **Not** tiny components — each chunk is a
network request.

**Suspense is mandatory** around a lazy component, and the fallback is not a
detail: `null` makes a slow connection look like a broken link. **One boundary
per route**, not one around the router, or every lazy navigation blanks the app
chrome.

---

## 37. Security

| Concern | Handling |
| --- | --- |
| XSS | React escapes interpolated content. **Zero** `dangerouslySetInnerHTML` in this codebase |
| Token storage | in memory / httpOnly cookie — §26 |
| CSRF | double-submit cookie + header |
| Open redirect | `?next=` validated as a same-origin path |
| Secrets | none — every `VITE_*` value is public |
| Source maps | built, not served |
| Headers | CSP-ready; `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` via nginx |

**Why React escaping does not make an app secure:** it protects interpolated
text. It does not protect `dangerouslySetInnerHTML`, a `javascript:` URL in an
`href`, or third-party HTML you inject yourself.

**The nginx trap worth knowing:** `add_header` is inherited **only if the current
level defines none**. A `location = /index.html` block that sets `Cache-Control`
silently discards every server-level security header — on the entry page, which
via the SPA fallback is every route.

---

## 38. Accessibility

**Done:** semantic HTML, one `<main>` and one `<h1>`, a labelled `<nav>`, a skip
link, focus moved and announced on navigation, keyboard-operable custom controls,
axe in the test suite over 12 components.

**Findings from the audit** — all real, all fixed:

| Rule | What it actually broke |
| --- | --- |
| `nested-interactive` | the overflow menu was announced but **unreachable** by keyboard |
| `aria-allowed-attr` | `aria-rowcount` on `role="list"` — invalid, discarded, doing nothing |
| `aria-progressbar-name` | a spinner announcing "progress bar" and nothing else |
| `aria-prohibited-attr` | `aria-label` on a roleless div — silently ignored |

> **Invalid ARIA is worse than none.** No ARIA falls back to native behaviour;
> invalid ARIA is discarded but *reads as done*.

**And the two axe could not find** — both Level A, both in the shell it reported
clean:

1. **No skip link.** axe's `bypass` rule is satisfied by a landmark, so it passed
   while a keyboard user tabbed through six controls on every page.
2. **Silent navigation.** `pushState` does not move focus or announce anything.
   Fixed by moving focus to `<main>` *and* announcing the page — and the detail
   that makes it work is `tabIndex={-1}`, without which `.focus()` is a no-op.

**Not done, and not claimed:** no screen-reader testing, no real keyboard
walkthrough, and contrast is unverified because jsdom has no layout engine.
Automated tooling finds roughly a third of real problems.

---

## 39. Error handling

| Kind | Where it goes |
| --- | --- |
| Render-time crash | `ErrorBoundary` → fallback UI |
| Route-level error | `errorElement` → `RouteErrorPage` |
| Expected API error (validation, 403) | next to its cause — a field error on a field |
| Unexpected API error | `errorToastMiddleware` → a toast, so nothing is silent |
| Network failure | the feature's error state, with retry |

**An error boundary catches render errors only.** Not event handlers, not async
code, not SSR, not errors thrown by the boundary itself. Saying which is the
follow-up.

---

## 40. Docker

Multi-stage: build with `node:22-alpine`, ship `nginx:1.27-alpine` with only
`dist/`. **~1.1 GB of toolchain becomes 89 MB**, with no Node, no npm and no
source in the runtime image.

**Contrast with the backend**, which *ends* on `node:22-alpine` because a Nest
server genuinely needs a Node runtime. The technique is not the point; asking
*"what does this actually need at runtime?"* is.

**Non-root**, which means binding 8080 rather than 80. "It only serves static
files" is not a security boundary — an escape from root is a much better starting
position than one from `nginx`.

---

## 41. nginx

```nginx
location / { try_files $uri $uri/ /index.html; }          # SPA fallback

/assets/*   public, max-age=31536000, immutable           # content-hashed
/index.html no-cache, no-store, must-revalidate           # the only unhashed file
```

Cache `index.html` and a returning user loads yesterday's HTML pointing at chunk
hashes that no longer exist — **a blank page after every deploy**.

**SSE needs its own block:** `proxy_buffering off`, and a read timeout longer
than the heartbeat.

---

## 42. CI/CD

```
api-quality ─┬─► api-build
             └─► contract-drift    (boots the API, regenerates, diffs)
web-quality ───► web-build         (bundle budget + docker image)
```

**Separate jobs, not extra steps.** GitHub runs jobs in parallel, so a red
pipeline says *which half* broke without opening the log.

---

## 43. Production architecture

```
Browser ──► CDN / nginx ──► static bundle (hashed, immutable)
        └─► /api ────────► NestJS instances ──► MongoDB / Redis
```

One origin: no CORS in the request path, cookies same-site, and the SPA fallback
and cache contract live in one place.

---

## 44. Design patterns used

| Pattern | Where | Why not something else |
| --- | --- | --- |
| Composition | `TaskCard.actions`, `EmptyState` | callback props serve one caller then grow forever |
| Custom hooks | `useDebounce`, `useNotificationStream` | shares logic; note it does **not** share state |
| Compound components | `Modal` | one config-prop API cannot serve every arrangement |
| Provider | `ThemeModeProvider` | prop drilling through four uninterested components |
| Adapter | `notificationFromEvent` | the SSE frame is narrower than the REST shape |
| Strategy | `can(user, capability, context)` | one exhaustive function beats scattered role checks |

**Patterns are not forced.** A `<Spinner>` with `<Spinner.Icon>` would be
ceremony — the flexibility buys nothing and every caller writes three lines
instead of one.

---

## 45. Anti-patterns, and what to do instead

| Anti-pattern | Instead |
| --- | --- |
| `useEffect` syncing state from props | derive during render |
| Server data copied into a slice | leave it in the query cache |
| Index keys on a reorderable list | a stable id |
| `useMemo` on everything | measure, or memoise for identity |
| Context for high-frequency state | a store, or push consumption down |
| A component defined inside a component | move it out — it remounts every render |
| `{count && <X/>}` | `{count > 0 && <X/>}` |
| Only handling the success case | the four-state rule |
| `catch {}` | handle it, or let it throw |
| A default standing in for a value you failed to read | fail loudly |

The last one produced 25 audit records reading `event: "unknown"`. **A default on
a field you did not successfully read is a disabled bug detector.**

---

## 46. Design decisions and trade-offs

| Decision | Bought | Cost |
| --- | --- | --- |
| RTK Query for server state | cache, dedupe, invalidation | a large dependency; Redux concepts |
| MUI | accessible components, speed | ~210 kB of a 245 kB bundle |
| Generated request types | drift is a CI failure | no response coverage — half a net |
| URL as filter state | shareable, survives refresh | serialisation, and a sentinel value |
| Code splitting | 8.5 kB redeploys | **worse cold load** (measured) |
| Hand-rolled `VirtualList` | the mechanism is understood | no variable heights, RTL or scroll restoration |
| No loaders | one cache, not two | no pre-render fetching |
| No SSR | nothing to maintain | no SEO, slower first paint — irrelevant for an authed tool |

---

## 47. Common mistakes

1. **Mutating state.** `Object.is` makes it invisible.
2. **Lying to the dependency linter.** Bugs that appear on the second
   interaction.
3. **Index keys.** Visually plausible, behaviourally wrong.
4. **`isFetching` for the skeleton.** Blanks the list on every window focus.
5. **Forgetting `.unwrap()`.** A failed mutation resolves, so `reset()` runs and
   destroys the user's text.
6. **Empty-check before error-check.** Reports "no results" for a server error.
7. **Optimistic updates plus `invalidatesTags`.** Instant update *and* a refetch.
8. **Assuming a route guard is security.** It is not.
9. **`role="button"` on something containing a button.** The inner control
   becomes unreachable.
10. **Trusting a 200 from an SPA server.** It proves the fallback works, nothing
    more.

---

## 48. Debugging guide

| Symptom | First move |
| --- | --- |
| Component renders too often | Profiler → "why did this render" |
| Effect loops forever | look for an object/array dependency |
| State is one render behind | you are syncing when you should derive |
| Callback sees old values | stale closure — functional update or a latest ref |
| API called twice | StrictMode, or two different cache keys |
| Random logouts | concurrent 401s → single-flight refresh |
| Wrong row's data after delete | index keys |
| Form clears on failure | missing `.unwrap()` |
| Works with a mouse, not a keyboard | `onClick` on a div, or nested interactives |
| Every row shows the same value | a default standing in for an unread field |
| Blank page after deploy | `index.html` was cached |

---

## 49. Angular → React mapping

The full treatment is [`docs/angular-vs-react.md`](docs/angular-vs-react.md).
The short version — everything descends from one difference:

> **Angular compares property values. React compares references.**

Which is why state must be immutable, why dependency arrays exist, why `key`
matters, and why there is no two-way binding.

| Angular | React |
| --- | --- |
| `@Input()` / `@Output()` | props / callback props |
| `ng-content` | `children` or a `ReactNode` prop |
| `*ngFor` + `trackBy` | `.map()` + `key` |
| `ngOnInit` / `ngOnDestroy` | `useEffect` + its cleanup ⚠ not equivalent |
| Service + DI | imports, hooks, Context — **the biggest real loss** |
| RxJS | RTK Query, or a hook with cleanup |
| `HttpInterceptor` | a wrapped `fetch` / RTK `baseQuery` |
| Route guard | a wrapper component ⚠ neither is security |
| `OnPush` | `React.memo` — same defeat condition |

---

## 50. Known issues

Deliberately open and listed rather than hidden. Full detail in
[`../ROADMAP.md`](../ROADMAP.md) and [`docs/frontend-audit.md`](docs/frontend-audit.md).

1. **245 kB gzip**, ~210 kB of it MUI. Only a library change moves it.
2. **No real-browser E2E.** There are assertions here that are *impossible* until
   Playwright runs — jsdom has no layout or hit-testing.
3. **No screen-reader or keyboard walkthrough**, and contrast is unverified.
4. **No response schemas in OpenAPI** — the contract check guards one direction.
5. **`POST` comment returns `author: null`** while `GET` populates it.
6. **Seven of nine domain events are never emitted** — the activity log is in
   practice a registration log.
7. **Missing joins** — the activity log shows raw `actorId`; project members show
   ids.
8. **One unreproduced flaky test.**
9. **No observability** — no error tracking, no real-user metrics. This is the
   main thing separating the project from "production ready".

---

## 51. Interview preparation

| Ordered by **difficulty** | Ordered by **topic** |
| --- | --- |
| [01 — Beginner](docs/interview/01-beginner.md) | [130 questions](../INTERVIEW-QUESTIONS.md) |
| [02 — Intermediate](docs/interview/02-intermediate.md) | [50 coding exercises](../CODING-EXERCISES.md) |
| [03 — Advanced](docs/interview/03-advanced.md) | [40 senior scenarios](../SENIOR-SCENARIOS.md) |
| [04 — Senior architecture](docs/interview/04-senior-architecture.md) | [20 architecture questions](../ARCHITECTURE-QUESTIONS.md) |
| [05 — Scenarios](docs/interview/05-scenarios.md) | [Mock interview](../MOCK-INTERVIEW.md) |

**Before any of it, read [POSITIONING.md](../POSITIONING.md).** It is explicit
about not inflating React years — because inflation does not survive the
follow-up question — and lists the gaps to volunteer rather than hide.

---

## Honesty note

This project exists to build **genuine** competence, not to support claiming
experience nobody has.

Where something was measured and the result was bad, the number is here — code
splitting made cold load worse and this README says so. Where a claim turned out
to be false, the correction sits next to the original rather than replacing it.
And the gaps are listed rather than glossed.

Being able to say what you have *not* done is what makes the rest credible.

---

**License:** MIT.
