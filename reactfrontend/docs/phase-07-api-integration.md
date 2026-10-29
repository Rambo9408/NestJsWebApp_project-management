# Phase 7 — NestJS API Integration

> Covers brief Parts 21, 22, 23 (and previews 24). **The fixtures are gone.**
> Real data, real sessions, real token refresh.

---

## ⚠️ A backend security finding, first

While verifying data isolation I found that **list endpoints are not scoped to
the caller.** Reproduced:

```
1. Register user A → create project "PH" → create 3 tasks
2. Register user B (brand new, zero projects)
3. GET /api/v1/tasks   as B  → total: 3   (all of A's tasks)
4. GET /api/v1/projects as B → total: 1   (A's project)
```

The cause is a gap between collection and item routes:

| Route | `ProjectAccessGuard` |
|---|---|
| `GET /projects/:id` | ✅ |
| `PATCH /projects/:id` | ✅ |
| `POST /tasks` | ✅ |
| **`GET /projects`** | ❌ |
| **`GET /tasks`** | ❌ |

`ProjectsController.findAll` accepts `memberId` as an *optional filter*, and
`TasksService.findAll` passes its filter straight to the repository with no
membership constraint.

This is **Broken Object-Level Authorization on collections** (OWASP API1). Item
routes are protected; the lists that enumerate them are not.

**The frontend cannot fix this** — that's the exact principle documented in
[RequireAuth.tsx](../src/routes/RequireAuth.tsx). The fix belongs in the backend:
derive the project scope from `@CurrentUser('id')` and constrain the query,
rather than accepting it as a client-supplied filter.

I haven't changed the backend — that's outside what you asked for. Flagging it
because it's the kind of thing an interviewer would find in five minutes.

---

## 1. Closing the drift gap — half of it, honestly

```bash
npm run api:types   # curl /api/docs-json → openapi-typescript
```

**What we got:** 34 paths, 16 schemas — all **request** DTOs, fully typed
including enums, nullability, and the backend's own comments as JSDoc:

```ts
CreateTaskDto: {
  title: string;
  projectId: string;
  assigneeId?: string | null;
  priority?: "low" | "medium" | "high" | "urgent";
  /** @description `@IsDateString()` validates an ISO-8601 STRING ... */
  dueDate?: string | null;
};
```

**What we did NOT get — responses:**

```
GET  /api/v1/tasks      → 200: ""
POST /api/v1/auth/login → 200: "Authenticated"
GET  /api/v1/auth/me    → 200: { type: object }
```

The `@nestjs/swagger` plugin builds schemas from DTO **classes** by reading
decorators. The controllers return plain TypeScript types
(`Promise<Paginated<TaskWithAssignee>>`) and an interface leaves nothing at
runtime to inspect.

**So the contract is half-generated and half-asserted, and it's worth being
able to say which half is which.** The backend fix is
`@ApiOkResponse({ type: TaskResponseDto })` with response classes; then
generation covers everything.

### Compile-time drift detection

[contractCheck.ts](../src/types/contractCheck.ts) asserts the hand-written half
against the generated half using `Expect<Equal<A, B>>`:

```ts
export type _RegisterPayloadMatchesBackend = Expect<Equal<RegisterPayload, RegisterRequest>>;
```

Both assertions **passed** — my Phase 6 Zod-derived payload matches the
backend's `RegisterDto` exactly. And I verified the check isn't vacuous by
injecting a bogus field:

```
src/types/contractCheck.ts(61,53): error TS2344:
  Type 'false' does not satisfy the constraint 'true'.
```

**Still not caught:** validation *rules* (OpenAPI carries `format: email`, not
"≥10 chars with an uppercase"), and **staleness** — the generated file is a
checked-in snapshot. The real fix is a CI step that regenerates and fails on a
non-empty diff.

### And the response types drifted, exactly as predicted

Printing the keys of a real `GET /tasks` response found two fields my
hand-written `Task` had been missing **since Phase 1**:

```
reference    "PH-3"  — the human-readable key
createdById          — the author, distinct from the assignee
```

A type that *omits* a field still compiles. It just makes that field invisible
to the entire frontend, silently. `task.reference` would have been an editor
error while the data sat right there in the payload.

That's the concrete argument for generated response types, and it cost me
nothing to find because I checked the wire instead of trusting the type.

---

## 2. Where the JWT lives

|  | XSS can read? | Survives reload? | CSRF risk? |
|---|---|---|---|
| localStorage | **yes** | yes | no |
| normal cookie | **yes** | yes | **yes** |
| httpOnly cookie | no | yes | yes (mitigated) |
| **memory** (ours) | only while running | **no** | no |

**Access token → memory. Refresh token → httpOnly cookie** (set by the backend,
scoped to `/api/v1/auth`).

*"But XSS can still call the API as the user"* — correct, and say it before the
interviewer does. Nothing defeats XSS. The point is **blast radius**: an
attacker gets the current tab's session, not a 7-day refresh token they can
replay from their own machine tomorrow.

**The cost:** a reload loses the access token. Hence `AuthProvider` calls
`/auth/refresh` on boot — the cookie survives and mints a fresh token. One
request, in exchange for never writing a long-lived credential where script can
read it.

---

## 3. Single-flight refresh — the bug that looks random

**The scenario:** token expires, dashboard fires six requests, all six 401, a
naive interceptor calls `/auth/refresh` six times.

**Why that's worse than wasteful:** the backend *rotates* refresh tokens and
treats reuse as theft. Its own comment: *"Reuse of a spent token revokes the
entire session family."* Six concurrent refreshes present the same token six
times — the exact signature of a stolen token being replayed.

**The user is logged out. On every token expiry.** And it's unreproducible in
manual testing, because it only fires when requests overlap.

```ts
refreshInFlight ??= performRefresh()...finally(() => { refreshInFlight = null; });
```

Three details that each prevent a specific bug:

1. **`??=`** — concurrent callers share one promise. Test asserts
   `fetch` called **once** for six callers.
2. **Raw `fetch`, not our `http`** — if the refresh went through the
   interceptor and itself 401'd, it would trigger another refresh, which
   401s… That's the infinite loop, prevented *structurally* rather than with a
   flag someone can forget.
3. **`finally`, not `then`** — clearing only on success would cache a rejected
   promise forever; every later request would await that same rejection and the
   user could never recover without a hard reload.

**Angular bridge:** this is the `shareReplay(1)` + `BehaviorSubject` refresh
interceptor. Same problem, same solution — genuinely transferable experience.

### Four conditions on the retry

```ts
if (response.status === 401 && !skipAuthRetry && tokenStore.get() !== null)
```

- **401 only** — a 403 means "authenticated but not allowed"; refreshing gives
  the same denial
- **`skipAuthRetry`** — a failed *login* 401s because the password is wrong
- **had a token** — a 401 with no token means logged out; there's nothing to
  refresh
- **one retry, no loop** — a retry loop around auth is a request storm against
  your own API

---

## 4. Three session states, not two

```ts
type AuthState =
  | { status: 'restoring' }      // boot refresh in flight
  | { status: 'authenticated'; user: User }
  | { status: 'anonymous' };
```

With `user: User | null` + `isLoading`, the state `{ user: null, isLoading:
false }` is **ambiguous** — it means both "checked, nobody's logged in" and "not
started checking". A guard can't tell them apart, so it either redirects a
logged-in user on every reload or spins forever.

`RequireAuth` handles all three, and the `restoring` branch is the one people
forget — omitting it makes the login page flash on every refresh, which is hard
to reproduce because it depends on network timing.

Same reason `SessionControls` renders `null` while restoring rather than
"Sign in".

---

## 5. Guard the branch, not the page

```tsx
{ element: <RequireAuth />, children: [ dashboard, tasks, settings ] }
```

A pathless layout route whose element is the guard. New pages are protected **by
construction**. *A guard you must remember is a guard that will be forgotten —
and forgetting this one exposes a page.*

**Labs are deliberately left outside it.** They hold no user data. Requiring a
login to read teaching demos is security theatre — it protects nothing and
trains people to see the guard as friction rather than a boundary that means
something.

**And the guard protects UI, not data.** Verified: `GET /api/v1/tasks` with no
token → **401**, regardless of what the client believes.

### Redirect-after-login, safely

```ts
return pathname.startsWith('/') && !pathname.startsWith('//') ? pathname : null;
```

`location.state` is `any` — it comes from a history entry and anyone can push
anything into it. That's an **untrusted boundary**, and `any` *spreads*: our
lint config caught the first draft leaking it straight into `navigate()`.

The `//` check is an **open-redirect guard**. `//evil.example` is
protocol-relative — it starts with a slash and is *not* local. A naive
`startsWith('/')` passes it, which is the classic bypass.

---

## 6. Server-side pagination — verified live

```
GET /tasks?page=1&limit=2  → items: 2, total: 3, totalPages: 2
GET /tasks?status=todo     → matched: 3
GET /tasks?status=all      → HTTP 400   ← why we strip the sentinel
```

| | Client-side | Server-side |
|---|---|---|
| Payload | scales with **total** | constant per page |
| Page change | instant | round-trip |
| 10,000 rows | several MB before first paint | fine |

We use server-side because a task list is unbounded. **Rule:** paginate on the
client only when you can bound the dataset and genuinely need instant paging.

`useAsyncData` is **deliberately temporary** — deleted in Phase 20. It has no
caching, no deduplication, no invalidation, no background refetch, no shared
state. Those five bullets *are* the argument for RTK Query, and writing the
loading flag and cancellation by hand exactly once is the fastest way to
understand what you're buying.

The N+1 is avoided at the API layer: `GET /tasks` returns a joined `assignee`,
so 50 rows cost **one** query, not 51. `TaskCard` taking `assigneeName` as a
prop (Phase 2) is what makes that possible.

---

## 7. Interview questions

1. **Where do you store a JWT?** Access in memory, refresh in an httpOnly
   cookie. Volunteer the blast-radius argument.
2. **Your refresh flow logs users out randomly. Why?** Missing single-flight
   plus refresh-token rotation with reuse detection.
3. **Your refresh flow loops infinitely. Why?** The refresh call goes through
   the interceptor and re-enters on its own 401.
4. **How do you keep types in sync?** Generate from OpenAPI, fail CI on a
   non-empty diff. Then say which half of *your* contract is generated.
5. **Why three auth states?** `user: null` + `isLoading: false` can't
   distinguish "checked, logged out" from "not started".
6. **Is a route guard security?** No. It hides UI. The server's guard is the
   boundary — verified with a 401.
7. **Client or server pagination?** Server, unless the dataset is bounded.
8. **How do you implement redirect-after-login safely?** Relative paths only;
   reject schemes and leading `//`.
9. **Why does a list endpoint need authorization separately from the item
   endpoint?** Because guarding `/:id` doesn't stop enumeration through the
   collection — as this backend demonstrates.

---

## 8. Exercises

1. Break single-flight: change `??=` to `=`. Run `refreshClient.test.ts`.
2. Delete `.finally()`. Make the first refresh fail, then succeed. Explain why
   recovery is impossible.
3. Remove `skipAuthRetry` from `authApi.login` and submit a wrong password.
   Count the network requests.
4. Delete the `restoring` branch in `RequireAuth`, log in, and hard-refresh
   `/tasks` a few times with the network throttled.
5. Add a field to `RegisterDto` on the backend, run `npm run api:types`, and
   watch `contractCheck.ts` fail.
6. Set `location.state` to `{from:{pathname:'//evil.example'}}` in the console
   and confirm the guard rejects it.

---

## Verified

```
lint ✅   typecheck ✅   72/72 tests ✅   build ✅

Live, through the Vite proxy:
  register → 201 · project → 201 · 5 tasks → 201
  GET /tasks?page=1&limit=2  → items 2, total 3, totalPages 2
  GET /tasks?status=all      → 400  (sentinel correctly stripped client-side)
  GET /tasks (no token)      → 401  (server guard is the real boundary)

Contract assertions pass; drift injection correctly fails the build.
```

---

## Quiz

1. Where does the access token live, and what is the risk of the alternative?
2. Why does the refresh token go in an httpOnly cookie, and what does that then
   require?
3. Five requests 401 at the same moment. What goes wrong without single-flight?
4. Why must the refresh call itself not go through the interceptor?
5. Name two of the four conditions guarding a 401 retry.
6. `createdAt` is typed `Date` on the server. What arrives in the browser?
7. What does the contract check guard, and what does it **not** guard?
8. A hand-written response type omits a field. What is the symptom?

<details>
<summary>Answers</summary>

1. **In memory.** `localStorage` is readable by any XSS. In-memory dies on
   refresh, which is what the refresh cookie is for — neither is "secure", they
   trade different risks.
2. JavaScript cannot read it, so XSS cannot exfiltrate it. It is sent
   automatically, which is exactly why **CSRF protection** is then required.
3. Five refresh calls. With rotation, four present an already-consumed token, so
   **reuse detection revokes the session** and the user is logged out.
4. Infinite recursion — a 401 on refresh would trigger a refresh.
5. Any two of: not the refresh endpoint; not already retried; a token existed;
   the caller did not opt out (login must show "wrong password").
6. A **string**. JSON has no date type. Typing it `Date` compiles and then fails
   on `.getTime()`.
7. It guards what we **send** (request types are generated). It does not guard
   what we **receive** — the OpenAPI document has no response schemas.
8. **Silence.** The field becomes invisible to the whole frontend — no error
   anywhere. `Task.reference` was missing for several phases exactly this way.

</details>

---

**Next: Phase 8 & 9 — Redux Toolkit, then RTK Query.** `useAsyncData` gets
deleted, the five missing capabilities arrive, and we draw the client-state /
server-state line properly.
