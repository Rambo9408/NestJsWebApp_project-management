# Phase 7 — Authentication

> **Goal:** a complete, honest JWT implementation — not "sign a token and check it", but rotation,
> reuse detection, revocation, and the trade-offs behind each.

Verified: `lint` ✅ · `tsc` ✅ · **86 tests passing** (was 73), including 13 auth e2e tests against a
real MongoDB ✅ · `build` ✅

```
src/auth/  auth.service.ts  auth.controller.ts  auth.module.ts  auth.types.ts
           schemas/refresh-token.schema.ts      dto/auth.dto.ts
           strategies/{jwt,local}.strategy.ts   guards/{jwt-auth,local-auth}.guard.ts
           decorators/{public,current-user}.decorator.ts
           auth.integration.spec.ts
```

---

## 1. The complete flow

```
LOGIN
  POST /auth/login { email, password }
      │
      ▼ JwtAuthGuard (global) sees @Public() → stands down
      ▼ LocalAuthGuard → LocalStrategy.validate()
      ▼ AuthService.validateCredentials() → hasher.compare()
      ▼ request.user = { id, email, role }
      ▼ handler → AuthService.login() → token pair
      ▼ refresh token → httpOnly cookie   ·   access token → JSON body

AUTHENTICATED REQUEST
  GET /api/v1/tasks    Authorization: Bearer <access>
      │
      ▼ JwtAuthGuard (global) → not @Public()
      ▼ JwtStrategy: verify signature + expiry → validate(payload)
      ▼ request.user = { id, email, role }        ← NO database read
      ▼ @CurrentUser() user → handler
```

---

## 2. Two tokens, because one cannot do both jobs

| | Access | Refresh |
| --- | --- | --- |
| Lifetime | 15 min | 7 days |
| State | Stateless (signature only) | **Stored** (hashed row) |
| Sent | Every request | Only to `/auth/refresh` |
| Revocable | **No** | Yes |
| Transport | `Authorization` header | httpOnly cookie |

**The core limitation to be able to state:** a stateless token cannot be revoked. A stolen access
token is valid until it expires, full stop. So "logout" means *delete the refresh row and wait up to
15 minutes*. If you need instant access-token revocation, you need a denylist checked on every
request — which reintroduces the database read JWT was meant to avoid. That is the answer to "how do
you log a user out immediately?", and the honest version includes the cost.

**Why two different secrets** (enforced at boot by `env.validation.ts`): with one secret, a refresh
token also verifies as an access token — so a stolen long-lived credential works directly against
every protected endpoint, removing the entire point of the split.

**Why the header for access and a cookie for refresh** — the two attacks are mirror images:

- A cookie is sent **automatically** by the browser → exposed to **CSRF**.
- A header token must live where JavaScript can read it → exposed to **XSS**.

So: short-lived access token in memory + header; long-lived refresh token in an httpOnly cookie that
script cannot touch. Neither storage is safe against everything; the split bounds what each
compromise costs.

---

## 3. Refresh rotation with reuse detection

Most tutorials stop at rotation. Rotation alone means a thief who refreshes first locks out the real
user, with **no signal that anything happened**.

```
1. Verify signature + expiry            → is this our token at all?
2. Look up the row by SHA-256 hash      → has it been revoked?
3. Row is REVOKED → REUSE DETECTED      → revoke the ENTIRE FAMILY, 403
4. Otherwise: revoke this one, issue a successor in the same family
```

A **family** is every token descended from one login. On reuse you cannot tell victim from thief, so
you log both out — the OAuth 2.0 Security BCP recommendation. Proven in the spec: the spent token
gets 403, and so does its descendant.

**The honest caveat:** a legitimate client retrying after a network timeout can trigger a false
positive. Mitigations are a short grace window on the immediately-previous token, or client-side
de-duplication of concurrent refreshes. Both trade a little security for far fewer support tickets.

### Why SHA-256 and not bcrypt for the stored token

This is the question interviewers like, and the answer is about **entropy**:

- A **password** is low-entropy and human-chosen — an attacker with the hash can guess it, so
  bcrypt's slowness is what makes guessing expensive.
- A **refresh token** is a 256-bit value we generated — there is nothing to guess.

Plus a practical reason: bcrypt embeds a random salt, so the same input hashes differently every
time and **cannot be used as a lookup key**.

> Fast hash for high-entropy secrets, slow hash for human-chosen ones.

### The TTL index

```ts
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
```

`0` means "delete when the date in the field passes" (a positive value means N seconds *after*).
Two caveats: the remover runs about once a **minute**, so never rely on it for security timing —
`AuthService.refresh` checks `expiresAt` in code too; and the field must be a real `Date`, or nothing
ever expires.

---

## 4. Deny by default

```ts
{ provide: APP_GUARD, useClass: JwtAuthGuard }   // every route protected
@Public()                                         // explicit opt-out
```

The alternative — `@UseGuards(JwtAuthGuard)` per route — is allow-by-default, and it **fails in the
worst direction**: the day someone adds an endpoint and forgets, it is silently open to the internet
and works perfectly. With deny-by-default, forgetting is a 401 in the first test run.

> **Fail closed, not open.** One of the highest-value five-line decisions in a codebase.

`@Public()` is deliberately conspicuous in a diff — reviewers stop on it, which is the point.

**Why `APP_GUARD` and not `useGlobalGuards`:** the guard injects `Reflector` to read the `@Public()`
metadata. `app.useGlobalGuards(new JwtAuthGuard(???))` cannot work, because you would have to
construct the Reflector by hand. (Note also that `APP_*` providers are **hoisted** — declaring one in
`AuthModule` still applies application-wide.)

---

## 5. Identity comes from the token, never from the payload

Phase 7 removed three fields from DTOs:

```
CreateProjectDto.ownerId    →  @CurrentUser('id') ownerId
CreateTaskDto.createdById   →  @CurrentUser('id') createdById
CreateCommentDto.authorId   →  @CurrentUser('id') authorId
```

Any field that determines ownership or permission and is accepted from a request body is a
privilege-escalation vector. A client could create a project owned by someone else, and once
membership drives access (Phase 8), grant themselves a way into another team's data.

And `RegisterDto = OmitType(CreateUserDto, ['role'])`, because **`whitelist: true` does not save
you** — `role` *is* on `CreateUserDto`'s allow-list. The protection is a **narrower DTO for the
public endpoint**, plus `Role.MEMBER` forced in the service. One DTO per *(operation, audience)*
pair, not one per entity.

---

## 6. Guards, strategies and Passport

| Piece | Responsibility |
| --- | --- |
| **Guard** (`CanActivate`) | Decides whether the request proceeds |
| **Strategy** | Extracts + verifies credentials, returns a user |
| **Passport** | Glue — runs the strategy, puts the result on `request.user` |

`PassportStrategy(Strategy, 'jwt')` is a **mixin factory**: it returns a base class wired into
passport-jwt and registered under the name `'jwt'`, which is what `AuthGuard('jwt')` looks up.

**Guard vs middleware — the interview question.** Express middleware could check a token. What a
guard has that middleware does not:

- `ExecutionContext` — the same guard works for HTTP, WebSocket and microservice transports.
- `Reflector` — it can read **route metadata**, which is what makes `@Public()` and `@Roles()`
  possible. Middleware has no idea which handler it is about to run.
- Dependency injection.
- It runs **after routing**, so it knows a route matched at all.

**Is Passport worth it?** For JWT alone, verifying by hand is ten lines. Passport earns its place
with *several* mechanisms — local, JWT, refresh, API key, OAuth, SAML — because it gives them one
shape and 500+ ready-made strategies. This project has three.

**No database read in `JwtStrategy.validate()`** — that is the point of a stateless token. The cost
is staleness: a demoted user keeps their old role until the token expires. If that is unacceptable:
shorten the TTL, keep a small Redis denylist, or load the user on sensitive routes only. "Always read
the user from the database" throws away the reason you chose JWTs.

---

## 7. The security details that are easy to miss

**User enumeration.** The naive implementation returns early for an unknown email (~2ms) and hashes
for a known one (~250ms). The response time now tells an attacker which accounts exist — turning a
credential-stuffing list from a guess into a target list. Fix: hash against a **dummy hash** on the
absent path so both cost the same, *and* return the same message. The dummy must be a valid hash of
the algorithm in use, or `compare` short-circuits and the timing difference reappears.

**Change password** requires the current one (otherwise a stolen access token becomes permanent
account takeover) and **revokes every session** (a password change is usually a reaction to suspected
compromise).

**Cookie attributes**, each a decision: `httpOnly` (XSS cannot read it — the whole reason to use a
cookie), `secure` (HTTPS only), `sameSite: 'strict'` (the CSRF defence), `path: '/api/v1/auth'` (not
attached to every request), `maxAge` (without it, a *session* cookie that quietly breaks "remember
me"). And `clearCookie` must use the **same attributes**, or the browser keeps the old one — a common
"logout does not work" bug.

**`@Res({ passthrough: true })`**, not plain `@Res()`. Plain `@Res()` opts out of Nest's response
handling entirely: your `return` value is ignored, the request hangs unless you call `res.json()`
yourself, and body-transforming interceptors (Phase 9) silently stop working.

**Second hasher instance.** `AuthModule` re-binds `PASSWORD_HASHER` because `UsersModule` does not
export it. That means **two instances** of `BcryptPasswordHasher` — harmless here (stateless), a bug
for anything holding a connection. The alternatives are exporting it (widening UsersModule's API) or
extracting a small shared module (the right move once a third consumer appears). Stated in the code
rather than left to be discovered.

---

## 8. Phase 7 interview questions

**1. Why two tokens?** Access is stateless and fast but unrevocable, so it must be short-lived.
Refresh is stored and therefore revocable, so it can be long-lived, and it is sent rarely.

**2. How do you log a user out immediately?** You cannot, with pure JWT — you revoke the refresh
token and wait for the access token to expire. For instant revocation you need a denylist checked
per request, which costs you statelessness.

**3. Where do you store tokens in a browser?** Refresh in an httpOnly cookie (XSS cannot read it),
access in memory + `Authorization` header (CSRF cannot send it). localStorage for either is the
common mistake, because XSS drains it.

**4. What is refresh rotation, and what is reuse detection?** Rotation: each refresh issues a new
token and revokes the old. Reuse detection: presenting a revoked token means theft, so the entire
family is revoked.

**5. Why hash the refresh token with SHA-256 and not bcrypt?** Entropy — there is nothing to guess in
a 256-bit random value — and bcrypt's random salt makes it unusable as a lookup key.

**6. Why must the access and refresh secrets differ?** Otherwise a refresh token verifies as an
access token, and a stolen long-lived credential works everywhere.

**7. What goes in a JWT payload?** Only what you need to authorise without a database read; nothing
secret — it is signed, not encrypted, and anyone can decode it. Keep it small; it is sent every
request.

**8. `@Public()` and a global guard — why that way round?** Deny by default. Forgetting to protect an
endpoint should be impossible; forgetting to unprotect one should be a loud 401.

**9. `APP_GUARD` vs `useGlobalGuards`?** The provider form is built by the container, so the guard
can inject (`Reflector`, config, repositories). The imperative form cannot.

**10. Guard vs middleware?** `ExecutionContext` (transport-agnostic), `Reflector` (route metadata),
DI, and it runs after routing.

**11. What does a Passport strategy return, and where does it go?** Whatever `validate()` returns
becomes `request.user`. Returning null or throwing produces 401.

**12. Why is there no database read in `JwtStrategy.validate()`?** Statelessness. The trade-off is
staleness of the claims; mitigate with a short TTL, a denylist, or per-route lookups.

**13. How do you prevent user enumeration on login?** Identical messages *and* identical timing —
hash against a dummy value when the user does not exist. Also rate-limit the endpoint (Phase 10).

**14. Why does changing a password revoke sessions?** Because it is usually a response to
compromise; leaving other refresh tokens alive keeps the attacker in.

**15. A user says "I logged out but the app still works for 10 minutes".** Expected: the access token
is stateless. Confirm the refresh token was revoked, then decide whether a denylist is worth it.

**16. How would you add "log out of all devices"?** Revoke every non-revoked refresh row for the user
— which is exactly why the sessions are stored, and why they carry user-agent and IP so a user can
recognise them.

---

## 9. Phase 7 scenarios

**A — "JWT works locally but fails in production."** Work through it in order: is the secret actually
set in the production environment (or is `ignoreEnvFile` hiding a missing var)? Do all instances
share the same secret — a load-balanced deploy where one pod has an old value produces *intermittent*
401s, which is the classic signature. Is a proxy stripping the `Authorization` header? Is
`clockTolerance` an issue — a server whose clock is 60s fast rejects freshly-issued tokens as
`iat` in the future. Is the cookie failing because `secure: true` on plain HTTP?

**B — "Someone's refresh token leaked."** Reuse detection already killed the family on the second
use. Then: confirm from the stored `userAgent`/`ip` whether it was a real device, force
`logout-all`, and look at how it leaked — XSS (so the token was readable by script, meaning it was
not httpOnly) or a logging/monitoring sink capturing request bodies.

**C — "Login is slow under load and the whole API slows with it."** bcrypt is CPU-bound and Node runs
one thread. At cost 12 (~250ms) and 40 concurrent logins, everything queues. Rate-limit auth
endpoints hard (login is the one route where an attacker chooses your CPU spend), use the async API,
and at volume move hashing off the API process.

**D — "We need SSO with Google next quarter."** This is where Passport pays off: add
`passport-google-oauth20` as another strategy, map the profile onto a user record, and issue *your
own* tokens from the same `AuthService.issueTokens`. The rest of the application does not change,
because everything downstream depends on `request.user`, not on how it got there.

**E — "Our access tokens are 4KB and mobile clients complain."** Someone put the user's permissions
list (or their whole profile) in the payload. Put an id and a role in the token; fetch the rest.
Every claim is bytes on every request, forever.

---

**Next:** Phase 8 — authorization. `@Roles()` + `RolesGuard` via `Reflector`, and the harder half:
**resource-level** authorization, where "is this user a MANAGER?" becomes "is this user a manager
*of this project*?" — which is where most implementations hand-wave.
