# Architecture and system design

> **Part 60.** 20 discussions, not quiz questions.
>
> The format is different from [INTERVIEW-QUESTIONS.md](INTERVIEW-QUESTIONS.md)
> on purpose. Nobody wants a thirty-second answer to "how would you scale this".
> They want to watch you **think**: ask about constraints, name trade-offs, pick
> one, and say what would make you pick differently.

**The shape of a good answer to any of these:**

1. **Clarify the constraint.** Scale, team size, latency budget, consistency
   needs. Most of these questions are under-specified deliberately.
2. **Name the options.** Two or three, honestly stated — including the boring one.
3. **Pick one, and say why _here_.** A recommendation with no context is a
   preference, not engineering.
4. **Say what would change your mind.** This is the part that reads as senior.

**A warning about this project.** Fourteen of these are grounded in something
that actually exists in this repo. Six are deliberately beyond it — you should be
able to say _"we don't do that here, and here's what it would take"_. Claiming
operational experience you don't have is the fastest way to lose an interview,
and the fastest way to be found out is a follow-up question about the failure
mode.

---

## Contents

| #     | Topic                                             | Grounded here? |
| ----- | ------------------------------------------------- | -------------- |
| 1–4   | Structure: monolith, modules, monorepo, contracts | yes            |
| 5–8   | State, caching and consistency                    | yes            |
| 9–12  | Auth, sessions and multi-tenancy                  | partly         |
| 13–16 | Real-time, scale-out and the data layer           | partly         |
| 17–20 | Delivery, migration and organisational design     | partly         |

---

## 1. Walk me through this system's architecture.

**What they're testing:** whether you can describe your own work at the right
altitude — not a file tour, not a buzzword list.

**The answer, in about ninety seconds.**

A **modular monolith** NestJS API and a **React SPA**, deployed as two containers
behind one origin.

The API is organised by feature module (auth, users, projects, tasks, comments,
notifications), each owning its schema, DTOs, service and controller. Cross-
cutting concerns are global: a JWT guard, a roles guard, a throttler, an
exception filter, request-scoped logging.

Data is MongoDB via Mongoose, running as a **replica set** — not for availability
here, but because multi-document transactions require one. Redis does caching,
rate-limit counters, and pub/sub for fanning notifications out across API
instances.

The client is a Vite/React SPA. Server state lives in RTK Query (a cache, not
state); filters live in the **URL**; the store holds only session, theme and
toasts. Types for requests are **generated from the API's OpenAPI document**, so
drift is a CI failure rather than a runtime surprise.

In production nginx serves the built bundle and reverse-proxies `/api` to the
API — one origin, so cookies are same-site and there's no CORS in the request
path.

**The follow-up you should invite:** _"why a monolith?"_ — see next.

---

## 2. Why a modular monolith rather than microservices?

**Clarify first:** team size and deployment cadence. This is a small team and one
deployable.

**The answer.** Microservices buy **independent deployability** and **independent
scaling**, and they cost you a distributed system: network calls where you had
function calls, partial failure, distributed transactions, eventual consistency,
tracing across services, and N pipelines.

Nothing here needs that. There's one team, one release, and no component with a
wildly different scaling profile. Splitting would add operational cost against no
benefit.

**What the modules buy anyway.** The seams are real — each module owns its data
and talks to others through services, not shared repositories. That's what makes
extraction _possible later_, which is the point: a well-modularised monolith is
the cheapest thing to split when you actually need to, and the split becomes
obvious rather than architectural guesswork.

**What would change my mind:** one component with genuinely different scaling
(the notification fan-out, if it grew), a team large enough that merge
coordination costs more than network calls (usually 15–20+ engineers), or a
compliance boundary that demands isolation.

> **The trap:** answering "microservices don't scale for teams" as dogma. The
> honest version is _"we don't need it yet, and here's the specific signal I'd
> watch for."_

---

## 3. How is the repository organised, and why isn't it a workspace?

Two applications, one repo: `nestbackend/` and `reactfrontend/`, with shared
tooling and docs at the root.

**Why a monorepo:** the contract between them is the thing most likely to break,
and it can be checked in a single CI run. A backend change that alters a DTO
fails the frontend's contract job in the same pipeline.

**Why deliberately _not_ npm workspaces:** ★ hoisting would move dependencies to
a root `node_modules`, and the backend Dockerfile builds with `./nestbackend` as
its context — so the hoisted dependencies would be **outside the build context**
and the image wouldn't build. This is a real constraint that bit this project,
and it's a good example of tooling choices being coupled to deployment shape
rather than being free.

**The cost, stated honestly:** duplicated dependencies on disk, two lockfiles,
and no shared package for common types. The last one is the real loss — shared
types come from OpenAPI generation instead.

---

## 4. How do you stop the frontend and backend contracts drifting?

**The options.**

- **Hand-written types.** Zero tooling, drifts silently. ★ This project ran that
  way early, and a field (`reference`) was simply _invisible_ to the frontend for
  several phases — no error, it just didn't exist.
- **Generate from OpenAPI.** What's here. `npm run api:types` regenerates, and CI
  boots the API, regenerates, and **fails on a non-empty diff**. It caught real
  drift on its first run.
- **Share a package** of types/validators. Strongest coupling, best guarantee —
  and requires both sides in the same language and release train.
- **Schema-first** (tRPC, GraphQL codegen, protobuf). The contract is the source
  of truth rather than a projection of the server.

**The honest limitation of what's here:** the OpenAPI document has request
schemas but **no response schemas**, so generation guards what we _send_, not
what we _receive_. Closing it is a backend change (`@ApiOkResponse({ type })` on
every handler), and it's on the roadmap rather than done.

**What I'd pick greenfield:** if both ends are TypeScript and deployed together,
tRPC or a shared package removes the whole category. OpenAPI is the right answer
when the API has consumers you don't control.

---

## 5. Where does state live in this application, and how did you decide?

**Four buckets**, and most state bugs come from confusing the first two:

| Bucket              | Home          | Why                                                            |
| ------------------- | ------------- | -------------------------------------------------------------- |
| Server state        | RTK Query     | It's a **cache**: stale on arrival, shared, needs invalidation |
| URL state           | search params | Filters/page/sort — shareable, bookmarkable, survives refresh  |
| Global client state | Redux slice   | Session, theme, toasts — genuinely app-wide                    |
| Local state         | `useState`    | Everything else. The default.                                  |

**The decision rule:** _who else needs this, and does it survive a refresh?_ If
nobody and no, it's local. If it came from the server, it's cache. If a user
would want to share this view, it's the URL.

**The one worth arguing for:** URL state. It's the highest-value, lowest-cost
decision in a list-heavy app — a filtered view becomes a link you can paste into
a ticket.

---

## 6. Design the caching strategy for this system.

**Clarify:** which cache? There are four, and conflating them is the mistake.

1. **HTTP/CDN** — content-hashed assets `immutable` for a year; `index.html`
   never cached. ★ Backwards and you serve yesterday's HTML pointing at chunk
   hashes that no longer exist: a blank page after every deploy.
2. **Client data cache (RTK Query)** — keyed on endpoint + serialised args,
   invalidated by tags. Mutations declare what they invalidate, so refetching is
   declarative rather than remembered at each call site.
3. **Server cache (Redis)** — for expensive reads shared across users. The hard
   part is never the cache, it's **invalidation**: write-through, TTL, or
   event-driven, and each has a different staleness story.
4. **Database-level** — indexes and query shape. Usually where the real win is,
   and the one people skip because caching feels more like architecture.

**The order I'd actually work in:** fix the query, then cache at the edge, then
cache in the app. Caching a slow query hides it until the cache misses at the
worst moment.

**What makes a thing cacheable:** it's read far more than written, it's expensive,
and being a little stale is acceptable. If any of those is false, don't.

---

## 7. Two users edit the same task. What happens?

**Right now:** last write wins, silently. That's worth saying plainly rather than
dressing up.

**The options, in increasing cost:**

- **Optimistic concurrency** — send a version/`updatedAt`; the server rejects a
  write whose base version is stale, and the client shows "this changed, reload".
  Cheap, and covers most of the harm.
- **Field-level merge** — only conflicting fields conflict. Better UX, much more
  logic.
- **CRDTs / operational transform** — real collaborative editing. Enormous cost,
  right for a document editor, absurd for a task's status field.

**What I'd do here:** optimistic concurrency on the fields that matter, because
this is a task tracker — two people rarely edit the same description
simultaneously, but silently losing an assignee change is a real complaint.

**The systems point:** the right answer depends entirely on _how bad a lost
update is_. Ask that before designing anything.

---

## 8. How would you add offline support?

**Clarify:** offline-_tolerant_ (survive a tunnel) or offline-_first_ (works for
a day)? They're different products.

**Offline-tolerant** — a service worker caching the shell and GET responses, plus
a request queue for mutations replayed on reconnect. Moderate cost.

**Offline-first** — a local database as the source of truth, sync as a background
concern, and now you own **conflict resolution, identity generation
(client-side ids) and schema migration on the client**. That's a different
application.

**The trap:** treating it as a caching feature. The hard part isn't storing data,
it's what happens when a queued mutation fails after the user has moved on —
where does that error even go?

**For this app:** not worth it. It's an authenticated internal tool used at a
desk. I'd spend the effort on making failures recoverable instead.

---

## 9. Walk me through the authentication design and its trade-offs.

**The scheme:** short-lived JWT access token in **memory**, long-lived refresh
token in an **httpOnly cookie**, with **rotation and reuse detection**.

**Why in memory rather than `localStorage`:** ★ `localStorage` is readable by any
XSS. In-memory dies on refresh — which is exactly what the refresh cookie fixes.
Neither is "secure"; they trade different risks, and saying that is the answer.

**Why httpOnly for refresh:** JavaScript can't read it, so XSS can't exfiltrate
it. It's sent automatically — which is precisely why CSRF protection is then
required, via double-submit.

**Rotation and reuse detection:** each refresh issues a new token and invalidates
the old. Presenting a consumed token means it leaked, so the whole session is
revoked.

**The consequence people miss:** ★ five requests 401 at once → five refresh calls
→ four use an already-consumed token → reuse detection logs the user out. The fix
is **single-flight refresh**: one in-flight promise everyone awaits.

**Stateless vs stateful:** JWTs are stateless until you need revocation, at which
point you're storing refresh tokens server-side and it's a session with extra
steps. That's the honest framing, and it's fine — the access token stays stateless
and cheap.

---

## 10. How would you add SSO / OAuth?

**The shape:** authorization code flow with PKCE. The provider authenticates; you
exchange the code server-side and issue **your own** session — the same tokens as
today. That's the key design decision: the external identity is an
_authentication_ method, not your _authorization_ model.

**What gets hard:**

- **Account linking.** Someone signs up with email/password, later uses Google
  with the same address. Auto-link (verified email only) or force a deliberate
  link — silently merging accounts is a security bug.
- **Provisioning.** JIT-create on first login, or require an invite. Enterprise
  buyers will want SCIM eventually.
- **Deprovisioning.** ⚠ The one people forget: when the IdP disables a user, how
  fast does your session die? Access tokens are valid until they expire.
- **Role mapping.** IdP groups → your roles, and what happens when a group
  disappears.

**Honestly:** I've implemented JWT auth end to end; I haven't run an enterprise
SSO integration in production, and SCIM is something I'd read up on rather than
claim.

---

## 11. This has global roles and per-project roles. Why two systems?

Because they answer different questions. **Global** role (admin/member) is _what
kind of account is this_. **Project** role (manager/member) is _what may you do
here_.

Collapsing them would mean either a project manager becoming a global admin
(privilege escalation) or admins needing explicit membership in every project
(unworkable).

They share one enum, which keeps the vocabulary consistent and lets a single
`can(user, capability, context)` function answer both — the context argument is
what makes it one function instead of two systems.

**The failure mode it creates:** ★ it's easy to check the _global_ role and forget
the _project_ one. An audit here found eight endpoints with **no** object-level
check at all — a second user could read, rename, reassign and **delete** another
user's task. The fix was a guard that follows task → project → membership.

**The general principle:** authorization has three levels — route (may you call
this?), collection (which rows do you get?), and object (may you touch _this_
one?). Most codebases do the first, some do the third, and the **collection**
level is the one that leaks quietly.

---

## 12. How would you make this multi-tenant?

**Clarify:** shared-everything, shared-schema-separate-rows, or database-per-
tenant? The choice is driven by compliance and blast radius, not by code.

- **Row-level (`tenantId` on everything)** — cheapest, one migration, one
  connection pool. ⚠ And **one missing `WHERE` clause from a cross-tenant data
  leak**, which is the worst bug a SaaS can ship.
- **Schema/database per tenant** — strong isolation, easy per-tenant restore and
  deletion. Costs: migrations × N, connection management, noisy-neighbour moves.
- **Cluster per tenant** — enterprise/regulated only.

**What I'd do:** row-level, but with the tenant scope enforced **structurally**
rather than by discipline — a base repository that requires a tenant context, so
an unscoped query is a compile error rather than a code-review catch. Given what
the authorization audit here found, "everyone will remember to add the filter" is
demonstrably false.

**The migration path** from single-tenant is the genuinely hard part: backfilling
`tenantId`, and every existing query.

---

## 13. Design the notification system. How does it scale?

**Today:** the API publishes to a Redis channel; each instance subscribes and
pushes to the SSE connections it holds. That's the piece that makes it work with
more than one instance — without pub/sub, a user connected to instance A never
sees an event raised on instance B.

**Why SSE rather than WebSockets:** ★ the traffic is one-directional
(server → client), SSE is plain HTTP so it traverses proxies unchanged, and the
browser reconnects automatically. WebSockets earn their complexity when you need
client → server messages.

**Where it breaks at scale:**

- **Connections are the constraint**, not messages. Every connected user holds an
  open connection and a browser allows ~6 per origin.
- **Fan-out to a large group** becomes N writes; that's when you want a broker
  with topics rather than a channel per user.
- **Missed events while disconnected.** SSE has `Last-Event-ID`; using it means
  events need durable ids and a replay window. Not implemented here — a
  reconnecting client **loses** what it missed, which is acceptable only because
  notifications are also readable from the API.

**What I'd change first at 10× users:** move the stream to a dedicated service.
It's the one component here with a genuinely different scaling profile — long-
lived connections vs short requests — which is the _signal_ for extraction I'd
want before splitting anything.

---

## 14. This API returns paginated lists. Design pagination properly.

**Offset (`?page=2&limit=20`)** — what's here. Simple, supports jumping to page
N, and shows a total count. ⚠ Two real problems: it's `O(offset)` in most
databases, and it **skips or repeats rows** when the underlying data changes
between pages.

**Cursor (`?after=<opaque>`)** — stable under concurrent writes, constant-time,
and the right answer for feeds and infinite scroll. Costs: no page numbers, no
easy total, and the cursor must encode the full sort key.

**Keyset** — cursor with the sort field exposed. Same benefits, leakier API.

**What I'd pick:** offset for admin tables where users want page numbers and the
data is small; cursor for anything append-heavy or large. The mistake is picking
one for the whole API — pagination style is a property of the _collection_.

**The detail that matters either way:** the sort must be **total**. Sorting by a
non-unique field without a tiebreaker gives non-deterministic ordering, and every
pagination bug traces back to it.

---

## 15. Why MongoDB here, and when would it be wrong?

**Honest answer:** it fits documents with variable shape and nested structures,
and Mongoose gives typed schemas over it. It also happens to be what this codebase
is built on.

**When it's wrong:** when your data is genuinely relational and your queries are
joins. Modelling many-to-many with `$lookup` everywhere means you wanted Postgres
and are paying for the wrong tool.

**The specific thing this project ran into:** ★ multi-document transactions
require a **replica set**. A standalone `mongod` returns _"Transaction numbers are
only allowed on a replica set member"_ — so a `DELETE` that spans collections
500s. That's a deployment constraint most people meet in production rather than
in design.

**The general point:** "SQL vs NoSQL" is the wrong frame. Ask about access
patterns, consistency requirements, and whether your data has a natural aggregate
boundary. If it does, documents fit. If everything joins to everything, it
doesn't.

---

## 16. Where would this system break first under 100× load?

**The right move is to say what you'd measure**, then give a hypothesis.

**My hypothesis, in order:**

1. **SSE connections.** Long-lived, memory-resident, and they don't shard by
   request. First thing to fall over, first thing to extract.
2. **Unindexed queries** revealed by data volume. Fine at 10k rows, fatal at 1M —
   and the symptom is a timeout somewhere unrelated.
3. **Offset pagination** deep in large collections, for the reason above.
4. **bcrypt on login.** ~250ms of single-threaded CPU that an _attacker_ chooses
   how much of to spend. It's a capacity question as much as a security one.
5. **Redis as a single point** — it's doing cache, rate limiting and pub/sub. All
   three degrade together.

**What I would _not_ say:** "add more instances". The API is stateless enough to
scale horizontally, which means the bottleneck moves to the database and the
stream — so scaling out buys time, not a fix.

---

## 17. How do you deploy this with zero downtime?

**Rolling deploy** behind a load balancer, with the pieces that make it actually
work:

- **Readiness vs liveness**, distinguished. Readiness gates traffic; liveness
  restarts the container. ★ Confusing them is how you get a restart loop — and a
  rate-limited liveness probe took this container down permanently until it was
  fixed.
- **Graceful shutdown**: stop accepting, drain in-flight, close the DB pool. Nest
  has `enableShutdownHooks`; `node dist/main` as PID 1 so it receives SIGTERM at
  all.
- **Backward-compatible migrations.** The real constraint: during a rollout both
  versions run at once, so every schema change must work with **old and new code
  simultaneously**. Expand → migrate → contract, over three deploys.
- **The SPA's cache contract**, or returning users get a blank page mid-deploy.

**What breaks it:** a migration that drops a column the old version still reads.
That's not a deployment problem, it's a schema-change discipline problem.

---

## 18. How would you migrate the frontend from Angular to React incrementally?

**Clarify:** can you afford a freeze? Almost never — so the answer is
strangler-fig, not rewrite.

**The options:**

- **Big-bang rewrite.** Predictably late, and the old app keeps shipping features
  the new one must catch up on. Occasionally right for a small app.
- **Route-level split.** A reverse proxy routes some paths to the new SPA, some
  to the old. Clean boundary, no interop. **What I'd pick.** The cost is a full
  page load when crossing between them, and duplicated shell/auth.
- **Component-level (micro-frontend).** New components mounted inside the old app
  via custom elements or a wrapper. Fine-grained, but you now own two frameworks
  in one bundle, shared state across a boundary, and doubled tooling.

**Sequencing:** start with a **leaf route with few dependencies** — a settings
page, not the dashboard. Prove auth, routing and the build, then move inward.

**The organisational half, which usually decides it:** who maintains the old app
while this happens? A migration with no owner for the legacy side stalls at 60%
and stays there for two years. That's the risk worth naming out loud.

---

## 19. How do you decide what to test, given finite time?

**By blast radius and detectability**, not by coverage percentage.

- **Always:** authorization (the audit here found eight broken endpoints —
  silent, exploitable), money, data deletion, and anything with a state machine.
- **Usually:** the wiring layer — page + store + router + transport. It catches
  "everything works in isolation and nothing is connected", which unit tests
  structurally cannot.
- **Rarely:** presentational rendering. Low value, high churn.

**The measurement I'd actually use:** ★ not coverage, but **whether a test fails
when you break the code**. Reintroduce the bug and watch. This project found two
of its own vacuous tests that way, and one false "verified" claim.

**On coverage numbers:** a useful floor and a terrible target. 100% coverage with
no assertions is achievable and worthless.

---

## 20. You join this project tomorrow. What do you change first?

**What they're testing:** judgement and honesty about your own work.

**The answer, in priority order:**

1. **Response schemas in OpenAPI.** The contract check currently guards what we
   send, not what we receive — that's half a safety net presented as a whole one.
2. **Real-browser E2E.** Three test layers exist and all run in jsdom, which has
   no layout and no hit-testing. There are assertions here that _cannot_ be made
   until Playwright runs.
3. **Structural tenant/authorization scoping**, if multi-tenancy is ever coming.
   Given what the audit found, discipline is not a control.
4. **The bundle.** 245 kB gzip, of which ~210 kB is MUI. Splitting was measured
   and made cold load _worse_; only a library change moves the number, and that's
   a big decision to take deliberately rather than by accident.

**What I would _not_ change:** the monolith, or the state-management split. Both
are working and neither is the constraint. Changing architecture that isn't
hurting is how you spend a quarter and ship nothing.

> **The meta-answer:** the first thing to change is usually _observability_, not
> architecture. You cannot prioritise what you cannot see.

---

## Related

- [INTERVIEW-QUESTIONS.md](INTERVIEW-QUESTIONS.md) — 130 shorter questions
- [SENIOR-SCENARIOS.md](SENIOR-SCENARIOS.md) — 40 situational judgement scenarios
- [MOCK-INTERVIEW.md](MOCK-INTERVIEW.md) — a full loop with follow-ups
- [POSITIONING.md](POSITIONING.md) — talking about experience honestly
