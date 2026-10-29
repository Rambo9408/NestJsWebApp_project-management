# TaskFlow — a full-stack NestJS + React reference

A project-management application built as a **production-style reference and
interview-preparation project**, with two independently-documented halves:

```
taskflow/
├── nestbackend/        NestJS API — users, projects, tasks, comments,
│   ├── docs/           notifications, activity logs, jobs, caching, SSE
│   └── README.md       ← the backend's own 1,500-line guide
│
├── reactfrontend/      React SPA — the client for that API
│   └── docs/           ← phase-by-phase React guide
│
├── docker-compose.yml  shared infrastructure (MongoDB + Redis)
└── package.json        convenience scripts that delegate to both
```

**Start with the README inside whichever half you care about.** This file only
covers running the two together.

---

## Quick start

```bash
npm install                 # root — installs `concurrently` only
npm run install:all         # installs both apps

npm run infra:up            # MongoDB (replica set) + Redis, via Docker
npm run dev                 # backend :3000 and frontend :5173 together
```

Then open **http://localhost:5173**.

> **New here? Read [HOW-IT-WORKS.md](HOW-IT-WORKS.md) first.** It follows real requests through the
> code (startup → guards → pipes → service → database → notifications → React), then
> [nestbackend/docs/express-vs-nestjs.md](nestbackend/docs/express-vs-nestjs.md) explains how NestJS
> differs from Express.

In development a seeded admin exists on first boot: **`admin@taskflow.dev` / `ChangeMe123!`**.

### Troubleshooting

| Symptom                                                   | Cause and fix                                                                                                          |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `connect ECONNREFUSED 127.0.0.1:27018` on `npm run dev`   | MongoDB isn't running. Start Docker Desktop, then `npm run infra:up` and check `docker compose ps` shows both healthy. |
| `Redis unavailable … DEGRADED mode` (warning)             | Redis isn't running. The API still works; caching and queues are off until you `npm run infra:up`.                     |
| `EADDRINUSE :::3000` or `Port 5173 is in use`             | An earlier `npm run dev` is still running. Stop it (or `Stop-Process -Id <pid>`); Vite silently moves to 5174.         |
| `429 Too Many Requests` on login                          | Login/register allow 10 attempts per 15 min per IP — by design. Wait, or clear dev counters: `docker exec taskflow-redis sh -c "redis-cli --scan --pattern 'taskflow:dev:throttle:*' \| xargs -r redis-cli del"`. |
| Backend tests fail with `spawn UNKNOWN`                   | The bundled `mongod` can't start on this machine. Run them against Docker's Mongo — see below.                        |
| `DELETE /tasks/:id` fails                                 | Mongo is a standalone, not a replica set; transactions need the compose one (host port 27018).                         |
| Dev admin can't log in                                    | The seed only runs when the users collection is empty. Re-create with `nestbackend/scripts/seed-admin.mjs`.           |

**Backend tests without the bundled mongod** (Docker must be up):

```bash
cd nestbackend
MONGO_TEST_URI="mongodb://127.0.0.1:27018/?directConnection=true" npx jest --runInBand
```

Details in [phase-14-testing.md](nestbackend/docs/phase-14-testing.md#running-the-integration-suites-without-the-bundled-mongod).

### Scripts

| Command                                          | What it does                   |
| ------------------------------------------------ | ------------------------------ |
| `npm run dev`                                    | both apps, colour-coded output |
| `npm run dev:api` / `dev:web`                    | one at a time                  |
| `npm run build`                                  | builds both                    |
| `npm run lint` / `typecheck`                     | across both                    |
| `npm test`                                       | backend unit + frontend suites |
| `npm run test:e2e`                               | backend integration suite      |
| `npm run infra:up` / `infra:down` / `infra:logs` | Docker services                |

---

## How the two halves connect

```
Browser ──► :5173  Vite dev server
                   │  proxies /api and /health
                   ▼
            :3000  NestJS  ──►  MongoDB :27018   Redis :6379
```

**Dev and production are both same-origin**, which is deliberate: no CORS
preflight, cookies attach without ceremony, and one relative `/api/v1` is
correct in both. In production nginx serves the static bundle and reverse-proxies
`/api` — the same shape the Vite proxy imitates.

> **MongoDB runs on host port 27018**, not 27017. Many machines already have a
> local `mongod` on 27017; when they do, the compose container silently fails to
> start and the API connects to the local **standalone** instead — which cannot
> run the multi-document transactions the cascade delete needs. Moving the host
> port designs the conflict away. See `docker-compose.yml`.

---

## Architecture at a glance

**Backend** — modular monolith. Global JWT guard, project-membership guards,
CSRF double-submit, refresh-token rotation with reuse detection, MongoDB
transactions, Redis-backed cache/queue/pub-sub, SSE, OpenAPI.

**Frontend** — Vite + TypeScript (strict), React Router data router, Redux
Toolkit + RTK Query, React Hook Form + Zod, MUI. Access token in memory, refresh
token in an httpOnly cookie, single-flight refresh shared across both transports.

**The API contract is the backend.** Request types are **generated** from its
OpenAPI document (`npm run api:types` in `reactfrontend/`); response types are
hand-written and verified against live responses, because the document carries no
response schemas. `src/types/contractCheck.ts` asserts the two halves agree at
compile time.

---

## Security work

Two audits were run against the running stack, and both found real issues:

| Finding                                                                                                    | Status                             |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `GET /tasks`, `GET /projects` unscoped — any user could read all data                                      | **fixed**, with regression tests   |
| `/tasks/:id` and sub-routes had **no** object-level authorization — read, edit and delete of anyone's task | **fixed** (`TaskAccessGuard`)      |
| `DELETE /comments/:id` unauthorized                                                                        | **fixed**, moved to a nested route |
| `/health/detail` public, exposing internal topology                                                        | **fixed**, admin-only              |

Written up in **[nestbackend/docs/authorization-audit.md](nestbackend/docs/authorization-audit.md)**
and **[security-fix-collection-authorization.md](nestbackend/docs/security-fix-collection-authorization.md)**.

Every fix was verified by **reintroducing the bug and confirming the tests fail** —
which also caught two of my own tests being vacuous.

---

## Documentation

### Backend — [nestbackend/README.md](nestbackend/README.md)

22 phase guides in [`nestbackend/docs/`](nestbackend/docs/), plus interview
material in [`nestbackend/docs/interview/`](nestbackend/docs/interview/).

### Frontend — [reactfrontend/README.md](reactfrontend/README.md)

51 reference sections, mirroring the backend guide. The phase-by-phase material
is indexed at [`reactfrontend/docs/`](reactfrontend/docs/README.md), with
graded interview sets in
[`reactfrontend/docs/interview/`](reactfrontend/docs/interview/), an
[Angular↔React translation](reactfrontend/docs/angular-vs-react.md), and a
[defect audit](reactfrontend/docs/frontend-audit.md).

| Doc                                                                                              | Covers                                                |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| [01 — Setup & architecture](reactfrontend/docs/phase-01-setup-and-architecture.md)               | Vite, strict TS, the dev proxy, the API contract      |
| [02 — Components, JSX, props, state](reactfrontend/docs/phase-02-components-jsx-props-state.md)  | composition over configuration, immutability          |
| [03 — Hooks](reactfrontend/docs/phase-03-hooks.md)                                               | useEffect in depth, stale closures, Context vs Redux  |
| [04 — Rendering & keys](reactfrontend/docs/phase-04-rendering-reconciliation-keys.md)            | render/commit, reconciliation, Fiber                  |
| [05–06 — Routing & forms](reactfrontend/docs/phase-05-06-routing-and-forms.md)                   | nested routes, URL-as-state, RHF + Zod                |
| [07 — API integration](reactfrontend/docs/phase-07-api-integration.md)                           | generated types, token storage, single-flight refresh |
| [08–09 — Redux & RTK Query](reactfrontend/docs/phase-08-09-redux-and-rtk-query.md)               | Immer, tags, optimistic updates                       |
| [10–11 — Authorization & RBAC](reactfrontend/docs/phase-10-11-authorization-rbac.md)             | two role systems, permission gates                    |
| [12 — Projects & data table](reactfrontend/docs/phase-12-projects-and-data-table.md)             | reusable table, server-side paging                    |
| [15 — SSE notifications](reactfrontend/docs/phase-15-sse-notifications.md)                       | EventSource auth, reconnect, backoff                  |
| [16 & 35 — Performance](reactfrontend/docs/phase-16-35-performance-and-splitting.md)             | measured bundle analysis, virtualization              |
| [44–45 — Testing & MSW](reactfrontend/docs/phase-44-45-testing-and-msw.md)                       | the three test layers, vacuous tests                  |
| [18–19 — Security & accessibility](reactfrontend/docs/phase-18-19-security-and-accessibility.md) | the audit that found seven real defects               |
| [20–22 — Docker, nginx, CI](reactfrontend/docs/phase-20-22-docker-nginx-ci.md)                   | multi-stage images, SPA fallback, contract drift      |

Each ends with interview questions, exercises and a quiz. The exercises are
deliberately *"delete this line and watch what breaks"* — good for understanding
this codebase, and a different skill from the standalone challenges below.

### Interview preparation

Standalone, and cross-linked to the code that demonstrates each point.

| Document                                               | Contents                                             |
| ------------------------------------------------------ | ---------------------------------------------------- |
| [INTERVIEW-QUESTIONS.md](INTERVIEW-QUESTIONS.md)       | **130** questions, 12 sections, short spoken answers |
| [CODING-EXERCISES.md](CODING-EXERCISES.md)             | **50** standalone implementations with solutions     |
| [SENIOR-SCENARIOS.md](SENIOR-SCENARIOS.md)             | **40** situational-judgement scenarios               |
| [ARCHITECTURE-QUESTIONS.md](ARCHITECTURE-QUESTIONS.md) | **20** system-design discussions                     |
| [MOCK-INTERVIEW.md](MOCK-INTERVIEW.md)                 | a full 5-round loop with follow-ups                  |
| [POSITIONING.md](POSITIONING.md)                       | Angular↔React translation, and honest framing        |

**28 of the 130 questions are marked ★** — meaning this project has a specific
story behind them: a real bug, a measurement, a trade-off with a number. Those are
the ones worth memorising, because a specific answer beats five general ones.

---

## Status

**All 28 phases complete**, and a completeness audit against the original
feature checklist closed four gaps that documentation alone would not have
found — a dead route constant, comments, the activity log, and modals. See
[ROADMAP.md](ROADMAP.md#the-completeness-audit--four-gaps-found-and-closed).

|          |                                           |
| -------- | ----------------------------------------- |
| Backend  | 180 unit + 90 e2e tests                   |
| Frontend | 206 tests                                 |
| Both     | lint clean, typecheck clean, builds clean |
| Stack    | four containers, all healthy              |

**Known issues** — deliberately open, not hidden — are listed in
[ROADMAP.md](ROADMAP.md). The main ones: no real-browser E2E (jsdom cannot test
layout, so some assertions here are impossible until Playwright runs), no
screen-reader testing, and a 245 kB gzip bundle of which ~210 kB is MUI.

---

## Honesty note

This project exists to build **genuine** competence, not to support claiming
experience nobody has. [POSITIONING.md](POSITIONING.md) is explicit about it: do
not inflate React years, because inflation does not survive the follow-up
question. Specific beats senior.

That principle is applied to the documentation itself. Where something was
measured and the result was bad, the number is here — code splitting made cold
load **worse**, and it says so. Where a claim turned out to be false, the
correction is in the file next to the original, including one case where a test
comment asserted "verified load-bearing" and was wrong.

The gaps are listed rather than glossed: no SSR shipped, no React at large-team
scale, no screen-reader testing, no real-browser E2E. Being able to say what you
haven't done is what makes the rest credible.
