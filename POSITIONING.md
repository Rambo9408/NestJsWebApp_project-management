# Positioning

> **Parts 53–54.** The consolidated Angular↔React translation, and how to talk
> about your experience without lying about it.

---

## The rule this document follows

**Do not claim React years you don't have.**

Not because honesty is its own reward in an interview — because *it doesn't
survive contact*. An interviewer who hears "four years of React" asks four-years
questions: what you did when concurrent rendering broke a third-party library,
how your team handled the class-to-hooks migration, what your bundle strategy was
across three products. The gap shows up in ninety seconds, and now the problem
isn't your experience level, it's that you lied.

**What actually works** is being specific about a real, smaller thing. Specific
beats senior. A candidate who can say *"I found a bug where five parallel 401s
triggered five refresh calls and reuse detection logged the user out"* is more
convincing than one who says "I've done a lot of auth work", regardless of years.

---

## Part 1 — What you actually have

Say this version out loud until it's comfortable:

> **2+ years professional TypeScript**, most of it Angular in production, plus
> Node/Express on the backend. **React learned properly about two and a half
> years ago**, used for real projects then, and rebuilt seriously and recently in
> a full-stack project against a NestJS API I also wrote.

Then the substance:

| Area                            | Level                                                 |
| ------------------------------- | ----------------------------------------------------- |
| TypeScript                      | **Strong** — strict mode, generics, discriminated unions, `satisfies` |
| Component architecture          | **Strong** — transfers almost completely from Angular |
| Async/state modelling           | **Strong** — RxJS makes RTK Query and cache invalidation feel familiar |
| REST / auth / JWT / CSRF        | **Strong** — built it, and found real vulnerabilities in it |
| Testing                         | **Strong** — and specifically, why a green suite can be worthless |
| Docker / CI / deployment        | **Solid** — multi-stage images, nginx, pipeline design |
| React fundamentals              | **Solid** — hooks, reconciliation, keys, effects, the render model |
| React ecosystem (RTK Query, RHF, Router 7) | **Solid, recent** — built with all three |
| React performance               | **Working** — profiled and measured, including a fix that made things worse |
| React at scale / large team     | **Not yet** — say so |
| SSR / RSC / Next.js             | **Understood, not shipped** — say so |
| Accessibility                   | **Better than most** — and know exactly what you haven't done |

**The two "not yet" rows are load-bearing.** Volunteering a limit before it's
found makes everything else you said more credible. A candidate who never
concedes anything is one an interviewer has to start testing.

---

## Part 2 — The Angular↔React translation

This is your unfair advantage, and it's underused. Most React candidates can't
explain *why* React works the way it does. Someone coming from Angular can,
because they've seen a system that made the opposite choice.

### The one that everything else follows from

| Angular                              | React                                    |
| ------------------------------------ | ---------------------------------------- |
| Change detection walks the tree comparing **property values** | Bailout compares **references** (`Object.is`) |
| Mutating an object is fine           | Mutating an object is **invisible**       |
| Zone.js patches async to know when to check | You tell React by calling a setter  |

Everything confusing about React descends from that one decision:

- **Why immutability?** Because `prev === next` means "nothing changed". Mutating
  and re-setting is indistinguishable from not changing it.
- **Why dependency arrays?** Because React can't observe what your function
  reads; you declare it.
- **Why `key`?** Because reconciliation needs identity and position isn't it.
- **Why does everything re-render?** Because "render" means "call the function",
  not "touch the DOM" — and that's cheap.

> **Interview gold.** When asked "what was hardest coming from Angular?", this is
> the answer. It's one idea, it explains five surface behaviours, and it shows you
> understand the model rather than the API.

### Concept map

| Angular                          | React                              | Honest note                                            |
| -------------------------------- | ---------------------------------- | ------------------------------------------------------ |
| `@Component`                     | function component                 | Same idea, less ceremony                               |
| `@Input()`                       | props                              | Direct                                                 |
| `@Output()` + `EventEmitter`     | callback prop                      | React is genuinely simpler — no emitter, no subscribe   |
| `ng-content`                     | `children` / `ReactNode` prop      | React's is more flexible: slots are **values**          |
| `*ngIf`                          | `&&` / ternary                     | ⚠ `{count && <X/>}` renders `0`                        |
| `*ngFor` + `trackBy`             | `.map()` + `key`                   | `trackBy` **is** `key`. Same problem, same fix         |
| `ngOnInit`                       | `useEffect(fn, [])`                | ⚠ Not the same: effects run after paint, and twice in StrictMode |
| `ngOnDestroy`                    | effect cleanup return              | Direct                                                 |
| `ngOnChanges`                    | effect with deps / derive in render | Usually you shouldn't — derive instead                |
| `@ViewChild`                     | `useRef`                           | Direct                                                 |
| Services + DI                    | imports, hooks, Context            | **The biggest genuine loss** — see below               |
| `providedIn: 'root'`             | a module-level singleton           | Simpler, less testable                                 |
| RxJS `Observable`                | RTK Query / promises / SSE hook    | No stream primitive in React. This is a real gap        |
| `async` pipe                     | RTK Query hook's `{data,isLoading}` | Same job: subscribe, unwrap, clean up                  |
| Reactive Forms                   | React Hook Form + Zod              | RHF is closer to *template*-driven internally (uncontrolled) |
| `Validators`                     | Zod schema                         | Zod also gives you the **type** — Angular doesn't      |
| `routerLink`                     | `<Link>`                           | Direct                                                 |
| `<router-outlet>`                | `<Outlet />`                       | Direct                                                 |
| Route guards                     | wrapper component / loader         | ⚠ Neither is security. The API is                      |
| Resolvers                        | Router `loader`                    | Very close                                             |
| `HttpInterceptor`                | wrapped fetch / RTK `baseQuery`    | You write it; nothing is automatic                     |
| `NgModule`                       | ES modules                         | React has no module system of its own                  |
| `ChangeDetectionStrategy.OnPush` | `React.memo`                       | Same intent; both defeated by unstable references      |
| `TrackByFunction`                | `key`                              | —                                                      |
| Pipes                            | plain functions / `useMemo`        | React has no template language, so no pipes needed     |
| Zone.js                          | *(nothing)*                        | React never guesses when to update                     |

### What you genuinely lose leaving Angular

Say these unprompted when asked to compare. They read as experience, not
complaint:

1. **Dependency injection.** React has no hierarchical, constructor-injected,
   per-instance, overridable service graph. Context is DI for *values*, not a
   container. Swapping an implementation in tests is a manual affair.
2. **Structure by default.** Angular tells you where things go. React gives you
   `useState` and wishes you luck — which is why a React codebase's architecture
   is a team decision, and why it drifts.
3. **RxJS for genuinely stream-shaped problems.** Debounce-switchMap-retry is
   four operators there and a hand-written hook here.
4. **The CLI and the batteries.** Angular ships routing, HTTP, forms, i18n,
   testing. React ships a renderer; everything else is a decision you own forever.

### And what you gain

1. **JSX is JavaScript.** No template language, no `*ngIf` compilation, no
   separate expression syntax. A component is a function; a slot is a value.
2. **Much better TypeScript ergonomics.** Props are just a type. Generic
   components are easy. Angular templates are only partially type-checked.
3. **Smaller conceptual surface.** Once the reference-equality model clicks,
   there's genuinely less to know.
4. **The ecosystem.** More options, and the good ones (RTK Query, RHF, Zod) are
   excellent.

---

## Part 3 — Answering the hard questions

### "How many years of React do you have?"

> "About two and a half years since I learned it, but I want to be accurate:
> most of my *professional day-to-day* has been Angular and Node. I've built
> React projects in that time and I've rebuilt seriously and recently — the
> current one is a full-stack app with a NestJS API I wrote myself, so I've done
> both ends of the integration. I'd say strong on fundamentals and the modern
> ecosystem, still building depth on React at large-team scale."

**Why this works:** it answers the question, refuses to inflate, and immediately
redirects to substance. The phrase *"I want to be accurate"* signals that the rest
of the interview can be taken at face value.

**Never:** "four to five years." **Never:** "I've been doing React since 2019"
when the truthful version is "I learned it in 2023."

### "You're mostly an Angular developer. Why should we hire you for React?"

> "Because most of what makes someone effective isn't framework-specific.
> Component architecture, async state, forms, routing, auth, testing, deployment
> — those transfer, and Angular is a strict teacher for them. What's genuinely
> React-specific is the rendering model and the ecosystem, and that's what I've
> spent recent months on deliberately. Coming from a framework that made the
> opposite change-detection choice, I can usually explain *why* React works the
> way it does rather than just that it does."

### "What don't you know about React?"

Answer it. Refusing is worse than any of the gaps.

> "Three honest ones. I haven't shipped SSR or React Server Components — I
> understand the model and the trade-offs, but I've made the decision *not* to
> use them rather than to use them. I haven't worked in a React codebase with
> fifty engineers, so I've read about the coordination problems rather than lived
> them. And my performance work has been on desktop builds — I've profiled and
> measured, including a fix that made things worse, but I haven't done real-device
> testing on low-end hardware."

### "Have you worked on a large React application?"

> "Not at the scale of a large product team, no. The one I've built is
> substantial — around 20 routes, generated API types, RTK Query, SSE, RBAC,
> containerised with CI — but it's one person's codebase. What I'd expect to be
> new is the coordination: shared component ownership, migration across many
> teams, and the fact that architectural decisions become social ones."

### "Why do you have a personal project instead of production React experience?"

> "Because I wanted the React-specific depth before I claimed it. Building it
> against my own NestJS API meant I had to solve the integration problems for
> real — token refresh races, contract drift, authorization at three levels — and
> those are the things that don't come up in a tutorial."

---

## Part 4 — The specifics to have ready

Interviews are won on **specific stories**. Have these memorised. Each is a real
thing from this project, each has a number or a mechanism, and each survives a
follow-up.

1. **The authorization audit.** Eight endpoints with no object-level check — a
   second user could read, rename, reassign and **delete** another user's task.
   Fixed with a guard that follows task → project → membership. Backend e2e went
   67 → 90 tests.
   *Follow-up you can answer:* why the collection endpoint is the one that leaks
   quietly.

2. **The whole-API rate limit.** Two named throttlers registered globally in
   `@nestjs/throttler`, on the belief that routes opt into one. Every entry
   applies to every route — so the API was capped at **10 requests per 15
   minutes**. Found by sending 14 requests to a health endpoint and watching 11–14
   return 429.
   *And the kicker:* the container had been sitting at `unhealthy`,
   `FailingStreak: 11`, because a 30-second healthcheck was **rate-limiting its
   own liveness probe**.

3. **The single-flight refresh.** Five parallel 401s → five refresh calls →
   rotation invalidates four → reuse detection revokes the session and logs the
   user out. One in-flight promise fixes it.

4. **The vacuous tests.** Two of my own tests passed whether or not the code was
   correct. Found by reintroducing the bug. One MSW handler re-validated the old
   token, so *"retries with the new token"* passed even when the client replayed
   the stale one.

5. **The performance fix that failed.** Code splitting made cold load *worse* —
   213 → 245 kB gzip, because separate gzip streams share no dictionary. Kept
   anyway for cache stability (a redeploy costs a returning user ~8.5 kB instead
   of 213 kB). Reported as a trade-off, not a win.

6. **The invalid ARIA.** `aria-rowcount` on `role="list"` — the attribute meant to
   fix virtualization's core accessibility problem was invalid and silently
   discarded. It typechecked, linted, rendered, and had a correct comment beside
   it explaining the problem it wasn't solving.

7. **The false claim I corrected.** I wrote *"VERIFIED LOAD-BEARING"* on a test
   comment, then checked, and it was false — jsdom has no layout or hit-testing,
   so no test there could have caught that bug. The correction is in the file.
   *This is a good story to tell*, because "I check my own claims and publish the
   correction" is a rarer trait than knowing jsdom's limits.

**Rehearse each in about sixty seconds:** situation → what was actually wrong →
how it was found → what changed. The *how it was found* clause is the one people
skip and the one interviewers care about.

---

## Part 5 — What not to do

- **Don't inflate years.** Covered above. It fails at the first follow-up.
- **Don't call the project "production".** It isn't. Call it what it is: a
  full-stack project, built seriously, with real integration problems solved.
- **Don't lead with the learning framing.** "I built this to learn React" invites
  them to discount it. Lead with what it *is* — a full-stack app with generated
  API types, RBAC, SSE and CI — and let the learning be the reason it's
  unusually well documented.
- **Don't hide the Angular background.** It's an asset and it explains your
  strengths. Hiding it makes your React depth look thinner than it is, because
  there's no explanation for why your fundamentals are solid.
- **Don't apologise.** "Only a personal project", "just two years" — the qualifier
  does the damage, not the fact.
- **Don't claim the ops work you haven't done.** You've containerised and written
  a pipeline. You haven't run this under load, on-call, at scale. Different thing.
- **Don't oversell accessibility.** You ran axe and fixed what it found, and you
  fixed two Level-A failures it *didn't* find. You have not used a screen reader.
  That distinction is exactly the kind of thing an accessibility-literate
  interviewer will probe, and getting it right is worth more than a broad claim.

---

## Part 6 — The thirty-second version

Memorise this. It's the answer to "tell me about yourself" and the frame for
everything else.

> "I'm a TypeScript developer with a couple of years professional experience,
> mostly Angular on the front end and Node on the back. I learned React a while
> back and I've been rebuilding depth in it deliberately — the current project is
> a full-stack task-management app: NestJS API with JWT auth, RBAC and SSE, and a
> React front end with RTK Query, generated API types and a real CI pipeline.
>
> The part I've found most valuable is that owning both ends forced me to solve
> the integration problems properly — token refresh races, contract drift,
> authorization at the route, collection and object level. I've found real
> security bugs in my own code doing it.
>
> I'd describe myself as strong on fundamentals and honest about where the gaps
> are: I haven't shipped SSR, and I haven't worked in React at large-team scale."

---

## Related

- [INTERVIEW-QUESTIONS.md](INTERVIEW-QUESTIONS.md) — 130 questions; the ★ ones are
  where you have a specific story
- [ARCHITECTURE-QUESTIONS.md](ARCHITECTURE-QUESTIONS.md) — 20 design discussions
- [SENIOR-SCENARIOS.md](SENIOR-SCENARIOS.md) — 40 situations
- [MOCK-INTERVIEW.md](MOCK-INTERVIEW.md) — a full loop, with the follow-ups
