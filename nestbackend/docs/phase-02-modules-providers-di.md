# Phase 2 — Modules, Controllers, Providers and Dependency Injection

> **Goal:** understand the NestJS DI container well enough to reason about it, not just use it —
> what a provider is, how resolution actually works, what module encapsulation buys you, and how to
> read the error message you will see a thousand times.

Files delivered:

```
src/common/enums/role.enum.ts
src/common/dto/pagination.query.ts
src/users/            entities/ dto/ users.repository.ts password-hasher.service.ts
                      users.service.ts users.controller.ts users.module.ts users.service.spec.ts
src/projects/         entities/ dto/ projects.repository.ts
                      projects.service.ts projects.controller.ts projects.module.ts
                      projects.service.spec.ts
src/app.module.ts     (updated: imports UsersModule, ProjectsModule)
```

Verified working: `npm run lint` ✅ · `npx tsc --noEmit` ✅ · `npm test` ✅ 15 passing · all 13
endpoints exercised with curl ✅

---

## Table of contents

1. [What a provider actually is](#1-what-a-provider-actually-is)
2. [What `@Injectable()` does — and does not do](#2-what-injectable-does--and-does-not-do)
3. [The resolution algorithm](#3-the-resolution-algorithm)
4. [Module encapsulation, proven](#4-module-encapsulation-proven)
5. [Provider lifecycle](#5-provider-lifecycle)
6. [Provider scopes — the short version](#6-provider-scopes--the-short-version)
7. [Controllers: responsibility and conventions](#7-controllers-responsibility-and-conventions)
8. [Express side by side](#8-express-side-by-side)
9. [Try it yourself](#9-try-it-yourself)
10. [Phase 2 interview questions](#10-phase-2-interview-questions)
11. [Phase 2 scenario questions](#11-phase-2-scenario-questions)
12. [Self-check before Phase 3](#12-self-check-before-phase-3)

---

## 1. What a provider actually is

**The one-sentence definition that unlocks everything:**

> A provider is a `{ token, recipe }` pair registered in a module. The container is a
> `Map<Token, Instance>`. Injection is a lookup by token.

Every provider form you will ever see is that pair, written differently:

```ts
providers: [UsersService]                                    // shorthand
providers: [{ provide: UsersService, useClass: UsersService }] // ...identical
providers: [{ provide: 'CACHE',  useValue: redisClient }]      // token ≠ class
providers: [{ provide: HASHER,   useClass: Argon2Hasher }]     // swap the recipe
providers: [{ provide: 'CLIENT', useFactory: fn, inject: [X] }] // compute it
```

When you write the class name alone, **the class is both the key and the instruction**. Phase 3 is
entirely about pulling those two apart — and once you have the sentence above, `useClass` /
`useValue` / `useFactory` stop being three things to memorise and become three ways to write the
*recipe* half.

**Why services are providers.** Because DI makes the dependency (a) *declared* — visible in the
constructor, (b) *resolvable at boot* — a missing one crashes at second zero, and (c) *replaceable*
— a test swaps it without touching production code. Compare the Express habit:

```js
module.exports = new UsersService(require('./users.repository'));
```

That is a hand-rolled singleton with a hard-coded dependency. It works — until you need a second
configuration of it, or a fake in a test, or you hit a `require` cycle.

**"Provider" is a role, not a base class.** A service, a repository, a factory, a constant, a helper —
anything the container can produce.

---

## 2. What `@Injectable()` does — and does not do

Less than most people assume. It:

1. attaches scope metadata to the class, and
2. **marks the class as decorated**, which is what makes TypeScript emit `design:paramtypes` for its
   constructor.

It does **not** register anything. Registration is a separate step:

```ts
@Injectable()          // "I can be injected, and here is my constructor type info"
providers: [UsersService]   // "in THIS module, that class exists under token UsersService"
```

That is why a class decorated with `@Injectable()` that nobody lists in a `providers` array still
produces `Nest can't resolve dependencies`.

**The subtle rule worth knowing:** a provider class with *no* constructor dependencies technically
works without the decorator. Decorate everything anyway — the day someone adds a constructor
parameter, the missing decorator becomes a baffling error.

---

## 3. The resolution algorithm

For each constructor parameter, in order:

```
a. determine the TOKEN
     from design:paramtypes (the class), or from @Inject(TOKEN)
b. look in THIS module's providers
c. look in the exports of every module in THIS module's imports
d. look among @Global() modules
e. otherwise → throw, marking the failing parameter with `?`
```

Resolution is **depth-first**: a dependency is fully constructed before its dependent. Each
singleton is created once and memoised.

`UsersService` in this phase is a compact map of the whole algorithm:

```ts
constructor(
  private readonly usersRepository: UsersRepository,  // step b — same module
  private readonly passwordHasher: PasswordHasher,    // step b — same module
  private readonly config: AppConfigService,          // step d — @Global() module
) {}
```

And `ProjectsService` shows step **c**:

```ts
constructor(
  private readonly projectsRepository: ProjectsRepository, // step b
  private readonly usersService: UsersService,             // step c — via imports: [UsersModule]
) {}
```

**Array order in `providers` is irrelevant.** Nest resolves by dependency graph, not by position.
Listing `UsersService` before `UsersRepository` works identically. This is a common misconception —
worth testing yourself once so you stop wondering.

### Reading the error message

```
Nest can't resolve dependencies of the ProjectsService (UsersService, ?).
Please make sure that the argument UsersRepository at index [1] is available
in the ProjectsModule context.
```

The `?` marks **which** parameter failed and the resolved ones are shown by name — that is the most
useful part of the message and the first thing to read. Then run the checklist:

1. Is the missing class decorated `@Injectable()`?
2. Is it in **some** module's `providers`?
3. Is it in that module's **`exports`**?
4. Does the consuming module **`imports`** that module?
5. Is there a circular import between the two files? *(Phase 4)*

Roughly 90% of real cases are #3 or #4.

---

## 4. Module encapsulation, proven

`UsersModule` registers three providers and exports **one**:

```ts
providers: [UsersService, UsersRepository, PasswordHasher],
exports:   [UsersService],
```

Add `private readonly repo: UsersRepository` to `ProjectsService`'s constructor — keeping
`imports: [UsersModule]` — and the app refuses to boot. TypeScript compiled it. The file exports the
class. The module was imported. **It still fails**, because module encapsulation is a *runtime
container rule*, not a compiler rule.

That gap — compiler happy, container not — is the thing Express structurally cannot give you, and
the single most useful property of Nest modules to be able to explain.

### The three wrong fixes

| "Fix" | What actually happens |
| --- | --- |
| Add `UsersRepository` to `exports` | Encapsulation gone. Every rule in `UsersService` (unique email, cannot delete the last admin) becomes optional. Legitimate *only* if you intend it as public API. |
| Add `UsersRepository` to `ProjectsModule.providers` | **The dangerous one.** It "works" and silently creates a **second, independent instance** — two Maps, two caches, two pools. Bug report: *"users I create disappear."* |
| Make `UsersModule` `@Global()` | Global changes whether you must *write* the import; it exports nothing extra. And it hides the dependency graph for everyone. |

**The right fix** is almost always: ask for a *method*, not for internals. `ProjectsService` does not
need `UsersRepository`; it needs *"does this user exist?"* — so `UsersService.findById()` is the
correct dependency and the boundary stays intact.

> **The instance-count question, because interviewers love it:** a provider instance belongs to the
> module that **declares** it. Declare the same class in two modules → two independent singletons.
> One owner, exported — that is the rule.

Conversely, `imports: [UsersModule]` creates **no** second instance. `ProjectsService` and
`UsersController` share the same `UsersService` object, which is why a user created over HTTP is
immediately visible to `ProjectsService`. The curl walkthrough below demonstrates it.

---

## 5. Provider lifecycle

```
instantiated during module init
   → onModuleInit               (this module's providers are ready)
   → onApplicationBootstrap     (EVERY module is ready)
   → [ application serves traffic ]
   → onModuleDestroy
   → beforeApplicationShutdown
   → onApplicationShutdown      (requires app.enableShutdownHooks())
```

**Which hook?** `onModuleInit` for work needing only this module (open a connection, warm a cache).
`onApplicationBootstrap` when other modules must already exist — e.g. `UsersService` seeding the dev
admin, or starting a queue consumer that dispatches into other services.

**Never do I/O in a constructor.** Constructors cannot be async, they run while the graph is still
being built, and a throw there produces a far worse error.

**Singletons live for the whole process** — which is exactly why a provider holding per-request state
is a bug: two concurrent requests share the same object. That is the problem request scope solves,
and the reason it costs what it costs.

---

## 6. Provider scopes — the short version

Phase 4 covers this properly. The one-paragraph version so the vocabulary is in place:

| Scope | Instances | Cost |
| --- | --- | --- |
| `DEFAULT` (singleton) | one per application | none — this is what you want |
| `REQUEST` | one per incoming request | the entire dependency chain above it becomes request-scoped too |
| `TRANSIENT` | a new one for every injector | cheap-ish, but easy to misuse |

The trap that makes this an interview question: request scope is **contagious upward**. Make a
repository request-scoped and every service and controller that depends on it is instantiated per
request as well. Everything in this phase is `DEFAULT`, deliberately.

---

## 7. Controllers: responsibility and conventions

Every controller method here is: *bind input → call one service method → return*.

**Why no logic in controllers?** A controller is coupled to HTTP, so any rule living inside it can
only be triggered by an HTTP request. The moment *"you cannot delete the last admin"* must also hold
for a queue worker (Phase 12), a WebSocket handler (Phase 11) or a CLI script, that logic has to
move. Keeping controllers thin from day one means it never has to.

**The measurable test:** if you cannot describe a controller method in one sentence without the word
"and", it is doing too much.

### Parameter binding

| Decorator | Binds | Type at runtime |
| --- | --- | --- |
| `@Body()` | parsed JSON body | **whatever the client sent** — see warning below |
| `@Param('id')` | route parameter | `string` |
| `@Query('page')` | query string value | `string` |
| `@Headers('x-request-id')` | request header (lowercase) | `string` |

> **The most dangerous misconception a new Nest developer can have:** `@Body() dto: CreateUserDto`
> gives you *compile-time* safety only. Right now, at runtime, the body is whatever the client sent —
> TypeScript validates nothing. That is why `UsersService` still checks by hand in this phase.
> Phase 6's `ValidationPipe` is what makes the annotation *true* at runtime, by constructing a real
> DTO instance and validating it.

### Status codes used, and why they are not decoration

| Code | When | Why it matters |
| --- | --- | --- |
| 201 | POST success (Nest default) | Tells the client a resource was created |
| 200 | GET/PATCH/PUT, and `POST /:id/archive` | Archive creates nothing — 201 would be a lie |
| 204 | DELETE success | "Success, deliberately no body" |
| 400 | Malformed input | Client fixes the request |
| 404 | Resource absent | Client stops retrying |
| 409 | Valid request, conflicting state | Duplicate email — **not** 400, **not** 500 |

Clients branch on these. Returning 500 for a duplicate email tells the client to retry, and it will
fail forever.

### Route order matters

Nest registers routes in declaration order and Express matches the first fit:

```ts
@Get('archived')   // ✅ declare static paths BEFORE parameterised ones
@Get(':id')        //    otherwise ':id' matches and id === "archived"
```

### Verbs and idempotency

- `POST` is **not** idempotent — two identical POSTs create two users. That is the "double-click
  created two orders" bug, and why Phase 12 covers idempotency keys.
- `PUT` replaces wholesale and **is** idempotent. `PUT /users/:id/role` reads as "set the role to
  exactly this", which is genuinely idempotent — modelling a single meaningful state change as its
  own sub-resource is usually better than a generic PATCH, because it documents intent and can carry
  its own authorization rule.
- `PATCH` is a partial update, and its DTO should be an **allow-list** of fields that are safe to
  change generically. Note what `UpdateProjectDto` deliberately omits: `key` (appears in pasted task
  references), `ownerId` (permission-bearing), `members` (own endpoints; also a lost-update race),
  `status` (own endpoint, has side effects).

---

## 8. Express side by side

**The same list endpoint.**

```js
// Express
router.get('/', async (req, res, next) => {
  try {
    const page  = parseInt(req.query.page  || '1', 10);
    const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
    const users = await userService.findAll({ search: req.query.search }, { page, limit });
    res.json(users);
  } catch (err) { next(err); }
});
```

```ts
// NestJS
@Get()
findAll(
  @Query('page') page?: string,
  @Query('limit') limit?: string,
  @Query('search') search?: string,
): Promise<Paginated<PublicUser>> {
  return this.usersService.findAll({ search }, buildPaginationQuery(page, limit));
}
```

Gone: `res`, the `try/catch`, the `next(err)`, the mount path, and the `require` of the service.
Still present in *both*: the manual string→number parsing — which is exactly the job Phase 6 hands
to a pipe.

**The dependency.**

```js
// Express: hard-coded by require. To fake it in a test: jest.mock('../db')
const usersRepository = require('./users.repository');
```

```ts
// NestJS: declared, supplied by the container. To fake it in a test:
{ provide: UsersRepository, useValue: fake }
```

**The boundary.**

```js
// Express: nothing stops this
const hasher = require('../users/password-hasher');  // from projects/, freely
```

```ts
// NestJS: refused at boot, because PasswordHasher is not exported
```

---

## 9. Try it yourself

```bash
npm run build && node dist/main.js
```

The development seeder creates `admin@taskflow.dev` on first boot (guarded by `isDevelopment` —
a seeded admin with a known password in production is a backdoor).

```bash
B=http://localhost:3000/api/v1

curl -s $B/users                                      # the seeded admin
curl -s -X POST $B/users -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com","name":"Ada Lovelace","password":"password123"}'

# 409 — and note it is case-insensitive, because emails are normalised
curl -s -X POST $B/users -H 'Content-Type: application/json' \
  -d '{"email":"ADA@example.com","name":"Ada Again","password":"password123"}'

# 404 raised by the CROSS-MODULE call into UsersService
curl -s -X POST $B/projects -H 'Content-Type: application/json' \
  -d '{"key":"GST","name":"Ghost","ownerId":"no-such-user"}'

# 409 — a business rule that lives in the service, not the controller
curl -s -X DELETE $B/users/<the-admin-id>
```

Actual results from this repo:

```
create user      → 201 {"id":"...","email":"ada@example.com","role":"member"}   ← no passwordHash
duplicate email  → 409 {"message":"A user with this email already exists"}
bad input        → 400 {"message":"A valid email is required"}
unknown user     → 404 {"message":"User nope not found"}
unknown owner    → 404 {"message":"User no-such-user not found"}      ← cross-module
archive ×2       → 200, 200                                          ← idempotent
patch archived   → 409 {"message":"Cannot modify an archived project"}
delete last admin→ 409 {"message":"Cannot delete the last remaining admin"}
delete member    → 204 (empty body)
```

**The instance-sharing proof:** the user you create over HTTP is immediately usable as a project
owner. Same `UsersService` object, same repository, one Map. If `ProjectsModule` had declared
`UsersRepository` in its own `providers`, that second call would 404.

### The five-minute experiment worth doing

Add `private readonly repo: UsersRepository` to `ProjectsService`'s constructor and boot. Read the
error. Then fix it the *wrong* way (add `UsersRepository` to `ProjectsModule.providers`) and watch
project creation start rejecting users that demonstrably exist. That failure — silent, plausible, and
hard to diagnose — is the one to have felt once before an interview.

---

## 10. Phase 2 interview questions

**1. What is a provider in NestJS?**
A `{ token, recipe }` pair registered in a module. The token is the lookup key (usually the class);
the recipe tells Nest how to build the value. `providers: [X]` is shorthand for
`{ provide: X, useClass: X }`.
*Follow-up:* Name three things other than a service that can be a provider. — A configuration object
(`useValue`), a database connection (`useFactory`), an interface implementation chosen at runtime
(`useClass` behind a token).

**2. What does `@Injectable()` actually do?**
Attaches scope metadata and — critically — marks the class as decorated so TypeScript emits
`design:paramtypes`. It does not register the class; a module's `providers` array does that.
*Follow-up:* Can a provider work without it? Yes, if it has no constructor dependencies — and you
should still add it, because the day someone adds a parameter it breaks confusingly.

**3. Walk me through how Nest resolves a constructor dependency.**
Token from `design:paramtypes` or `@Inject` → this module's providers → the exports of imported
modules → global modules → throw with `?` marking the failing parameter. Depth-first; each singleton
built once.

**4. `providers` vs `exports`?**
`providers` = built for this module, private to it. `exports` = the module's public API. Importing a
module grants access only to its exports.

**5. A provider class is listed in two modules' `providers`. How many instances exist?**
Two — independent singletons. The instance belongs to the declaring module. This is the classic
"my data disappeared" bug. One owner, exported.

**6. Does importing a module create a second instance of its providers?**
No. Modules are singletons per application; the imported provider is the same object.

**7. Does the order of the `providers` array matter?**
No. Nest resolves by dependency graph, not array position.

**8. Where should business logic live, and why not in the controller?**
In providers. A controller is coupled to HTTP, so logic inside it can only be triggered by an HTTP
request — it cannot be reused by a queue worker, a WebSocket handler or a CLI script.

**9. Why inject `UsersService` into `ProjectsService` rather than `UsersRepository`?**
The service is a contract; the repository is an implementation detail. Depending on the contract
lets UsersModule change storage, add caching, or move behind a remote call without touching
ProjectsService — which is exactly the seam a microservice extraction cuts along. It is also
enforced: the repository is not exported.

**10. What is the repository pattern buying you here, given Mongoose models already exist?**
Testability (a service can be unit-tested against an in-memory fake with no infrastructure and no
brittle `model.find().sort().skip().exec()` mock chains), leakage control (Mongo query syntax stays
out of business logic), and one place for query discipline (projections, `.lean()`, pagination
limits).
*Follow-up:* When is it not worth it? When the wrapper is a pass-through of thirty generic methods.
The pattern earns its keep when the interface is narrow and expressed in domain terms.

**11. Where do you put a rule like "cannot delete the last admin"?**
In the service. Not the controller (it must hold for non-HTTP callers), not the database (it is
domain policy, not data integrity).

**12. Your uniqueness check is `findByEmail` then `create`. What is wrong with it?**
Check-then-act is not atomic; two concurrent registrations can both pass. The application check
exists for a friendly message; the *guarantee* must be a unique index in the database. "Validate in
the app, enforce in the database."

**13. Why 409 for a duplicate email rather than 400 or 500?**
400 says the request was malformed — it was not. 500 blames the server and tells clients to retry,
which will fail forever. 409 says "valid request, conflicting state", which is actionable.

**14. Which lifecycle hook for opening a database connection, and why not the constructor?**
`onModuleInit` (or `onApplicationBootstrap` if other modules must be ready). Constructors cannot be
async, run mid-graph-construction, and produce worse errors on failure.

**15. `onModuleInit` vs `onApplicationBootstrap`?**
The first runs when *this* module's providers exist; the second when *every* module is initialised.
Use the second when your work reaches into other modules — e.g. seeding, or starting a consumer that
dispatches into other services.

**16. Entity vs DTO vs Schema?**
Entity = domain model (business logic speaks it). DTO = wire model (validated inbound, shaped
outbound). Schema = persistence model (Mongoose fields, indexes, hooks). Keeping them apart prevents
the single most common Node data leak — returning the database document, and with it `passwordHash`
— and stops a column rename from being a breaking API change.

**17. What is mass assignment and how does this codebase prevent it?**
`Object.assign(user, req.body)` lets a client send `{"role":"admin"}` and promote themselves. The
DTO is an allow-list of settable fields, and Phase 6's `whitelist: true` strips everything not on it.

**18. Why does `PublicUser` exist rather than returning the entity?**
So a controller physically cannot leak the hash. `toPublicUser` is an allow-list, not a
`delete user.passwordHash` deny-list — a deny-list silently includes any newly added secret field.

**19. Why is `Role` in `common/` when it is clearly a user concept?**
The `common/` rule is about *dependencies*, not topic. `Role` is a pure value with zero imports, so
putting it there creates no coupling — and it prevents `common/guards/roles.guard.ts` (Phase 8) from
having to import a feature module. If it ever needs an import from `users/`, it must move.

**20. Why string enum values instead of numeric?**
Numeric enums store 0/1/2: unreadable in the database, exposed as meaningless integers in JSON, and
inserting a new member in the middle silently renumbers every existing record — real data corruption.

**21. What is the difference between a global role and a project role here, and why does it matter?**
A user can be a MANAGER of one project and a MEMBER of another. Collapsing them into one field
either over-grants (global manager = manager everywhere) or accumulates special cases. It also means
authorization needs two guards: one for the global role, one that loads membership for the requested
resource — that second one is "resource-level authorization", and it is where most implementations
hand-wave.

---

## 11. Phase 2 scenario questions

**A — "Users created through the API are missing when another service looks them up."**
Almost certainly two instances of the same provider. Someone hit a resolution error and "fixed" it by
adding the repository to a second module's `providers`. Check every `providers` array for duplicate
registrations of the same class; the owner should declare and export it, and everyone else should
import the module. The general rule: *one owner, exported*.

**B — "A junior added `@Global()` to `UsersModule` because three modules needed it."**
Push back. Three explicit imports are three lines of self-documentation. `@Global()` is for
stateless, read-only, universally-needed infrastructure (config, logging). If a feature module truly
is needed everywhere, the more likely diagnosis is that too much has accumulated in it and something
should be extracted.

**C — "We need to check a user's projects before deleting them, so `UsersService` needs
`ProjectsService`."**
That closes a cycle: `UsersService → ProjectsService → UsersService`. `forwardRef()` will compile it
and is the *worst* of the four options. Better, in order: (1) emit a `user.deletion_requested`
domain event and let `ProjectsModule` react — the dependency now points one way through the event
bus; (2) move the orchestration up to a caller that legitimately knows both (a controller or an
application service); (3) extract the shared rule into a third module both depend on. Phase 4 builds
all four so you can compare them.

**D — "`POST /projects` returns 500 with a CastError in production."**
An unvalidated path or body parameter reached Mongoose where an ObjectId was expected. The client
made a mistake but the server took the blame, and your error monitoring is now full of noise.
Fix: `ParseUUIDPipe`/`ParseObjectIdPipe` on the parameter and `@IsMongoId()` on the DTO, so it is a
400 before the service runs (Phase 6).

**E — "Login latency spikes to 8 seconds under load, but the database is idle."**
Password hashing is CPU-bound and Node runs your JavaScript on one thread. At cost factor 12 (~250ms)
and 40 concurrent logins, everything queues behind it — including unrelated requests. Three
mitigations: always use the async bcrypt API (it uses libuv's threadpool, sized by
`UV_THREADPOOL_SIZE`), rate-limit auth endpoints hard because login is the one route where an
attacker controls how much CPU you burn (Phase 10), and if volume demands it, move hashing off the
API process entirely.

---

## 12. Self-check before Phase 3

- [ ] State the `{ token, recipe }` definition of a provider without hesitating.
- [ ] Recite the five resolution steps and say which one each of `UsersService`'s three dependencies
      uses.
- [ ] Explain why `providers: [X]` in two modules gives two instances, but `imports: [M]` gives one.
- [ ] Read a "can't resolve dependencies" error and name the five things to check, in order.
- [ ] Explain why `PasswordHasher` is not exported, and what breaks if it is.
- [ ] Explain why `@Body() dto: CreateUserDto` is not validation.
- [ ] Justify 409 vs 400 vs 500 for a duplicate email.
- [ ] Explain the check-then-act race and where the real guarantee has to live.

**Next:** Phase 3 — provider tokens and custom providers. We take the `{ token, recipe }` sentence
literally: `useClass` to swap the hasher implementation, `useValue` for frozen app metadata,
`useFactory` (async, with `inject`) for a real client, and `@Inject()` with string/symbol tokens for
the things you cannot name in a constructor signature — starting with an interface.
