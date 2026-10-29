# Phases 10 & 11 — Authorization and RBAC

> Covers brief Part 24. Every rule here **mirrors** a rule the NestJS backend
> enforces — and the audit means those backend rules are now real.

---

## The rule that governs this entire phase

> **Nothing in the frontend authorization layer is a security control.**

Every rule in `permissions.ts` exists to decide what UI to render, so a user is
never shown a button that will 403. Anyone can delete the module in DevTools,
edit the bundle, or use curl.

**Verified**, not asserted:

```
GET /users         as member → 403
GET /activity-logs as member → 403
   (promote to admin in the DB, re-login)
GET /users         as admin  → 200
GET /activity-logs as admin  → 200
```

**The interview answer must be unambiguous:** frontend authorization is a
*usability* feature. It prevents confusion, not access. If the only thing
stopping an action is a hidden button, the action is not protected.

---

## 1. The genuinely subtle part: two role systems, one enum

The backend reuses `Role` for two different things, and conflating them is the
easiest mistake available:

| | Lives on | Means |
|---|---|---|
| **Global role** | `User`, travels in the JWT | `admin` = platform administrator, bypasses every project check |
| **Project role** | `ProjectMember`, one per project | What `@ProjectRoles(Role.MANAGER)` checks |

A user can be **MANAGER of project A and MEMBER of project B simultaneously**.

So *"is this user a manager?"* is not a question with an answer. *"Is this user
a manager **of this project**?"* is.

**That is why `can()` takes a context rather than just a user** — a permission
check without a subject is usually a bug. There's a test that passes
`projectRole: MANAGER` against `users:manage` and expects `false`, pinning
exactly this.

---

## 2. The rules, each citing its source

```ts
can(user, capability, context)   // pure function — no React
```

| Capability | Rule | Backend source |
|---|---|---|
| `users:*`, `activity-logs:read`, `health:detail` | global ADMIN | `@Roles(Role.ADMIN)` on the class |
| `project:read` | any member | `ProjectAccessGuard`, no `@ProjectRoles` |
| `project:update`/`archive`/`members:manage` | project MANAGER | `@ProjectRoles(Role.MANAGER)` |
| `task:create`/`update`/`delete` | any member | `TaskAccessGuard`, no `@ProjectRoles` |
| `comment:delete` | author **or** project MANAGER **or** global ADMIN | `TasksService.removeComment` |

**`task:delete` being open to any member looks like an oversight and isn't** — it
mirrors the backend exactly. A shared project means shared work. The test pins
it so that tightening it later is a conscious change *on both sides*.

### Three details worth stealing

**The admin short-circuit is copied verbatim** from the guards:

```ts
if (user.role === Role.ADMIN) return true;
```

If client and server disagree about what admin means, the UI shows buttons that
403 — the exact confusion this file exists to prevent.

**`projectRole` is `Role | null | undefined` and all three differ:**

```
Role.X      the caller's role in the project under consideration
null        checked — not a member
undefined   no context supplied — we don't know
```

Collapsing them would make "not a member" and "didn't ask" indistinguishable.
Both deny, but for different reasons, and a call site that *forgets* the context
gets a hidden button rather than a wrongly-shown one — the correct way to fail.

**Exhaustiveness via `never`, not `default: return false`:**

```ts
const exhaustive: never = capability;
```

`default: return false` is worse in a security-adjacent file: a new capability
would silently deny everyone, the feature would look *broken* rather than
*unguarded*, and somebody would "fix" it by loosening a rule.

---

## 3. Two gates, deliberately different

### `<RequirePermission>` — UI

```tsx
<RequirePermission capability="project:update" context={{ projectRole }}>
  <EditButton />
</RequirePermission>
```

Why a component rather than `{can('x') && <Button/>}`: the *reason* the button is
conditional lives in the markup; policy changes happen in one place; and it can't
be half-done (the inline form invites the Phase 2 falsy-zero bug and invites
forgetting the check on the fifth button someone adds).

**Hide or disable?** A real decision, and it differs:

- **Hide** when the permission is unattainable in this context. A member won't
  become a manager by reading a tooltip.
- **Disable + explain** when it *is* attainable, or when hiding makes the UI look
  broken — a toolbar with three buttons for one user and one for another is
  disorienting.

Hiding is the default because it discloses less: a disabled "Delete project"
button tells a member that deleting projects is something someone can do here.

### `<RequireRole>` — routes, and it does **not** redirect

```
RequireAuth              signed in?    → /login if not
 └── RequireRole(ADMIN)  an admin?     → explanation if not
      └── /admin/*
```

**Sending a signed-in non-admin to `/login` is actively wrong.** They *are*
logged in, so the login form either bounces them straight back (a loop) or
invites credentials that won't help.

> **Redirect for missing identity. Explain for insufficient permission.** HTTP
> makes the same distinction with 401 vs 403, for the same reason.

Both guards keep a `restoring` branch — treating "unknown" as "not an admin"
would flash a 403 at every admin on every reload.

---

## 4. The Phase 2 promise, paid

Phase 2 said `NAV_LINKS` was data rather than JSX because *"it gains a
`capability` field and is filtered per user"*. That change was **one line per
link**:

```tsx
{ to: paths.adminUsers, label: 'Users', capability: 'users:read' },
```

Three layers now stand between a member and the admin data — and only one is a
boundary:

| Layer | Effect if removed |
|---|---|
| Nav filter | member sees a link |
| `RequireRole` | member sees the page shell |
| **`@Roles(Role.ADMIN)`** | **member sees the data** |

`MainNav` is its own component so only *it* re-renders on a session change, and
its `useMemo` holds only because `can` is `useCallback`'d in `usePermissions` —
the Phase 3 point about memoising at a hook boundary paying off.

---

## 5. One non-security guard that's still correct

`AdminUsersPage` disables the role selector on your **own** row.

An admin can trivially bypass this with curl, and the backend allows it. It's a
**foot-gun guard**: in a system with one administrator, demoting yourself locks
everyone out permanently with no in-app way back.

> *"The frontend is not a security boundary"* does not mean the frontend should
> let users destroy things. **Preventing an irreversible mistake is a legitimate
> client-side job, distinct from preventing an unauthorised action.**

The real fix is a backend rule refusing to remove the last admin. Flagged, not
done.

---

## 6. What these tests cannot catch

The permission tests are pure and fast (no `render`), and they pin what the
client currently believes. **They do not close the loop.**

If someone tightens `@ProjectRoles` on the backend, every test here still passes
and the UI silently starts showing buttons that 403.

The honest fixes, in order:
1. A contract test exercising both sides against real endpoints
2. A shared policy document the two implementations both cite
3. What we have: every rule citing its source in a comment

Worth naming in an interview rather than pretending unit tests solve it.

---

## 7. Interview questions

1. **Is frontend RBAC security?** No. It decides what to render. The server's
   guards are the boundary — and here that's demonstrable with curl.
2. **Global role vs project role?** Same enum, different scopes. "Is X a
   manager" is unanswerable without naming a project.
3. **Why does `can()` take a context?** Rules like `comment:delete` depend on the
   *resource* (authorship), not just the actor. A model that can't express "your
   own" gets worked around.
4. **Hide or disable a forbidden action?** Hide when unattainable, disable+explain
   when attainable or when hiding looks broken. Hiding discloses less.
5. **Why doesn't `RequireRole` redirect?** They're authenticated. Redirecting to
   login loops or misleads. 401 → redirect, 403 → explain.
6. **How do you stop client and server rules drifting?** You mostly can't with
   unit tests — you need a contract test or a shared policy source. Cite sources
   as the minimum.
7. **Why `never` in the default branch?** A new capability must fail the *build*,
   not silently deny everyone.

---

## 8. Exercises

1. Delete `<RequireRole>` from the router and open `/admin/users` as a member.
   The page renders; the table shows an error. That's the correct failure.
2. Remove `capability` from the admin nav link. The link appears for everyone —
   and still 403s. Which layer actually protected anything?
3. Change `comment:delete` to `authorId === user.id || isProjectManager` and run
   the tests. Explain which one fails and why ordering matters.
4. Add `project:delete` to `Capability` and don't handle it. Find the compile
   error.
5. Make `RequirePermission` render a disabled button with a tooltip instead of
   hiding. Decide which of the app's gates should use it.
6. Remove the `restoring` branch from `RequireRole`, log in as admin, and
   hard-refresh `/admin/users` with the network throttled.

---

## Verified

```
lint ✅   typecheck ✅   100/100 tests ✅   build ✅

Live:
  member → GET /users 403 · GET /activity-logs 403
  admin  → GET /users 200 · GET /activity-logs 200
  /admin/users /dashboard /tasks → 200
```

Bundle 628 kB / 195 kB gzip.

---

## Quiz

1. Why are there two role systems rather than one?
2. What are the three levels of authorization, and which one leaks quietly?
3. Hide the control or disable it — how do you choose?
4. What does the `never` in the `can()` switch achieve?
5. `RequireAuth` models three states, not two. Name them and the bug that
   modelling two causes.
6. Deleting `<RequirePermission>` from a button — what changes on the server?
7. Why does the repository check use `!== undefined` rather than a truthiness
   test?

<details>
<summary>Answers</summary>

1. They answer different questions. **Global** role is *what kind of account is
   this*; **project** role is *what may you do here*. Collapsing them means
   either a project manager becoming a global admin, or admins needing
   membership in every project.
2. **Route** (may you call this?), **collection** (which rows do you get?),
   **object** (may you touch this one?). The **collection** level leaks quietly —
   `GET /tasks` once returned every task in the database while `GET /tasks/:id`
   checked ownership correctly.
3. **Hide** when the user can never have it — a member cannot become an admin by
   clicking, so a disabled link is permanent clutter that also advertises the
   admin area. **Disable, with a reason,** when they could have it.
4. **Exhaustiveness.** Adding a capability without handling it becomes a compile
   error rather than a silent `false`.
5. `authenticated | unauthenticated | restoring`. With two, every page reload
   flashes the login screen for an already-signed-in user while the boot-time
   refresh is in flight.
6. **Nothing.** The frontend is not the security boundary; the API guard is.
7. An **empty array** of accessible projects must return nothing. A truthiness
   check would treat it as "no filter" and return everything — exactly backwards,
   for the least privileged user.

</details>

---

**Next: Phase 12 onward** — projects and users features, the reusable data
table, then SSE notifications. The permission model is now in place for all of
them.
