# Phase 22 — Mock senior NestJS interview

> A full 75-minute interview, transcribed. **The candidate has 2+ years of Node/TypeScript and recent,
> deep NestJS experience — not 4–5 years of Nest.** That is stated in round 1 and never becomes a
> problem, which is the point of the exercise.
>
> Read it once for the shape, then re-read the annotations — the `▸` notes explain *why* an answer
> landed, which is the transferable part.

**Format:** 5 rounds — screening (10 min), technical depth (25), architecture (20), debugging (15),
your questions (5).

---

## Round 1 — Screening (10 minutes)

**Interviewer:** Tell me about your background.

**Candidate:** About two and a half years professionally, Node and TypeScript throughout — Express APIs
with MongoDB, JWT auth, Angular on the front end, and the operational side: Docker, CI, some SSE and
caching work. NestJS specifically I've gone deep on more recently. I built a full production-style
backend with it — DI and custom providers, the guard/interceptor/pipe/filter pipeline, Passport with
refresh-token rotation, Redis caching and distributed rate limiting, BullMQ, SSE, event-driven
decoupling, and a test suite with real MongoDB integration tests.

So the Node fundamentals are the two-plus years; the Nest-specific depth is more recent but it's
hands-on rather than tutorial-deep. Happy to go as deep as you like on any of it.

> ▸ **Why this works.** It is the honest answer delivered as a *strength*, not a caveat. No hedging, no
> apology, no inflation. It ends with an invitation to be tested — which only someone who can be tested
> says. Note what it does **not** say: "I only have two years, but…".

**Interviewer:** The role says 4–5 years of Nest. Does that concern you?

**Candidate:** It's a fair question. What I'd say is that the year count is a proxy for something —
being able to own a service end to end: design the modules, get the auth right, keep it fast, debug it
at 3am. I can walk you through every one of those in a codebase I built, and I'd rather be measured on
that than on the proxy. If there's a specific thing you need that I haven't done, tell me and I'll tell
you honestly whether I've done it.

> ▸ **Why this works.** It reframes without arguing, and it offers to fail the check. That confidence is
> only available to someone telling the truth — which is precisely why honesty is the *strategically*
> better play, not just the ethical one.

**Interviewer:** Why Nest over Express?

**Candidate:** Express gives you routing and middleware and stops there — deliberately. Every team then
invents its own conventions for structure, wiring, validation and error handling, and every codebase
looks different.

Nest's value isn't features, it's that the structural decisions are already made. The concrete version:
in my project authentication is one global `APP_GUARD`, so every route is protected by default and
opting out needs an explicit `@Public()` decorator that shows up in review. In Express you add auth
middleware per route, and the first one you forget is a breach.

The cost is honest too — Nest is measurably slower than bare Express. A few hundred microseconds
against database calls measured in milliseconds. I'll take that trade.

> ▸ **Why this works.** A concrete mechanism, a specific example, and the cost volunteered without being
> asked. Volunteering the trade-off is one of the strongest seniority signals available.

---

## Round 2 — Technical depth (25 minutes)

**Interviewer:** Explain how Nest's dependency injection works. Not how to use it — how it works.

**Candidate:** Three pieces. `emitDecoratorMetadata` in tsconfig makes TypeScript emit a
`design:paramtypes` array — the runtime constructor parameter types — for any class carrying a
decorator. `reflect-metadata` provides the API to read it. Then at bootstrap Nest walks the module
graph, and for each provider reads `design:paramtypes`, resolves each token to an instance recursively,
and calls the constructor.

Every limitation follows from that. You can't inject an interface, because interfaces don't exist at
runtime. `@Inject()` exists to override the emitted type with an explicit token. And a missing
`@Injectable()` means no metadata was emitted at all — which is why the error is "can't resolve
dependencies at index [0]" rather than "unknown class".

**Interviewer:** So how do you inject something behind an interface?

**Candidate:** Two options: a string or symbol token plus `@Inject(TOKEN)`, or an **abstract class**.

I prefer the abstract class, and the reason is that it's both the type *and* the runtime token. My
`UsersService` constructor just says `private readonly usersRepository: UsersRepository` — no
`@Inject()`, full type safety, and the compiler enforces that implementations are complete. With a
string token you get a magic string that's typed nowhere, so a typo is a runtime failure.

Production binds it to the Mongo implementation; the unit tests bind an in-memory one. No mocking
library, no changes to production code. And the same swap is what would make extracting the module into
a service a transport change rather than a rewrite.

> ▸ **Why this works.** It answers the question, states a preference *with* a reason, and connects it to
> two downstream payoffs — testing and extraction. That last move — "here's what this decision buys me
> later" — is what distinguishes a senior answer.

**Interviewer:** Talk to me about circular dependencies.

**Candidate:** `forwardRef` on both sides — a cycle has two edges, and doing one leaves "undefined at
index [n]" at runtime. It works by deferring evaluation: you pass a thunk instead of a class reference
that's still `undefined` mid-cycle.

But I'd say `forwardRef` is the *last* option, not the first, because it makes the error go away
without making the coupling go away. The ranking I'd use: extract the shared logic into a third module;
invert with an event so the dependency disappears; use an interface so only one side knows the other's
shape; then `forwardRef`.

In my project I actually built the cycle deliberately — `UsersService` needed to check project
membership before deleting a user — and then removed it entirely. `UsersService` now emits
`USER_DELETION_REQUESTED` with a `blockers` array, `ProjectsModule` listens and pushes a blocker if the
user owns projects, and the emitter throws a 409 if there are any. Same behaviour, no cycle. The
`forwardRef` count in the repository is zero.

**Interviewer:** Nice. What's the cost of that event approach?

**Candidate:** Traceability. "What happens when a user is deleted?" used to be a call graph you could
read; now it's a search across listeners. And because it's `emitAsync`, the emitter still waits on
listener latency — so I've removed the compile-time coupling but kept a runtime one. I'd say that out
loud in a design review rather than pretend the event version is free.

> ▸ **Why this works.** The candidate names the cost of *their own* preferred solution, unprompted. That
> is very hard to fake and reads instantly as experience.

**Interviewer:** Provider scopes. When would you use `REQUEST`?

**Candidate:** Rarely, and I'd usually try not to. Scope bubbles **upward** — inject a request-scoped
provider into a singleton and that consumer becomes request-scoped too, all the way up the chain. So
one innocuous provider deep in the graph can quietly make half your app rebuild per request.

The legitimate case is multi-tenancy where you genuinely need a per-request connection or schema.

For correlation IDs and current-user context — which is what people usually reach for it for — I use
`AsyncLocalStorage` instead. The service stays a singleton with per-request storage, so nothing above
it changes scope. And it has a property request scope can't have: it works in a **BullMQ worker**,
where there is no request, so a worker gets the same correlation behaviour as an HTTP handler.

**Interviewer:** How does your auth work end to end?

**Candidate:** Passport local strategy for login, JWT strategy for everything after. Login returns a
short-lived access token in the body and a long-lived refresh token as an **httpOnly, SameSite=strict**
cookie — so JavaScript can't read it and an XSS can't steal the durable credential.

Refresh tokens are stored hashed with **SHA-256**, not bcrypt, because the token is 32 bytes of CSPRNG
output — there's no guessable structure for a slow hash to protect, and bcrypt on every refresh is real
latency. Slow hashing is for low-entropy secrets like passwords, where I use bcrypt at cost 12.

They're organised into **families** and rotated on every use, with reuse detection: presenting an
already-rotated token means someone has a copy, so I revoke the whole family. Records carry a TTL index
so MongoDB expires them rather than a cron job I'd forget to write.

**Interviewer:** Why not delete the old token on rotation?

**Candidate:** Because then a reused token is just "not found", indistinguishable from an expired one,
and you lose the detection entirely. You need the record to know it was *already used*.

The honest wrinkle is a legitimate race — two browser tabs refreshing simultaneously would look like
reuse and log the user out. I'd handle it with a short grace window where the immediately-previous
token is accepted without triggering revocation. That's a real trade-off between security and UX and
I'd want the product's input on the window.

> ▸ **Why this works.** It anticipates the follow-up, and it flags a decision as one that belongs to the
> business rather than silently making it.

**Interviewer:** Do you protect against CSRF?

**Candidate:** On the endpoints where it applies, and I'd want to be precise about which those are.

CSRF exists because browsers attach **cookies** automatically. The browser never attaches
`Authorization: Bearer` by itself, and same-origin policy stops an attacker's script from adding it. So
most of my API isn't vulnerable — it's bearer-authenticated.

The ones that *are* vulnerable are exactly two: `POST /auth/refresh` and `POST /auth/logout`, because
those authenticate with the refresh **cookie**. Those use a double-submit token with a `timingSafeEqual`
comparison, and the guard is opt-in via a `@CsrfProtected()` decorator — the opposite of my auth
guard's deny-by-default, deliberately, because applying CSRF to bearer endpoints would break every
non-browser client for no benefit.

**Interviewer:** Your CSRF cookie isn't httpOnly. Isn't that a mistake?

**Candidate:** No — it's required. That token isn't a credential; it carries no authority. It only
proves the request came from a page that could read our origin, and our own JavaScript has to read it
to echo it in a header. Making it httpOnly would break the pattern.

The known weakness is that a subdomain XSS can often set cookies on the parent domain and forge a
matching pair. The stronger variant is a signed double-submit — HMAC the token with a server secret and
the session id. I'd reach for that if we had untrusted subdomains.

> ▸ **Why this works.** This was a trap question — the "wrong-looking" decision. The candidate defends
> it on mechanism, then volunteers the actual weakness and its fix.

---

## Round 3 — Architecture (20 minutes)

**Interviewer:** You've built a modular monolith. When would you go microservices?

**Candidate:** When there's a specific force I can name. Independent scaling — one workload needing 10×
the resources of the rest. Team autonomy, which is really about independent deploys and barely exists
below about three teams. Independent deployability, where one module changes daily and another is
regulated. Technology mismatch. Regulatory isolation.

Not on my list: "the codebase is big" — that's a modularity problem, and extracting it into a network
call doesn't fix a bad boundary, it hardens it. And not "it'll scale better", because a stateless
monolith scales horizontally perfectly well.

The failure mode I'd want to avoid by name is the **distributed monolith**: services split by noun, so
every request fans out synchronously to four of them. Every cost of distribution, none of the
independence — and worse reliability, because four 99.9% services in series is 99.6%.

**Interviewer:** Say the force appears. What have you already done to make it possible?

**Candidate:** Five things, all deliberate.

Repositories are **abstract-class ports** — swapping a Mongo implementation for an HTTP one is a new
provider and one line in the module, with no consumer changes. Modules **own their models**, so data
ownership already follows the module boundary. Cross-module communication is already **domain events**,
so moving from `EventEmitter2` to a broker is a transport swap. There are **zero circular
dependencies**, which matters because a cycle across a network is a distributed deadlock. And
correlation IDs are already propagated, which is painful to retrofit.

**Interviewer:** Which module first, and which never?

**Candidate:** Notifications first — it's already asynchronous, already event-driven, nothing waits on
it synchronously, and it has a completely different scaling profile. It consumes `TASK_ASSIGNED` rather
than being called, so extracting it needs **no caller changes at all**. Activity logs second: write-
heavy, read-rarely, its own retention rules, already a wildcard subscriber.

Never: Users, Projects, Tasks and Comments. They're one transactional cluster — creating a task checks
project membership, deleting a project cascades. Split them and every one of those becomes a
distributed transaction with sagas and compensating actions.

The heuristic I'd use is: **a boundary that a transaction crosses is a bad boundary.**

**Interviewer:** How would you extract notifications without a big bang?

**Candidate:** Strangler fig. Publish the domain events to a broker *as well as* in-process — pure
addition, zero risk, nothing consumes them yet. Stand up the new service consuming from the broker,
writing to its own store, and run it in parallel comparing output before switching anything. Then move
the read path behind a gateway. Then turn off the in-process listener. Then **delete the code and the
collection** — which is the step teams skip, and skipping it means you now maintain both.

Steps one to three are all reversible, which is the property that makes it safe.

**Interviewer:** How do you keep events reliable if the process dies mid-operation?

**Candidate:** You can't, with an in-process emitter — that's its actual limitation. "Save to the
database, then publish" is a **dual write** and isn't atomic; crash in between and the two systems
diverge permanently with no way to detect it afterwards.

The answer is the **transactional outbox**: write the event into an outbox collection in the *same
transaction* as the state change, and have a separate relay publish it and mark it sent. That gives
at-least-once, which means consumers must be idempotent — same reasoning as the `jobId` deduplication
on my BullMQ jobs. Exactly-once delivery doesn't exist; exactly-once processing is at-least-once plus
an idempotent consumer.

**Interviewer:** You need to rename a field on 10 million documents with no downtime.

**Candidate:** Expand, migrate, contract — three deploys, because during any rolling deploy **both
versions run at once**.

Expand: add the new field, write both, read the old. Safe with either version live. Migrate: backfill
in batches with a cursor, throttled and resumable, off-peak; then switch reads. Contract: stop writing
the old field, drop it once nothing reads it.

The cost is three deploys instead of one and a window where both fields exist. That's what you pay to
not take production down mid-rollout. And a rename is *always* add plus backfill plus remove — treating
it as one operation is the mistake.

---

## Round 4 — Debugging (15 minutes)

**Interviewer:** Production alert: p99 latency has tripled. Everything else looks normal. Go.

**Candidate:** Narrow before profiling.

First, is it everything or one endpoint? RED metrics per route. If it's one, it's that handler's
queries; if it's everything, it's shared — the database, the pool, or the event loop.

Second, latency or saturation? Is the connection pool full? Requests waiting for a connection show up
as latency with an idle database, which is the most confusing profile there is.

Third — and this finds it most of the time — turn on MongoDB's slow-query log with `slowms: 100` and
look. Then `.explain('executionStats')` on whatever shows up, comparing `totalDocsExamined` with
`nReturned`. If it's 50,000 examined to return 20, the index is wrong.

Fourth, event-loop lag. If p99 lag is high, something is blocking and no amount of horizontal scaling
will help.

Only then a CPU profile, and only of the specific endpoint.

**Interviewer:** Slow-query log shows nothing. All queries under 20ms.

**Candidate:** Then it's not the queries, and the arithmetic tells me that immediately — four indexed
queries at 20ms can't produce a tripled p99 on their own.

So: how many queries per request? Twenty fast queries is an N+1 and looks fine in the slow log. Are
independent awaits running sequentially where `Promise.all` would do? Is something CPU-bound in the
handler — a big JSON serialisation, a regex over user input? I escape regex inputs specifically because
a crafted pattern like `(a+)+$` causes catastrophic backtracking and pins a core.

And I'd check what changed. p99 tripling with no code deploy points at **data volume** or a **cold
cache** — a query that was fine at 100,000 documents and isn't at a million.

**Interviewer:** Good. Different one: a background job is sending duplicate emails.

**Candidate:** Expected behaviour meeting a non-idempotent handler. At-least-once is the norm.

The cause is usually a **stalled job** — the worker died mid-job and BullMQ recovered it. Worth noting
that's not a retry, so setting `attempts: 1` doesn't prevent it, which is the thing people get wrong.

Fix in two layers: a deterministic `jobId` so BullMQ deduplicates at enqueue, and — the real fix — an
idempotent handler that records "email sent for event X" and checks before sending.

I'd also check that workers shut down gracefully. If `SIGTERM` never reaches Node, every deploy kills
jobs mid-flight and they all get recovered and re-run. That's why my Dockerfile uses `CMD ["node",
"dist/main"]` rather than `npm run start:prod` — npm doesn't forward signals, so it sits at PID 1 and
Node never hears the signal.

> ▸ **Why this works.** The candidate connects a symptom (duplicate emails) to a cause three layers away
> (container `CMD` form). That kind of cross-layer link is the clearest evidence of real operational
> experience in the whole transcript.

**Interviewer:** Last one. You scaled to three instances and users report random logouts.

**Candidate:** State in process memory. Either an in-memory session or refresh-token store, or — the
one I'd check first — a JWT secret generated at boot instead of injected, so each instance signs with a
different key and only validates its own tokens.

My design constraint is that nothing per-user lives in the process: JWTs are self-contained, refresh
tokens are hashed in MongoDB, secrets come from validated config, and the boot validation actually
fails if the access and refresh secrets are equal — because then an access token would be accepted as a
refresh token.

The honest trade-off of self-contained JWTs is that you can't revoke before expiry. That's why access
tokens are short and revocation happens at the refresh boundary. If we needed instant revocation we'd
need a denylist, and that reintroduces a per-request lookup — which is a real cost, so I'd want to know
the requirement before paying it.

---

## Round 5 — Candidate questions (5 minutes)

**Interviewer:** What questions do you have?

**Candidate:** Four.

How do you handle database migrations — is there a review step, and are they separated from the deploy?
What does a deploy look like end to end, and how long from merge to production and back out again if
it's wrong? What's your test suite's runtime — because that number tells me a lot about the day-to-day.
And how do you find out something's broken: an alert, or a customer?

**Interviewer:** Good questions. Anything else?

**Candidate:** One more, and it's the one I actually care about: **what's the technical debt you'd fix
first if you had a month?**

> ▸ **Why this works.** It is the most useful question in an interview. The answer tells you whether the
> team knows its own weak points — and a team that cannot name any is telling you something. It also
> signals that the candidate expects to own the system, not just close tickets.

---

## What made this interview go well

Nine things, all reusable:

1. **The experience question was answered in round 1 and never came back.** Honest, specific, delivered
   as a strength, ending with an invitation to be tested.
2. **Mechanism, not vocabulary.** "`design:paramtypes` via reflect-metadata" beats "it uses decorators".
3. **Every claim had a file behind it.** "In my project, X, and here's why" — the difference between
   having read and having built.
4. **Trade-offs volunteered unprompted**, including the cost of the candidate's *own* preferred
   solutions. Very hard to fake.
5. **Decisions attributed to the right owner.** The refresh grace window was flagged as a product
   decision, not silently made.
6. **A trap question defended on mechanism** (the non-httpOnly CSRF cookie), then its real weakness
   volunteered.
7. **Debugging answered as a narrowing strategy**, not a tool list. "I'd profile it" is not an answer.
8. **Arithmetic used to rule things out.** Four queries at 20ms cannot make 4 seconds — so stop looking
   there.
9. **Cross-layer connections.** Duplicate emails → stalled jobs → signal forwarding → the Dockerfile.

## What to practise

- **Say your answers out loud, at full length.** Silent reading feels like knowing and is not. The gap
  between "I know this" and "I can explain this in 90 seconds" is the entire interview.
- **End substantive answers with the trade-off.** Make it a reflex.
- **Rehearse the experience answer until it is automatic**, so it costs you no composure when it comes —
  and it will come first.
- **Have your three stories ready**: something you built, something you debugged, something you got
  wrong and fixed. The third one is the one candidates never prepare and interviewers always ask for.

---

**Back to:** [the question bank](phase-21-interview-questions.md) · [README](../README.md)
