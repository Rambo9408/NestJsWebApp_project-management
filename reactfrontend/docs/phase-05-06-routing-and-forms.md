# Phases 5 & 6 — React Router and Forms

> Covers brief Parts 23, 25, 26, 27, 30, 35 (and previews 22, 24).
> **The app stops being labs.** Real routes, real forms, real API calls.

---

## What changed

```
BEFORE                          AFTER
/                → labs         BRANCH 1  AuthLayout   (no chrome)
/lab/*           → labs           /login  /register
                                BRANCH 2  RootLayout   (full chrome)
                                  /dashboard
                                  /tasks              ← filters in the URL
                                  /settings           → SettingsLayout
                                      /profile  /security
                                  /lab/*              ← lazy-loaded
                                  *                   → RouteErrorPage
```

**New, permanent:** `AuthLayout`, `SettingsLayout`, `RouteErrorPage`,
`DashboardPage`, `TasksPage`, `LoginPage`/`RegisterPage`,
`useUrlTaskFilters`, `authSchemas`, `authApi`, `applyServerErrors`,
`FormTextField`, `LoginForm`, `RegisterForm`.

**Tests:** 68 passing (25 new).

---

# PHASE 5 — Routing

## 1. Two top-level branches, not one tree

```tsx
{ element: <AuthLayout />,  children: [login, register] }   // no path!
{ path: '/', element: <RootLayout />, children: [...] }
```

The auth branch is a **pathless layout route** — it contributes a component but
no URL segment, so children keep top-level paths (`/login`, not `/auth/login`).

**Why separate branches rather than siblings under one layout:** in Phase 11 the
app branch gets an auth guard and this one must not have it. Expressing that as
*tree structure* means the guard cannot accidentally be applied to the login
page — which would be an infinite redirect loop, and a genuinely confusing one
to debug.

**This is the argument for layout routes over `<Header />` in every page.** With
a shared header component, "which pages get the nav?" is a decision repeated in
every page file, and it drifts. Here it's one five-line diff in the router.

## 2. Nested layouts — two outlets active at once

```
RootLayout          header, nav, theme toggle
 └── SettingsLayout  heading + tabs
      ├── /settings/profile
      └── /settings/security
```

The tab bar **mounts once**, so switching tabs preserves its state. Adding a
third settings page is one route entry, not a copy-pasted tab bar that drifts.

And in Phase 11 a guard goes on the **parent** and every child inherits it by
construction. *A guard you must remember to add per page is a guard that will
eventually be forgotten — and forgetting it is a security bug.*

> **Angular bridge:** identical to a `children` array with its own
> `<router-outlet>`, and the guard-on-parent point is the same argument for
> `canActivateChild`.

## 3. Filters in the URL — answering Part 30 properly

**Where should state live? One question decides it: *should this survive a
refresh or a shared link?***

| | |
|---|---|
| **Component state** | ephemeral, private to one screen — a modal, a hover, an unsaved draft |
| **URL** | anything describing *what the user is looking at* — filters, sort, page, search, selected tab |
| **Redux** | cross-cutting client state several unrelated features read. **Rare** — most candidates are URL or server state in disguise |
| **RTK Query** | server data, never hand-copied into a slice |

Four things the URL gives free, none of which component state can:

1. **Shareable** — "look at these urgent tasks" is a link, not instructions
2. **Refresh-safe** — F5 doesn't reset the view
3. **Back button works** — users expect Back to undo a filter, not exit the page
4. **Bookmarkable**, pasteable into a bug report

**The cost, honestly:** the URL is strings. Everything is parsed on read and
serialised on write, and anyone can type nonsense into it — so parsing must be
**defensive**, which is most of `useUrlTaskFilters`.

```tsx
// ?status=banana is one keystroke away, and it's what an old bookmark
// looks like after you rename a status.
parseEnum(searchParams.get('status'), STATUSES)   // falls back to 'all'
```

Trusting the string would send `?status=banana` to the API, fail
`@IsEnum(TaskStatus)`, and turn a typo in the address bar into an error screen.

**The URL is an untrusted boundary, exactly like the network and localStorage.**

There's **no `useState` here** — the URL *is* the state. Mirroring it into state
would create the second source of truth Phases 2 and 3 both warned about, plus
an effect to sync them.

**Interview:** lead with the refresh-and-share test. Most candidates answer
"Redux" reflexively.

## 4. Code splitting — where and where not

```tsx
const HooksLabPage = lazy(() =>
  import('@/pages/HooksLabPage').then(m => ({ default: m.HooksLabPage })));
```

Build output confirms it:

```
ConnectivityPage    1.83 kB
ComponentsLabPage   4.74 kB
StateLabPage        6.97 kB
RenderingLabPage    7.23 kB
HooksLabPage        8.40 kB
index             521.34 kB (160 kB gzip)
```

**The calculus for a split point: size × probability of not needing it.** The lab
pages are the largest, least-visited pages in the app — someone signing in to
check tasks shouldn't download five pages of teaching demos.

Split: routes, heavy deps behind an interaction (charts, rich text, PDF),
rarely-opened dialogs. **Don't** split tiny components — each chunk is a separate
request, so splitting a 2 kB component turns one round-trip into two.

**Trade-off:** a lazy route has first-visit delay — invisible on fast
connections, a visible flash on 3G. Mitigation is prefetch on hover/focus.

**Suspense is mandatory**, and **one boundary per route** — a single top-level
boundary would blank the entire app chrome on every lazy navigation.

## 5. Three error layers

| Layer | Catches |
|---|---|
| `ErrorBoundary` (main.tsx) | render errors anywhere, including providers *above* the router |
| `errorElement` (RouteErrorPage) | route-scoped — the chrome survives so the user can navigate away |
| `ErrorState` (component) | **API failures — not React errors.** A rejected promise never reaches either of the above |

Previously `errorElement` pointed at `NotFoundPage`. That was a shortcut worth
correcting: **a 404 and a crash are different events.** Telling a user "page not
found" when the page was found and then exploded sends them hunting a typo that
doesn't exist.

---

# PHASE 6 — Forms

## 6. Zod schemas transcribed from the backend

Every rule cites its source. From `is-strong-password.validator.ts`:

```
length >= 10  AND  /[a-z]/  AND  /[A-Z]/  AND  /\d/
```

**Four separate `.regex()` calls, not one lookahead monster.**

```
BAD:  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{10,}$/
```

One rule, one message — a user who forgot a digit is shown the whole policy and
must work out which part they failed. Four checks give four specific messages,
and Zod reports all of them.

> A validation message should say how to **fix** the input, not restate the
> policy. The backend author made the same call — their comment reads *"Invalid
> password is the most common and least useful validation message there is."*

**Order matters:** `.trim().toLowerCase().pipe(z.email())` — trim *before*
validating, or `" a@b.com "` is rejected before it's ever trimmed.

### Why frontend validation does not replace backend validation

**The frontend is not a security boundary.** DevTools, `curl`, a cached bundle —
all bypass it. Client validation is a UX feature: instant feedback without a
round-trip. That's all.

Two implementations of the same rules **will drift.** The honest ladder:

1. **Generate from OpenAPI** — drift becomes impossible (Phase 7)
2. **Share a schema package** — not possible here; class-validator decorators
   can't be imported into a browser bundle
3. **Cite the source, and render the server's own messages when it rejects**

We do (3) now and (1) next. Being able to explain the ladder beats claiming the
duplication is fine.

### Login is deliberately weaker than register

```tsx
loginSchema:  email non-empty, password non-empty.  That's it.
```

Applying the password policy would lock out any user whose password predates the
current rules — telling them their own correct password is invalid, with no way
forward. **A login form validates presence, not policy.**

## 7. `applyServerErrors` — the pay-off for the backend's `string[]`

Verified live:

```
POST /auth/register {"email":"bad","name":"A","password":"weak"} → 400
  field: email    | email must be a valid email address
  field: name     | name must be longer than or equal to 2 characters
  field: password | password must be at least 10 characters and contain ...
```

The first word of each message is the field name (class-validator interpolates
`args.property`), so each lands under its own input instead of in one banner
listing three problems the user must attribute themselves.

**This is a heuristic and it's worth being honest about that.** It relies on a
message-format convention, not a machine-readable contract. The rigorous fix is
structured errors:

```jsonc
"errors": { "email": ["must be a valid email address"] }
```

*"I would ask the backend for structured field errors"* is a strong answer to
"how do you handle server-side validation in a form?"

Note the whitelist: `setError('role', ...)` for a field the form doesn't have
would store an error against a non-existent field — `isValid` goes false and the
form can **never be submitted again**, with nothing visible. A nasty bug.

## 8. The security decision in `LoginForm`

**No `applyServerErrors` on login.** A failed login must never reveal which
field was wrong.

> "No account with that email" turns the form into an **account enumeration
> oracle**: submit a list of addresses, learn which are registered, feed the hits
> to credential stuffing.

The backend already refuses to distinguish — verified live, it returns
`"Invalid email or password"` for a wrong password. Splitting the message
client-side would undo that *where the attacker is looking*. There's a test
pinning it, because the "improvement" that breaks it looks like better UX and
someone will eventually propose it.

## 9. RHF details that matter

| Decision | Why |
|---|---|
| `defaultValues: { ... }` | Without it, inputs start `undefined` → uncontrolled → controlled on first keystroke. **The most common React form warning** |
| `mode: 'onTouched'` | `onSubmit` tells you about six fields at once; `onChange` scolds you from the first letter. Validate after blur, then live |
| Button disabled on `isSubmitting` **only** | Disabling on `!isValid` means the user can't press it and is therefore never told why |
| No `finally { setSubmitting(false) }` | RHF derives it from the promise. Hand-rolled flags leave permanently-disabled buttons when an early return skips the reset |
| `<form onSubmit>` + `noValidate` | Real form = Enter-to-submit, screen-reader semantics, password-manager prompts. `noValidate` stops the browser's own tooltip pre-empting ours |
| `autoComplete="new-password"` vs `current-password` | Wrong one makes a password manager offer the *existing* password on signup |

`FormTextField` exists so `error`/`helperText`/`aria-invalid` wiring is
**structural, not remembered.** MUI links helper text via `aria-describedby` —
but only if you pass the props.

The generics make `name` type-safe: `FieldPath<TFieldValues>` produces every
legal dotted path, so `name="emial"` is a compile error. With `name: string` it
would render, accept input, and submit nothing.

> **Angular bridge:** `useForm` is `FormGroup`, the Zod resolver is your
> `ValidatorFn`s, `formState.errors` is `control.errors`, `handleSubmit` is
> `(ngSubmit)`, and `FormTextField` is a `ControlValueAccessor`. What differs:
> validation lives in a **schema** rather than per-control.

---

## 10. Interview questions

1. **Where does filter state belong?** URL, if it describes what the user is
   looking at. Refresh-and-share is the test.
2. **Why layout routes over a shared header component?** The "which pages get
   chrome" decision is expressed once, structurally — and guards can go on the
   parent.
3. **What do you code-split, and what don't you?** Routes and heavy deps behind
   interactions. Not tiny components — each chunk is a request.
4. **Why does frontend validation not replace backend validation?** The client
   isn't a security boundary. Client-side is UX; the server is the real gate.
5. **How do you keep the two in sync?** Generate from OpenAPI; failing that,
   render the server's messages so it stays authoritative.
6. **How do you show server validation errors in a form?** Map per-field
   messages onto fields via `setError`. Ask for structured errors rather than
   parsing prose.
7. **Why not tell the user their email isn't registered?** Account enumeration.
8. **Why `defaultValues`?** Prevents the uncontrolled→controlled warning.
9. **When would you validate on change vs on blur?** `onTouched` by default;
   `onChange` only where instant feedback is genuinely useful.
10. **Why does your login schema differ from register?** Existing users whose
    passwords predate the policy.

---

## 11. Exercises

1. Open `/tasks`, set two filters, copy the URL to a new tab. Then press Back
   twice. Now change `setFilters` to `replace: true` and repeat.
2. Type `?status=banana&page=-4` manually. Explain why nothing breaks.
3. Delete `path: ['confirmPassword']` from the refine. Mismatch the passwords.
   The form won't submit and shows no error — that's the bug the test catches.
4. Change `mode` to `'onChange'` and type one character into Password.
5. In DevTools Network, filter to JS and visit `/lab/hooks`. Watch the chunk
   arrive on navigation, not on load. Then throttle to Slow 3G.
6. Make `applyServerErrors` call `setError('role', ...)`. Submit twice and
   explain why the form dies.
7. Remove `defaultValues` and watch the console.

---

## 12. Quiz

1. What's a pathless layout route for?
2. Why `<Navigate replace>` on the index route?
3. Why does `lazy()` need `.then(m => ({ default: m.X }))` here?
4. Why one Suspense boundary per route rather than one at the top?
5. Why does `.trim()` come before `.email()`?
6. What breaks if `setError` names a field the form doesn't have?
7. Why is `confirmPassword` stripped before the request?

<details>
<summary>Answers</summary>

1. Sharing a layout without sharing a URL prefix.
2. Without `replace`, Back from `/dashboard` hits `/`, which redirects forward
   again — trapping the user.
3. `lazy` expects a default export; this project uses named exports.
4. A boundary replaces everything inside it — a top-level one would blank the
   nav on every lazy navigation.
5. `z.email().trim()` would reject `" a@b.com "` before trimming it.
6. RHF stores the error, `isValid` stays false, and the form can never submit —
   with nothing visible to explain why.
7. It's a client-only UX field; the backend has no such property, and
   `RegisterPayload = Omit<..., 'confirmPassword'>` makes sending it a compile
   error.

</details>

---

## Verified

```
lint ✅   typecheck ✅   68/68 tests ✅   build ✅ (6 chunks)

Live against the running NestJS backend:
  POST /auth/register              → 201 {user, accessToken, expiresIn}
  POST /auth/register (invalid)    → 400, 3 field-prefixed messages
  POST /auth/login  (wrong pass)   → 401 "Invalid email or password"

Routes: / /login /register /dashboard /tasks /tasks?status=todo&priority=urgent
        /settings /settings/profile /settings/security /lab/* /nope → all 200
```

Main bundle 521 kB / 161 kB gzip, plus 5 lazy chunks totalling ~29 kB.

---

**Next: Phase 7 — NestJS API integration in earnest.** Generate types from the
OpenAPI document (closing the drift gap named above), replace the task fixtures
with real requests, and build the auth session — access token in memory,
refresh-on-401 with single-flight.
