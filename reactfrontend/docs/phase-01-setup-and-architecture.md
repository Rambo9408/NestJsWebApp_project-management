# Phase 1 — React + TypeScript + Vite + Full-Stack Architecture

> Companion doc to the code. Read this, then read the files it points at — the
> comments in the source carry the detail, this carries the shape.

---

## 1. What we are building

**TaskFlow** — a project-management application. Users belong to projects, create
and assign tasks, comment on them, receive real-time notifications, and generate
an activity log.

It is deliberately **not** a CRUD demo. The features were chosen because each one
forces a real frontend decision:

| Feature                          | The decision it forces                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| Auth with refresh tokens         | Where do you store a JWT? What happens when it expires mid-request?                 |
| RBAC (admin/manager/member)      | How do you express permissions in a UI without making the UI the security boundary? |
| Server-side pagination + filters | Where does filter state live — component, URL, or store?                            |
| Real-time notifications (SSE)    | How do you manage a long-lived connection across a component lifecycle?             |
| Comments on tasks                | How do optimistic updates and cache invalidation interact?                          |

Those are the questions a 4–5 year React interview actually probes. The app is
the vehicle.

---

## 2. How React talks to NestJS

The single most important architectural fact in this phase:

```
┌──────────────── DEVELOPMENT ────────────────┐
│                                              │
│  Browser ──► localhost:5173 (Vite)          │
│                    │                         │
│                    │ proxy /api, /health     │
│                    ▼                         │
│              localhost:3000 (NestJS)        │
└──────────────────────────────────────────────┘

┌──────────────── PRODUCTION ─────────────────┐
│                                              │
│  Browser ──► nginx :443                     │
│                ├── /          → static bundle│
│                └── /api       → NestJS       │
└──────────────────────────────────────────────┘
```

**Both are same-origin.** That single property buys three things:

1. **No CORS.** Not "CORS configured correctly" — no preflight at all.
2. **Cookies attach automatically.** The refresh token is an httpOnly cookie;
   same-origin means it just works, in dev and prod identically.
3. **One relative URL, `/api/v1`, is correct everywhere.** No environment
   branching in client code.

The alternative — pointing the client at `http://localhost:3000` — _also works
locally_ and then breaks the day the frontend gets a real domain. Configured in
[vite.config.ts](../vite.config.ts).

### Verified, not assumed

Phase 1 ends with the connection proven against the running stack:

```
GET  /health/live   via :5173 → 200  {"status":"ok",...}
GET  /api/v1/tasks  via :5173 → 401  (reached the JWT guard — proxy works)
POST /api/v1/auth/register     → 201  {user, accessToken, expiresIn}
POST /api/v1/auth/login        → 200  + Set-Cookie: taskflow_refresh (HttpOnly)
POST /api/v1/auth/register (bad) → 400 {success:false, message:[...3 field errors]}
```

---

## 3. The API contract — three things the backend does that changed my types

Part 2 of the brief says the NestJS backend is the source of truth. Taking that
seriously meant reading the controllers **and then checking the wire**. Three
findings that a guessed contract would have gotten wrong:

### 3.1 `refreshToken` is not in the login response

The service returns `TokenPair & { user }`. The **controller strips it**:

```ts
this.setRefreshCookie(response, result.refreshToken);
return { user, accessToken, expiresIn }; // refreshToken deliberately dropped
```

It leaves the server _only_ as an httpOnly cookie. Typing the response as
`TokenPair & { user }` would compile and be wrong at runtime — and the natural
"fix" would be to start storing tokens in `localStorage`, undoing the security
property on purpose. See [src/types/api.ts](../src/types/api.ts).

### 3.2 The refresh cookie is path-scoped

```
Set-Cookie: taskflow_refresh=...; Path=/api/v1/auth; HttpOnly
```

The browser sends it **only** to auth endpoints — never to `/api/v1/tasks`. The
longest-lived credential is exposed on the narrowest surface.

### 3.3 Errors are enveloped; successes are not

```jsonc
// error — every error, one shape
{"success": false, "statusCode": 400, "message": ["email must be..."], "error": "...", "path": "...", "timestamp": "...", "requestId": "..."}

// success — the plain resource, no wrapper
{"id": "...", "title": "...", "status": "todo"}
```

`message` is `string | string[]` — the array is one message **per failed field**,
preserved specifically so a frontend can map them onto form fields (we use that
in Phase 6). `success: false` is a literal type, which makes it a perfect
discriminant for the `isApiError` type guard.

The project has a `TransformResponseInterceptor` that _would_ wrap successes in
`{success, data}` — and deliberately doesn't register it globally. Good thing to
be able to argue both sides of.

### Contract reference

| Method | Endpoint                                                   | Auth             | Notes                                               |
| ------ | ---------------------------------------------------------- | ---------------- | --------------------------------------------------- |
| POST   | `/auth/register`                                           | public           | → `{user, accessToken, expiresIn}` + refresh cookie |
| POST   | `/auth/login`                                              | public           | → same. 200, not 201                                |
| POST   | `/auth/refresh`                                            | cookie           | reuse of a spent token revokes the whole family     |
| POST   | `/auth/logout`                                             | bearer           | 204                                                 |
| GET    | `/auth/me`                                                 | bearer           | → `User`                                            |
| GET    | `/users`, `/projects`, `/tasks`                            | bearer           | → `Paginated<T>`                                    |
| GET    | `/tasks?projectId=&status=&priority=&search=&page=&limit=` | bearer           | server-side filtering                               |
| PATCH  | `/tasks/:id/status`                                        | bearer           | `{from, to}` — an explicit transition, not a set    |
| PATCH  | `/tasks/:id/assignee`                                      | bearer           | `{assigneeId: string \| null}`                      |
| GET    | `/notifications/stream`                                    | `?access_token=` | SSE                                                 |
| GET    | `/health/live`                                             | public           | **outside** `/api/v1`                               |

Two details that will bite if forgotten:

- **Everything is under `/api/v1`.** Global prefix `api` + URI versioning with
  `defaultVersion: '1'`. `/api/tasks` is a 404.
- **Health is not.** Deliberately excluded so infrastructure probes a path that
  no version bump can break. It needs its own proxy rule.
- **SSE authenticates by query param.** `EventSource` cannot set headers, so the
  JWT strategy has a `fromUrlQueryParameter('access_token')` extractor
  specifically for it. Phase 15.

---

## 4. Folder structure

```
src/
├── app/            # composition root — router, providers, store (Phase 8)
├── components/     # SHARED, feature-agnostic UI
│   ├── ui/  forms/  tables/  modals/  feedback/
├── features/       # auth/ users/ projects/ tasks/ comments/ notifications/
├── layouts/        # route-level chrome (RootLayout)
├── pages/          # route targets — thin, compose from features/
├── routes/         # path constants + guards (Phase 11)
├── services/       # transport (httpClient)
├── hooks/  utils/  types/  constants/  config/
└── test/           # global test setup
```

### Component-based vs feature-based

```
COMPONENT-BASED                    FEATURE-BASED
components/                        features/
  TaskCard.tsx                       tasks/
  TaskList.tsx                         TaskCard.tsx
  ProjectCard.tsx                      TaskList.tsx
  UserAvatar.tsx                       tasksApi.ts
hooks/                                 useTaskFilters.ts
  useTasks.ts                        projects/
services/                              ProjectCard.tsx
  tasksApi.ts
```

Both are fine at 20 components. The difference shows up at 200.

**A change is almost always a change to one feature.** Feature-based means one
folder open. Component-based means four folders, and after a year nobody can
tell you what `useTasks.ts` is still used by — so nothing is ever deleted.

The real prize is **deletability**: "we're dropping comments" should be
`rm -rf features/comments` plus a handful of import errors the compiler finds
for you. That is only true if the boundary is real.

**The rule that keeps it real:** a feature may import from `components/`,
`hooks/`, `utils/`, `types/`. A feature may **not** import from another feature.
When two need the same thing, it moves down into shared — an explicit,
reviewable act. Cross-feature imports are how a feature-based codebase quietly
turns back into a ball of mud, and the `@/` alias makes them visible in review
(`from '@/features/projects/...'` inside `features/tasks/` is the smell).

> **Angular bridge:** this is the feature-module layout you already know, minus
> `NgModule`. Angular enforces boundaries via the module graph; React has no
> such mechanism — the boundary is a convention, enforced by review and lint
> rules. That is a genuine downside of React worth saying out loud in an
> interview.

---

## 5. Technology choices

Only the ones already installed and wired are listed as decided. The rest are
argued when we use them.

### Vite

- **Problem:** dev-server startup and rebuild time on a large app.
- **How:** serves native ESM in dev (no bundling — startup is O(1) in app size);
  Rollup for production.
- **Alternatives:** CRA (deprecated), Next.js, Rspack.
- **Trade-off:** dev and prod use different engines, so a class of bug appears
  only in the production build. Rare, real. _Always run the prod build in CI._
- **Why not Next.js:** it's a full-stack framework — SSR, API routes, its own
  data fetching. We already have a backend. Adding Next would mean two servers
  and a permanent argument about which owns auth. **Choose Next when you need
  SSR/SSG for SEO or first-paint.** An authenticated internal dashboard needs
  neither.

### TypeScript — strict

The Vite template ships **without `strict`**, which is a real gap. Turned on,
plus `noUncheckedIndexedAccess`. The backend is already `strict: true`; matching
it means one mental model across the stack.

Concretely: `Task.assigneeId` is `string | null`. Under strict, every consumer is
_forced_ to handle "unassigned". That is the whole value proposition.

### MUI

- **Problem:** accessible, consistent components — dialogs with focus traps,
  tables, forms — that you should not hand-roll.
- **Alternatives:** Ant Design (denser, more opinionated), shadcn/ui + Radix
  (you own the code; no theme lock-in), Tailwind alone (no components).
- **Trade-off:** **bundle size.** Our build is already **435 kB / 138 kB gzip**,
  nearly all MUI. That's the Phase 35 code-splitting target — and a real
  number to discuss rather than a hypothetical.
- **Every app?** No. A marketing site should not ship MUI. A data-dense internal
  tool is exactly its sweet spot.

### ESLint over the template's oxlint

Oxlint is much faster and a reasonable default. Two reasons to override:
`react-hooks/exhaustive-deps` is the most valuable rule in a React codebase and
ESLint's is the reference implementation; and the backend already uses ESLint
flat config. **`exhaustive-deps` is set to `error`, not `warn`** — warnings get
scrolled past, and this rule is right more often than the developer arguing with
it.

We also enable `recommendedTypeChecked` for `no-floating-promises` — an
un-awaited promise whose rejection vanishes is, in a React app, a failed mutation
the user never hears about.

### Vitest + Testing Library + MSW

Vitest shares Vite's transform pipeline, so there is no second build config to
drift. RTL gives you the rendered DOM and _nothing else_ — you cannot reach in
and read component state, by design.

> **Angular bridge:** with TestBed you'd assert on `fixture.componentInstance`.
> RTL removes that option. If your Angular tests leaned on `componentInstance`,
> this is a real adjustment — but the resulting tests survive refactors far
> better, because they're coupled to the user-facing contract instead of the
> implementation.

---

## 6. Angular → React: what transfers

### Transfers directly (most of your value)

| You know                                 | Here it is                                                       |
| ---------------------------------------- | ---------------------------------------------------------------- |
| Component-based UI                       | Same idea, function instead of class + decorator                 |
| `@Input()`                               | Props                                                            |
| `<router-outlet>`                        | `<Outlet />`                                                     |
| `routerLink`                             | `<Link to=...>`                                                  |
| Feature modules                          | `features/` folders (convention, not enforced)                   |
| `HttpInterceptor`                        | The one place in `httpClient.ts` / RTK Query `baseQuery`         |
| `environment.ts`                         | `config/env.ts` reading `import.meta.env`                        |
| `proxy.conf.json`                        | `server.proxy` in vite.config.ts                                 |
| `switchMap` to cancel a stale request    | `AbortController` in effect cleanup                              |
| DTOs, guards, RBAC, JWT, SSE, Docker, CI | **Identical.** This is backend knowledge and it does not change. |

That last row is the important one. Roughly 60% of this project is architecture,
API design, auth and infrastructure — where your 2+ years count fully.

### Does _not_ transfer — learn deliberately

1. **No dependency injection.** Angular resolves by token through an injector.
   React imports modules directly and passes values through Context
   _positionally_. A missing provider is a confusing `undefined`, not a loud
   `NullInjectorError`. (Fix: a `useContext` hook that throws. Phase 17.)

2. **No change detection.** Angular tracks mutations via Zone.js — you can
   mutate an array and the view updates. **React re-renders when state identity
   changes.** `items.push(x); setItems(items)` renders nothing: same reference.
   Immutability is not a style preference here, it is the mechanism.

3. **No RxJS.** Async is promises + `useEffect` + RTK Query. Operators you reach
   for reflexively (`switchMap`, `debounceTime`, `combineLatest`) have no
   built-in equivalent — they become manual patterns or library features.

4. **No templates or lifecycle hooks.** JSX is JavaScript; `*ngIf` is `&&`,
   `*ngFor` is `.map()`. And `useEffect` is **not** `ngOnInit` — it is a
   synchronisation primitive that runs whenever its dependencies change. Mapping
   it to lifecycle hooks is the single most common source of React bugs in
   people coming from Angular. Phase 11 is dedicated to this.

5. **The framework does far less.** No CLI generators, no enforced structure, no
   built-in forms or HTTP module. More decisions are yours — which is why the
   architecture chapters matter more in React than in Angular.

---

## 7. What's on disk

| File                                                                                      | Why it exists                                                                  |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [vite.config.ts](../vite.config.ts)                                                       | Proxy, `@/` alias, Vitest — the integration seam                               |
| [src/types/api.ts](../src/types/api.ts)                                                   | The contract, transcribed from the backend and verified on the wire            |
| [src/services/httpClient.ts](../src/services/httpClient.ts)                               | fetch wrapper: CSRF double-submit, `credentials: include`, error normalisation |
| [src/config/env.ts](../src/config/env.ts)                                                 | One module reads `import.meta.env`                                             |
| [src/app/router.tsx](../src/app/router.tsx)                                               | Data router, layout route, 404                                                 |
| [src/app/providers/AppProviders.tsx](../src/app/providers/AppProviders.tsx)               | Provider composition root — Redux joins here in Phase 8                        |
| [src/components/feedback/ErrorBoundary.tsx](../src/components/feedback/ErrorBoundary.tsx) | The one place a class component is still required                              |
| [src/pages/ConnectivityPage.tsx](../src/pages/ConnectivityPage.tsx)                       | Proof of wiring — **deleted in Phase 9**, replaced by ~3 lines of RTK Query    |

Three bugs the toolchain caught while writing this phase, each worth knowing:

1. **`erasableSyntaxOnly`** rejected TypeScript _parameter properties_
   (`constructor(readonly status: number)`). The backend uses them constantly —
   Nest DI depends on them — but esbuild only _strips_ types, it never
   transforms. Same language, different compilation model.
2. **`react-hooks/set-state-in-effect`** flagged `setState({status:'loading'})`
   at the top of an effect: two render+paint cycles before a byte was requested.
   Fix — make `loading` the _initial_ state. General rule: if an effect's first
   act is an unconditional `setState`, that value belongs in `useState`.
3. **`no-unsafe-return`** caught `response.json()` returning `Promise<any>` and
   `any` silently propagating into state.

---

## 8. Interview questions — Phase 1

1. **Why proxy in dev instead of pointing at `localhost:3000`?**
   Same-origin: no preflight, cookies attach, one relative URL in both
   environments, and dev mirrors the production nginx topology instead of
   accidentally working.

2. **Where do you store a JWT in a React app?**
   Access token in memory (module variable or Redux). Refresh token in an
   httpOnly cookie the client never reads. `localStorage` is readable by any XSS.
   Cost: a page reload loses the access token, so you call `/auth/refresh` on
   boot. _Follow-up: so XSS can still call your API as the user — why bother?_
   Because it limits the blow to the tab's lifetime instead of handing over a
   7-day refresh token.

3. **The CSRF cookie is readable by JavaScript. Isn't that insecure?**
   No — it isn't a credential. Double-submit works because an attacker's page
   can _make_ the browser send your cookies but can't _read_ them, so it can't
   set the matching header. It must be non-httpOnly for the pattern to function.

4. **Why does `useEffect` run twice in development?**
   StrictMode double-invokes mount/unmount to surface missing cleanup. It's a
   detector, not a bug, and it's stripped from production. The right response is
   to add cleanup, not to remove StrictMode.

5. **What does an Error Boundary _not_ catch?**
   Event handlers, async code, SSR, and errors in the boundary itself — because
   it works by catching exceptions during React's render walk. Therefore it is
   **not** an API error handler: a rejected fetch never reaches it. API errors
   are data.

6. **Feature-based vs component-based structure — when does it matter?**
   Not at 20 components. At 200 it decides whether a change touches one folder
   or four, and whether dead code can ever be deleted.

7. **How do you keep frontend and backend types in sync?**
   Generate a client from the OpenAPI document and check it in CI so a breaking
   backend change fails the frontend build. Hand-mirrored types drift silently —
   which is why this phase _verified_ three of them against the running server.

---

## 9. Exercises

1. Break the proxy: comment out the `/health` rule and reload. Read the actual
   network error before fixing it — recognising that shape saves an hour later.
2. Set `VITE_API_BASE_URL=http://localhost:3000/api/v1` in `.env.local` and open
   DevTools. Find the OPTIONS preflight. Then remove `http://localhost:5173`
   from the backend's `CORS_ORIGINS` and read the failure.
3. Delete `credentials: 'include'` from `httpClient.ts`, log in, and check
   whether `taskflow_refresh` is sent.
4. Add a `status` field to `ApiError` (not `statusCode`) and see what the
   compiler says. Then check what it _doesn't_ say about `request<T>` — and
   explain why the generic is an assertion, not a validation.
5. In `ConnectivityPage`, remove `return () => controller.abort()`. With network
   throttling on, click Retry rapidly. Explain what you see.

---

## 10. Quiz

1. Why is `Role` a `const` object rather than a TypeScript `enum`?
2. What does `credentials: 'include'` do, and what breaks without it?
3. Why is `/health/live` not under `/api/v1`?
4. `createdAt` is `Date` on the server. Why is it `string` here?
5. Name two TypeScript features that emit runtime code.
6. Why is `ErrorBoundary` a class?
7. Why does the `paths` alias have to be declared in _two_ files?
8. What makes `success: false` more useful than `success: boolean`?

<details>
<summary>Answers</summary>

1. `erasableSyntaxOnly` — a TS `enum` emits runtime code. The const object gives
   the same runtime value + union type with erasable syntax.
2. Sends cookies with the request. Without it the httpOnly refresh cookie never
   reaches the backend and every refresh 401s.
3. So infrastructure probes a path that no API version bump can break — the
   backend `exclude`s it from the prefix _and_ marks it version-neutral.
4. JSON has no date type; an ISO-8601 string is what actually arrives. Typing it
   `Date` compiles and then throws on `.getFullYear()`.
5. Enums, parameter properties, namespaces, legacy decorators.
6. There is no hook equivalent of `componentDidCatch`.
7. `tsconfig` resolves _types_; Vite resolves the _module graph_. Two
   independent resolvers — configure one only and it works in the editor and
   fails at build.
8. It's a literal type, so it discriminates: `success === false` narrows the
   union unambiguously. `boolean` narrows nothing.

</details>

---

**Next: Phase 2 — Components, JSX, Props, State.** Say `continue`.
