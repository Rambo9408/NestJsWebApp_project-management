# Phase 17 — Docker & CI/CD

> **Goal:** ship the same artefact everywhere, and make the pipeline fail as early and as cheaply as
> possible.

Verified **against a real Docker daemon** (Docker Desktop 4.86, engine 29.7.2, linux/amd64):
image builds ✅ · full stack runs ✅ · probes answer ✅ · graceful shutdown confirmed ✅

| Claim | Measured |
| --- | --- |
| Runtime image excludes build tooling | `typescript`, `jest`, `eslint`, `@nestjs/cli`, `ts-jest` all **absent** |
| `.dockerignore` keeps secrets and source out | `.env`, `.git`, `src/`, `test/` all **absent** from the image |
| `npm prune --omit=dev` shrinks the tree | `node_modules` **113MB**, `dist` **2.8MB**, image **371MB** |
| `USER node` runs unprivileged | `uid=1000(node) gid=1000(node)` |
| Exec-form `CMD` puts Node at PID 1 | `/proc/1/cmdline` = `node dist/main` |
| **Signals are forwarded** | `docker stop` completed in **551ms**, exit code **0** — not the 10s timeout and 137 you get when they are not |
| `enableShutdownHooks()` actually runs | Shutdown log: `Closing Redis connection (signal: SIGTERM)` then `MongoDB disconnected` |
| `HEALTHCHECK` works | Docker reported the container `healthy` |
| `depends_on: service_healthy` gates startup | API started only after both `taskflow-redis` and `taskflow-mongodb` reported healthy |

The one figure below that is **not** measured here is the layer-cache speedup — it is standard
BuildKit behaviour, not something this build timed.

Files: [Dockerfile](../Dockerfile) · [docker-compose.yml](../../docker-compose.yml) ·
[.dockerignore](../.dockerignore) · [.github/workflows/ci.yml](../../.github/workflows/ci.yml)

---

## 1. Why containerise at all

Not "because everyone does". Three concrete reasons:

1. **The artefact is the same everywhere.** The image that passed CI is byte-for-byte the image in
   production. "Works on my machine" stops being a category of bug — including the Node version, the
   OpenSSL version and the locale.
2. **Dependencies are declared, not assumed.** No "install Node 22 and Redis first" in a README that
   nobody reads.
3. **The orchestrator gets a contract.** Health checks, resource limits, graceful shutdown and
   rolling deploys all need a process the platform can start, probe and stop.

---

## 2. The multi-stage build

```dockerfile
FROM node:22-alpine AS deps      # install everything, including devDependencies
FROM node:22-alpine AS build     # compile TypeScript
FROM node:22-alpine AS runtime   # production deps + dist only
```

A single-stage image contains the TypeScript compiler, ESLint, Jest, every `@types` package, the
source, and `.git` if you are careless. That is roughly **500MB of attack surface and cold-start
weight to ship a few hundred kilobytes of JavaScript**.

The runtime stage copies only pruned `node_modules` and `dist`, so **nothing that can compile, lint
or test code exists in the image that faces the internet**. Smaller image, faster pulls, fewer CVEs
in your scanner, and one fewer way for an attacker to build tooling on your host.

### Layer caching is the single most valuable optimisation

```dockerfile
COPY package.json package-lock.json ./   # ← manifests ONLY
RUN npm ci --no-audit --no-fund
COPY . .                                 # ← source afterwards
```

Docker caches each instruction keyed on the files it touched. Copy the whole source before
`npm ci` and **every source edit invalidates the install layer** and reinstalls 800 packages. Copy
the manifests first and the install layer is reused until a *dependency* changes.

Typical effect: a 3-minute rebuild becomes 20 seconds. It is one line of ordering.

### `npm ci`, never `npm install`

| | Behaviour |
| --- | --- |
| `npm ci` | Installs **exactly** the lockfile, deletes `node_modules` first, fails if `package.json` and the lock disagree. Reproducible. |
| `npm install` | May resolve new versions and **rewrite the lockfile** — so your image can differ from what you tested, silently. |

`ci` in CI and in Docker, always.

### Alpine vs slim, honestly

Alpine is ~40MB smaller but uses **musl** instead of glibc, which breaks some native modules and has
historically caused subtle DNS and performance differences. This project has no native dependencies
(`bcryptjs` is pure JS — Phase 3), so Alpine is safe **here**. Add `bcrypt`, `sharp` or `canvas` and
you should switch to `node:22-slim` rather than fight it.

And pin a major (`node:22-alpine`), never `latest` — otherwise your image changes under you and a
build that worked yesterday fails today for no reason in your diff.

---

## 3. Two details that quietly undo everything else

### `USER node`

Containers run as root by default. If an attacker achieves RCE in the process, root inside the
container plus any runtime or kernel escape is root on the **host** — and even without an escape,
root can write anywhere in the container and tamper with the code it is running.

The `node` image already ships a `node` user (uid 1000), so this is one line. `--chown=node:node` on
each `COPY` is the other half: without it the files are owned by root and the `node` user cannot read
them, which produces a very confusing startup failure.

### `CMD ["node", "dist/main"]`, **not** `npm run start:prod`

This is the one that catches most people, because the symptom is nowhere near the cause.

Running through npm puts **npm at PID 1**, and npm does not forward signals to its child. So
`docker stop` sends `SIGTERM` to npm, node never receives it, and 10 seconds later Docker `SIGKILL`s
everything.

The visible consequence: **`enableShutdownHooks()` never runs.** In-flight requests are cut,
connections are left open, and BullMQ jobs are abandoned mid-flight (Phases 1 and 12). All of the
graceful-shutdown work is silently undone by one line of convenience.

Use the **exec form** (`["node", ...]`) for the same reason — shell form wraps the process in
`/bin/sh -c`, which has the same signal problem.

---

## 4. `HEALTHCHECK` hits **liveness**, not readiness

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health/live')..."
```

Liveness answers *"is the process alive?"* and **must not touch the database**. A liveness check that
fails when MongoDB is slow makes the orchestrator restart perfectly healthy containers — turning a
database blip into a full outage, and a restart storm on top of an already-struggling database.
Phase 18 builds both probes properly - and note the path carries **no prefix and no version**, so
this line survives the day you ship `/api/v2`.

`--start-period` matters: without it, a container that takes 20 seconds to boot is marked unhealthy
and killed before it has ever finished starting.

Note the check uses `node -e` with the built-in `fetch` rather than `curl` — the Alpine Node image
has no `curl`, and installing one just for a health check adds a package and a CVE surface.

---

## 5. Compose: profiles and `service_healthy`

```yaml
api:
  profiles: ['app']
  depends_on:
    mongodb: { condition: service_healthy }
    redis:   { condition: service_healthy }
```

**The profile** keeps `docker compose up -d` starting only MongoDB and Redis, which is what you want
for local development with hot reload and a debugger attached. Running the API in a container is an
explicit choice: `docker compose --profile app up -d`.

**`condition: service_healthy`, not the default `service_started`.** Without it the API starts before
MongoDB is accepting connections, exhausts its retries and exits — which looks like an application
bug and is a startup-ordering one.

**Service names, not `localhost`:**

```yaml
MONGODB_URI: mongodb://mongodb:27017/taskflow?directConnection=true
REDIS_HOST: redis
```

Inside the compose network, `mongodb` and `redis` resolve through Docker's embedded DNS.
`localhost` points at the **container itself** — the single most common compose mistake, and the
error message (`ECONNREFUSED 127.0.0.1:27017`) does nothing to suggest the real cause.

---

## 6. `.dockerignore` is a security file

It is **not** the same file as `.gitignore`, and the difference is not cosmetic.

Before Docker runs a single instruction it tars the entire directory and sends it to the daemon.
Without this file, that tarball includes `node_modules` (~400MB) and `.git` — so every build starts
with a multi-second upload of files that are about to be thrown away, or worse, copied in.

The part that matters more:

- **`.env` holds real secrets.** `COPY . .` bakes them into a layer. Deleting them in a *later*
  instruction does **not** remove them — layers are immutable, and anyone with the image can read
  them with `docker history` or by extracting the layer tarball. **A secret that ever entered an
  image is leaked, permanently, and must be rotated.**
- **`.git`** contains every past commit, including secrets you already rotated out of the working
  tree.

And a correctness point: excluding `node_modules` is what makes the multi-stage build honest. If the
host tree were copied in, a Linux image could end up running native modules compiled for Windows —
and the failure appears at runtime, not at build time.

---

## 7. The pipeline: cheapest check first

```
push → install → lint → typecheck → unit tests → e2e tests → coverage → build → docker build
        ~10s      ~15s     ~20s        ~12s        ~90s                  ~30s      ~90s
```

The ordering is not aesthetic. Putting the Docker build first means waiting two minutes to be told
about a missing semicolon. **It is the difference between a feedback loop people use and one they
route around.**

Three deliberate choices in [ci.yml](../../.github/workflows/ci.yml):

**A separate `typecheck` step even though `build` also compiles.** `nest build` uses
`tsconfig.build.json`, which excludes tests — so a type error in a spec file would *not* fail the
build. `tsc --noEmit` checks everything, and it costs 20 seconds.

**`concurrency` with `cancel-in-progress`.** Push three times to a PR and, without this, you run
three full pipelines and pay for two results nobody will read.

**Coverage as an artefact, not a second gate.** The threshold check already runs inside `test:cov`;
the uploaded HTML report is for the human reviewing the PR, and it is what makes a coverage
discussion concrete instead of an argument about a number.

The e2e job needs **no service containers**: `mongodb-memory-server` downloads and caches a real
`mongod` (Phase 14). One fewer moving part in CI, and the same code path developers run locally.

---

## 8. Deployment — what the pipeline stops short of, and why

Everything above is verifiable in this repository. Deployment is not, because it depends on a
platform this project does not have. But the **ideas** are the interesting part, and they are what an
interview actually asks about:

### Migrations run *before* the new version, and must work with the *old* one

During any rolling deploy, **both versions are running at once**. A migration that drops a column the
old version still reads takes production down during the rollout.

The pattern is **expand → migrate → contract**, across three deploys:

1. **Expand** — add the new field, write to both, read from the old. Safe with either version live.
2. **Migrate** — backfill; switch reads to the new field.
3. **Contract** — stop writing the old field; remove it. Only once no running version reads it.

This is the single most important deployment idea in the phase, and the one most often skipped.

### Rolling or blue/green, never stop-then-start

- **Rolling** — replace instances a few at a time. Cheap; requires both versions to coexist (see
  above).
- **Blue/green** — run the full new version alongside, switch traffic at the load balancer, keep the
  old one warm for instant rollback. Doubles resources briefly; buys the fastest rollback there is.
- **Canary** — blue/green with a traffic percentage. Best signal, most machinery.

### Health checks gate the rollout

A pod that fails **readiness** never receives traffic, so a broken release *stalls* instead of
serving errors. This is the mechanism that makes a bad deploy a non-event — and it only works if the
readiness probe genuinely reflects readiness (Phase 18).

### Graceful shutdown must actually work

Otherwise every deploy drops in-flight requests and abandons running jobs. See §3 — this is exactly
what `CMD ["node", ...]` protects.

### Rollback must be one command, and must be rehearsed

A rollback plan nobody has ever run is a hope, not a plan. The corollary: **keep the previous image
tagged and pullable**, and never make a deploy irreversible with a destructive migration in the same
step.

### What a fuller pipeline adds, and why it is not here

| Stage | Why it is deliberately omitted |
| --- | --- |
| `npm audit` / Trivy image scan | A noisy gate everyone learns to ignore is worse than none — it needs a policy for accepted findings first. |
| Publish to a registry | Needs credentials and a versioning scheme; both are org decisions. |
| Post-deploy smoke tests | Needs a deployed environment. The *full* suite belongs before the deploy, not after. |

---

## 9. Why?

| Question | Answer |
| --- | --- |
| **Why multi-stage?** | Ship only what runs. Smaller image, smaller attack surface, faster pulls. |
| **Why not another approach?** | A single-stage image is simpler and 5× larger with a compiler in it. Buildpacks/Nixpacks remove the Dockerfile but also remove your control over exactly these decisions. |
| **Trade-offs** | Multi-stage builds are harder to debug (`--target build` to get a shell in an intermediate stage). Alpine's musl is a real compatibility risk with native modules. |
| **When to use** | Any compiled or transpiled language. Always. |
| **When to avoid** | Nothing to build and no dev dependencies — then a single stage genuinely is simpler. |

---

## 10. Express comparison

There is almost none, and that is the point: **containerisation is framework-agnostic.** The
Dockerfile for an Express app is the same file with a different `CMD`.

The two things Nest brings to the deployment story are not Docker features at all:

- **`enableShutdownHooks()`** gives you a real `onModuleDestroy`/`beforeApplicationShutdown`
  lifecycle, so closing the Mongo connection, quitting both Redis clients and draining BullMQ
  workers is declarative and ordered. In Express that is a hand-written `process.on('SIGTERM')`
  block that someone has to remember to update every time a new resource is added.
- **Config validated at boot** means a misconfigured container fails immediately and visibly, in
  front of a deploy pipeline that can roll it back — instead of at 3am on the first request that
  happens to need the missing value.

---

**Next:** [Phase 18 — health checks, logging & observability](phase-18-health-logging.md)
