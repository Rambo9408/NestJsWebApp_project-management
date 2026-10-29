# Phase 8 — Authorization, guards and RBAC

> **Goal:** both halves of authorization — the easy one (global roles) and the one most
> implementations hand-wave (resource-level permissions).

Verified: `lint` ✅ · `tsc` ✅ · **96 tests passing** (was 86), incl. 10 authorization e2e tests ✅ ·
suite runtime cut from ~10 min to **30 s** by sharing one `mongod` across suites ✅

```
src/common/decorators/roles.decorator.ts     @Roles(Role.ADMIN)
src/common/guards/roles.guard.ts             global, after JwtAuthGuard
src/projects/guards/project-access.guard.ts  @ProjectRoles(Role.MANAGER) — resource-level
src/auth/dto/update-me.dto.ts + PATCH /auth/me
src/common/guards/authorization.integration.spec.ts
test/global-setup.ts · test/global-teardown.ts · test/shared-mongo.ts
```

---

## 1. Authentication vs authorization

| | Question | Failure |
| --- | --- | --- |
| **Authentication** (Phase 7) | Who are you? | **401** |
| **Authorization** (Phase 8) | May you do *this*? | **403** |

The codes are not interchangeable, and the difference is **behavioural**: a client seeing 401 should
refresh its token and retry; a client seeing 403 must **not**, because nothing about the request will
change the answer. Returning 401 for an authorization failure sends clients into a refresh loop.

---

## 2. Guard order is load-bearing

```ts
{ provide: APP_GUARD, useClass: JwtAuthGuard },   // populates request.user
{ provide: APP_GUARD, useClass: RolesGuard },     // reads request.user
```

Multiple `APP_GUARD` providers run in **registration order**. Swap these and every `@Roles()` route
403s with `user` undefined. This is the one place in Nest where provider *order* genuinely matters —
everywhere else the container resolves by dependency graph, not position.

---

## 3. Deny-by-default for authN, allow-by-default for authZ

`JwtAuthGuard` denies unless `@Public()`. `RolesGuard` **allows** when there is no `@Roles()`. That
looks contradictory; it is not:

- **Authentication** must be deny-by-default: a route with no opinion should still require a valid
  token, because "anyone at all" is almost never right.
- **Authorization** cannot be, without a policy for every route. "No `@Roles()` means nobody" makes
  every ordinary endpoint 403 until decorated, and the practical result is people writing
  `@Roles(ADMIN, MANAGER, MEMBER)` everywhere — noise that means nothing and hides the routes where
  the policy is real.

The security floor is that the caller is **authenticated**; role checks narrow from there.

---

## 4. `getAllAndOverride` vs `getAllAndMerge`

```ts
this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);
```

| Method | Behaviour | Use for |
| --- | --- | --- |
| `getAllAndOverride` | most specific wins | flags and policies |
| `getAllAndMerge` | concatenates both levels | accumulating lists |
| `get` | one target only | narrow cases |

Choosing wrong is a real bug: with `merge`, a class-level `@Roles(ADMIN)` plus a method-level
`@Roles(MEMBER)` would allow **both** — quietly *widening* access, which is the dangerous direction.

---

## 5. Resource-level authorization — the half that matters

`RolesGuard` answers *"is this user a MANAGER?"*. Real systems need:

> **"Is this user a manager OF THIS project?"**

A global role cannot answer that, because the answer depends on the resource. That is why
`Project.members` carries its own role (Phase 2), and why collapsing global and per-project roles
into one field is the classic RBAC modelling mistake.

```ts
@UseGuards(ProjectAccessGuard)                 // membership required
@ProjectRoles(Role.MANAGER)                    // ...with this project role
@Patch(':id')
```

One guard serves three route shapes because it looks for the project id in **params, body and
query** — which is how `POST /tasks { projectId }` reuses the same guard as
`PATCH /projects/:id`. (The risk to watch: a route where the id appears in two places with different
values.)

### Three deliberate decisions in that guard

**404, not 403, for a non-member.** A 403 confirms the project exists, turning the endpoint into an
enumeration oracle. 404 says "nothing here for you". Note the asymmetry: a *member* attempting a
manager-only action gets **403**, because their access to the project is not a secret — only that
action is denied.

**A global ADMIN bypasses membership.** A product decision, stated explicitly rather than left
implicit: admins support customers and clean up abandoned projects, and requiring them to add
themselves as a member first means mutating customer data to read it. The cost is that an admin token
is a skeleton key — so admin actions must be **audited** (Phase 13) and admin accounts need MFA.
"Admins bypass" without "admins are audited" is how you get a breach you cannot reconstruct.

**It costs a duplicate query.** The guard loads the project, then the service loads it again. Named
in the code rather than hidden, with the three mitigations ranked: attach it to the request; cache
the read (Phase 10); or accept it. "I added a guard and doubled my database reads" is a real
regression nobody notices until it is a p99 problem.

### Guard or service check?

| Use a **guard** | Use a **service check** |
| --- | --- |
| The policy is a property of the **route** | The decision needs data the service loads anyway |
| Decidable from the request + one lookup | The rule must also hold for **non-HTTP** callers |
| Runs before pipes; declarative; visible in the controller | A queue worker or WebSocket handler never passes through the HTTP pipeline |

---

## 6. Design an endpoint so the unsafe case cannot be expressed

`PATCH /users/:id` is now **admin-only**. Users edit themselves through `PATCH /auth/me`, which takes
**no id at all** — it comes from the token.

> An endpoint that cannot express the unsafe case does not need a check for it.

That is cheaper and more durable than an `if (isSelf || isAdmin)` branch that has to stay correct
through every future edit. Each endpoint also gets its own DTO (`UpdateMeDto` cannot touch `role`)
and its own audit trail.

There is also deliberately **no API path to make yourself an admin**: registration forces `MEMBER`
and `PUT /users/:id/role` is admin-only. The first admin comes from a migration or an operator. The
test promotes one directly in the database and **re-logs in** — because a JWT is a snapshot, and the
old token still says `member`. That is Phase 7's staleness trade-off, visible.

---

## 7. When RBAC is not enough

| Model | What it is | When to move on |
| --- | --- | --- |
| **RBAC** | role → actions | Breaks as soon as access depends on *which* resource |
| **RBAC + membership** (this project) | global role for coarse policy, per-resource membership for the rest | Covers most real applications |
| **PBAC** | `@RequirePermission('task:delete')`; roles become bundles | Once roles start multiplying |
| **ABAC / policy engines** (OPA, Cedar, CASL) | rules over attributes, time, state | Powerful; a large operational commitment |

The senior answer to "how would you do authorization?" is not naming the most sophisticated option —
it is saying which the system needs and why, and noting that moving up the list is easy *if the
checks live in guards rather than scattered through handlers*.

---

## 8. Phase 8 interview questions

**1. Authentication vs authorization, and their status codes?** Who you are (401) vs what you may do
(403). The distinction drives client retry behaviour.

**2. How does a guard read route metadata?** `Reflector` reads what `SetMetadata` wrote —
`getAllAndOverride([handler, class])`.

**3. Why does guard registration order matter?** `APP_GUARD` providers run in registration order, and
`RolesGuard` depends on `request.user` existing.

**4. Why is `RolesGuard` allow-by-default when `JwtAuthGuard` is deny-by-default?** Authentication has
a universal safe default; authorization does not, and forcing one produces meaningless decorators
everywhere.

**5. `getAllAndOverride` vs `getAllAndMerge`?** Most-specific-wins vs concatenate. Merge on a role
list silently widens access.

**6. Your app has global roles and per-project roles. How do you model and enforce that?** Two
separate concepts: `User.role` and `Project.members[].role`. Enforce with two guards — one global,
one resource-level that loads the resource and checks membership.

**7. Should a non-member get 403 or 404?** 404 when the existence of the resource is itself
sensitive; 403 when the caller can already see the resource and only the action is denied. Pick per
endpoint, deliberately.

**8. Should admins bypass resource permissions?** It depends, and either answer needs its
consequences: bypass means auditing and MFA are mandatory; no-bypass means an explicit,
also-audited "grant myself access" flow.

**9. Guard vs service-level authorization?** Guard for route-level policy decidable from the request;
service for rules that need loaded data or must also hold for queue/WebSocket callers.

**10. How do you avoid the duplicate query a resource guard causes?** Attach the loaded entity to the
request, cache the read, or accept the cost — and *measure* before deciding.

**11. How would you migrate from roles to permissions?** Introduce `@RequirePermission()` plus a
permission set on the user (or derived from the role), keep `@Roles()` working during the migration,
and move endpoint by endpoint. Feasible only because the checks are centralised in guards.

**12. A user was demoted but can still perform admin actions. Why?** The role is in the JWT, which is
a snapshot. Wait for expiry, force a re-login, keep a "permissions changed at" timestamp, or read the
role from the database on sensitive routes.

---

## 9. Phase 8 scenarios

**A — "A customer could read another customer's project."** Almost certainly a route with the global
`RolesGuard` but no resource guard — the caller had the right *role*, just not the right *project*.
Audit every route that takes a resource id and confirm it has a resource-level check. Then ask why it
was possible to forget: if resource guards are opt-in per route, someone eventually will.

**B — "`?memberId=` lets anyone list another user's projects."** A filter that is really an
authorization rule must not be client-controlled. For non-admins, force the filter to the
authenticated user's id and ignore the parameter.

**C — "We need 'a manager, but only during business hours, and not on archived projects'."** RBAC has
run out. That is ABAC — a policy engine (Cedar, OPA) or CASL. The migration is tractable *because*
every check already lives in a guard.

**D — "Our admin did something destructive and we cannot reconstruct it."** The admin bypass without
the audit half. Add the activity log (Phase 13), record actor + action + resource + before/after on
every privileged operation, and treat "admin bypassed a permission check" as a first-class logged
event.

**E — "Adding a guard doubled our database load."** The guard loads the resource and the service
loads it again. Cache it, attach it to the request, or measure and accept.

---

**Next:** Phase 9 — interceptors, middleware and exception filters. The rest of the request pipeline:
a correlation-id middleware, logging and timing interceptors, a response-envelope interceptor, and a
global exception filter that turns every error into one consistent shape.
