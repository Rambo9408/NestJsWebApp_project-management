# Phase 16 — Security hardening

> **Goal:** go through the OWASP list that actually applies to a JSON API, and for each item say
> what this codebase does, **and where it is genuinely not a risk** — because knowing when a control
> is unnecessary is the harder half.

Verified: `lint` ✅ · CSRF accept/reject/bearer-exempt cases covered in
[auth.integration.spec.ts](../src/auth/auth.integration.spec.ts#L312) ✅

Files: [csrf.guard.ts](../src/common/guards/csrf.guard.ts) ·
[main.ts](../src/main.ts#L145) · [schema.helpers.ts](../src/database/schema.helpers.ts#L111) ·
[auth.service.ts](../src/auth/auth.service.ts)

---

## 1. The most useful security answer is "that does not apply here, and here is why"

Every one of these controls has a *precondition*. Bolting on a control whose precondition is absent
costs you compatibility, complexity and credibility.

| Threat | Precondition | Applies here? |
| --- | --- | --- |
| CSRF | Credential sent **automatically** by the browser (cookie) | **Two endpoints only** |
| XSS | You render HTML with untrusted data | Only Swagger UI |
| SQL injection | String-concatenated SQL | No — MongoDB, and no string queries |
| NoSQL injection | Untrusted values reaching query **operators** | Yes — handled by validation + regex escaping |
| Mass assignment | Request body spread into a model | Yes — handled by the global pipe |
| Clickjacking | Your app renders in an iframe | Only Swagger UI |

Saying "we protect against CSRF everywhere" when the API is bearer-authenticated is not a stronger
answer than the table above. It is a weaker one — it means you applied the control without checking
the precondition.

---

## 2. CSRF: the precondition, and the two endpoints that meet it

**CSRF exists because browsers attach cookies automatically.** An attacker's page causes your
browser to issue a request to our API; the browser helpfully attaches the session cookie; the
request is authenticated even though the attacker never saw the credential.

Therefore:

- ✗ **Not vulnerable:** anything authenticated by `Authorization: Bearer`. The browser does not
  attach that header by itself — JavaScript must, and the same-origin policy stops an attacker's
  script from reading or scripting our origin. **Most of this API is in this category.**
- ✓ **Vulnerable:** anything authenticated by a **cookie**. Here that is exactly two endpoints —
  `POST /auth/refresh` and `POST /auth/logout` — because the refresh token is deliberately an
  httpOnly cookie (Phase 7).

So [`CsrfGuard`](../src/common/guards/csrf.guard.ts) is **opt-in**, the opposite of the global
`JwtAuthGuard`'s deny-by-default:

```ts
@CsrfProtected()          // ← only on refresh and logout
@Post('refresh')
```

The test that proves the *exemption* is as important as the ones that prove the check:

```ts
it('does NOT require a CSRF token on bearer-authenticated routes', ...)
```

### Defence in depth: `SameSite` first, token second

The refresh cookie is already `SameSite=strict`. In a modern browser **that alone defeats CSRF**.

So why the guard as well? Because `SameSite` is enforced by the **client**:

- old browsers ignore it entirely;
- `SameSite=none` becomes necessary the moment the API and the frontend are on different sites — and
  then the protection is gone, silently, from a config change made for an unrelated reason;
- some proxies and embedded webviews behave inconsistently.

A server-enforced check does not depend on the client cooperating. Two independent mechanisms, one
of which is under our control.

### The double-submit cookie pattern

1. Server sets a random token in a **non-httpOnly** cookie.
2. JavaScript on our origin reads it and echoes it in a request **header**.
3. Server requires cookie and header to match.

**Why it works:** an attacker's page can *cause* the cookie to be sent — that is the whole problem —
but cannot *read* it, because the same-origin policy blocks cross-origin cookie access. Without the
value it cannot set the header.

**Why the cookie is deliberately not httpOnly** — the exact opposite of the refresh cookie — is the
part people get wrong in interviews. **This token is not a credential.** It carries no authority; it
only proves the request came from a page that could read our origin. Making it httpOnly would break
the pattern, because our own JavaScript could not read it either.

**Its known weakness:** an attacker with a *subdomain* XSS can often set cookies on the parent
domain, forging a matching pair. The stronger variants are the **signed** double-submit (HMAC the
token with a server secret and the session id) or the synchroniser-token pattern with server-side
state. `csurf` is deprecated and unmaintained, which is why this is 40 lines of our own rather than
a dependency.

### Constant-time comparison

```ts
if (cookieBuffer.length !== headerBuffer.length || !timingSafeEqual(cookieBuffer, headerBuffer))
```

`===` on a secret leaks, through timing, how many leading characters matched — which over enough
samples reconstructs the value. `timingSafeEqual` throws when lengths differ, so the length check
comes first. (The lengths are not secret; both values are ours.)

---

## 3. NoSQL injection

The MongoDB version of the attack is not string concatenation — it is untrusted input arriving where
an **operator** is expected:

```jsonc
{ "email": { "$gt": "" }, "password": { "$gt": "" } }   // matches any user
```

Two independent defences, and both matter:

**1. The global `ValidationPipe`** (Phase 6). `@IsString()` on `email` rejects an object outright,
and `whitelist: true` strips anything not declared. The attack never reaches the repository.

**2. Regex escaping** for search, where user input legitimately becomes part of a query:

```ts
// src/database/schema.helpers.ts
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
```

Without it, `search=.*` is a full scan, and a crafted pattern like `(a+)+$` is a **ReDoS** — a
single request that pins a CPU core. This is not theoretical; it is one of the more common ways a
search endpoint becomes an availability bug.

Used in all three searchable repositories:
[users](../src/users/repositories/mongo-users.repository.ts#L206),
[projects](../src/projects/repositories/mongo-projects.repository.ts#L144),
[tasks](../src/tasks/tasks.repository.ts#L335).

`strictQuery: true` in `baseSchemaOptions` (Phase 5) is the third layer: an undeclared field in a
filter is stripped rather than silently matching nothing.

---

## 4. Mass assignment

The classic: `User.create(req.body)` where the body contains `{"role": "admin"}`.

The global pipe closes it structurally, not by discipline:

```ts
new ValidationPipe({
  whitelist: true,             // strip undeclared properties
  forbidNonWhitelisted: true,  // and reject the request outright
  transform: true,
})
```

`whitelist` alone would silently drop `role` — safe, but the client never learns their request was
wrong. `forbidNonWhitelisted` turns it into a 400 that names the offending field, which is both
safer and kinder.

The second half is that **identity does not come from the body at all**. `PATCH /auth/me` reads the
user id from the validated JWT, never from `dto.userId`. A DTO field that could name *someone else*
is an authorization bug waiting for the first careless edit.

---

## 5. Password and token handling

| Concern | Decision | Why |
| --- | --- | --- |
| Password hashing | **bcrypt**, cost 12 | Deliberately slow. A fast hash (SHA-256) lets an attacker with the dump try billions of candidates per second. |
| Refresh token hashing | **SHA-256**, not bcrypt | The token is 32 bytes of CSPRNG output — it has no guessable structure, so there is nothing for a slow hash to protect against, and bcrypt on every refresh is real latency. **Slow hashing is for low-entropy secrets.** |
| Token comparison | `timingSafeEqual` | See above. |
| Access vs refresh secrets | **Two different secrets**, enforced by Joi at boot | If they were equal, an access token would be accepted as a refresh token — trivial, permanent privilege escalation. The config schema fails startup if they match. |
| Refresh token delivery | httpOnly, `SameSite=strict`, `secure` in production | JavaScript cannot read it, so an XSS cannot steal the long-lived credential. |
| Reuse detection | Token families, rotated on every refresh | A replayed token means the family is compromised → revoke the whole family. |

### User enumeration

```ts
const DUMMY_HASH = '$2b$12$...';  // hashed once at module load
```

Login compares against a dummy hash when the user does not exist, so the response time is the same
either way. Without it, "no such user" returns in 2ms and "wrong password" in 250ms — and an
attacker enumerates your entire user list with a stopwatch. The error message is identical too:
*"Invalid credentials"*, never *"no account with that email"*.

---

## 6. Secrets

**Never hardcoded. Not once, anywhere in this repository.**

- `MONGODB_URI` has **no default** in the Joi schema — the app refuses to boot without it, rather
  than silently connecting to `localhost` in production.
- JWT secrets have no defaults and must differ from each other.
- `docker-compose.yml` contains obviously-fake development values with a comment saying so; real
  secrets come from the orchestrator's secret store.
- `.dockerignore` excludes `.env` and `.env.*`. **This is load-bearing:** `COPY . .` would bake a
  secret into an image layer, and deleting the file in a later instruction does **not** remove it —
  layers are immutable, and anyone with the image can extract it with `docker history`. A secret
  that ever entered an image is leaked, permanently, and must be rotated.
- `.env` is git-ignored; `.env.example` is committed as documentation.

**Validate at boot, not at first use.** A missing secret should crash the process at second zero, in
front of a deploy pipeline that can roll back — not at 3am on the first request that happens to need
it.

---

## 7. Transport and headers

```ts
app.set('trust proxy', 1);
app.use(helmet());
app.use(compression());
app.enableCors({ origin: allowList, credentials: true });
```

**`trust proxy` is a security control, not a logging nicety.** Rate limiting (Phase 10) buckets by
client IP. Behind a load balancer without it, every request appears to come from the balancer — so
either you rate-limit your entire user base as a single client, or you disable the limit. It also
drives `req.secure`, and therefore whether the refresh cookie gets the `secure` flag.

Set it to a *specific* hop count (`1`), never `true`. `true` trusts the whole `X-Forwarded-For`
chain, which the client controls — so anyone can spoof their IP and bypass the rate limit.

**Helmet** sets `X-Content-Type-Options: nosniff`, HSTS, `Referrer-Policy`, frame options, a default
CSP, and removes `X-Powered-By`. For a pure JSON API the first two carry most of the value; CSP
matters because we serve HTML for Swagger UI.

**CORS with `credentials: true` may not use `origin: '*'`** — the spec forbids the combination, and
allowing every origin to send credentials would be a standing invitation. Hence the explicit
allow-list from configuration.

**Compression:** cheap on JSON lists, but never compress responses that mix secrets with
attacker-controlled input over TLS (the **BREACH** attack). Not a concern for a
token-in-header API — which is exactly the kind of precondition check this whole phase is about.

---

## 8. Information disclosure in errors

[`AllExceptionsFilter`](../src/common/filters/all-exceptions.filter.ts) never returns a stack trace
or a driver message to the client. A `MongoServerError` with code 11000 becomes
`409 Conflict: email already in use`; anything unrecognised becomes a flat
`500 Internal server error` — logged in full, server-side, with the correlation id so it is still
diagnosable.

The related judgement call, from Phase 8: **404 vs 403.** Returning 403 for a project you are not a
member of confirms the project exists. Returning 404 does not. This project returns **404 for
resources you cannot see** and 403 only where membership is already established — so the response
never leaks the existence of something you have no relationship with.

---

## 9. Rate limiting and availability

Phase 10's throttler is a security control as much as a capacity one: it is what makes credential
stuffing and brute-force password guessing expensive. Two details worth restating:

- **Key by user id when authenticated, IP when not.** IP-only limiting punishes everyone behind one
  NAT and does nothing against a botnet.
- **Login gets a much tighter limit than reads**, because the cost of a successful brute force is
  categorically different from the cost of a scraped list.

---

## 10. Why?

| Question | Answer |
| --- | --- |
| **Why a hand-written CSRF guard?** | `csurf` is deprecated and unmaintained. The double-submit pattern is 40 lines and we need it on two routes. |
| **Why not another approach?** | A synchroniser token with server-side state is stronger but needs a session store for an otherwise stateless API. `SameSite` alone is client-enforced. |
| **Trade-offs** | The double-submit pattern is weak against subdomain XSS; the client must read a cookie and set a header, which is friction for the frontend. |
| **When to use** | Any cookie-authenticated state-changing endpoint. |
| **When to avoid** | Pure bearer APIs — the control protects nothing and breaks every non-browser client. |

---

## 11. Express comparison

| Express | NestJS |
| --- | --- |
| `csurf` middleware applied globally, then `app.use('/api/webhooks', skipCsrf)` exceptions | A guard plus a `@CsrfProtected()` decorator — the policy is *on the route it protects* |
| Validation is per-route middleware you must remember to add | One `APP_PIPE`; forgetting is not possible |
| Auth is middleware you must remember to add | Global `APP_GUARD` with explicit `@Public()` — **deny by default** |
| Error shape depends on which middleware caught it | One exception filter, one shape |

The pattern across all four rows: in Express, security is something you **remember to apply**; in
Nest it is something you **explicitly opt out of**. Every real breach story where "that one endpoint
was missed" is a failure of the first model.

---

**Next:** [Phase 17 — Docker & CI/CD](phase-17-docker-ci.md)
