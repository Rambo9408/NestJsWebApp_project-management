# Phases 20–22 — Docker, nginx and CI

> Covers brief Parts 46, 47, 48. The last structural gap: the frontend had no
> container, and CI only built the backend.

---

## Four real bugs this phase found

All four were found by **running the thing**, not by reading it. None would have
been caught by lint, typecheck or the test suite.

### 1. `stats.html` was being served in production

The bundle visualiser writes into `dist/`, and `dist/` is exactly what the
Dockerfile copies into nginx. Verified by inspecting the built image — the full
module graph, every source path and dependency size, served to anyone who
guessed the URL.

Now opt-in: `npm run analyze`.

> A build-time tool that writes into the **output** directory is a deployment
> artefact whether you meant it to be or not. Check what's in the image, not
> what you think you put there.

### 2. `sed -i` exits 0 when the pattern doesn't match

```dockerfile
RUN sed -i 's/listen       80;/.../' nginx.conf || sed -i 's/listen 80;/.../'
```

The `||` was meant to fall through to the second pattern. **It never did** —
changing nothing is not an error. So nginx kept listening on 80, the port
mapping pointed at 8080, and the container came up *looking* healthy while
refusing every connection.

Fixed by declaring `listen 8080` in the config file. **Configuration belongs in
the config file**; patching it in a build step is one more thing that can
silently not happen.

### 3. nginx silently dropped every security header

This is a genuine nginx trap, from its own docs:

> *"These directives are inherited from the previous configuration level **if
> and only if there are no `add_header` directives defined on the current
> level**."*

`location = /index.html` sets `Cache-Control` — and therefore **discarded all
three server-level security headers.** On the entry page. Which, through the SPA
fallback, is *every route*.

Confirmed against the running container: `curl -I /` returned no
`X-Content-Type-Options`, no `X-Frame-Options`, no `Referrer-Policy`. Fixed by
repeating them in each block that overrides.

Also fixed a duplicate `Cache-Control` — `expires` emits its own header, so
pairing it with an explicit `add_header` sent two.

### 4. `api:types` destroyed the checked-in contract

```bash
curl -s http://localhost:3000/api/docs-json -o openapi/openapi.json
```

`curl -s -o` writes **whatever comes back**, including an error body. Run against
an API with `SWAGGER_ENABLED=false` and 36 kB of contract became:

```json
{"success":false,"statusCode":404,"message":"Cannot GET /api/docs-json"}
```

Nothing failed. Now [`scripts/fetch-openapi.mjs`](../scripts/fetch-openapi.mjs)
validates **before** writing — is it JSON, is it OpenAPI, does it have any paths
— and names the likely cause on a 404.

> `curl -o` is not a download, it's a redirect of bytes. Anything that overwrites
> a checked-in artefact must verify what it received *first*. Write-then-validate
> is too late — the good file is already gone.

---

## And the contract check caught real drift immediately

The new `contract-drift` CI job boots the API, regenerates the types, and fails
on a non-empty diff. Running it locally:

```
before: 34 paths | after: 35 paths
ADDED: /api/v1/tasks/{id}/comments/{commentId} -> delete
```

That's the route added during the **comment-moderation fix several phases ago**,
never regenerated. The job would have caught it on the commit that introduced it.

**What it still cannot catch:** the document has no *response* schemas, so this
guards what we **send**, not what we **receive**. Closing that is a backend
change (`@ApiOkResponse({ type })`) and is in the roadmap.

---

## The image: 89 MB, no Node

```
node present? NO    npm present? NO    src present? NO
running as: nginx (non-root)
```

Multi-stage: build with `node:22-alpine`, ship `nginx:1.27-alpine` with only
`dist/`. ~1.1 GB of toolchain becomes 89 MB.

**Contrast with the backend**, which *ends* on `node:22-alpine` because a Nest
server genuinely needs a Node runtime. Same technique, different conclusion —
the technique isn't the point, asking *"what does this actually need at
runtime?"* is.

**Non-root** means binding 8080 rather than 80. "It only serves static files"
isn't a security boundary — a container escape from root is a much better
starting position than one from `nginx`.

---

## nginx: the four rules that matter

### The SPA fallback — flagged in Phase 4, fixed here

```nginx
location / { try_files $uri $uri/ /index.html; }
```

Without it, `/tasks/abc123` works on soft navigation and **404s on a hard refresh
or a pasted link** — so the app appears to work until it's actually used.

Verified: `/`, `/login`, `/tasks`, `/projects/abc123`, `/admin/users`,
`/total-nonsense` → all **200**.

### Cache headers — two rules, and the split is the point

```
/assets/*      public, max-age=31536000, immutable   (content-hashed)
/index.html    no-cache, no-store, must-revalidate   (the only unhashed file)
```

This is what makes the Phase 16 chunk splitting pay off: vendor chunks keep their
hash across deploys and stay cached, so an app deploy costs a returning user
**~8.5 kB instead of ~213 kB**.

Cache `index.html` and a returning user loads yesterday's HTML pointing at chunk
hashes that no longer exist — **a blank page after every deploy**.

### SSE needs its own block

nginx **buffers proxied responses by default**, so events sit in a buffer until
it fills. `proxy_buffering off` is mandatory, and `proxy_read_timeout` must
exceed the backend's 30-second heartbeat or nginx closes the connection and the
client reconnects in a loop.

Verified end to end through the container — assigned a task, frame arrived:

```
event: notification
data: {"title":"TPR-1 assigned to you", ...}
```

### Compression

65% saved, measured on a real asset (23 kB → 8 kB).

---

## CI: 5 jobs, parallel where possible

```
api-quality ─┬─► api-build
             └─► contract-drift   (boots the API, regenerates, diffs)
web-quality ───► web-build        (bundle budget + docker image)
```

**Separate jobs, not extra steps.** GitHub runs jobs in parallel, so backend and
frontend run together — and a red pipeline says *which half* broke without
opening the log.

### A bundle budget

```
eager JS: 245 kB gzip across 9 files — within the 260 kB budget
```

15 kB of headroom against the Phase 16 measurement. Enough for ordinary work,
tight enough to catch something structural. **The number is arbitrary; having one
is not** — otherwise a dependency that doubles the bundle is noticed six months
later.

### And the existing workflow was invalid YAML

```yaml
run: echo "In a real pipeline: boot dist/main with ..."
```

A plain scalar can't contain `": "` — YAML reads it as a nested mapping. That
placeholder had been there since the backend's Phase 17 and **would have failed
the workflow outright**.

> Run any workflow you can't execute locally through a YAML parser. A broken
> pipeline definition fails at the platform, long after you've pushed.

---

## Interview questions

1. **Why multi-stage?** The runtime image should contain what runs, not what
   built it. 1.1 GB → 89 MB, and every removed package is removed attack surface.
2. **Why does an SPA need `try_files`?** Client-side routes have no file on disk.
   Without it, hard refresh and shared links 404.
3. **What's the SPA caching contract?** Hashed assets immutable forever; entry
   HTML never cached. Get it backwards and you ship a blank page.
4. **What breaks SSE behind a proxy?** Response buffering, and a read timeout
   shorter than the heartbeat.
5. **Why non-root in a container?** Escape from root is a far better position for
   an attacker. Costs you an unprivileged port.
6. **How do you stop generated types drifting?** Regenerate in CI and fail on a
   non-empty diff. Say which direction it covers.
7. **Liveness for a static server?** Its own endpoint, never one that proxies
   upstream — restarting nginx because the API is down is the wrong response.

---

## Exercises

1. Remove `try_files` and hard-refresh `/tasks`. Note it's nginx's 404, not ours.
2. Add `expires -1` next to the `index.html` `add_header` and `curl -I /`.
3. Delete the repeated security headers from `location = /index.html` and
   `curl -I /`. Explain why `/assets/*` still has them.
4. Set `SWAGGER_ENABLED=false` and run `npm run api:types`. Confirm the spec
   survives.
5. Drop the budget to 200 kB and run the CI step.
6. Comment out `proxy_buffering off` and watch an SSE notification arrive late.

---

## Verified

```
Image        89.2 MB · no node/npm/src · runs as nginx
Health       web + api both healthy
Routes       / /login /tasks /projects/abc123 /admin/users /nonsense → 200
Headers      one Cache-Control, all three security headers, both locations
Compression  65% on a real asset
API proxy    401 unauthenticated, 200 as admin, same origin
SSE          notification frame delivered unbuffered through nginx
CI           YAML valid, 5 jobs, correct dependency graph
Budget       245 kB / 260 kB
Drift        detected a real 35th path that was never regenerated

frontend 151/151 · backend 90/90 · lint + typecheck clean
```

---

## Quiz

1. Why does the frontend image end on nginx while the backend image ends on Node?
2. What does an SPA need `try_files` for, and when does its absence show up?
3. State the two-rule cache contract, and the failure mode of inverting it.
4. `sed -i` did not match its pattern. What was the exit code?
5. Why did `location = /index.html` drop every security header?
6. `curl -s -o file url` against a 404 — what is in the file?
7. Why run a container as non-root, and what does it cost?
8. Which direction does the contract-drift job actually protect?

<details>
<summary>Answers</summary>

1. Because the question is *what does this need at runtime?* Static files need a
   web server; a Nest server genuinely needs a Node runtime. Same technique,
   different conclusion — 1.1 GB becomes 89 MB.
2. Client-side routes have no file on disk. It shows up on a **hard refresh or a
   pasted link**, never on soft navigation — so the app appears to work until it
   is actually used.
3. Hashed assets `immutable` for a year; `index.html` never cached. Inverted, a
   returning user loads yesterday's HTML pointing at chunk hashes that no longer
   exist — **a blank page after every deploy**.
4. **0.** Changing nothing is not an error, so the `||` fallback never ran and
   nginx kept listening on port 80.
5. nginx `add_header` directives are inherited **only if the current level
   defines none**. Setting `Cache-Control` there discarded all three
   server-level security headers — on the entry page, which via the SPA fallback
   is every route.
6. The **404 body**. `curl -o` is not a download, it is a redirect of bytes — it
   replaced 36 kB of checked-in OpenAPI spec with an error message.
7. An escape from root is a far better starting position for an attacker. It
   costs you an unprivileged port — nginx on 8080 rather than 80.
8. What we **send**. The document has no response schemas, so it cannot detect a
   change in what we **receive**.

</details>

---

**Remaining:** consolidated security/accessibility passes, then the interview
material (Parts 57–60) and the mock interview. See
[ROADMAP.md](../../ROADMAP.md).
