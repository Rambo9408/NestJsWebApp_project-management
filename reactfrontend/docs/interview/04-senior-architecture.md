# Senior architecture — 20 questions

> Decisions rather than knowledge. Every one of these is under-specified on
> purpose, and the first move is always to ask what the constraint is.
>
> The shape of a strong answer: **clarify → name the options → pick one and say
> why *here* → say what would change your mind.** The last clause is the one that
> reads as senior.

---

### S1. Walk me through this frontend's architecture.

**Answer, in about ninety seconds.**

A Vite/React SPA against a NestJS API, deployed as static files behind nginx
which also reverse-proxies `/api` — one origin, so no CORS in the request path
and cookies attach without ceremony.

Feature-based structure: `features/` owns domain slices (auth, tasks, projects,
comments, notifications), `components/` owns the reusable UI, `pages/` composes.
Server state lives in RTK Query; filters live in the URL; the Redux store holds
only session, theme and toasts.

Request types are **generated** from the API's OpenAPI document, with a CI job
that regenerates and fails on a diff.

**The follow-up to invite:** *"Why is the store so small?"*

---

### S2. Why is the Redux store so small?

**Answer.** Because most of what people put in a store is **server state**, and
server state is a cache — stale on arrival, shared, needing invalidation and
deduplication. Copying it into a slice means re-implementing a cache by hand.

**What is left** is genuinely global client state: who is signed in, the theme,
the toast queue. Three slices.

**What would change my mind:** a genuinely cross-cutting client workflow — a
multi-step wizard whose state survives navigation, or offline queuing.

---

### S3. How do you decide where a piece of state lives?

**Answer.** One question: *who else needs this, and does it survive a refresh?*

Nobody and no → local. Came from the server → cache. Someone would want to share
this view → the URL. Genuinely app-wide with real transitions → the store.

**The one worth arguing for:** URL state. Highest value, lowest cost, and
routinely forgotten. A filtered task list becomes a link you paste into a ticket.

---

### S4. Design the caching strategy.

**Clarify first:** which cache? There are four and conflating them is the
mistake.

1. **HTTP/CDN** — hashed assets immutable, `index.html` never cached.
2. **Client data cache** — RTK Query, keyed by endpoint + serialised args,
   invalidated by tags.
3. **Server cache** — Redis, for expensive shared reads. The hard part is never
   the cache, it is invalidation.
4. **Database** — indexes and query shape, usually where the real win is.

**The order I would actually work in:** fix the query, then cache at the edge,
then cache in the app. Caching a slow query hides it until the cache misses at
the worst possible moment.

---

### S5. How do you stop the frontend and backend contracts drifting?

**Options:** hand-written types (drift silently), generate from OpenAPI (what is
here), a shared package (strongest, needs one language and one release train),
or schema-first — tRPC, GraphQL codegen, protobuf.

**The honest limitation here:** no response schemas in the document, so this
guards what we send and not what we receive. That gap produced a real defect —
two endpoints declaring one response type and returning different shapes.

**Greenfield:** if both ends are TypeScript and deploy together, tRPC or a shared
package removes the category. OpenAPI is right when the API has consumers you do
not control.

---

### S6. How would you structure a React app with 500 components?

**Answer.** Feature-first, not type-first. `features/billing/` containing its
components, hooks, slice and types beats `components/`, `hooks/`, `types/` at the
top level — because features are how work arrives, and a type-first layout means
every change touches four directories.

**Then the boundary rules**, which are the part that actually scales:

- a feature may import from `components/` and `services/`, never from another
  feature's internals
- shared code moves **down** into `components/` only when a second feature needs
  it, not in anticipation
- cross-feature communication goes through the store or the router

**What enforces it:** an ESLint import boundary rule. Conventions that only live
in a README erode within two quarters.

---

### S7. When is Context the wrong tool?

**Answer.** When the value changes often, when the tree beneath it is large, or
when you want selector granularity — because every consumer re-renders on every
change and there is no `shallowEqual` escape.

**The fix before splitting the context:** push consumption **down** to the leaf
that needs it. `ThemeModeToggle` reads the theme; `RootLayout` does not, so a
toggle does not re-render the nav.

---

### S8. Two users edit the same task. What happens?

**Answer, plainly:** last write wins, silently. That is worth saying rather than
dressing up.

**Options, increasing cost:** optimistic concurrency with a version field (cheap,
covers most of the harm); field-level merge; CRDTs or OT for genuine
collaborative editing.

**Here I would do optimistic concurrency** — this is a task tracker, two people
rarely edit one description at once, but silently losing an assignee change is a
real complaint.

**The systems point:** the right answer depends entirely on how bad a lost update
is. Ask that before designing.

---

### S9. How would you add offline support?

**Clarify:** offline-*tolerant* (survive a tunnel) or offline-*first* (works for
a day)? Different products.

**Tolerant:** a service worker caching the shell and GETs, plus a mutation queue
replayed on reconnect.

**First:** a local database as source of truth — and now you own conflict
resolution, client-generated ids, and schema migration **on the client**.

**The trap:** treating it as caching. The hard part is what happens when a queued
mutation fails after the user has moved on. Where does that error even go?

**For this app:** not worth it. Authenticated internal tool, used at a desk. I
would spend the effort on making failures recoverable.

---

### S10. How would you design a reusable component library?

**Answer.** Three decisions, in order:

1. **Styling strategy** — and commit. Mixing CSS-in-JS with utility classes
   across a library is how you get two design systems.
2. **The composition model** — compound components for anything with more than
   one sensible arrangement, props for anything with one.
3. **Escape hatches** — every component needs a way out (`className`, `sx`, a
   slot), or the first unanticipated design forks it.

**Versioning matters more than the code.** A breaking change to a shared `Button`
is a coordinated migration across every consumer. Prefer additive changes and
deprecation windows.

**Named exports over static properties** for a shipped library, incidentally —
`Modal.Footer` cannot be tree-shaken.

---

### S11. How would you improve initial page load?

**Answer, in order of usual payoff:**

1. **Measure.** Which metric — LCP, INP, CLS? They have different causes.
2. **Reduce bytes** — the dependency graph before the code. Here, 245 kB gzip of
   which ~210 kB is MUI; only a library change moves that number.
3. **Cache properly** — hashed assets immutable, entry HTML never.
4. **Remove waterfalls** — a request that cannot start until another finishes.
5. **Split**, knowing it may not help cold load and is really about cache
   stability.

**What I would not lead with:** SSR. It moves work rather than removing it, and
for an authenticated internal tool it buys nothing.

---

### S12. Where does SSR or RSC fit, and why not here?

**Answer.** They move rendering to the server for LCP and SEO.

**Not here because** this is an authenticated internal tool: no SEO value, and
every page needs a session anyway, so the server would render a shell and wait.

**Knowing when not to adopt something is the answer.** The follow-up is usually
*"what would make you reconsider?"* — a public marketing surface, or a genuinely
content-heavy page where LCP is the business metric.

---

### S13. How would you handle real-time at 10,000 concurrent users?

**Answer.** **Connections are the constraint, not messages.**

The current shape — API publishes to Redis, each instance pushes to the SSE
connections it holds — is what makes it work with more than one instance at all.
Without pub/sub, a user on instance A never sees an event raised on B.

**What breaks at scale:** fan-out to a large group becomes N writes (you want a
broker with topics); and a reconnecting client **loses** missed events unless you
implement `Last-Event-ID` with durable ids and a replay window — not done here.

**What I would change first:** extract the stream to its own service. It is the
one component with a genuinely different scaling profile — long-lived connections
versus short requests — which is the *signal* for extraction rather than a guess.

---

### S14. How do you handle API failures across a whole application?

**Answer.** Three layers, and conflating them is the mistake:

- **Transport** — retries, timeouts, the 401 refresh. Lives in one client.
- **Feature** — the four-state rule per screen: loading, error, empty, success,
  with a retry affordance.
- **Global** — a middleware that toasts unexpected failures so no error is
  silent, and an error boundary for render-time crashes.

**The distinction that matters:** an expected failure (validation, 403) belongs
next to the thing that caused it — a field error on a field. An unexpected one
belongs in the global channel.

---

### S15. How would you migrate an Angular app to React incrementally?

**Clarify:** can you afford a freeze? Almost never — so strangler-fig, not
rewrite.

**Options:** big-bang (predictably late, and the old app keeps shipping features
the new one must catch); **route-level split** at a reverse proxy (clean
boundary, no interop — what I would pick, costing a full page load when crossing
and a duplicated shell); component-level micro-frontend (fine-grained, but two
frameworks in one bundle and shared state across a boundary).

**Sequencing:** start with a **leaf route with few dependencies** — a settings
page, not the dashboard. Prove auth, routing and the build, then move inward.

**The organisational half, which usually decides it:** who maintains the old app
during the migration? One with no owner for the legacy side stalls at 60% and
stays there for two years.

---

### S16. How do you decide what to test, given finite time?

**Answer.** By blast radius and detectability, not coverage percentage.

- **Always:** authorization, money, deletion, anything with a state machine.
- **Usually:** the wiring layer — page + store + router + transport. It catches
  "everything works in isolation and nothing is connected", which unit tests
  structurally cannot.
- **Rarely:** presentational rendering. Low value, high churn.

**The measurement I would actually use:** whether a test **fails when you break
the code**. This project found two vacuous tests and one false claim that way.

---

### S17. What is your deployment strategy, and what makes it safe?

**Answer.** Rolling deploy behind a load balancer, plus the pieces that make it
actually work:

- **Readiness vs liveness, distinguished.** Readiness gates traffic; liveness
  restarts. Confusing them gives you a restart loop — and a rate-limited liveness
  probe took this project's API container down permanently until it was fixed.
- **Graceful shutdown** — stop accepting, drain, close pools.
- **Backward-compatible migrations.** During a rollout both versions run at once,
  so every schema change must work with old **and** new code. Expand → migrate →
  contract, over three deploys.
- **The SPA cache contract**, or returning users get a blank page mid-deploy.

---

### S18. How would you add observability to a frontend?

**Answer.** Three streams, and they answer different questions:

1. **Errors** — an exception tracker wired to the error boundary and to unhandled
   rejections, with source maps uploaded privately (not served).
2. **Real-user metrics** — Core Web Vitals from actual sessions. Lab numbers on a
   developer laptop are the least representative measurement available.
3. **Product events** — what people actually do, so you know which slow screen
   matters.

**The honest gap here:** this project has none of the three. Everything measured
is a desktop build measurement, and nobody has ever been paged for it. That is
the main thing separating it from "production ready".

---

### S19. What are the trade-offs of the choices in this project?

**Answer — the four worth naming, each with its cost:**

| Choice | Bought | Cost |
| --- | --- | --- |
| RTK Query over hand-rolled fetching | cache, dedupe, invalidation | a large dependency, and Redux concepts to learn |
| MUI | accessible components, fast delivery | ~210 kB of the 245 kB bundle |
| Generated request types | drift is a CI failure | no response coverage, so half a net |
| URL as filter state | shareable, bookmarkable | serialisation code and a sentinel value (`all`) never sent to the API |

**The one I would revisit first:** MUI. It is most of the bundle, and only a
library change moves the number — which is a decision to take deliberately rather
than by accident.

---

### S20. You join this project tomorrow. What do you change first?

**Answer, in priority order:**

1. **Observability.** You cannot prioritise what you cannot see, and there is
   none.
2. **Response schemas in OpenAPI.** The contract check currently guards one
   direction while looking like it guards both.
3. **Real-browser E2E.** All three test layers run in jsdom, which has no layout
   — there are assertions in this repo that are *impossible* until Playwright
   runs.
4. **Emit the seven unemitted domain events**, so the activity log is an activity
   log rather than a registration log.

**What I would not change:** the state-management split or the module structure.
Both work and neither is the constraint. Changing architecture that is not
hurting is how you spend a quarter and ship nothing.

---

## Self-check before moving on

1. Give a two-sentence justification for the store containing only three slices.
2. What is the first question you ask about any caching problem?
3. Name the organisational risk in a framework migration.
4. What separates this project from "production ready"?
5. For each major dependency here, what does it cost?

---

**Next:** [05 — Scenarios](05-scenarios.md)
