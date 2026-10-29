# TaskFlow API — a production-style NestJS project built as a senior interview reference

A task/project-management backend written the way a real team would write it, and commented the
way a good mentor would explain it.

This repository has four jobs at once:

1. **A real backend** — users, projects, tasks, comments, notifications, activity logs, background
   jobs, caching, real-time delivery.
2. **A NestJS learning project** — the source files themselves carry the teaching. Comments explain
   _what_ a construct is, _why_ NestJS has it, _what it replaces in Express_, and _what the
   trade-off is_.
3. **An interview-preparation reference** — every phase ends with interview questions, common
   mistakes, and senior-level follow-ups.
4. **A migration bridge from Express** — if you already know Node/Express/Mongo/JWT, this maps what
   you know onto what NestJS calls it.

> **Honesty note (project requirement #46).** This repo exists to make you _genuinely_ competent
> with NestJS, not to help you claim experience you do not have. See
> [POSITIONING.md](../POSITIONING.md) at the repo root — it is explicit about not inflating years,
> and lists the gaps to volunteer rather than hide.

---

## Status: all 22 phases complete

The project is built **phase by phase** so each concept lands before the next one arrives.

| Phase  | Topic                                                                       | Status      |
| ------ | --------------------------------------------------------------------------- | ----------- |
| **1**  | **Project setup, architecture, configuration**                              | ✅ **done** |
| **2**  | **Modules, controllers, providers, dependency injection**                   | ✅ **done** |
| **3**  | **Provider tokens + custom providers (`useClass`/`useValue`/`useFactory`)** | ✅ **done** |
| **4**  | **Provider scopes, dependency resolution, circular dependencies**           | ✅ **done** |
| **5**  | **MongoDB + Mongoose**                                                      | ✅ **done** |
| **6**  | **DTOs, validation, pipes**                                                 | ✅ **done** |
| **7**  | **Authentication (Passport + JWT + refresh tokens)**                        | ✅ **done** |
| **8**  | **Authorization, guards, RBAC**                                             | ✅ **done** |
| **9**  | **Interceptors, middleware, exception filters**                             | ✅ **done** |
| **10** | **Redis, caching, rate limiting**                                           | ✅ **done** |
| **11** | **SSE + WebSockets**                                                        | ✅ **done** |
| **12** | **BullMQ background jobs**                                                  | ✅ **done** |
| **13** | **Events / event-driven architecture**                                      | ✅ **done** |
| **14** | **Testing (unit / integration / e2e)**                                      | ✅ **done** |
| **15** | **Swagger / OpenAPI**                                                       | ✅ **done** |
| **16** | **Security hardening**                                                      | ✅ **done** |
| **17** | **Docker + CI/CD**                                                          | ✅ **done** |
| **18** | **Health checks, logging, observability**                                   | ✅ **done** |
| **19** | **Performance + scalability**                                               | ✅ **done** |
| **20** | **Microservices architecture + migration strategy**                         | ✅ **done** |
| **21** | **132 interview questions**                                                 | ✅ **done** |
| **22** | **Mock senior NestJS interview**                                            | ✅ **done** |

**Phase deep dives:**
[Phase 1 — setup & configuration](docs/phase-01-setup-and-configuration.md) ·
[Phase 2 — modules, providers & DI](docs/phase-02-modules-providers-di.md) ·
[Phase 3 — tokens & custom providers](docs/phase-03-tokens-and-custom-providers.md) ·
[Phase 4 — scopes, resolution & circular deps](docs/phase-04-scopes-resolution-circular.md) ·
[Phase 5 — MongoDB & Mongoose](docs/phase-05-mongodb-mongoose.md) ·
[Phase 6 — DTOs, validation & pipes](docs/phase-06-dtos-validation-pipes.md) ·
[Phase 7 — authentication](docs/phase-07-authentication.md) ·
[Phase 8 — authorization & RBAC](docs/phase-08-authorization-rbac.md) ·
[Phase 9 — middleware, interceptors & filters](docs/phase-09-middleware-interceptors-filters.md) ·
[Phase 10 — caching & rate limiting](docs/phase-10-caching-rate-limiting.md) ·
[Phase 11 — SSE & WebSockets](docs/phase-11-sse-websockets.md) ·
[Phase 12 — background jobs](docs/phase-12-background-jobs.md) ·
[Phase 13 — event-driven architecture](docs/phase-13-event-driven-architecture.md) ·
[Phase 14 — testing](docs/phase-14-testing.md) ·
[Phase 15 — Swagger / OpenAPI](docs/phase-15-swagger.md) ·
[Phase 16 — security hardening](docs/phase-16-security.md) ·
[Phase 17 — Docker & CI/CD](docs/phase-17-docker-ci.md) ·
[Phase 18 — health, logging & observability](docs/phase-18-health-logging.md) ·
[Phase 19 — performance & scalability](docs/phase-19-performance-scalability.md) ·
[Phase 20 — microservices & migration](docs/phase-20-microservices.md) ·
[Phase 21 — 132 interview questions](docs/phase-21-interview-questions.md) ·
[Phase 22 — mock senior interview](docs/phase-22-mock-interview.md)
**Express → NestJS translation guide:** [`docs/express-vs-nestjs.md`](docs/express-vs-nestjs.md)

---

## Table of contents

1. [Project overview](#1-project-overview)
2. [Domain model](#2-domain-model)
3. [Architecture](#3-architecture)
4. [Folder structure](#4-folder-structure)
5. [Technologies](#5-technologies)
6. [Installation](#6-installation)
7. [Environment variables](#7-environment-variables)
8. [Running locally](#8-running-locally)
9. [Docker setup](#9-docker-setup)
10. [CI/CD pipeline](#10-cicd-pipeline)
11. [Configuration architecture](#11-configuration-architecture)
12. [API endpoints](#12-api-endpoints)
13. [API documentation (Swagger / OpenAPI)](#13-api-documentation-swagger--openapi)
14. [Request lifecycle](#14-request-lifecycle)
15. [Modules](#15-modules)
16. [Controllers](#16-controllers)
17. [Providers and services](#17-providers-and-services)
18. [Dependency injection](#18-dependency-injection)
19. [Provider tokens and custom providers](#19-provider-tokens-and-custom-providers)
20. [Provider scopes](#20-provider-scopes)
21. [Dependency resolution](#21-dependency-resolution)
22. [Circular dependencies](#22-circular-dependencies)
23. [Global modules](#23-global-modules)
24. [DTOs and validation](#24-dtos-and-validation)
25. [Pipes](#25-pipes)
26. [Authentication flow](#26-authentication-flow)
27. [Authorization and RBAC](#27-authorization-and-rbac)
28. [Guards](#28-guards)
29. [Interceptors](#29-interceptors)
30. [Middleware](#30-middleware)
31. [Exception filters](#31-exception-filters)
32. [Database architecture](#32-database-architecture)
33. [MongoDB and Mongoose](#33-mongodb-and-mongoose)
34. [MongoDB performance](#34-mongodb-performance)
35. [Redis](#35-redis)
36. [Caching strategy](#36-caching-strategy)
37. [Rate limiting](#37-rate-limiting)
38. [Server-Sent Events](#38-server-sent-events)
39. [WebSockets](#39-websockets)
40. [Background jobs](#40-background-jobs)
41. [Event-driven architecture](#41-event-driven-architecture)
42. [Testing strategy](#42-testing-strategy)
43. [Security](#43-security)
44. [Health checks, logging and observability](#44-health-checks-logging-and-observability)
45. [Performance and scalability](#45-performance-and-scalability)
46. [Modular monolith vs microservices](#46-modular-monolith-vs-microservices)
47. [Design decisions and trade-offs](#47-design-decisions-and-trade-offs)
48. [Common mistakes](#48-common-mistakes)
49. [Express → NestJS mapping](#49-express--nestjs-mapping)
50. [Interview preparation](#50-interview-preparation)

---

## 1. Project overview

**TaskFlow** is the backend for a team task manager. It was chosen over the usual e-commerce or blog
demo for three reasons:

- It has **real authorization complexity** — permissions depend on both a global role _and_
  per-project membership, which is where naive RBAC implementations fall apart. That makes it a
  genuinely interesting guard/decorator exercise instead of a toy one.
- It has **natural asynchronous work** — assigning a task should notify someone, write an activity
  log, and possibly send an email. That is a queue and an event bus, not an inline `await`.
- It has **natural real-time needs** — notifications want to be pushed, which motivates SSE and
  WebSockets for real rather than as a checkbox.

### Features

Built so far:

- **Phase 1** — Environment-based, validated, strongly-typed configuration; bootstrap pipeline
  (security headers, CORS, compression, cookies, global prefix, URI versioning, graceful shutdown);
  local infrastructure via Docker Compose (MongoDB replica set + Redis); strict TypeScript,
  type-aware ESLint and Prettier
- **Phase 2** — `users` and `projects` feature modules: full REST controllers, services holding the
  business rules, repositories behind an interface, cross-module DI, module encapsulation, and 15
  unit tests
- **Phase 3** — all four custom-provider recipes in real use: a swappable password-hashing port
  (`useClass`, two working implementations + a contract test), frozen build metadata (`useValue`),
  an environment-driven notification-channel strategy (`useFactory`), a shared Redis connection
  built by an **async** factory with graceful degradation and a shutdown hook, plus a test proving
  the `useClass` vs `useExisting` identity difference — 38 tests

Planned (see phase table):

- Registration/login, access + refresh tokens, logout, protected routes
- RBAC (`ADMIN` / `MANAGER` / `MEMBER`) plus per-project membership checks
- Projects, tasks, comments with pagination, filtering and indexes
- Redis cache-aside with explicit invalidation, and Redis-backed rate limiting
- Real-time notifications over SSE, with a WebSocket gateway for bidirectional needs
- BullMQ workers for notification fan-out and activity logging, with retries and idempotency
- Domain events (`TaskCreated`, `TaskAssigned`, …) decoupling producers from consumers
- Health probes, structured logging with correlation IDs, Swagger docs, Docker, CI

---

## 2. Domain model

```text
User
 ├── belongs to Projects        (membership carries a project-level role)
 ├── creates Tasks
 ├── comments on Tasks
 ├── receives Notifications
 └── generates ActivityLogs

Project ──< Task ──< Comment
   │          │
   │          └── assignee: User
   └── members: [{ user, role }]
```

---

## 3. Architecture

**Modular monolith**: one deployable process, hard internal boundaries.

```text
┌─────────────────────────────────────────────────────────────┐
│                      NestJS process                          │
│                                                              │
│  FEATURE MODULES        auth · users · projects · tasks      │
│                         comments · notifications · activity  │
│         │                                                    │
│         ▼                                                    │
│  INFRASTRUCTURE         config · database · cache · queue    │
│  MODULES                events · health                      │
│         │                                                    │
│         ▼                                                    │
│  COMMON                 guards · pipes · interceptors        │
│  (no business logic)    filters · decorators · middleware    │
└─────────────────────────────────────────────────────────────┘
              │                    │                │
              ▼                    ▼                ▼
          MongoDB               Redis           (SMTP, …)
```

### Why this architecture?

**Why modular over layered (`controllers/`, `services/`, `models/`)?**
A layered layout groups files by _technical role_; a modular layout groups them by _reason to
change_. Adding a field to a task touches one folder instead of four, and the directory listing
tells you what the system does instead of what framework it uses. Critically, it means a future
microservice extraction is a folder move, not a rewrite.

**Why a monolith and not microservices now?**
You cannot draw correct service boundaries before you understand the domain, and a wrong boundary
is far more expensive to fix than a wrong folder. A modular monolith buys you the boundaries
without paying the distributed-systems tax: network partitions, eventual consistency, distributed
tracing, N deployment pipelines, N on-call runbooks. Phase 20 covers _when_ that tax becomes worth
paying and how to migrate module by module.

**Why the dependency rule (`features → infrastructure → common`)?**
Because it is the only thing that stops a "modular" monolith from quietly becoming a big ball of
mud. Concretely:

- `common/` must never import from a feature. If a guard needs `UsersService`, it is not common —
  it belongs to `auth/`.
- Feature-to-feature dependencies must be one-directional and explicit. Two features that need each
  other is the circular-dependency smell that Phase 4 attacks properly (and explains why
  `forwardRef()` is a last resort, not a fix).

**Principles this expresses**

| Principle              | Where you see it                                                              |
| ---------------------- | ----------------------------------------------------------------------------- |
| Single responsibility  | Controllers do HTTP; services do rules; repositories do persistence           |
| Dependency inversion   | Consumers depend on tokens/interfaces, not concrete classes (Phase 3)         |
| Separation of concerns | Cross-cutting behaviour lives in guards/interceptors/filters, not in handlers |
| Encapsulation          | A module's providers are private unless exported                              |
| Scalability            | Stateless HTTP layer + Redis for shared state ⇒ horizontal scaling (Phase 19) |

---

## 4. Folder structure

```text
.
├── docker-compose.yml         # MongoDB (replica set) + Redis for local dev
├── eslint.config.mjs          # ESLint 9 flat config, type-aware rules
├── nest-cli.json              # Nest CLI + Swagger plugin
├── tsconfig.json              # strict mode + the two decorator flags Nest needs
├── .env.example               # committed documentation of every variable
├── .env.development           # local dev values (no real secrets)
├── .env.test                  # separate DB + Redis index so tests cannot touch dev data
├── docs/
│   ├── phase-01-setup-and-configuration.md
│   └── express-vs-nestjs.md
└── src/
    ├── main.ts                # bootstrap: the composition root of the process
    ├── app.module.ts          # root module: the composition root of the DI graph
    ├── app.controller.ts      # GET /api/v1 and /api/v1/ping
    ├── app.service.ts
    ├── config/                # ✅ Phase 1
    │   ├── config.module.ts       # @Global() wrapper around @nestjs/config
    │   ├── config.types.ts        # the shape of all configuration
    │   ├── env.validation.ts      # Joi schema — fail fast at boot
    │   ├── env.util.ts            # small parse/assert helpers
    │   ├── app-config.service.ts  # typed facade over ConfigService
    │   └── namespaces/            # registerAs() per concern
    ├── users/                  # ✅ Phase 2 — feature module
    │   ├── users.module.ts         # providers: 3, exports: 1  ← the encapsulation lesson
    │   ├── users.controller.ts     # REST verbs + @Param/@Query/@Body/@Headers
    │   ├── users.service.ts        # business rules; the DI deep-dive comments live here
    │   ├── users.repository.ts     # in-memory; swapped for Mongoose in Phase 5
    │   ├── hashing/                # ✅ Phase 3 — the useClass port
    │   │   ├── password-hasher.interface.ts   # the contract (why you can't inject an interface)
    │   │   ├── bcrypt-password-hasher.ts      # implementation #1 (default)
    │   │   ├── scrypt-password-hasher.ts      # implementation #2 (real, node:crypto)
    │   │   └── password-hasher.spec.ts        # ONE contract test over BOTH
    │   ├── entities/  dto/
    │   └── users.service.spec.ts
    ├── projects/               # ✅ Phase 2 — imports UsersModule (cross-module DI)
    │   ├── projects.module.ts  projects.controller.ts  projects.service.ts
    │   ├── projects.repository.ts  entities/  dto/
    │   └── projects.service.spec.ts
    ├── notifications/          # ✅ Phase 3 — the useFactory strategy
    │   ├── notifications.module.ts        # factory picks a channel from config
    │   ├── notifications.service.ts       # facade owning the swallow-and-log rule
    │   ├── channels/                      # console · email · noop (Null Object)
    │   └── notifications.module.spec.ts   # useClass vs useExisting, proven
    ├── redis/                  # ✅ Phase 3 — ASYNC useFactory + shutdown hook
    │   └── redis.module.ts         # @Global(); boots degraded if Redis is down
    ├── common/                # cross-cutting, zero business knowledge
    │   ├── constants/             # injection tokens — the annotated reference
    │   ├── providers/             # appMetadataProvider (useValue)
    │   ├── enums/  dto/           # Role, pagination — pure shared-kernel values
    │   ├── decorators/  guards/  interceptors/  filters/  pipes/  middleware/
    ├── database/              # Phase 5
    ├── cache/                 # Phase 10
    ├── queue/                 # Phase 12
    └── health/                # Phase 18 — terminus probes
```

---

## 5. Technologies

| Concern           | Choice                                   | Why this one                                                                           |
| ----------------- | ---------------------------------------- | -------------------------------------------------------------------------------------- |
| Framework         | NestJS 11                                | Opinionated structure + DI + first-class TypeScript                                    |
| HTTP adapter      | Express                                  | Larger middleware ecosystem; Fastify is a one-line swap if profiling ever justifies it |
| Language          | TypeScript 5 (strict)                    | Compile-time safety; also _required_ for Nest's metadata-driven DI                     |
| Database          | MongoDB 7 + Mongoose 8                   | Flexible documents fit tasks/comments; replica set enables transactions                |
| Cache / broker    | Redis 7 + ioredis                        | Cache-aside store, BullMQ backend, pub/sub for multi-instance SSE                      |
| Jobs              | BullMQ                                   | Redis-native, retries, backoff, delayed jobs, good observability                       |
| Auth              | Passport + `@nestjs/jwt`                 | Strategy pattern already built in; JWT keeps the API stateless                         |
| Validation        | class-validator + class-transformer      | Declarative DTOs that Swagger can also read                                            |
| Config validation | Joi                                      | Natively supported by `@nestjs/config`                                                 |
| Docs              | Swagger / OpenAPI                        | Generated from the decorators you already write                                        |
| Tests             | Jest + Supertest + mongodb-memory-server | Unit + integration + e2e without a shared test DB                                      |
| Logging           | pino via `nestjs-pino`                   | Structured JSON, very low overhead                                                     |

---

## 6. Installation

**Prerequisites:** Node.js ≥ 20 (this repo is developed on 24), npm ≥ 10, Docker Desktop.

```bash
git clone <your-fork> taskflow-api
cd taskflow-api
npm install
```

Start the backing services:

```bash
npm run infra:up        # docker compose up -d  → MongoDB + Redis
docker compose ps       # wait until both are (healthy)
```

The MongoDB container initialises itself as a **single-node replica set** on first boot (its
healthcheck runs `rs.initiate()` once). That is required for multi-document transactions and change
streams later — running standalone locally and a replica set in production is a classic
"works on my machine" trap.

---

## 7. Environment variables

`.env.example` is committed and documents every variable. Real values live in `.env.development` /
`.env.test` locally, and in your platform's secret manager in production.

| Variable                          | Default                              | Purpose                                          |
| --------------------------------- | ------------------------------------ | ------------------------------------------------ |
| `NODE_ENV`                        | `development`                        | Selects `.env.<NODE_ENV>` and behaviour switches |
| `PORT`                            | `3000`                               | HTTP port                                        |
| `APP_NAME`                        | `taskflow-api`                       | Logging / health payloads                        |
| `API_PREFIX`                      | `api`                                | Global route prefix → `/api/v1/...`              |
| `CORS_ORIGINS`                    | `*`                                  | Comma-separated allow-list                       |
| `LOG_LEVEL`                       | `info`                               | pino level                                       |
| `MONGODB_URI`                     | _(required)_                         | No default on purpose — see below                |
| `MONGODB_MAX_POOL_SIZE`           | `20`                                 | Mongoose socket pool ceiling                     |
| `MONGODB_MIN_POOL_SIZE`           | `2`                                  | Warm connections                                 |
| `REDIS_HOST` / `REDIS_PORT`       | `localhost` / `6379`                 | Redis endpoint                                   |
| `REDIS_PASSWORD`                  | _(empty)_                            | Required in production                           |
| `REDIS_DB`                        | `0`                                  | Logical DB index (tests use `1`)                 |
| `REDIS_KEY_PREFIX`                | `taskflow`                           | Namespacing so environments can share a server   |
| `JWT_ACCESS_SECRET`               | _(required, ≥32 chars)_              | Signs access tokens                              |
| `JWT_ACCESS_TTL`                  | `15m`                                | Short — access tokens cannot be revoked          |
| `JWT_REFRESH_SECRET`              | _(required, ≥32 chars, must differ)_ | Signs refresh tokens                             |
| `JWT_REFRESH_TTL`                 | `7d`                                 | Long — refresh tokens are stored and revocable   |
| `CACHE_DEFAULT_TTL`               | `60`                                 | Seconds                                          |
| `THROTTLE_TTL` / `THROTTLE_LIMIT` | `60000` / `100`                      | Rate-limit window (ms) and quota                 |
| `SWAGGER_ENABLED`                 | `false`                              | Keep off in production or put behind auth        |

**Rules this project follows:**

1. **Validate at boot, not at use.** `src/config/env.validation.ts` runs before the server listens.
   A container that refuses to start pages the on-call engineer; a container that starts
   misconfigured causes an outage.
2. **No default for `MONGODB_URI`.** A fallback like `mongodb://localhost` is exactly how a
   production pod ends up writing to nowhere and reporting success.
3. **Access and refresh secrets must differ** — enforced by a cross-field Joi rule. Signing both
   with one secret means a stolen refresh token is also a valid access token, which defeats the
   point of having two.
4. **Secrets never enter the image.** In production `ignoreEnvFile` is on, so config comes only from
   the orchestrator.

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

---

## 8. Running locally

```bash
npm run start:dev      # watch mode
npm run lint           # type-aware ESLint, zero warnings allowed
npm run typecheck      # tsc --noEmit
npm run build          # → dist/
npm run start:prod     # node dist/main
```

Verify:

```bash
curl http://localhost:3000/api/v1
# {"name":"taskflow-api","environment":"development","version":"0.1.0","uptimeSeconds":3,...}

curl http://localhost:3000/api/v1/ping
# {"status":"ok","timestamp":"..."}
```

**Try the fail-fast behaviour** — it is the single best demonstration of why config validation
matters:

```bash
JWT_ACCESS_SECRET=short npm run start:dev
# Error: Config validation error: "JWT_ACCESS_SECRET" must be at least 32 characters...
```

---

## 9. Docker setup

Phase 1 containerises only the **backing services**; the API runs on your host so hot-reload and
the debugger stay fast. Phase 17 adds a multi-stage `Dockerfile` and an `api` service.

```bash
npm run infra:up      # start
npm run infra:logs    # tail
npm run infra:down    # stop, keep data
docker compose down -v  # stop and DELETE data
```

Two deliberate choices in `docker-compose.yml`, both explained in the file:

- **Ports bound to `127.0.0.1`** — reachable from this machine only, never the LAN.
- **Mongo runs without auth locally** — enabling auth on a replica set also requires internal member
  authentication via a shared keyfile, which would mean committing a secret just to run
  `docker compose up`. Production is different: auth, TLS, least-privilege users and network policy
  are mandatory there.

---

## 10. CI/CD pipeline

`.github/workflows/ci.yml` — **cheapest check first**, because that ordering is the difference between
a feedback loop people use and one they route around.

```
push → install → lint → typecheck → unit tests → e2e tests → coverage → build → docker build
        ~10s      ~15s     ~20s        ~12s        ~90s                  ~30s      ~90s
```

Three deliberate choices:

- **A separate `typecheck` step**, even though `build` compiles. `nest build` uses
  `tsconfig.build.json`, which excludes tests — so a type error in a spec file would _not_ fail the
  build. `tsc --noEmit` checks everything for 20 seconds.
- **`concurrency` with `cancel-in-progress`.** Three pushes to a PR otherwise run three full pipelines
  and you pay for two results nobody reads.
- **Coverage as an artefact, not a second gate.** The threshold check already runs inside `test:cov`;
  the HTML report is for the human reviewing the PR.

The e2e job needs **no service containers** — `mongodb-memory-server` runs a real `mongod`, so CI runs
the same code path developers run locally.

Deployment is described but not implemented, because it depends on a platform this project does not
have. The ideas that matter — expand/migrate/contract, readiness-gated rollouts, rehearsed rollback —
are in [Phase 17](docs/phase-17-docker-ci.md).

**Verified against a real daemon** (Docker Desktop 4.86 / engine 29.7.2): the image builds (371MB,
`node_modules` pruned to 113MB), the full stack starts with `depends_on: service_healthy` gating,
Docker reports the container `healthy`, it runs as `uid=1000(node)`, and `docker stop` exits
**cleanly in 551ms with code 0** — proving signals reach Node and `enableShutdownHooks()` runs.
The runtime image contains no `typescript`, `jest`, `eslint`, `.env`, `.git`, `src/` or `test/`.

> **Port note:** `docker-compose.yml` publishes MongoDB on `127.0.0.1:27017`, which collides with a
> locally installed MongoDB service. If you have one, either stop it or change the published port —
> the API container is unaffected either way, because it reaches MongoDB over the compose network by
> service name, not through the published port.

---

## 11. Configuration architecture

```text
process.env  (everything is `string | undefined`)
     │
     ▼  Joi schema ......... env.validation.ts      → fail fast at boot
     │
     ▼  registerAs() ....... config/namespaces/*    → parse, group, default
     │
     ▼  AppConfigService ... typed facade           → injectable, mockable
     │
     ▼  your service:  this.config.database.uri     // string, guaranteed
```

Four layers looks like a lot for "read an env var". Each one earns its place:

| Layer                     | Removes this class of bug                                              |
| ------------------------- | ---------------------------------------------------------------------- |
| Joi validation            | Missing/invalid variables discovered in production instead of at boot  |
| `registerAs` namespaces   | Config sprawl; also gives each namespace an injectable token           |
| `AppConfigService` facade | Typos in stringly-typed `get('cach.ttl')` calls returning `undefined`  |
| Typed interfaces          | `parseInt` scattered across the codebase with three different defaults |

The namespace token trick is worth internalising early, because it is your first real provider
token:

```ts
constructor(
  @Inject(appConfig.KEY) private readonly cfg: ConfigType<typeof appConfig>,
) {}

this.cfg.port; // number — no get(), no string path, no cast
```

`registerAs('app', factory)` registers the factory result under the token `CONFIGURATION(app)`.
That is all a provider token is: **a key in a map**. Phase 3 builds on exactly this.

---

## 12. API endpoints

All routes are served under `/api/v1`, except the health probes, which are deliberately served at
an unprefixed, unversioned path so infrastructure config never has to change (Phase 18).

| Method   | Path                            | Purpose                | Notes                                               |
| -------- | ------------------------------- | ---------------------- | --------------------------------------------------- |
| `GET`    | `/`                             | App metadata           |                                                     |
| `GET`    | `/ping`                         | Simple liveness        | Superseded by the terminus probes below             |
| `GET`    | `/health/live`                  | Liveness probe         | **No prefix, no version** — see Phase 18            |
| `GET`    | `/health/ready`                 | Readiness probe        | Checks MongoDB only                                 |
| `GET`    | `/health/detail`                | Full dependency report | Includes Redis; 503 when degraded                   |
| `POST`   | `/users`                        | Create a user          | 409 on duplicate email (case-insensitive)           |
| `GET`    | `/users`                        | List users             | `?page&limit&search&role`, `X-Request-Id` header    |
| `GET`    | `/users/:id`                    | One user               | 404 if absent                                       |
| `PATCH`  | `/users/:id`                    | Partial update         |                                                     |
| `PUT`    | `/users/:id/role`               | Set role               | Idempotent PUT; 409 if it would demote the last admin |
| `DELETE` | `/users/:id`                    | Delete                 | 204; 409 if it is the last admin                    |
| `POST`   | `/projects`                     | Create a project       | 404 if the owner does not exist (cross-module call) |
| `GET`    | `/projects`                     | List projects          | `?page&limit&search&status&memberId`                |
| `GET`    | `/projects/:id`                 | One project            |                                                     |
| `PATCH`  | `/projects/:id`                 | Partial update         | 409 if archived                                     |
| `POST`   | `/projects/:id/archive`         | Archive                | 200, idempotent                                     |
| `POST`   | `/projects/:id/members`         | Add member             | 409 if already a member                             |
| `DELETE` | `/projects/:id/members/:userId` | Remove member          | 409 for the owner                                   |

In development a seed admin is created on first boot: `admin@taskflow.dev` / `ChangeMe123!`
(guarded by `isDevelopment` — a seeded admin with a known password in production is a backdoor).

No response body ever contains `passwordHash`: the service returns a `PublicUser` built by an
allow-list, so a controller physically cannot leak it.

---

## 13. API documentation (Swagger / OpenAPI)

`GET /api/docs` (UI) and `GET /api/docs-json` (the raw document, which is what tooling consumes).

**How much is automatic:** more than people expect. The Swagger **CLI plugin** in `nest-cli.json` is an
AST transform that infers `@ApiProperty()` for every DTO field — type, optionality, enums, and JSDoc as
the description. DTOs need almost no Swagger decorators. What stays hand-written is what the compiler
cannot infer: what an endpoint _means_, which errors it returns, and which security applies.

Three things worth knowing:

- **Order matters.** `setupSwagger` runs _after_ `setGlobalPrefix` and `enableVersioning`, or the
  document describes `/users` when the real route is `/api/v1/users`. Nothing warns you; the e2e test
  asserts real paths for exactly this reason.
- **The scheme name must match** on both sides — `addBearerAuth(..., 'access-token')` and
  `@ApiBearerAuth('access-token')`. A mismatch fails silently: the Authorize button appears and the
  token is never attached.
- **The plugin is build-time only.** It does not run under `ts-jest`, so DTO schemas are empty in
  tests. Generate the shipped document from the **built** artefact.

`SWAGGER_ENABLED` makes serving it in production an explicit decision — the document is a complete map
of your attack surface.

**Deep dive:** [Phase 15](docs/phase-15-swagger.md)

---

## 14. Request lifecycle

```
incoming request
  ├─ Express middleware (main.ts)        helmet, cors, compression, cookie-parser
  ├─ Nest middleware (module.configure)  correlation id, cache headers
  ├─ Guards            CanActivate       401 / 403
  ├─ Interceptors (pre)                  start the timer
  ├─ Pipes             PipeTransform     400
  ├─ ► CONTROLLER → SERVICE → REPOSITORY → DATABASE
  ├─ Interceptors (post)                 shape / log the response
  └─ Exception filters                   only if something threw
response
```

Almost every _"why doesn't my X see Y"_ question is answered by this diagram. Two consequences worth
memorising:

- **Pipes run after guards.** A request with a bad token and an invalid body returns **401, not 400** —
  you never spend anything validating input from a caller you are about to reject.
- **Middleware runs before routing is resolved**, so it cannot read route metadata. That is why
  authorization is a guard and not middleware.

**Deep dive:** [Phase 9](docs/phase-09-middleware-interceptors-filters.md)

---

## 15. Modules

A `@Module()` declares `imports` (modules whose **exports** I want injectable here), `providers`
(what I own), `controllers`, and `exports` (what I share).

The point people miss: **modules are the encapsulation boundary at runtime**, not a folder convention.
A provider is private unless exported, and the container enforces it.

`UsersModule` exports `UsersService` but **not** `UsersRepository`. Other modules can create users;
nobody else can reach into the users collection. That is what makes "who owns this data?" answerable —
and it is a precondition for ever extracting a module into its own service.

**Deep dive:** [Phase 2](docs/phase-02-modules-providers-di.md)

---

## 16. Controllers

The HTTP boundary, and nothing else: map a route, bind input, call one service method, return a value.

Keeping them thin is not style. Logic inside a controller can only ever be triggered by an HTTP
request — and in this project the same rules had to run from a **BullMQ worker** (Phase 12), an **SSE
path** (Phase 11) and an **event listener** (Phase 13). Anything living in a controller would have had
to move.

Two Nest-specific properties: handlers **return values** rather than calling `res.json()`, so a thrown
exception becomes an HTTP response via a filter; and the route table is **declared as metadata**, which
is what makes Swagger generation possible with no extra work.

**Deep dive:** [Phase 2](docs/phase-02-modules-providers-di.md)

---

## 17. Providers and services

A provider is anything the container can create and inject. `@Injectable()` _marks_ a class as able to
participate; listing it in `providers` is what **registers** it — the distinction behind most early
"Nest can't resolve dependencies" errors.

The layering here is strict and one-directional:

```
Controller  →  Service  →  Repository (port)  →  Mongo implementation
   HTTP        business        interface            infrastructure
```

Each layer talks only to the one beneath it. The controller never touches a model; the service never
touches Mongoose. That is what lets the service layer be unit-tested with an in-memory repository —
**no mocking library and no changes to production code** — and it is the same substitution that would
make a service extraction a transport change rather than a rewrite.

**Deep dive:** [Phase 2](docs/phase-02-modules-providers-di.md)

---

## 18. Dependency injection

Full treatment with 21 interview questions:
[`docs/phase-02-modules-providers-di.md`](docs/phase-02-modules-providers-di.md).

**The one sentence that unlocks everything:**

> A provider is a `{ token, recipe }` pair registered in a module. The container is a
> `Map<Token, Instance>`. Injection is a lookup by token.

`providers: [UsersService]` is shorthand for `{ provide: UsersService, useClass: UsersService }` —
the class is both the key _and_ the instruction. Phase 3 pulls those apart.

### The resolution algorithm

```
for each constructor parameter:
  a. token ← design:paramtypes, or @Inject(TOKEN)
  b. look in THIS module's providers
  c. look in the exports of modules in THIS module's imports
  d. look among @Global() modules
  e. otherwise throw, marking the failing parameter with `?`
```

`UsersService` uses three of those steps at once:

```ts
constructor(
  private readonly usersRepository: UsersRepository,  // b — same module
  private readonly passwordHasher: PasswordHasher,    // b — same module
  private readonly config: AppConfigService,          // d — @Global() module
) {}
```

and `ProjectsService` shows step **c** — `UsersService` via `imports: [UsersModule]`.

### Module encapsulation, and the three wrong fixes

`UsersModule` registers three providers and exports one. `PasswordHasher` is **deliberately
private**: try to inject it into `ProjectsService` and the app refuses to boot, even though
TypeScript compiled it and the file exports the class. Encapsulation is a _runtime container rule_,
not a compiler rule — that is the boundary Express cannot give you.

| "Fix"                                       | What actually happens                                                   |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| Export the repository                       | Encapsulation gone; every rule in the service becomes optional          |
| Re-declare it in the consumer's `providers` | **Two independent instances.** Bug report: _"users I create disappear"_ |
| Make the module `@Global()`                 | Changes nothing about exports; hides the graph for everyone             |

**Right fix:** ask for a _method_, not internals. `ProjectsService` doesn't need `UsersRepository`;
it needs _"does this user exist?"_

> Interview: _a provider class registered in two modules — how many instances?_ **Two.** The instance
> belongs to the declaring module. One owner, exported.

### Why this makes testing easy

`ProjectsService` → `UsersService` → `UsersRepository` + `PasswordHasher` + `AppConfigService`.
Testing the top of that chain replaces exactly **one** token:

```ts
providers: [
  ProjectsService,
  ProjectsRepository,
  { provide: UsersService, useValue: fake },
];
```

Nothing behind `UsersService` is ever constructed. That is the concrete answer to "why DI?" — not
"loose coupling" as an abstraction, but a substitution seam the framework already provides, with no
mocking library and no changes to production code. It is also the same substitution Phase 20 makes
when users become a separate service.

---

## 19. Provider tokens and custom providers

Full treatment with 21 interview questions and 6 scenarios:
[`docs/phase-03-tokens-and-custom-providers.md`](docs/phase-03-tokens-and-custom-providers.md).

### Why tokens exist

A token is the **key** a provider is filed under. Usually it's the class, and you never think about
it. Three situations force the issue — and this repo has a real example of each:

| Situation                              | Example here                                              |
| -------------------------------------- | --------------------------------------------------------- |
| The value isn't a class                | `REDIS_CLIENT` — an `ioredis` instance                    |
| The value is typed by an **interface** | `PASSWORD_HASHER`, `NOTIFICATION_CHANNEL`, `APP_METADATA` |
| You need two instances of one class    | `REDIS_CLIENT` vs `REDIS_SUBSCRIBER` (Phase 11)           |

The second is the one interviewers probe:

```ts
constructor(private readonly hasher: PasswordHasher) {}                      // ❌ boot failure
constructor(@Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher) {} // ✅
```

TypeScript **erases** interfaces, so `design:paramtypes` records `Object` — a token that resolves to
nothing. The interface gives the compile-time type; the token gives the runtime key. _Two systems,
two jobs._ (An **abstract class** sidesteps it — it exists at runtime, so it serves as both type and
token with no `@Inject()`. Know both and why you'd pick each.)

### The four recipes

| Recipe        | Meaning                              | Used here for                                      |
| ------------- | ------------------------------------ | -------------------------------------------------- |
| `useValue`    | "Here is the finished object"        | Frozen build metadata; **every test stub**         |
| `useClass`    | "Build one of these for this token"  | Password hashing — bcrypt ⇄ scrypt in one word     |
| `useFactory`  | "Run this and store what it returns" | Notification channel (needs config); Redis (async) |
| `useExisting` | "This token is an **alias**"         | Token renames; one impl under two contracts        |

**The question that decides `useClass` vs `useFactory`:** _does choosing the implementation require
information that only exists at runtime?_ No → `useClass`. Yes → `useFactory`. A `useClass` provider
is a static answer written in source; only a factory can ask a question first.

### `useClass` — a one-word swap

```ts
{ provide: PASSWORD_HASHER, useClass: BcryptPasswordHasher }
{ provide: PASSWORD_HASHER, useClass: ScryptPasswordHasher }   // the entire migration
```

`UsersService` doesn't change. Its tests don't change. Both implementations are real (scrypt is
RFC 7914, built into Node, with `timingSafeEqual`), and **one contract test runs against both**:

```
✓ never returns the plaintext          ✓ different hash each time (random salt)
✓ verifies a correct password          ✓ rejects an incorrect one
✓ returns false — never throws — for a hash from a different algorithm
```

That last case isn't hypothetical: during a real migration, `compare` **will** be handed foreign
hashes, and throwing turns "this user is on the old algorithm" into a 500.

### `useFactory` — async, and a design decision

```ts
{ provide: REDIS_CLIENT, useFactory: async (config) => { … await client.connect() … },
  inject: [AppConfigService] }
```

If the factory returns a promise, **Nest awaits it before the server listens**. That is the only way
to do async construction — constructors can't be async.

**Should the app boot if Redis is down?** Here, yes — verified:

```
WARN [RedisFactory] Redis unavailable at localhost:6379 - starting in DEGRADED mode
```

> **Fail fast on dependencies you cannot function without; degrade gracefully on dependencies that
> only make you faster.**

Redis does caching and background work — a miss just means reading Mongo, so refusing to start would
turn a performance problem into an outage. MongoDB (Phase 5) is the opposite. Then make the
degradation _visible_: `warn`, not `debug`, and `/health/detail` (Phase 18) reports Redis as
`down` while `/health/ready` stays `ok` — so alerting sees it and the load balancer does not act
on it.

**Who closes it?** Not Nest — a factory-created value is a plain object and never receives Nest's
lifecycle calls. The module does, and injects its own provider to do so. Skip this and the container
won't exit and Jest warns about open handles.

### `useClass` vs `useExisting` — the identity bug

```ts
providers: [Channel, { provide: ALIAS, useClass: Channel }]; // TWO objects
providers: [Channel, { provide: ALIAS, useExisting: Channel }]; // ONE object
```

Proven in `notifications.module.spec.ts` with `sentCount`: through the `useClass` alias the counter
increments on one object and reads zero on the other — the _"why is my counter zero?"_ bug.

### A testing gotcha worth knowing

`.overrideProvider(X)` **replaces** a provider the graph already contains; it does not **supply** a
missing one. If `X` comes from a `@Global()` module your test never imported, declare a small
`@Global()` fake module instead. (This is how `notifications.module.spec.ts` works, and it is the
standard recipe for testing any module that depends on global infrastructure.)

---

## 20. Provider scopes

`DEFAULT` (singleton), `REQUEST` (one per request), `TRANSIENT` (one per injection site).

**Scope bubbles upward.** Inject a request-scoped provider into a singleton and that consumer becomes
request-scoped too, all the way up. One innocuous provider deep in the graph can quietly make half the
application rebuild on every request — which is the cost, and it is easy to introduce accidentally.

This project uses `AsyncLocalStorage` for request context precisely to avoid it: `RequestContextService`
stays a **singleton with per-request storage**. It has a property request scope cannot have — it works
in a BullMQ worker, where there is no request at all.

`GET /api/v1/scopes` demonstrates it live (non-production only): call it twice and see which instance
ids change.

**Deep dive:** [Phase 4](docs/phase-04-scopes-resolution-circular.md)

---

## 21. Dependency resolution

For each constructor parameter Nest: (1) reads the token from `design:paramtypes` or `@Inject()`;
(2) looks in the current module's providers; (3) looks in the **exports** of its imported modules;
(4) looks in the global injector; (5) throws at **bootstrap** if still unresolved.

Step 3 is the one people miss — importing a module gives you its exports, not its providers. That is
the encapsulation rule stated as an algorithm.

Failing at bootstrap rather than at first request is the property that matters: a wiring mistake
crashes in front of a deploy pipeline that can roll back.

**Deep dive:** [Phase 4](docs/phase-04-scopes-resolution-circular.md)

---

## 22. Circular dependencies

`forwardRef(() => Other)` defers evaluation — you pass a thunk instead of a class reference that is
still `undefined` mid-cycle. It must be on **both sides**: a cycle has two edges.

But it is the **last** option, not the first, because it makes the error go away without making the
coupling go away. Ranked:

1. Extract the shared logic into a third module.
2. **Invert with an event** — the dependency disappears rather than being deferred.
3. Use an interface/token so only one side knows the other's shape.
4. `forwardRef`.

This codebase deliberately built a `UsersService ↔ ProjectsService` cycle in Phase 4, then **deleted it
entirely** in Phase 13: `UsersService` emits `USER_DELETION_REQUESTED` with a `blockers` array,
`ProjectsModule` listens and pushes a blocker, and the emitter throws 409 if any were added. Same
behaviour, no cycle. **`forwardRef` count in this repository: zero.**

**Deep dive:** [Phase 4](docs/phase-04-scopes-resolution-circular.md) ·
[Phase 13](docs/phase-13-event-driven-architecture.md)

---

## 23. Global modules

`@Global()` registers a module's exports in the root injector, so consumers need no import.

Global here: config, Redis, the database connection, `CommonModule`. **Not global:** any feature
module. `@Global()` on a domain module destroys the boundary that makes the architecture legible, and
turns the module graph into decoration that hides real coupling.

The test: exactly one of it, cross-cutting, needed nearly everywhere → global. Otherwise, import it.

---

## 24. DTOs and validation

DTOs are **classes**, not interfaces — interfaces vanish at compile time, leaving nothing for the
validator to inspect.

The global `ValidationPipe` (registered via `APP_PIPE` so it can inject) uses:

| Option                            | Effect                                                                    |
| --------------------------------- | ------------------------------------------------------------------------- |
| `whitelist`                       | Strips undeclared properties — the structural fix for **mass assignment** |
| `forbidNonWhitelisted`            | Rejects instead of silently stripping, naming the field                   |
| `transform`                       | Produces a real DTO instance and applies type conversion                  |
| `enableImplicitConversion: false` | Explicit `@Type()` instead of surprising coercion                         |

Two traps: `@ValidateNested()` **without** `@Type(() => Child)` silently validates nothing; and mapped
types (`PartialType`, `PickType`, `OmitType`) must be imported from **`@nestjs/swagger`**, or the
OpenAPI metadata is lost.

Identity never comes from the body. `PATCH /auth/me` reads the user id from the validated JWT — a DTO
field that could name _someone else_ is an authorization bug waiting to happen.

**Deep dive:** [Phase 6](docs/phase-06-dtos-validation-pipes.md)

---

## 25. Pipes

Four binding scopes: global, controller, handler, and **parameter** — the tightest.

`ParseObjectIdPipe` on `@Param('id')` is the example worth remembering. Without it,
`GET /users/not-an-id` reaches Mongoose, throws a `CastError` and becomes a **500** — a client's typo
recorded as a server error, polluting your error rate and your alerting. With it, 400 before any
service code runs.

**Deep dive:** [Phase 6](docs/phase-06-dtos-validation-pipes.md)

---

## 26. Authentication flow

```
POST /auth/register ─┐
POST /auth/login  ───┴─► access token (JSON, ~15 min)
                        refresh token (httpOnly cookie, SameSite=strict, 7 days)

POST /auth/refresh ────► rotate: new access + new refresh, old one marked used
POST /auth/logout  ────► revoke the family
```

The decisions and their reasons:

- **Access short, refresh long.** Limits the damage of a stolen access token without making users log
  in every fifteen minutes.
- **Refresh token in an httpOnly cookie**, so JavaScript cannot read it and an XSS cannot steal the
  durable credential.
- **Hashed with SHA-256, not bcrypt** — the token is 32 bytes of CSPRNG output, so there is nothing for
  a slow hash to protect against. Slow hashing is for _low-entropy_ secrets; passwords use bcrypt
  cost 12.
- **Token families with rotation and reuse detection.** Replaying an already-rotated token means
  someone has a copy → revoke the whole family. The record is kept (not deleted) precisely so reuse is
  distinguishable from expiry.
- **Timing-equalised login** via a precomputed dummy hash, with an identical error message — otherwise
  an attacker enumerates your user list with a stopwatch.
- **Two different JWT secrets**, with a boot-time check that they differ. If they were equal, an access
  token would be accepted as a refresh token.

**Deep dive:** [Phase 7](docs/phase-07-authentication.md)

---

## 27. Authorization and RBAC

Two layers, because they answer different questions.

**Role-based:** `@Roles(Role.ADMIN)` + `RolesGuard`, registered globally **after** the auth guard —
order is load-bearing, since `RolesGuard` needs the user the auth guard attached.

**Resource-based:** `@ProjectRoles(...)` + `ProjectAccessGuard`, which loads the caller's membership of
_that_ project. "Is this user an admin?" and "may this user touch _this_ project?" are different
questions, and the second is usually the real requirement. The admin bypass is explicitly audited —
an unlogged super-power is how privilege escalation goes unnoticed.

**404, not 403**, for resources you cannot see: a 403 confirms the resource exists.

**Deep dive:** [Phase 8](docs/phase-08-authorization-rbac.md)

---

## 28. Guards

`CanActivate` → boolean or throw. They run after routing (so they can read metadata via `Reflector`)
and before interceptors and pipes (so rejection is cheap).

The structural decision here is **deny by default**: `JwtAuthGuard` is a global `APP_GUARD`, and
exposing an endpoint requires an explicit `@Public()` that shows up in review. Every "we forgot to
protect that one endpoint" incident is the opposite choice.

`getAllAndOverride` (first match wins — handler over class) for on/off flags; `getAllAndMerge` for
accumulating values.

**Deep dive:** [Phase 8](docs/phase-08-authorization-rbac.md)

---

## 29. Interceptors

They wrap the handler, so they see **both** sides — the only place that can time, log, transform or
cache a response.

Global interceptors run in registration order going **in** and reverse order coming **out**. The
practical rule: register observation (logging, metrics) **outermost**, so it sees the true final
response and the true total duration.

`TransformResponseInterceptor` is deliberately **not** global. Success responses stay plain resources,
which is REST-correct and generates better clients; **errors** are standardised everywhere by the
exception filter, which is where a consistent shape actually helps, because clients must branch on
them.

**Deep dive:** [Phase 9](docs/phase-09-middleware-interceptors-filters.md)

---

## 30. Middleware

Runs **before routing is resolved**, so it sees raw `req`/`res` and cannot read route metadata. Right
for anything transport-level that must happen for every request — including ones that never reach a
handler.

`CorrelationIdMiddleware` has to be middleware rather than an interceptor because the
`AsyncLocalStorage` store must be open for the **guards** too — otherwise every authentication log line
has no correlation id, which is precisely the set you most want correlated.

Class middleware when it needs DI; a plain function when it does not (`noStoreMiddleware` is six
lines).

**Deep dive:** [Phase 9](docs/phase-09-middleware-interceptors-filters.md)

---

## 31. Exception filters

One shape for every error:

```json
{
  "success": false,
  "statusCode": 409,
  "message": "...",
  "error": "Conflict",
  "path": "/api/v1/users",
  "timestamp": "...",
  "requestId": "c1f..."
}
```

`AllExceptionsFilter` translates known failures (Mongo `11000` → **409**, `CastError` → **400**,
validation → 400 with the field array preserved) and turns everything else into a flat
`500 Internal server error` — logged in full server-side with the correlation id, so it is still
diagnosable, but **no driver message ever reaches the client**. A raw driver message leaks schema,
hostnames and query values.

Precedence, which people conflate: across scopes the **most specific** matching filter wins; at the
same scope the **last registered** wins. The health controller uses a scoped filter to keep its
diagnostic payload intact — a global enhancer is a policy, and some endpoints have a different
contract.

**Deep dive:** [Phase 9](docs/phase-09-middleware-interceptors-filters.md) ·
[Phase 18](docs/phase-18-health-logging.md)

---

## 32. Database architecture

`DatabaseModule` opens **one** connection via `MongooseModule.forRootAsync`; feature modules register
their own models with `forFeature`. Repositories are abstract-class **ports**, so no service ever
touches Mongoose.

The asymmetry with Redis is deliberate: **the app refuses to boot without MongoDB** (there is no
correct response to give) and **boots in degraded mode without Redis** (a cache miss just reads Mongo).

> Fail fast on dependencies you cannot function without; degrade gracefully on the ones that only make
> you faster.

`TransactionRunner` centralises session handling, and the tests assert **both** commit and rollback —
a transaction test that only checks the happy path proves nothing.

**Deep dive:** [Phase 5](docs/phase-05-mongodb-mongoose.md)

---

## 33. MongoDB and Mongoose

Schema (shape) → Model (compiled, bound to a collection) → Document (one instance, with change
tracking). `.lean()` skips hydration and returns plain objects — **3–5× less CPU and memory** on a
read-only endpoint.

**Embed vs reference:** embed when the data is read together, bounded, and owned by the parent
(comments on a task); reference when it is shared, unbounded, or independently queried (users).

`populate` issues a second query and stitches; `$lookup` joins server-side and lets later stages filter
by the joined data — which `populate` cannot, because it happens after the fact.

Concurrency: atomic operators (`$inc`), conditional updates (`updateOne({ _id, status: 'open' })` with
`matchedCount === 0` as a conflict), or optimistic concurrency with a version field. A transaction
gives isolation, **not** a guarantee that your read is still current when you write.

**Deep dive:** [Phase 5](docs/phase-05-mongodb-mongoose.md)

---

## 34. MongoDB performance

**ESR** — order compound index keys Equality → Sort → Range. Put a range field before the sort field
and the index can no longer serve the sort, so MongoDB does an in-memory sort, which **fails above
32MB**.

**The prefix rule** — `{a, b, c}` also serves `{a}` and `{a, b}`. Three indexes where one suffices costs
write throughput and RAM on every insert.

**Verify, do not guess:** `.explain('executionStats')`, comparing `totalDocsExamined` with `nReturned`.
50,000 examined to return 20 means the index is wrong; `COLLSCAN` is the alarm.

Also here: TTL indexes (refresh tokens, activity logs) so MongoDB expires data instead of a cron job
you forgot to write; partial indexes; `$match` **first** in every aggregation; `autoIndex: false` in
production; and cursor pagination where deep paging is plausible, because `skip(n)` is **O(n)** _and_
incorrect under concurrent inserts.

**Deep dive:** [Phase 5](docs/phase-05-mongodb-mongoose.md) ·
[Phase 19](docs/phase-19-performance-scalability.md)

---

## 35. Redis

`RedisModule` owns the connection and is deliberately **not** inside `cache/`, because three unrelated
subsystems need a socket — caching, BullMQ and pub/sub fan-out. If the connection lived in `cache/`,
`queue/` would have to import `cache/` to get one, and the dependency graph would state something false
about the architecture.

Two clients are provisioned — `REDIS_CLIENT` and `REDIS_SUBSCRIBER` — because a connection in
subscriber mode cannot issue normal commands. Both are closed in `OnApplicationShutdown`; a
`useFactory` value is a plain object and never receives lifecycle calls, so the _module_ closes it.

**Deep dive:** [Phase 10](docs/phase-10-caching-rate-limiting.md)

---

## 36. Caching strategy

**Cache-aside**: read → miss → database → populate with a TTL; write → invalidate. The read path stays
correct if the cache is empty, stale or entirely gone.

Handled failure modes: **stampede** (an in-flight promise map dedupes concurrent misses to one database
read), **TTL jitter** (so a batch written together does not expire together), **`SCAN` not `KEYS`**
(Redis is single-threaded; `KEYS` blocks the server and is fine at 100 keys and fatal at 10 million),
and **degrade on failure** — every Redis error is caught and returns a miss, logged at `warn` so
degradation is visible.

When _not_ to cache: the query is slow because it is unindexed; the data must be current (permissions,
balances); writes outnumber reads; or the hit rate would be low.

**Deep dive:** [Phase 10](docs/phase-10-caching-rate-limiting.md)

---

## 37. Rate limiting

`@nestjs/throttler` with a **Redis** storage backend, because an in-memory limiter with five instances
turns a limit of 100 into 500 — and works perfectly in development, where there is one.

The trap inside the fix: after `INCR`, check `PTTL == -1` and set the expiry. A key created by a race
without a TTL lives forever and locks that user out permanently — a worse bug than the one you set out
to fix.

Key by **user** when authenticated, IP otherwise; IP-only punishes everyone behind one NAT and does
nothing against a botnet. Login gets a much tighter limit than reads, because the cost of a successful
brute force is categorically different.

Fail **open** for general traffic, **closed** for login — the limit _is_ the brute-force defence.

**Deep dive:** [Phase 10](docs/phase-10-caching-rate-limiting.md)

---

## 38. Server-Sent Events

`@Sse()` returns an Observable that **never completes** — completing closes the stream.

SSE over WebSockets when you only need server→client: it is plain HTTP, so it traverses proxies, needs
no sticky sessions, and **reconnects automatically** in the browser.

Practical constraints: **HTTP/1.1 allows six connections per origin**, so one multiplexed stream rather
than one per feature; heartbeats to stop intermediaries reaping an idle socket; `EventSource` cannot set
an `Authorization` header, so authentication is a cookie or a short-lived query token; and multi-instance
fan-out needs Redis Pub/Sub, because an in-process emitter only reaches clients on the same box.

**Deep dive:** [Phase 11](docs/phase-11-sse-websockets.md)

---

## 39. WebSockets

For genuinely bidirectional, low-latency communication. Nest's gateway API mirrors controllers —
`@SubscribeMessage()` instead of `@Get()`, and the same guards, pipes and filters apply.

Costs SSE does not have: sticky sessions (the Socket.IO handshake spans multiple HTTP requests), a
Redis adapter for multi-instance rooms, and a client-side reconnect strategy with exponential backoff
and jitter — deploys **will** drop connections, and that is unavoidable rather than fixable.

**Deep dive:** [Phase 11](docs/phase-11-sse-websockets.md)

---

## 40. Background jobs

BullMQ on Redis. The HTTP handler enqueues and returns in milliseconds; the work happens in a worker
that scales and restarts independently.

Non-obvious requirements: `maxRetriesPerRequest: null` (BullMQ blocks on `BRPOPLPUSH` and ioredis's
default retry cap kills it), `enableOfflineQueue: false` so a Redis outage fails fast rather than
queueing commands in memory, exponential backoff, and **you retry by throwing** — catching and logging
inside a processor marks the job completed, so it never retries.

**Idempotency is not optional.** A deterministic `jobId` deduplicates at enqueue, but the real defence
is a handler safe to run twice — a stalled job recovered after its worker died is _not_ a retry, so
`attempts: 1` does not prevent it.

Workers close inside Nest's shutdown hooks, which is also why the Dockerfile uses `CMD ["node", ...]`:
via `npm run`, `SIGTERM` never reaches Node and every deploy abandons in-flight jobs.

**Deep dive:** [Phase 12](docs/phase-12-background-jobs.md)

---

## 41. Event-driven architecture

`@nestjs/event-emitter` for in-process pub/sub. It is what removed the circular dependency: emitters no
longer know their consumers exist.

- `emit` — fire and forget. Used for audit logging; never block a request for a log line.
- `emitAsync` — awaits listeners, which enables the **veto pattern**: listeners push blockers onto the
  payload and the emitter throws a 409 if any were added. A synchronous _decision_ without a
  synchronous _dependency_.
- Wildcards: `@OnEvent('**')` powers the activity log with no changes to any feature module.

> **Current status:** the bus, the event catalogue and the wildcard audit listener are all in place,
> but only `user.registered` and `user.deletion_requested` are actually emitted today. The `task.*`,
> `comment.added` and `project.*` events are defined in `domain-events.ts` and not yet fired, so the
> activity log records user registrations only. See "Known gaps" in [HOW-IT-WORKS.md](../HOW-IT-WORKS.md#12-known-gaps).

Its honest limit: it is **in-process and in-memory**. If the process dies between the state change and
the listener, the event is gone. The durable answer is the **transactional outbox** — write the event in
the same transaction as the state change and have a relay publish it.

**Deep dive:** [Phase 13](docs/phase-13-event-driven-architecture.md)

---

## 42. Testing strategy

**157 tests, 19 suites, ~32 seconds.** Coverage 82% statements.

| Level       | Proves                                 | Cost    |
| ----------- | -------------------------------------- | ------- |
| Unit        | one class's logic, every branch        | ms      |
| Integration | real infrastructure behaves as assumed | seconds |
| E2E         | the whole app from the outside         | seconds |

A unit test cannot prove anything about MongoDB, so unique indexes, atomic `$inc` under concurrency,
`populate`, aggregation and **both** transaction commit and rollback run against a real `mongod` via
`mongodb-memory-server`. Equally, an e2e test is a terrible place to enumerate branches — every
`RolesGuard` case is one cheap unit assertion.

One replica set is shared across the whole run via Jest's `globalSetup`, with a database name per
suite. Three separate instances took ~10 minutes; this takes 30 seconds.

**Deep dive:** [Phase 14](docs/phase-14-testing.md)

---

## 43. Security

The useful framing: every control has a **precondition**, and knowing when one does _not_ apply is the
harder half.

- **CSRF** applies only where a credential is sent automatically — here, exactly two cookie-authenticated
  endpoints. Bearer endpoints are not vulnerable, and protecting them would break every non-browser
  client for nothing.
- **NoSQL injection** — validation rejects operator objects; `escapeRegex` neutralises search input,
  which is also a **ReDoS** defence.
- **Mass assignment** — `whitelist` + `forbidNonWhitelisted`, and identity from the token, never the
  body.
- **Passwords** bcrypt cost 12; **tokens** SHA-256; comparisons `timingSafeEqual`.
- **Secrets** never hardcoded, never defaulted, never in an image layer — a secret that ever entered a
  layer is leaked permanently.
- **Headers and transport** — helmet, CORS allow-list (never `*` with credentials), and `trust proxy: 1`,
  which is a security control because the rate limiter depends on it. Never `trust proxy: true` — the
  client controls that header.
- **Errors** never leak driver messages, and 404-vs-403 is chosen to avoid confirming existence.

**Deep dive:** [Phase 16](docs/phase-16-security.md)

---

## 44. Health checks, logging and observability

```
GET /health/live     liveness  — checks NOTHING, and that is the finished implementation
GET /health/ready    readiness — MongoDB only
GET /health/detail   full report, including Redis; 503 when degraded
```

Failing liveness makes the orchestrator **restart**; failing readiness makes the load balancer **stop
routing**. Put a database check in liveness and a 30-second blip restarts every healthy instance at
once, turning a degradation into an outage.

Redis is deliberately absent from readiness — it only makes the app faster — but present in
`/health/detail`, so degradation is **visible** rather than silent.

The probes are served at unprefixed, unversioned paths (`exclude` + `VERSION_NEUTRAL`) so infrastructure
config never has to change when you ship `/api/v2`.

Logging is **pino**: structured JSON, redaction of `authorization`/`cookie`/`set-cookie`/passwords
(without which every log line contains a bearer token), level by outcome (5xx `error`, 4xx `warn`), and
probes excluded — ~250,000 lines a day of "the app is up" buries the signal and costs real money.

Correlation IDs are minted in exactly one place and adopted everywhere else; running the server live
revealed two components minting **different** ids for the same request, which is worse than none.

**Deep dive:** [Phase 18](docs/phase-18-health-logging.md)

---

## 45. Performance and scalability

The bottleneck ranking, which is remarkably consistent: **database** (80%+ of real problems) → network
→ event-loop blocking → framework overhead (almost never).

The scaling order, cheapest first: missing index (10–100×) → N+1s, `.lean()`, projections (2–5×) →
caching → move slow work to the queue → scale horizontally → read replicas → shard or split.

Horizontal scaling is nearly free here **only because the app is stateless** — sessions, cache, rate
limits, queue and real-time fan-out all live in Redis or MongoDB. That was paid for incrementally
across Phases 7–12, and the rate limiter is the clearest case: in-memory counters with five instances
mean a limit of 100 becomes 500.

Node does not use multiple cores in one process, so the scaling unit is **containers**, not the cluster
module — the orchestrator already does the supervision and health checking you would otherwise
reimplement.

**Deep dive:** [Phase 19](docs/phase-19-performance-scalability.md)

---

## 46. Modular monolith vs microservices

Microservices trade a _local_ problem (a big codebase) for _distributed systems_ problems — partial
failure, eventual consistency, cross-store consistency, distributed tracing. Strictly harder. You take
that trade when a **named** force appears: independent scaling, team autonomy, independent
deployability, technology mismatch, or regulatory isolation. "The codebase is big" is not one — that is
a modularity problem, and a network call hardens a bad boundary rather than fixing it.

What is already done to make a split cheap: abstract-class repository ports, modules owning their
models, event-based cross-module communication, **zero** circular dependencies, and propagated
correlation IDs.

Extract **notifications** first (already async, already event-driven, different scaling profile,
**no caller changes**), then activity logs. Never split Users/Projects/Tasks/Comments — they are one
transactional cluster, and **a boundary a transaction crosses is a bad boundary**.

**Deep dive:** [Phase 20](docs/phase-20-microservices.md)

---

## 47. Design decisions and trade-offs

Every significant decision in this project, with its cost:

| Decision                               | Bought                                            | Cost                                                        |
| -------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------- |
| Modular monolith                       | One deploy, real transactions, one place to debug | Everything scales together                                  |
| Express over Fastify                   | Larger middleware ecosystem, familiarity          | Measurably slower at pure JSON throughput                   |
| Abstract-class ports                   | Testability, swappability, extraction path        | One more indirection per feature                            |
| Global deny-by-default guard           | Cannot forget to protect an endpoint              | Must remember `@Public()` on genuinely public ones          |
| Envelope on errors only                | REST-correct successes, better generated clients  | Two response shapes to document                             |
| `AsyncLocalStorage` over request scope | Singletons stay singletons; works in workers      | Implicit — the value's origin is invisible at the call site |
| Events over direct calls               | No cycles; extraction path                        | Traceability: a call graph becomes a listener search        |
| Degrade on Redis failure               | An outage becomes a slowdown                      | Silent unless logged — hence `warn` and `/health/detail`    |
| SSE over WebSockets                    | No sticky sessions, auto-reconnect                | One-directional only                                        |
| Real `mongod` in tests                 | Verifies what fakes cannot                        | Slower suite, a binary to download                          |
| bcrypt cost 12 (4 in tests)            | Real resistance to offline cracking               | 250ms of CPU per login                                      |

The pattern worth noticing: **every row has a cost**, and being able to state it is the difference
between a decision and a preference.

---

## 48. Common mistakes

Collected from the phase docs — most of these were hit and fixed while building this, not read about:

| Mistake                                                        | Consequence                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------ |
| `forwardRef` on one side only                                  | `dependency at index [1] appears to be undefined`            |
| `@ValidateNested()` without `@Type()`                          | Nested object silently unvalidated                           |
| Mapped types from `@nestjs/mapped-types` with Swagger          | OpenAPI metadata silently lost                               |
| `@Prop({ index: true })` **and** `schema.index()` on one field | Duplicate index; uniqueness can be silently lost             |
| `Model.create(doc, { session })`                               | Runs **outside** the transaction                             |
| `KEYS` instead of `SCAN`                                       | Blocks single-threaded Redis; fine at 100 keys, fatal at 10M |
| `INCR` without checking `PTTL == -1`                           | A key with no TTL locks a user out permanently               |
| Catching errors inside a BullMQ processor                      | Job marked complete; never retries                           |
| `CMD ["npm", "run", "start:prod"]`                             | `SIGTERM` never reaches Node; graceful shutdown never runs   |
| `.env` not in `.dockerignore`                                  | Secret baked into an immutable layer, leaked permanently     |
| Swagger set up before `setGlobalPrefix`                        | Document describes routes that do not exist                  |
| Database check in the **liveness** probe                       | A database blip restarts every healthy instance              |
| Two components each minting a correlation id                   | Every line tagged — with the wrong tag half the time         |
| `trust proxy: true`                                            | Clients can spoof their IP and bypass rate limiting          |
| `.overrideProvider()` for a provider that was never registered | Substitutes; does not supply                                 |
| Trusting DTO schemas from a test-generated OpenAPI document    | The CLI plugin is build-time only                            |

---

## 49. Express → NestJS mapping

Full guide with side-by-side code: [`docs/express-vs-nestjs.md`](docs/express-vs-nestjs.md).

| Express                             | NestJS                                   | What actually changes                                                       |
| ----------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------- |
| `express.Router()`                  | `@Controller()`                          | Routes become metadata, not imperative calls                                |
| `router.get('/x', h)`               | `@Get('x')`                              | Same routing, declarative — and Swagger can read it                         |
| `req`/`res` handling                | Return a value                           | Nest serialises; throw for errors                                           |
| `app.use(mw)`                       | Middleware / **Guard** / **Interceptor** | Express's one hook splits into four purpose-built ones                      |
| Auth middleware                     | **Guard** (`CanActivate`)                | Returns boolean, runs before pipes, can read route metadata via `Reflector` |
| `express-validator` / manual checks | **Pipe** + DTO                           | Validation is declarative and typed, and feeds the OpenAPI schema           |
| `(err, req, res, next)` handler     | **Exception filter**                     | Centralised, typed, per-scope                                               |
| Response-shaping middleware         | **Interceptor**                          | Wraps the handler as an RxJS stream: before _and_ after                     |
| `require('./userService')`          | **Provider** + DI                        | Dependencies are declared and swappable in tests                            |
| `config/index.js` module            | `ConfigModule` + `ConfigService`         | Same data; injected instead of globally required                            |
| Folder conventions                  | **Modules**                              | Boundaries the framework actually enforces                                  |

The concepts you already have — REST, JWT, CSRF, caching, SSE, Mongo, Docker, CI — all transfer.
NestJS mostly changes _where_ code lives and _how_ it is wired, not what it does.

---

## 50. Interview preparation

You have **2+ years** of professional Node.js/TypeScript/Angular work. Do not claim four years of
NestJS. Interviewers at this level check, and being caught costs you the offer; being straight
usually does not, because what they actually need is someone who can ship.

A script that works:

> "I have 2+ years of professional backend experience with Node.js and TypeScript — REST APIs,
> MongoDB, JWT auth, caching, SSE, Docker and CI/CD, plus Angular on the frontend. NestJS is the
> framework I'm specialising in now. The underlying concepts are the same ones I've been working
> with: NestJS guards are the auth middleware I've written, interceptors are response middleware,
> providers are the services I was requiring manually. What NestJS added for me was enforced module
> boundaries and dependency injection, which I've been using to build a full modular-monolith
> project — auth, RBAC, Mongo, Redis caching, BullMQ, SSE, the lot. Happy to walk through the
> architecture."

Why it works: it states experience accurately, then immediately reframes NestJS as _transferable
knowledge plus deliberate practice_ rather than a gap — and ends by inviting a technical
conversation, which is where you win. Then **be ready to actually walk through it**; that is what
the rest of this repository is for.

### The preparation material

|                                                                     | What it is                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [**132 interview questions**](docs/phase-21-interview-questions.md) | Beginner (20) · Intermediate (30) · Advanced (30) · Senior/architecture (20) · Scenarios (32). Every one answerable from code in this repository, each with **Answer · Why it matters · Real-world example · Common mistake · Follow-up**. |
| [**Mock senior interview**](docs/phase-22-mock-interview.md)        | A full 75-minute transcript across five rounds, annotated with _why_ each answer landed. The experience question is handled in round 1 and never comes back.                                                                               |
| [**Express → NestJS mapping**](docs/express-vs-nestjs.md)           | The translation guide for everything you already know.                                                                                                                                                                                     |

**How to prepare, in order:**

1. **Say the experience answer out loud until it is automatic.** It comes first in every interview, and
   costing you no composure is worth more than polishing it.
2. **Work Intermediate and Advanced**, out loud, at full length. Silent reading feels like knowing and
   is not — the gap between "I know this" and "I can explain this in 90 seconds" is the entire
   interview.
3. **Open the file behind every answer.** A code comment you have read sticks under pressure; a bullet
   point does not.
4. **Read the mock interview last**, for shape and pacing.
5. **Prepare three stories**: something you built, something you debugged, and something you got wrong
   and fixed. The third is the one candidates never prepare and interviewers always ask for.

**Two failure modes, in opposite directions.** _Inflating_ collapses at the first "walk me through how
you handled that", and takes the rest of your credibility with it. _Apologising_ — "I only have two
years…" — invites the interviewer to agree with you. State the facts, then move straight to what you
can do.

---

## License

UNLICENSED — personal learning project.
