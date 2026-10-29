# How TaskFlow works — a guided tour of the code

Read this **first**. The phase docs explain _one concept at a time_; this file follows
_one request at a time_ through the real code, so you can see how the concepts fit together.

Every claim below points at a file. If a file and this document ever disagree, the file is right —
please fix the document.

> **Who this is for:** someone who knows Express and wants to understand (a) how NestJS works and
> (b) how _this_ project is wired. For the Express→Nest translation table, read
> [express-vs-nestjs.md](nestbackend/docs/express-vs-nestjs.md) alongside this.

**Contents**

1. [The big picture](#1-the-big-picture)
2. [What happens when the server starts](#2-what-happens-when-the-server-starts)
3. [The modules and who depends on whom](#3-the-modules-and-who-depends-on-whom)
4. [Life of a request (the pipeline, in order)](#4-life-of-a-request)
5. [Authentication: tokens, cookies, CSRF](#5-authentication)
6. [Authorization: three layers](#6-authorization-three-layers)
7. [The data layer](#7-the-data-layer)
8. [Side effects: notifications, queues, events](#8-side-effects-notifications-queues-events)
9. [The React side](#9-the-react-side)
10. [One feature, both halves: "assign a task"](#10-one-feature-both-halves-assign-a-task)
11. [When things break: degraded modes](#11-when-things-break-degraded-modes)
12. [Known gaps (honest list)](#12-known-gaps)
13. [Where to find things](#13-where-to-find-things)

---

## 1. The big picture

```text
 Browser ──► :5173  Vite dev server  ──proxy /api, /health──►  :3000  NestJS
 (React SPA)                                                     │
   ▲                                                             ├──► MongoDB :27018  (data, replica set)
   │  SSE stream (notifications)                                 └──► Redis   :6379   (cache, queue, pub/sub, rate limits)
   └─────────────────────────────────────────────────────────────┘
```

- **Same-origin by design.** The browser only ever talks to `:5173`; Vite forwards `/api` and
  `/health` to Nest. That is why there is no CORS dance and cookies "just work". In production,
  nginx plays Vite's role ([reactfrontend/nginx.conf](reactfrontend/nginx.conf)).
- **Redis is optional, MongoDB is not.** With Redis down the API still serves requests in a
  _degraded mode_ ([§11](#11-when-things-break-degraded-modes)). With MongoDB down it never becomes ready.
- **The domain:** `User` ─ member of ─ `Project` ─ contains ─ `Task` ─ has ─ `Comment`. Assigning a
  task creates a `Notification`.

---

## 2. What happens when the server starts

Entry point: [nestbackend/src/main.ts](nestbackend/src/main.ts). In order:

1. **`NestFactory.create(AppModule)`** — Nest reads the module tree and builds the **DI container**
   (see below). Nothing is listening yet.
2. **Express-level middleware**, registered on the underlying Express app in this order:
   `helmet()` (security headers) → `compression()` → `cookieParser()` → `enableCors()`.
   These are plain Express middleware — the part of Nest that still _is_ Express.
3. **Routing setup:** `setGlobalPrefix('api')` (except `health/*`) and
   `enableVersioning({ type: URI, defaultVersion: '1' })`. That is how
   `@Controller('tasks')` + `@Get(':id')` becomes **`/api/v1/tasks/:id`**.
4. `enableShutdownHooks()` (so `SIGTERM` closes DB/Redis cleanly), Pino logger, Swagger.
5. **`app.listen(3000)`**.

### The DI container — the one idea that explains most of NestJS

In Express you `require()` what you need, so a file decides _which_ implementation it gets.
In Nest a class only **declares** what it needs in its constructor; the **module** decides what to
supply:

```ts
// tasks/tasks.service.ts  — "I need these; I don't care how they're built"
constructor(
  private readonly tasksRepository: TasksRepository,
  private readonly projectsService: ProjectsService,
  private readonly notifications: NotificationsService,
  private readonly transactions: TransactionRunner,
) {}
```

At startup Nest walks every module, builds each provider **once** (singletons by default), works
out the dependency order from those constructors, and injects them. A test can hand the same class
a fake instead — no `jest.mock` of the module system.

### Lifecycle hooks that run at startup (worth knowing)

| Hook                           | Where                                                                              | What it does                                                                                    |
| ------------------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `onModuleInit`                 | [notification-stream.service.ts](nestbackend/src/notifications/notification-stream.service.ts) | Subscribes to the Redis channel `taskflow:notifications`                                         |
| `onModuleInit`                 | [activity-log.listener.ts](nestbackend/src/activity-logs/activity-log.listener.ts) | Attaches a wildcard listener to the event bus                                                    |
| `onApplicationBootstrap`       | [users.service.ts](nestbackend/src/users/users.service.ts)                         | **Dev only:** if the users collection is empty, creates `admin@taskflow.dev` / `ChangeMe123!`    |
| `onModuleDestroy`              | stream service, Redis, queue                                                       | Unsubscribes / closes connections on shutdown                                                    |

---

## 3. The modules and who depends on whom

A **module** is a boundary: it lists what it `provides`, what it `exports` (visible to others) and
what it `imports`. Anything not exported is private — that is the enforcement Express folders lack.
Composition root: [app.module.ts](nestbackend/src/app.module.ts).

| Module                                       | Owns                                                              | Notes                                                                           |
| -------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `AppConfigModule`                            | Typed, validated env config (`AppConfigService`)                  | App refuses to boot with a bad `.env` ([env.validation.ts](nestbackend/src/config/env.validation.ts)) |
| `CommonModule` (`@Global`)                   | Logging interceptor, exception filter, validation pipe, request-id | Registered once, applies everywhere                                             |
| `DatabaseModule`                             | Mongoose connection, `TransactionRunner`, atomic counters          | Retries the connection at startup                                               |
| `RedisModule`                                | Publisher + subscriber clients                                    | Fails soft: "starting in DEGRADED mode"                                         |
| `CacheModule`                                | `CacheService`, Redis-backed rate limiter                         | Registers the global `SmartThrottlerGuard`                                      |
| `QueueModule`                                | BullMQ connection                                                 | Used by notifications                                                           |
| `EventsModule` (`@Global`)                   | In-process event bus (`EventEmitter2`)                            | Event catalogue: [domain-events.ts](nestbackend/src/events/domain-events.ts)    |
| `AuthModule`                                 | Register/login/refresh, JWT + local strategies, refresh-token store | Registers the global `JwtAuthGuard` and `RolesGuard`                            |
| `UsersModule`                                | User CRUD, roles, password hashing                                | Owns the "last admin" rule                                                      |
| `ProjectsModule`                             | Projects, membership, `ProjectAccessGuard`                        | Caches project lookups                                                          |
| `TasksModule`                                | Tasks, comments routes, `TaskAccessGuard`                         | The most "connected" module                                                     |
| `CommentsModule`                             | Comment storage                                                   | Used by `TasksService`                                                          |
| `NotificationsModule`                        | Notification store, SSE stream, WebSocket gateway, queue worker    | See [§8](#8-side-effects-notifications-queues-events)                           |
| `ActivityLogsModule`                         | Audit log + admin-only read endpoint                              | See [known gaps](#12-known-gaps)                                                |
| `HealthModule`                               | `/health/live`, `/health/ready`, `/health/detail`                 | Outside the `/api` prefix on purpose                                            |
| `ScopesDemoModule`                           | Teaching endpoints for provider scopes                            | **Not loaded in production**                                                    |

---

## 4. Life of a request

Take `PATCH /api/v1/tasks/:id/status` with body `{ "from": "todo", "to": "in_progress" }`.
Here is every stop, in the order it happens, and the file that implements it.

```text
 request
   │
   ├─ 1  Express middleware (main.ts)      helmet → compression → cookieParser → CORS
   ├─ 2  Nest middleware (app.module.ts)   CorrelationIdMiddleware  (assigns X-Request-Id), noStoreMiddleware
   │
   ├─ 3  GLOBAL GUARDS, in registration order
   │       a. SmartThrottlerGuard          rate limit (100 / 60s by default)             → 429
   │       b. JwtAuthGuard                 verify Bearer token → request.user            → 401
   │       c. RolesGuard                   only if the route has @Roles(...)             → 403
   ├─ 4  ROUTE GUARD  TaskAccessGuard      is this user a member of the task's project?  → 404/403
   │
   ├─ 5  INTERCEPTORS (before)             LoggingInterceptor starts its timer
   ├─ 6  PIPES                             global ValidationPipe validates the DTO       → 400
   │                                       ParseObjectIdPipe validates :id               → 400
   ├─ 7  CONTROLLER  tasks.controller.ts   thin: extract params, call the service
   ├─ 8  SERVICE     tasks.service.ts      business rules
   ├─ 9  REPOSITORY  tasks.repository.ts   MongoDB query
   │
   ├─ 10 INTERCEPTORS (after)              LoggingInterceptor logs "PATCH … 200 12ms user=… req=…"
   └─ 11 EXCEPTION FILTER (only if something threw)   AllExceptionsFilter → uniform error JSON
 response
```

Why this order matters:

- **Guards run before pipes.** An unauthenticated caller is rejected _before_ their body is
  validated, so validation errors can never be used to probe the API anonymously.
- **Global guards run before route guards.** Identity (`JwtAuthGuard`) is established first;
  `TaskAccessGuard` then relies on `request.user` being set.
- The relative order of the three global guards comes from the order their modules are imported in
  `AppModule` (`CacheModule` before `AuthModule`). Reordering imports reorders guards — a classic
  source of confusing bugs.

### The pieces, concretely

| Stage              | File                                                                                                    | Behaviour worth knowing                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Throttler          | [smart-throttler.guard.ts](nestbackend/src/cache/smart-throttler.guard.ts)                              | Keys by user id when authenticated, otherwise IP. `login`/`register` override it to **10 per 15 min**. Counters live in Redis (in-memory fallback). |
| JWT guard          | [jwt-auth.guard.ts](nestbackend/src/auth/guards/jwt-auth.guard.ts)                                      | **Deny by default.** Every route needs a token unless marked `@Public()`.                                                            |
| Roles guard        | [roles.guard.ts](nestbackend/src/common/guards/roles.guard.ts)                                          | Reads `@Roles(Role.ADMIN)` via `Reflector`. No decorator = allowed.                                                                   |
| Validation pipe    | [validation.provider.ts](nestbackend/src/common/pipes/validation.provider.ts)                          | `whitelist` + `forbidNonWhitelisted` + `transform`: unknown fields are **rejected**, not silently dropped (blocks mass-assignment).     |
| Logging            | [logging.interceptor.ts](nestbackend/src/common/interceptors/logging.interceptor.ts)                    | One line per request; skips `/health/*` so probes don't flood logs.                                                                  |
| Error filter       | [all-exceptions.filter.ts](nestbackend/src/common/filters/all-exceptions.filter.ts)                     | Maps `HttpException`, Mongoose `CastError`/`ValidationError` and Mongo duplicate-key (11000 → 409) to one JSON shape. Unknown errors → opaque 500. |
| Response envelope  | [transform-response.interceptor.ts](nestbackend/src/common/interceptors/transform-response.interceptor.ts) | **Not global.** Successful responses are the plain resource (`{ "user": …, "accessToken": … }`). Only **errors** have the `{ success:false, statusCode, message, path, requestId }` envelope. |

### What the controller actually looks like

[tasks.controller.ts](nestbackend/src/tasks/tasks.controller.ts) — note how little is in it:

```ts
@UseGuards(TaskAccessGuard)
@Patch(':id/status')
changeStatus(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: ChangeTaskStatusDto) {
  return this.tasksService.changeStatus(id, dto);   // return the value; Nest sends it as JSON
}
```

No `res.json`, no `try/catch`, no `next(err)`. If the service throws a `ConflictException`, the
filter in stage 11 turns it into a 409.

---

## 5. Authentication

Files: [auth.controller.ts](nestbackend/src/auth/auth.controller.ts),
[auth.service.ts](nestbackend/src/auth/auth.service.ts),
[jwt.strategy.ts](nestbackend/src/auth/strategies/jwt.strategy.ts),
[csrf.guard.ts](nestbackend/src/common/guards/csrf.guard.ts).

### Three credentials, three jobs

| Credential          | Lives in                                   | Lifetime | Used for                                         |
| ------------------- | ------------------------------------------ | -------- | ------------------------------------------------ |
| **Access token** (JWT) | JS **memory** only ([tokenStore.ts](reactfrontend/src/features/auth/tokenStore.ts)) | 15 min   | `Authorization: Bearer …` on every API call       |
| **Refresh token** (JWT) | **httpOnly cookie** `taskflow_refresh`     | 7 days   | Only to get a new access token                    |
| **CSRF token**      | Readable cookie `taskflow_csrf`            | 7 days   | Echoed in header `x-csrf-token` on refresh/logout |

Why split them? An XSS bug can read anything JavaScript can read — so the long-lived secret (refresh)
is in a cookie JavaScript _cannot_ read, and the readable one (access) dies in 15 minutes. A cookie
is sent automatically by the browser, which is exactly what CSRF abuses — so the cookie-authenticated
endpoints (`/auth/refresh`, `/auth/logout`) additionally demand the **double-submit CSRF** header.
Bearer-token endpoints don't need that: a forged cross-site request can't add the header.

### Login, step by step

1. `POST /auth/login` is `@Public()` (no token yet) and uses `LocalAuthGuard`.
2. `validateCredentials`: bcrypt-compares the password. For an **unknown email** it still compares
   against a dummy hash, so response time doesn't reveal which emails exist.
3. `issueTokens`: signs the access JWT (`sub`, `email`, `role`) and the refresh JWT
   (`sub`, `jti`, `family`). It stores a **SHA-256 hash** of the refresh token in MongoDB — never
   the token itself, so a database leak doesn't hand out sessions.
4. The controller sets the refresh cookie + CSRF cookie and returns `{ user, accessToken, expiresIn }`.

### Refresh with rotation and reuse detection

Every refresh **spends** the old refresh token and issues a new one in the same **family**:

```text
login ─► token A (family F)
refresh(A) ─► A revoked, token B issued (family F)
refresh(B) ─► B revoked, token C issued (family F)
refresh(A) again ─► A is already revoked ⇒ someone stole it
                     ⇒ revoke the WHOLE family F, return 403
                       "Refresh token reuse detected; all sessions have been revoked"
```

A stolen-and-replayed token therefore kills the session for both attacker and victim — the safe
failure. (This is why the 403 differs from a plain 401.)

Other revocations: `logout` (this session), `logout-all`, and **changing your password revokes every
session**.

### How a request is authenticated

`JwtAuthGuard` → Passport `JwtStrategy` verifies signature + expiry → `validate()` returns
`{ id, email, role }` → Nest attaches it to `request.user` → controllers read it with the
`@CurrentUser()` decorator.

Two things to be aware of:

- **The role is baked into the access token.** Promote someone to admin and their _existing_ token
  still says `member` for up to 15 minutes — they must refresh or sign in again.
- The strategy also accepts `?access_token=` in the URL. That exists only because the browser's
  `EventSource` (used for SSE) **cannot set headers**. The trade-off is that URLs can end up in
  logs; see [known gaps](#12-known-gaps).

---

## 6. Authorization: three layers

"Are you logged in?" is authentication. **Authorization** asks _may you do this?_ and here it has
three independent layers, each catching a different mistake:

| Layer                       | Question                                    | Mechanism                                                                                              |
| --------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **1. Global role**          | Are you a site admin?                       | `@Roles(Role.ADMIN)` + `RolesGuard`. Used on `/users/*`, `/activity-logs`, `/health/detail`.           |
| **2. Project membership**   | Are you a member of _this_ project?         | [`ProjectAccessGuard`](nestbackend/src/projects/guards/project-access.guard.ts) / [`TaskAccessGuard`](nestbackend/src/tasks/guards/task-access.guard.ts) |
| **3. Business rule**        | May _you_ do _this_ to _this_ object?       | Inside services, e.g. deleting a comment needs author / admin / project manager.                       |

Details that are easy to miss:

- **Non-members get 404, not 403.** `ProjectAccessGuard` throws `NotFoundException` for a project you
  aren't in, so the API doesn't confirm that a project exists. (Verified live: member B got 404
  until added.)
- **Global admins bypass membership checks** (explicitly, in both guards).
- `ProjectAccessGuard` finds the project id from `params.projectId ?? params.id`, then the body,
  then the query string — that's how one guard protects `GET /projects/:id`, `POST /tasks` (body) and
  `GET /tasks?projectId=` (query).
- **Aggregate views need their own decision.** The activity log is admin-only even though a member
  can see each project individually, because the combined log would reveal what they shouldn't see.
- **The system always keeps at least one admin.** Both _deleting_ and _demoting_ the last admin
  return **409** — one shared check, `assertNotLastAdmin`, in
  [users.service.ts](nestbackend/src/users/users.service.ts). (Demotion used to be unguarded; the
  bug and its test are described in the [testing doc](nestbackend/docs/phase-14-testing.md).)

---

## 7. The data layer

### Controller → service → repository

- **Controller:** HTTP only (params, status codes, decorators).
- **Service:** the rules ("can't add tasks to an archived project", "assignee must be a member").
  Knows nothing about HTTP — it could be called from a queue worker or a script.
- **Repository:** Mongoose queries only. `TasksRepository` is a plain class;
  `ProjectsRepository` is an abstract class (a "port") bound to `MongoProjectsRepository` in the module,
  with an in-memory version for tests — the textbook use of a custom provider (`useClass`).

### Patterns you'll meet in the code

| Pattern                         | Where                                                                                       | Why                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Atomic counter** for `WEB-1`, `WEB-2` | `tasksRepository.nextReference` + [counter.schema.ts](nestbackend/src/database/schemas/counter.schema.ts) | `findOneAndUpdate($inc)` is atomic, so concurrent creates never get the same number (tested under concurrency). |
| **Optimistic concurrency**      | `changeStatus(id, from, to)`                                                                | The update filters on `status: from`. If someone changed it first nothing matches → **409** "someone changed it first" instead of a silent overwrite. |
| **Transaction**                 | `tasksService.remove` via [transaction.runner.ts](nestbackend/src/database/transaction.runner.ts) | Deleting a task + its comments must be all-or-nothing. **Requires a replica set** (Docker compose provides one; a standalone `mongod` cannot do transactions). |
| **Soft delete**                 | Comments (`deletedAt`)                                                                      | Every read must filter `deletedAt: null`.                                                         |
| **Cache-aside**                 | `projectsService.findById` → `cache.getOrSet(cacheKeys.project(id), …)`                     | Cached 60 s (+ jitter); writes call `delByPrefix` to invalidate. Cache errors are swallowed → treated as a miss. |
| **Pagination**                  | `PaginationQuery` + `paginate()`                                                            | Same `{ items, total, page, limit }` shape everywhere.                                            |
| **Secrets stay in the service** | `findByEmailWithSecrets`                                                                    | Only that method returns the password hash; everything else maps through `toPublicUser`.          |

---

## 8. Side effects: notifications, queues, events

Three different mechanisms, easy to confuse. Think of them as three answers to "something happened —
who needs to know?":

| Mechanism             | Scope               | Durable? | Used for                                         |
| --------------------- | ------------------- | -------- | ------------------------------------------------ |
| **Domain events** (`EventEmitter2`) | in-process, sync | No       | Decoupling modules; the audit log                |
| **BullMQ queue**      | across processes, via Redis | Yes (retries, backoff) | Delivering email-like notifications                |
| **Redis pub/sub + SSE** | across server instances | No (fire-and-forget) | Pushing live notifications to open browsers        |

### What "assign a task" triggers

[tasks.service.ts](nestbackend/src/tasks/tasks.service.ts) `assign()` → `notifyAssignee()` →
[notifications.service.ts](nestbackend/src/notifications/notifications.service.ts) `notifyUser()`, which does:

1. **Store** a `Notification` row in MongoDB (so the bell works after a page refresh).
2. **Publish** it on Redis channel `taskflow:notifications`
   ([notification-stream.service.ts](nestbackend/src/notifications/notification-stream.service.ts)).
   _Every_ API instance is subscribed, so whichever instance holds Bob's open SSE connection
   delivers it — that is what makes the stream work behind a load balancer.
3. **Dispatch** an "email" via `NotificationDispatcher`: add a BullMQ job whose id is a hash of
   (recipient, subject, body) — so a retry or double-click can't send twice (**idempotency**).
   `NotificationsProcessor` (concurrency 5) picks it up and hands it to a channel; in development
   the channel is just the **console**. If the queue is unreachable, the dispatcher delivers
   **inline** instead of failing the request.

Failures in notification code are caught and logged — assigning a task never fails because the
notification system had a bad moment.

### The SSE endpoint

`GET /api/v1/notifications/stream` ([notifications.controller.ts](nestbackend/src/notifications/notifications.controller.ts))
returns an `Observable` merged with a 30-second heartbeat. Nest handles the `text/event-stream`
framing. Each browser connection filters the shared stream by its own user id.

A WebSocket gateway also exists ([notifications.gateway.ts](nestbackend/src/notifications/notifications.gateway.ts),
namespace `/realtime`: typing indicators, project rooms). It's a teaching feature — **the React app
uses SSE, not the gateway.**

### Domain events and the activity log — what is actually wired

The event bus, the full event catalogue and the audit listener all exist. But today only **two**
events are ever emitted:

| Event                       | Emitted by                         | Consumed by                                                               |
| --------------------------- | ---------------------------------- | ------------------------------------------------------------------------- |
| `user.registered`           | `UsersService.create`              | `ActivityLogListener` (wildcard) → writes an activity row                 |
| `user.deletion_requested`   | `UsersService.remove` (`emitAsync`) | `UserDeletionListener` in Projects — can **veto** (409 if user owns active projects) |

The `task.*`, `comment.added` and `project.*` events are _defined_ in
[domain-events.ts](nestbackend/src/events/domain-events.ts) but nothing emits them yet, so the
activity log currently records user registrations only. See [known gaps](#12-known-gaps).

The **veto pattern** is the clever bit: `UsersService` doesn't import `ProjectsService` (that would
create a circular dependency). It announces _"I'm about to delete user X"_ and any module may push a
blocker onto the payload; if any did, it throws 409. Decoupled, but still a synchronous decision.

---

## 9. The React side

Stack: Vite + TypeScript, React Router (data router), Redux Toolkit + **RTK Query**, React Hook
Form + Zod, MUI. Guide: [reactfrontend/README.md](reactfrontend/README.md).

### Boot

[main.tsx](reactfrontend/src/main.tsx): `ErrorBoundary` (outermost, so even provider failures show a
page, not white screen) → `AppProviders` (Redux store, theme, `SessionBootstrap`) → `RouterProvider`.

### Session restore (why you stay logged in after F5)

The access token lives only in memory, so a reload loses it. [SessionBootstrap.tsx](reactfrontend/src/features/auth/SessionBootstrap.tsx)
calls `POST /auth/refresh` on startup; the browser sends the httpOnly cookie automatically. Success →
`sessionRestored(user)`; failure → `restoreFailed` → the router sends you to `/login`. While this
runs the auth state is `restoring`, so protected pages show a loader instead of flashing the login page.

### Every API call: [apiSlice.ts](reactfrontend/src/services/apiSlice.ts)

```text
component calls a hook (useGetTasksQuery)
   └─► baseQuery adds  Authorization: Bearer <memory token>   and   x-csrf-token (from the cookie)
         └─► response 401?
               └─► refreshAccessToken()   ← SINGLE-FLIGHT: if 5 requests 401 at once,
                     │                      only ONE refresh call is made; the rest await it
                     ├─ ok  → retry the original request once, transparently
                     └─ fail → tokenStore.expire() → sessionExpired → redirect to /login
```

([refreshClient.ts](reactfrontend/src/services/refreshClient.ts) holds the shared in-flight promise.)

### Cache and invalidation (RTK Query)

Responses are cached by endpoint + arguments (`keepUnusedDataFor: 60`). Mutations declare which
**tags** they invalidate (`Task`, `Project`, `User`, `Comment`, `Notification`), and RTK Query
re-fetches exactly the affected queries. Some mutations (task status) update the cache
**optimistically** and roll back on failure ([optimisticUpdate.integration.test.ts](reactfrontend/src/features/tasks/optimisticUpdate.integration.test.ts)).

### Routes and permissions

[router.tsx](reactfrontend/src/app/router.tsx): public `/login`, `/register`; everything else is under
`RequireAuth`; `/admin/*` is additionally under `RequireRole(ADMIN)`. Pages are `lazy()`-loaded.
**These checks are UX, not security** — the server enforces the real rules (a user who edits the
bundle still gets 403 from the API).

### Live notifications

[useNotificationStream.ts](reactfrontend/src/features/notifications/useNotificationStream.ts) opens an
`EventSource` to `/notifications/stream?access_token=…`, and on each event pushes the notification into
the RTK Query cache (`updateQueryData`) and bumps the unread badge — **no refetch**. It de-duplicates
by id and reconnects with exponential backoff (1 s → 30 s cap), refreshing the access token first.

---

## 10. One feature, both halves: "assign a task"

Alice (project owner) assigns a task to Bob, who has the app open in another browser.

```text
ALICE'S BROWSER                         NESTJS                                   BOB'S BROWSER
───────────────                         ──────                                   ─────────────
pick Bob in the assignee menu
useAssignTaskMutation →
PATCH /api/v1/tasks/:id/assignee
  + Bearer + x-csrf-token
        │ (Vite proxy :5173 → :3000)
        ▼
                                   helmet/cookies/CORS → request-id
                                   Throttler → JwtAuthGuard (Alice) → RolesGuard (no @Roles)
                                   TaskAccessGuard: Alice is a member ✔
                                   LoggingInterceptor starts timer
                                   ValidationPipe: { assigneeId } is a MongoId ✔
                                   TasksController.assign → TasksService.assign
                                     • task exists? project loaded (cache-aside)
                                     • Bob is a project member? (else 409)
                                     • tasksRepository.update(assigneeId = Bob)
                                     • notifyAssignee → NotificationsService.notifyUser
                                          1. insert Notification (Mongo)
                                          2. Redis PUBLISH taskflow:notifications ──────────┐
                                          3. BullMQ job "send-notification" (console)        │
                                   ◄─ 200 { updated task }                                  │
                                   LoggingInterceptor: "PATCH … 200 14ms"                   │
        ◄───────────────────────                                                           │
RTK Query invalidates Task tags;                                                            │
task list refetches                              Redis SUBSCRIBE (every instance) ◄────────┘
                                                 NotificationStreamService.local$.next()
                                                 filter(userId === Bob) → SSE frame ───────────────►  EventSource 'notification'
                                                                                                       updateQueryData(+1 unread)
                                                                                                       toast "WEB-1 assigned to you"
```

I verified the backend half of this live: Bob's `unread-count` rose to 3 and the notification row
contained `type: "task_assigned"`, title `WEB-1 assigned to you`.

---

## 11. When things break: degraded modes

The code is written so optional infrastructure failing doesn't take the API down:

| If this is down | What happens                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Redis**       | Boot logs `starting in DEGRADED mode`. Cache reads become misses, rate limiting falls back to in-memory counters, SSE delivers locally (no cross-instance fan-out), notification jobs run **inline** instead of queued. `/health/ready` stays green; `/health/detail` (admin) reports it. |
| **MongoDB**     | Mongoose retries; the app never reports ready (`/health/ready` fails). Nothing works without it.                           |
| **Mongo is a standalone, not a replica set** | Everything works **except** `DELETE /tasks/:id` (transactions need a replica set).                   |
| **Queue worker slow/crashed** | Jobs wait in Redis and retry with backoff; stalled jobs are re-run, which is why handlers are idempotent.   |

Probes: `GET /health/live` (process up), `/health/ready` (can serve traffic — MongoDB only),
`/health/detail` (admin-only, includes Redis).

---

## 12. Known gaps

Honest list of places where the code is narrower than the docs' ambitions. None break the app.

1. **Most domain events are never emitted.** `task.created`, `task.assigned`, `task.status_changed`,
   `task.deleted`, `comment.added`, `project.member_added`, `project.archived` exist in
   `domain-events.ts` but no service fires them, so the **activity log only records user
   registrations**. Fixing it means passing the acting user's id into service methods (events require
   an `actorId`) and emitting after each successful write. Task assignment currently calls
   `NotificationsService` directly instead of going through an event.
2. **Access token in the SSE URL** (`?access_token=`). Required by `EventSource`, but tokens in URLs
   can be logged. Mitigated by the 15-minute lifetime; the standard hardening is a short-lived,
   single-purpose "stream ticket".
3. **Role changes lag by up to 15 minutes** because the role is inside the JWT.
4. **Rate limiting is per IP** for anonymous routes, so users behind one NAT share the login allowance.
5. **WebSocket gateway is unused by the frontend** — present for teaching, not product.

---

## 13. Where to find things

```text
nestbackend/src/
  main.ts                    bootstrap: middleware, prefix, versioning
  app.module.ts              composition root (module import order matters)
  config/                    typed env config + validation
  common/                    guards (roles, csrf), interceptors, filter, pipes, decorators
  auth/                      controller, service, strategies, jwt guard, refresh-token schema
  users/ projects/ tasks/ comments/     the domain (controller → service → repository)
  notifications/             store + SSE stream + queue processor + WS gateway
  activity-logs/             audit listener + admin endpoint
  events/domain-events.ts    event catalogue
  database/                  Mongoose setup, TransactionRunner, counters
  cache/ redis/ queue/       Redis-backed infrastructure
  health/                    probes
nestbackend/test/            Jest global setup (shared MongoDB)
nestbackend/docs/            phase-by-phase concept docs + interview prep
reactfrontend/src/
  main.tsx, app/             entry, store, router, providers
  services/                  apiSlice (RTK Query), refreshClient (single-flight)
  features/<name>/           auth, tasks, projects, comments, notifications, users, activity
  pages/ layouts/ routes/    screens, shells, route guards
reactfrontend/docs/          phase-by-phase React docs
```

**Suggested reading order**

1. This file → [express-vs-nestjs.md](nestbackend/docs/express-vs-nestjs.md)
2. Backend phases 1–3 (modules, providers, DI) — the foundation.
3. Phases 6–9 (DTOs, auth, authorization, the request pipeline).
4. Phases 5, 10–13 (data, caching, SSE, queues, events) as you need them.
5. Frontend phases 1–9, then 15 (SSE) and 10–11 (authorization).

**Running and testing:** see the root [README](README.md#quick-start). If backend tests fail with
`spawn UNKNOWN` (the bundled `mongod` cannot start on some Windows machines), see the
[testing doc](nestbackend/docs/phase-14-testing.md#running-the-integration-suites-without-the-bundled-mongod).
