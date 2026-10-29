# =============================================================================
# The React client — multi-stage: build with Node, ship with nginx
# =============================================================================
# THE SHAPE THAT MATTERS: the final image contains NO NODE, NO npm AND NO SOURCE.
# A built SPA is static files; the toolchain that produced them is build-time
# scaffolding and has no business in production.
#
# Concretely, ~1.1 GB of node + node_modules becomes a ~50 MB nginx image
# holding a few hundred kB of assets. That is not only disk: every package in
# a runtime image is attack surface and something a scanner will report.
#
# CONTRAST WITH THE BACKEND: nestbackend/Dockerfile ends on `node:22-alpine`
# because a Nest server genuinely needs a Node runtime. Same multi-stage
# technique, different conclusion — the technique is not the point, asking
# "what does this actually need at runtime?" is.
# =============================================================================

# -----------------------------------------------------------------------------
# STAGE 1 — dependencies
# -----------------------------------------------------------------------------
FROM node:22-alpine AS deps

WORKDIR /app

# MANIFESTS FIRST, and only the manifests. Docker caches each layer against the
# files it copied; copying the whole tree here would invalidate the install on
# every source edit. This way `npm ci` is only re-run when a dependency
# genuinely changes — the difference between a 3-second and a 90-second build.
COPY package.json package-lock.json ./

# `npm ci`, never `npm install`.
#   - installs EXACTLY the lockfile, so the image is reproducible
#   - fails if package.json and the lockfile disagree, instead of silently
#     resolving something new
#   - deletes node_modules first, so there is no partial state
# A green build from `npm install` says nothing about what you tested.
RUN npm ci --no-audit --no-fund

# -----------------------------------------------------------------------------
# STAGE 2 — build
# -----------------------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# TYPECHECK IS PART OF THE BUILD. `npm run build` is `tsc -b && vite build`, so
# a type error fails the image rather than shipping.
#
# WHAT IS DELIBERATELY NOT HERE: lint and tests. They belong in CI, where they
# run in parallel and report per-step. Putting them in the Dockerfile means a
# lint failure and a compile failure look identical, and every image rebuild
# pays for the whole suite.
RUN npm run build

# -----------------------------------------------------------------------------
# STAGE 3 — runtime
# -----------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

# nginx's default config serves /usr/share/nginx/html with no SPA fallback, no
# compression and no cache headers. Replacing it wholesale is clearer than
# layering a partial override.
COPY nginx.conf /etc/nginx/nginx.conf

# ONLY `dist`. Not src, not node_modules, not the tsconfigs — see .dockerignore.
COPY --from=build /app/dist /usr/share/nginx/html

# -----------------------------------------------------------------------------
# NON-ROOT
# -----------------------------------------------------------------------------
# The nginx image ships an `nginx` user but runs the master process as root so
# it can bind port 80. Dropping to a non-root user means binding an unprivileged
# port instead, and the directories nginx writes to must be owned by that user.
#
# WHY BOTHER: a container escape from a root process is a far better starting
# position than one from an unprivileged user. "It only serves static files" is
# not a security boundary.
#
# The port is 8080, declared DIRECTLY in nginx.conf rather than patched here.
#
# THE BUG THIS REPLACES, because it is worth remembering: the first version ran
#
#     RUN sed -i 's/listen       80;/.../' nginx.conf || sed -i 's/listen 80;/.../'
#
# expecting the `||` to fall through to the second pattern. It never did -
# `sed -i` EXITS 0 WHEN A PATTERN DOES NOT MATCH. It is not an error to change
# nothing. So the first sed "succeeded" silently, nginx kept listening on 80,
# the port mapping pointed at 8080, and the container came up healthy-looking
# and refused every connection.
#
# Configuration belongs in the config file. Patching it in a build step is one
# more thing that can silently not happen.
RUN touch /var/run/nginx.pid \
 && chown -R nginx:nginx /var/cache/nginx /var/run/nginx.pid /usr/share/nginx/html

USER nginx

EXPOSE 8080

# HEALTHCHECK hits nginx's OWN endpoint, not one that proxies to the API.
# A probe that depends on the backend reports the BACKEND's health — and
# restarting this container because the API is down is precisely the wrong
# response. Same liveness-vs-readiness reasoning as the backend's probes.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/nginx-health || exit 1

# `daemon off;` keeps nginx in the foreground. A backgrounded process means PID
# 1 exits and Docker considers the container finished — one of the most common
# "my container starts and immediately stops" causes.
CMD ["nginx", "-g", "daemon off;"]
