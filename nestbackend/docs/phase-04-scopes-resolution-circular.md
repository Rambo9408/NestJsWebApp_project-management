# Phase 4 — Provider scopes, dependency resolution, circular dependencies

> **Goal:** know what each scope costs, be able to debug a resolution error in under a minute, and be
> able to argue about circular dependencies rather than just quote `forwardRef`.

Files delivered:

```
src/examples/scopes/counters.ts               three scopes, one instanceId each
src/examples/scopes/scope-inspector.service.ts ModuleRef.get vs resolve, contextId
src/examples/scopes/scopes.controller.ts       GET /api/v1/scopes — observable scopes
src/examples/scopes/scopes-demo.module.ts      a hand-written DynamicModule
src/examples/scopes/scopes.spec.ts             scope behaviour as assertions
src/users/  src/projects/                      a REAL circular dependency + forwardRef
```

Verified: `lint` ✅ · `tsc` ✅ · `npm test` ✅ **46 passing** · `/scopes` observed live ✅ ·
circular rule returns 409 over HTTP ✅

---

## 1. The three scopes, observed

```bash
curl -s localhost:3000/api/v1/scopes    # call it twice and compare
```

Real output from this repo:

```
                  call 1        call 2
singleton         173ea384      173ea384    ← never changes; calls 1 → 2
requestScoped     d48408c6      5a7b85a2    ← new every request
transient in A    6677007b      6677007b    ← per injection site, stable
transient in B    a2af2301      a2af2301    ← different object from A
controller        lhzkiy6n      clzukr6j    ← CHANGES. It declares no scope.
```

**That last line is the whole lesson.** `ScopesController` has no `@Injectable({ scope })`. It is
request-scoped anyway, because it injects `RequestScopedCounter`. **Scope bubbles upward**, silently,
converting every consumer above it.

| Scope | Instances | Real use | Cost |
| --- | --- | --- | --- |
| `DEFAULT` | one per application | ~everything | none |
| `REQUEST` | one per request | correlation id, tenant, current user, transaction handle | rebuilds the whole chain above it, per request |
| `TRANSIENT` | one per **injection site** | a logger that knows its owner (`INQUIRER`) | N copies of any state it holds |

### Singleton: the rule and the danger

A singleton lives for the whole process, so:

- **Anything it accumulates lives forever.** `private readonly seen = new Map()` with no eviction is
  a textbook leak — invisible until the container OOMs.
- **It must be stateless with respect to a request.** Storing `this.currentUser` on a singleton is
  not a subtle bug: two concurrent requests share the object, request B overwrites A's user, and A
  acts as B. That is a data-leak-shaped bug and the most dangerous mistake in this topic.

### Request scope: when, and the three alternatives

Genuinely useful for per-request context that must reach code far from the controller — correlation
id, tenant id, the authenticated user, a transaction handle. But rank the options:

1. **Pass it as a method argument.** Explicit, zero magic, zero cost. Verbose across five layers.
2. **`AsyncLocalStorage`** (`node:async_hooks`) — a *singleton* service backed by per-request async
   context. This is what `nestjs-cls` does, and what most production apps use for correlation ids,
   precisely because it avoids bubbling. Trade-off: implicit, small async-hooks cost.
3. **Request scope.** Correct, framework-native, most expensive.

Hard constraint: **`app.get()` cannot retrieve a request-scoped provider** — there is no request.
Use `moduleRef.resolve()`. The same limitation is why a request-scoped `APP_GUARD` makes every
request pay.

### Transient: the misconception

> "Transient means a new instance per request."

It does **not**. Transient is **per injection site**. A transient injected into a singleton is created
once, with the singleton, and lives as long as it does. Only a transient inside a *request-scoped*
parent is recreated per request — because its parent is.

The canonical real use is `INQUIRER`, a built-in token valid only in transient providers that gives
you the class which asked for the injection:

```ts
@Injectable({ scope: Scope.TRANSIENT })
class ContextLogger {
  constructor(@Inject(INQUIRER) parent: object) { this.context = parent.constructor.name; }
}
```

---

## 2. `ModuleRef`

| Method | Behaviour |
| --- | --- |
| `get(TOKEN)` | Sync. Returns the **singleton**. **Throws** for scoped providers. `{ strict: false }` searches the whole app |
| `resolve(TOKEN, contextId?)` | Async. Creates a **new** instance of a scoped provider. Same `contextId` → same instance |

Proven live:

```json
"sameContextTwice": { "first": "c8d940ba", "second": "c8d940ba", "same": true }
```

That is exactly the mechanism Nest uses per HTTP request: one context id, so every provider in that
request shares one instance.

**When `ModuleRef` is right:** resolving a scoped provider from a singleton; genuinely dynamic
dispatch (a plugin registry keyed by a string from the database); lazily breaking a cycle.

**When it is a mistake:** as a general **service locator**. Empty constructors and
`this.moduleRef.get(...)` at the top of every method throws away everything DI gives you —
dependencies vanish from the signature, missing ones fail at *call* time instead of *boot* time, and
tests must stub the container. Constructor injection is declarative; ModuleRef is imperative. Treat
each call as needing a one-line justification.

---

## 3. Debugging dependency-resolution errors

```
Nest can't resolve dependencies of the ProjectsService (ProjectsRepository, ?, NotificationsService).
```

**Read the `?` first** — it marks the failing parameter, and the resolved ones are named. Then:

| # | Check | Typical symptom |
| --- | --- | --- |
| 1 | Is the class decorated `@Injectable()`? | Missing `design:paramtypes` |
| 2 | Is it in *some* module's `providers`? | Token was never registered |
| 3 | Is it in that module's **`exports`**? | ~45% of real cases |
| 4 | Does the consumer **`imports`** that module? | ~45% of real cases |
| 5 | Is it an **interface**? | Needs `@Inject(TOKEN)` — Phase 3 |
| 6 | Is there a **circular import** between the two files? | "appears to be undefined at runtime" |
| 7 | Did someone write `import type { X }`? | Erased at runtime, so the token is `undefined` |

Two more error shapes worth recognising on sight:

```
The module at index [0] of the UsersModule "imports" array is undefined.
  → a circular *module* import; needs forwardRef on both sides

UsersService is marked as a scoped provider... use resolve() instead of get()
  → you called app.get()/moduleRef.get() on a REQUEST/TRANSIENT provider
```

**A trick worth knowing:** `NestFactory.create(AppModule, { snapshot: true })` records the dependency
graph so Devtools can render it. For a quick check, the boot log's `InstanceLoader` lines already
tell you the module initialisation order.

---

## 4. The circular dependency — built for real

A new rule arrived: *"you may not delete a user who still owns active projects."* Putting it in
`UsersService` closes the loop:

```
UsersService   ──needs──▶ ProjectsService     (count their projects)
ProjectsService ──needs──▶ UsersService        (validate the owner exists)
```

### Why it breaks — and it is not Nest's fault

To evaluate `users.module.ts`, Node must evaluate its import of `projects.module.ts`, which must
evaluate its import of `users.module.ts` — which is mid-evaluation, so Node returns a **partially
initialised** module object. One of the two classes is `undefined` at the moment the decorator runs,
and `design:paramtypes` captures that `undefined`.

### `forwardRef` is lazy evaluation, nothing more

```ts
imports: [forwardRef(() => ProjectsModule)]                       // module level
@Inject(forwardRef(() => UsersService)) private users: UsersService  // provider level
```

Wrapping the reference in a **function** means the class is read later, when Nest calls it, by which
time both files have finished evaluating.

### It must be on **both** sides — and I proved it by getting it wrong

I first added `forwardRef` only on the `UsersService` side. Nine tests failed with:

```
Nest can't resolve dependencies of the ProjectsService (ProjectsRepository, ?, NotificationsService).
- The dependency at index [1] appears to be undefined at runtime
- This commonly occurs when using 'import type' instead of 'import' for injectable classes
```

A cycle has two edges; both need deferring. (Note Nest's hint about `import type` — same class of
problem: a value that exists to TypeScript but not at runtime.)

### The subtlety that bites later

A `forwardRef`'d dependency is **not populated during a window at bootstrap**. Touching it in a
**constructor** — or a very early lifecycle hook — can still throw. Using it only inside methods, as
`UsersService.remove()` does, is safe.

### It works

```bash
DELETE /api/v1/users/<owner-id>
→ 409 {"message":"Cannot delete a user who owns 1 active project(s); archive or transfer them first"}

POST /api/v1/projects/<id>/archive
DELETE /api/v1/users/<owner-id>
→ 204
```

### Why it is still a smell

1. **It breaks modularity.** Neither module can be understood, tested, or extracted alone. Phase 20
   has no seam to cut here.
2. **It hides a missing concept.** A cycle almost always means a third thing neither module owns —
   here, *account lifecycle*.
3. **It is fragile.** Add a third module to the cycle, or an `onModuleInit` that calls across it, and
   you get initialisation-order bugs that are genuinely hard to diagnose.
4. **Read `UsersService.remove()` and feel it.** A service whose job is users now has an opinion
   about projects. That discomfort *is* the diagnosis.

### The four ways out, worst to best

| # | Approach | Verdict |
| --- | --- | --- |
| 1 | `forwardRef()` | Works. Keeps the coupling. What we did, so you have seen it. |
| 2 | Lazy `ModuleRef.get()` inside a method | No evaluation cycle, same coupling, service location |
| 3 | **Extract the shared concept** — an `AccountsModule` importing both, owning "close this account" | Arrows point one way again |
| 4 | **Invert with a domain event** — `UsersService` emits `user.deletion_requested`; `ProjectsModule` subscribes | Compile-time dependency disappears; also works across processes |

**Phase 13 replaces this with option 4, and the diff is the lesson.**

> **Interview answer, compressed:** "`forwardRef` defers the class reference so the ES module cycle
> resolves. It works, but I treat a cycle as a signal that a concept is missing — usually I extract
> the shared behaviour into a third module or invert the dependency with a domain event, and reserve
> `forwardRef` for when I can't change the design right now."

**One mercy worth noticing:** a circular dependency between *modules* does not have to become one
between *test fixtures*. `users.service.spec.ts` stubs `ProjectsService` with a two-line fake — no
`forwardRef`, no `ProjectsModule`. That the test can decouple them is a hint that production can too.

---

## 5. A hand-written dynamic module

`ScopesDemoModule.registerIf(enabled)` returns a `DynamicModule`:

```ts
{ module, imports?, providers?, controllers?, exports?, global? }
```

`registerIf(false)` returns `{ module: ScopesDemoModule }` — nothing registered, route never mapped.
That is how a diagnostics endpoint can exist in the codebase without existing in production.

The simpler alternative is conditional spreading at the composition root
(`imports: [...(isDev ? [M] : [])]`), which is arguably where the decision belongs. For anything
elaborate, Nest ships `ConfigurableModuleBuilder` to generate the
`register`/`registerAsync`/`OPTIONS_TYPE` boilerplate.

---

## 6. Phase 4 interview questions

**1. Name the three scopes and the default.**
`DEFAULT` (singleton, one per application — the default), `REQUEST` (one per request), `TRANSIENT`
(one per injection site).

**2. What is scope bubbling?**
A provider that depends on a request-scoped provider becomes request-scoped itself, transitively, up
to and including the controller. One scoped leaf can convert a whole vertical slice.
*Follow-up:* how would you find out it happened? The provider stops being retrievable with
`get()`; and in Devtools/graph the affected chain shows as scoped. Symptomatically: throughput drops
with no code change nearby.

**3. Why isn't request scope the default?**
Per-request allocation, per-request graph reconstruction for the affected subtree, loss of singleton
caching along that chain, and it is contagious.

**4. Give a legitimate use of request scope, and a cheaper alternative.**
Correlation id / tenant / current user / transaction handle. Cheaper: pass it as an argument, or use
`AsyncLocalStorage` behind a singleton (what `nestjs-cls` does).

**5. Does `TRANSIENT` mean "new instance per request"?**
No — per injection site. Injected into a singleton, it is created once and lives as long as the
singleton.

**6. What is `INQUIRER`?**
A built-in token, valid in transient providers, that injects the class which requested the injection.
The standard way to build a logger that labels itself with its owner's name.

**7. `ModuleRef.get()` vs `resolve()`?**
`get` is sync and returns the singleton, throwing for scoped providers. `resolve` is async and mints
a new instance per DI context; the same `contextId` returns the same instance.

**8. What is the danger of `ModuleRef`?**
Service location: dependencies disappear from constructors, failures move from boot time to call
time, and tests must stub the container.

**9. Why does a circular dependency break, at the JavaScript level?**
Cyclic ES/CJS module evaluation returns a partially initialised module object, so one class is
`undefined` when the decorator runs and `design:paramtypes` captures that.

**10. What does `forwardRef` actually do?**
Wraps the class reference in a function so it is read later, after both modules finish evaluating.
Lazy evaluation, nothing more.

**11. Do you need it on one side or both?**
Both. A cycle has two edges. One-sided only moves the failure.

**12. What still goes wrong with `forwardRef`?**
The dependency is undefined during a bootstrap window, so using it in a constructor or a very early
lifecycle hook can throw. Use it only inside methods.

**13. Is `forwardRef` acceptable in production code?**
Sometimes — but treat it as a marker. Prefer extracting the missing concept into a third module, or
inverting the dependency with a domain event. State the trade-off rather than a rule.

**14. How do you debug "Nest can't resolve dependencies of X (?)"?**
Read the `?` for the failing index, then: `@Injectable()` present → registered in some module →
**exported** → **imported** by the consumer → is it an interface needing `@Inject(TOKEN)` → is it a
circular import → is it `import type`.

**15. Two modules both declare `providers: [FooService]`. How many instances?**
Two. The instance belongs to the declaring module. One owner, exported.

**16. Why can't a request-scoped provider be an `APP_GUARD`?**
It can, but then the guard — and its whole dependency chain — is constructed on every request, for
every route. That is usually an unacceptable cost for something on the hot path.

**17. How would you write a module that is only active in some environments?**
A static method returning a `DynamicModule` (empty when disabled), or conditional spreading in the
parent's `imports`. Prefer the latter for simple cases; the former when the module should own the
rule.

---

## 7. Phase 4 scenario questions

**A — "Throughput dropped 60% after a small refactor and nobody touched the hot path."**
Look for a newly request-scoped provider. Someone made a repository or a context helper
`Scope.REQUEST`, and bubbling converted every service and controller above it, so the graph is now
rebuilt per request. Confirm by checking which providers `app.get()` can no longer retrieve. Fix by
moving per-request state to `AsyncLocalStorage` or a method argument.

**B — "A user occasionally sees another user's data, but only under load."**
Per-request state on a singleton. Something is doing `this.currentUser = ...` in a provider that is
shared by every concurrent request. Grep for assignments to `this.` in services outside the
constructor. This is why "singletons must be stateless with respect to a request" is a rule and not
a preference.

**C — "`app.get(SomeService)` throws in a script that worked last week."**
`SomeService` (or something it depends on) became scoped. Use `moduleRef.resolve()`, or — better —
ask why a CLI script needs a request-scoped provider at all.

**D — "Two teams' modules now import each other and CI fails at boot."**
Short term: `forwardRef` on both sides to unblock. Same day: find the missing concept. Usually one
of the two "needs" is really a third responsibility (billing, account lifecycle, search indexing)
that should own the interaction, or a notification that should be an event. Leave a comment naming
the follow-up, because `forwardRef` is exactly the kind of temporary fix that becomes permanent.

**E — "We want a per-request database transaction available to every repository."**
The textbook request-scope case — but weigh it: request scope rebuilds the chain, while
`AsyncLocalStorage` gives you the same ambient handle from a singleton. Most production Nest code
uses the latter (`nestjs-cls` + a transactional decorator). Either way the rule is the same: the
transaction must be started and committed at exactly one boundary (an interceptor or a decorator),
never inside individual repository methods.

---

## 8. Self-check before Phase 5

- [ ] Predict every id in the `/scopes` output, twice, before running it.
- [ ] Explain scope bubbling and why the controller in that demo is request-scoped.
- [ ] Say why transient is *not* per-request.
- [ ] Explain `get()` vs `resolve()` and what `contextId` does.
- [ ] Recite the 7-step resolution-error checklist.
- [ ] Explain a circular dependency in terms of module evaluation, not framework magic.
- [ ] Say why `forwardRef` is needed on both sides, and what still breaks with it.
- [ ] Name the four ways out of a cycle, in order.

**Next:** Phase 5 — MongoDB and Mongoose. Real schemas for all six collections, `forRootAsync`,
`@InjectModel`, the repository implementations that replace the in-memory ones (one line per module
— the payoff of Phase 3), indexes, `lean()`, projections, `populate` and the N+1 problem,
aggregation, and transactions on the replica set.
