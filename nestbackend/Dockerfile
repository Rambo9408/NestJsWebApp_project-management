# =============================================================================
# MULTI-STAGE BUILD
# =============================================================================
# Three stages, and the reason for each:
#
#   deps    install ALL dependencies (including dev) - needed to compile
#   build   compile TypeScript to dist/
#   runtime a clean image with production dependencies and dist/ only
#
# WHY BOTHER? A single-stage image contains the TypeScript compiler, ESLint,
# Jest, every type package, the source, and the .git history if you are
# careless. That is ~500MB of attack surface and cold-start weight to ship a
# few hundred kilobytes of JavaScript.
#
# The runtime stage copies only `node_modules` (production) and `dist`, so
# nothing that can compile, lint or test code exists in the image that faces the
# internet. Smaller image, faster pulls, fewer CVEs in your scanner.
# =============================================================================

# -----------------------------------------------------------------------------
# Base: pinned, slim, and NOT `latest`
# -----------------------------------------------------------------------------
# `node:22-alpine` - a specific major, because `latest` means your image changes
# under you and a build that worked yesterday can fail today for no reason in
# your diff.
#
# ALPINE vs DEBIAN-SLIM, honestly: Alpine is ~40MB smaller but uses musl instead
# of glibc, which breaks some native modules and has historically caused subtle
# DNS and performance differences. This project has no native dependencies
# (bcryptjs is pure JS - see Phase 3), so Alpine is safe here. If you add
# `bcrypt`, `sharp` or `canvas`, switch to `node:22-slim` and stop fighting it.
FROM node:22-alpine AS deps

WORKDIR /app

# COPY ONLY THE MANIFESTS FIRST.
#
# This is the single most valuable Docker optimisation and it is about LAYER
# CACHING: Docker caches each instruction keyed on the files it touched. Copying
# the whole source before `npm ci` means every source edit invalidates the
# install layer and reinstalls 800 packages. Copying just the manifests means
# the install layer is reused until a DEPENDENCY changes.
#
# Typical effect: a 3-minute rebuild becomes 20 seconds.
COPY package.json package-lock.json ./

# `npm ci`, NOT `npm install`.
#
#   ci      installs EXACTLY the lockfile, deletes node_modules first, and fails
#           if package.json and the lock disagree. Reproducible.
#   install may resolve new versions and REWRITE the lockfile - so your image
#           can differ from what you tested, silently.
#
# `ci` in CI and in Docker, always.
RUN npm ci --no-audit --no-fund

# -----------------------------------------------------------------------------
# Build
# -----------------------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# `nest build` uses tsconfig.build.json, which EXCLUDES tests and *.spec.ts -
# so no test code reaches the image (Phase 1).
#
# It also runs the Swagger CLI plugin, which is a BUILD-TIME AST transform. The
# OpenAPI document you ship comes from here, not from a test run (Phase 15).
RUN npm run build

# Reduce node_modules to production dependencies only. Done in the BUILD stage
# so the runtime stage copies an already-pruned tree.
RUN npm prune --omit=dev

# -----------------------------------------------------------------------------
# Runtime
# -----------------------------------------------------------------------------
FROM node:22-alpine AS runtime

# `NODE_ENV=production` is not decoration:
#   - Express and many libraries skip development-only work and caching.
#   - Our own config reads it: `ignoreEnvFile` (Phase 1), `autoIndex: false`
#     (Phase 5), the email notification channel (Phase 3), and Swagger.
# Forgetting it means running production code in development mode - which is
# both slower and, given `autoIndex`, genuinely risky.
ENV NODE_ENV=production

WORKDIR /app

# -----------------------------------------------------------------------------
# RUN AS A NON-ROOT USER
# -----------------------------------------------------------------------------
# Containers run as root by default. If an attacker achieves RCE in the process,
# root inside the container plus any kernel or runtime escape is root on the
# host - and even without an escape, root can write anywhere in the container
# and tamper with the code it is running.
#
# The `node` image already ships a `node` user (uid 1000), so this is one line.
# There is no reason not to, and container security scanners flag its absence.
USER node

# `--chown` on COPY, because the files would otherwise be owned by root and the
# `node` user could not read them - a very common "permission denied" at
# startup.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json

EXPOSE 3000

# -----------------------------------------------------------------------------
# HEALTHCHECK
# -----------------------------------------------------------------------------
# Docker (and Compose) use this to decide whether the container is healthy, and
# `depends_on: condition: service_healthy` waits for it.
#
# NOTE it hits the LIVENESS probe, not readiness. Liveness answers "is the
# process alive?" and must not touch the database - a liveness check that fails
# when MongoDB is slow makes the orchestrator restart perfectly healthy
# containers, turning a database blip into an outage (Phase 18).
#
# `start-period` matters: without it, a container that takes 20 seconds to boot
# is marked unhealthy and killed before it ever starts.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# -----------------------------------------------------------------------------
# CMD: `node dist/main`, NOT `npm run start:prod`
# -----------------------------------------------------------------------------
# Running through npm puts npm at PID 1, and npm does NOT forward signals to its
# child. So `docker stop` sends SIGTERM to npm, node never receives it, and 10
# seconds later Docker SIGKILLs everything.
#
# The visible consequence: `enableShutdownHooks()` never runs, so in-flight
# requests are cut, connections are left open, and BullMQ jobs are abandoned
# mid-flight (Phases 1 and 12). All the graceful-shutdown work is silently
# undone by one convenience.
#
# Exec form (`["node", ...]`), not shell form, for the same reason - shell form
# wraps the process in `/bin/sh -c`, which has the same signal problem.
CMD ["node", "dist/main"]
