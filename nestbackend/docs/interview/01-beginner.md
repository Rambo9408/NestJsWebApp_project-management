# Beginner — 20 questions

> The ones that open almost every NestJS interview. They look easy; the difference between a weak
> and a strong answer here is entirely in the **why**.

---

### B1. What is NestJS, and what problem does it solve?

**Answer.** A Node.js framework for building server-side applications, written in TypeScript, that
sits _on top of_ an HTTP platform (Express by default, Fastify optionally). It supplies what Express
deliberately does not: a module system, a dependency-injection container, and a defined request
pipeline of guards, interceptors, pipes and filters.

**Why it matters.** Express gives you routing and middleware and stops there. Every team then invents
its own conventions for folder structure, wiring, validation and error handling — and every codebase
looks different. Nest's value is not features, it is that **the structural decisions are already
made**, so a new developer can find things and cross-cutting concerns are applied once instead of
per-route.

**Real-world example.** In this project, authentication is a single global `APP_GUARD`. Every route
is protected by default and opting out requires an explicit `@Public()`. In Express you add
`authMiddleware` to each route and the first one you forget is a breach.

**Common mistake.** Saying "it's Angular for the backend" and stopping. The decorator syntax is
borrowed; the substance is the DI container and the pipeline.

**Follow-up.** _"If Nest is slower than raw Express, why use it?"_ — because the overhead is a few
hundred microseconds against database calls measured in milliseconds, and you are buying structure
that prevents whole categories of bug.

---

### B2. What is a module?

**Answer.** A class annotated with `@Module()` that groups related controllers and providers and
declares what it needs (`imports`) and what it shares (`exports`). Every application has at least a
root module, and Nest builds the DI container by walking that graph.

**Why it matters.** Modules are the **encapsulation boundary at runtime**, not just a folder
convention. A provider is private to its module unless exported — so "who can use this?" is enforced
by the container, not by discipline.

**Real-world example.** `UsersModule` exports `UsersService` but not `UsersRepository`. Other modules
can create users; nobody else can reach into the users collection.

**Common mistake.** Treating `imports` as "files I need". It is not — it is _"modules whose exported
providers I want injectable here"_.

**Follow-up.** _"What happens if you forget to export a provider?"_ — `Nest can't resolve
dependencies of X` at boot, not at first request. Fail-fast is the point.

---

### B3. What is a controller?

**Answer.** The HTTP boundary. It maps routes to methods, binds input via decorators, delegates to a
service, and returns a value that Nest serialises.

**Why it matters.** Keeping controllers thin is what makes business logic reusable. Logic inside a
controller can only ever be triggered by an HTTP request.

**Real-world example.** The moment the same rule had to run from a BullMQ worker (Phase 12) and from
an SSE path (Phase 11), anything living in a controller would have had to move. Nothing did.

**Common mistake.** Injecting the repository directly into the controller "to save a layer". It works
until two endpoints need the same rule and it exists in two places, slightly differently.

**Follow-up.** _"Can a controller be injected into something?"_ — no. Controllers sit at the edge of
the graph; nothing should depend on the HTTP layer.

---

### B4. What is a provider?

**Answer.** Anything the container can create and inject: services, repositories, factories, guards,
even plain values. `@Injectable()` marks a class as _able_ to participate in DI; listing it in a
module's `providers` array is what actually **registers** it.

**Why it matters.** That distinction is the most common early confusion. `@Injectable()` alone does
nothing — it only stores metadata.

**Real-world example.** `PASSWORD_HASHER` in this project is a string token bound to `BcryptPasswordHasher`
via `useClass`. The consumer asks for the token; the module decides the implementation.

**Common mistake.** Adding `@Injectable()` and expecting injection to work without registering it.

**Follow-up.** _"Is `@Injectable()` ever strictly required?"_ — only when the class itself has
dependencies. It is what makes TypeScript emit `design:paramtypes`. Put it on everything anyway.

---

### B5. What is dependency injection, and why does Nest use it?

**Answer.** A class declares what it needs in its constructor; something else supplies it. Nest's
container reads the constructor's parameter types (via `emitDecoratorMetadata` →
`design:paramtypes` → reflect-metadata), resolves each token, and constructs the instance.

**Why it matters.** Three concrete payoffs: **testability** (pass a fake in a test), **swappability**
(change one line in a module to change the implementation everywhere), and **lifecycle** (the
container creates each singleton once and knows the destruction order).

**Real-world example.** `UsersService` depends on the abstract `UsersRepository`. Production binds it
to the Mongo implementation; the unit tests bind it to an in-memory one. **No mocking library, and no
change to production code.**

**Common mistake.** `new UsersService(...)` inside another class. It compiles, and it silently opts
that object out of the container's lifecycle and every test seam.

**Follow-up.** _"How does Nest know what to inject when the type is an interface?"_ — it cannot.
Interfaces do not exist at runtime; you need a token, or an abstract class. See A-level questions.

---

### B6. What is the difference between `@Body()`, `@Param()` and `@Query()`?

**Answer.** They bind different parts of the request: the parsed JSON body, the route parameters
(`/users/:id`), and the query string (`?page=2`). Each can take an argument to pick one field, or no
argument to bind the whole object.

**Why it matters.** Binding the _whole_ object to a DTO is what lets the global `ValidationPipe`
validate it. `@Query('page') page: string` gives you a string with no validation; `@Query() q:
ListUsersQuery` gives you a validated, transformed object.

**Real-world example.** `UsersController.findAll(@Query() query: ListUsersQuery)` — page, limit,
search and role all validated and typed by one decorator.

**Common mistake.** Assuming the TypeScript annotation is enforced. Without a validation pipe,
`@Body() dto: CreateUserDto` is a compile-time fiction — the body is whatever the client sent.

**Follow-up.** _"Why is `page` a number after validation but a string before?"_ — `transform: true`
plus `@Type(() => Number)`. The query string is always strings on the wire.

---

### B7. How does routing work?

**Answer.** `@Controller('users')` sets a base path; the method decorators (`@Get()`, `@Post()`,
`@Patch(':id')`) add to it. Nest reads that metadata at bootstrap and builds the underlying router.

**Why it matters.** The route table is **declared as metadata**, not built by imperative calls. That
is what makes Swagger generation possible with no extra work — the framework already knows every
route, its parameters and its types.

**Real-world example.** `setGlobalPrefix('api')` plus URI versioning turns `@Controller('users')`
into `/api/v1/users` without touching the controller.

**Common mistake.** Route order. `@Get(':id')` declared before `@Get('search')` swallows `/search` as
an id — the same trap as Express, because it _is_ Express underneath.

**Follow-up.** _"Where would you put a route that must not have the global prefix?"_ — the `exclude`
option, as this project does for the health probes.

---

### B8. What is a DTO?

**Answer.** A Data Transfer Object: a class describing the shape of data crossing the API boundary,
decorated with `class-validator` rules.

**Why it matters.** A DTO is a **class, not an interface**, and that is load-bearing: interfaces
vanish at compile time, so there would be nothing left at runtime for the validator to inspect.

**Real-world example.** `CreateUserDto` carries `@IsEmail()`, `@MinLength(8)` and `@IsEnum(Role)`.
The rules live next to the field they constrain, so adding a field and forgetting to validate it is
visible in the diff.

**Common mistake.** Reusing the database entity as the DTO. Then adding an internal field to the
schema silently exposes it in the API and, worse, accepts it as input.

**Follow-up.** _"How do you avoid duplicating a DTO for create and update?"_ — `PartialType`,
`PickType`, `OmitType` from `@nestjs/swagger` (that package, so Swagger metadata is preserved).

---

### B9. What is a pipe?

**Answer.** A class that transforms or validates an argument before the handler receives it. It runs
after guards and before the handler, and throwing from it produces a 400 without the handler ever
running.

**Why it matters.** It is where "reject bad input" belongs, so the handler can assume its inputs are
valid — which is what keeps handlers short.

**Real-world example.** `ParseObjectIdPipe` on `@Param('id')`. Without it, `GET /users/oops` reaches
Mongoose, throws a `CastError` and becomes a **500** — a client's typo recorded as a server error.

**Common mistake.** Validating inside the service instead. It works, but it runs after guards,
interceptors and the whole framework has already done work for a request that was never valid.

**Follow-up.** _"What are the four scopes a pipe can be bound at?"_ — global, controller, handler and
**parameter**, which is the tightest.

---

### B10. What is a guard?

**Answer.** A class implementing `CanActivate` that returns `true`/`false` (or throws). It runs after
middleware and before interceptors and pipes, and it has access to the `ExecutionContext` and the
`Reflector` — so it can read route metadata.

**Why it matters.** Guards are for **authorization decisions**, and their position in the pipeline is
the reason: they run before anything expensive.

**Real-world example.** `JwtAuthGuard` is registered globally, so every route is protected unless
marked `@Public()`. `RolesGuard` is registered after it, so the user exists by the time it runs.

**Common mistake.** Putting authorization in middleware. Middleware runs **before routing is
resolved**, so it cannot read `@Roles()` metadata — there is no handler yet to read it from.

**Follow-up.** _"Guard order matters — why?"_ — global guards run in registration order.
`RolesGuard` before `JwtAuthGuard` would read a user that has not been attached yet.

---

### B11. What is an interceptor?

**Answer.** A class that wraps the handler, so it sees **both** sides: it can run code before, run
code after, transform the returned value, or replace it entirely. It works with RxJS observables.

**Why it matters.** Anything that needs the before _and_ the after — timing, logging, response
shaping, caching, timeouts — belongs here and nowhere else.

**Real-world example.** `LoggingInterceptor` captures the start time before and logs method, path,
status and duration after — including on the error path, which is the half people forget.

**Common mistake.** Using only `tap`'s success handler. Failed requests then produce no timing line
at all, and errors are exactly the requests whose duration you want.

**Follow-up.** _"In what order do global interceptors run?"_ — registration order going in, **reverse
order** coming out. They nest like an onion, so register observation outermost.

---

### B12. What is an exception filter?

**Answer.** A class that catches exceptions and turns them into a response. `@Catch()` with no
argument catches everything; `@Catch(HttpException)` narrows it.

**Why it matters.** Clients must _branch_ on errors — show a message, retry, log out. A payload that
is `{message}` here and a raw stack trace there makes that impossible.

**Real-world example.** `AllExceptionsFilter` produces one shape everywhere, translates a Mongo
duplicate-key error (11000) into a 409, and **never lets an unexpected error's message reach the
client** — a raw driver message can leak schema, hostnames and query values.

**Common mistake.** Returning `error.message` for unknown errors. That is an information leak by
default.

**Follow-up.** _"You register a specialised filter and it never runs — why?"_ — filter precedence:
most specific scope wins across scopes, and the **last registered** wins at the same scope.

---

### B13. What is middleware, and how is it different from a guard?

**Answer.** Middleware runs **before routing is resolved**, so it sees raw `req`/`res` and does not
know which handler will run. A guard runs after routing, has the `ExecutionContext` and the
`Reflector`, and answers yes/no.

**Why it matters.** The rule falls straight out: _"it must happen for every request, before anything
else"_ → middleware. _"It needs route metadata or the user"_ → guard.

**Real-world example.** `CorrelationIdMiddleware` opens the `AsyncLocalStorage` store. It has to be
middleware, because the store must be open for the **guards** too — otherwise every authentication
log line has no correlation id, which is precisely the set you most want correlated.

**Common mistake.** Reaching for middleware out of Express habit for things that need DI or metadata.

**Follow-up.** _"Class or functional middleware?"_ — class when it needs DI or has state; a plain
function when it does not.

---

### B14. What is the request lifecycle?

**Answer.**

```
middleware → guards → interceptors (pre) → pipes → HANDLER
           → interceptors (post) → exception filters (only on throw)
```

**Why it matters.** Almost every "why doesn't my X see Y" question is answered by this diagram.
Pipes run _after_ guards, so an unauthenticated request is rejected before you spend anything
validating its body.

**Real-world example.** A request with a bad token and an invalid body returns **401, not 400** —
because the guard ran first.

**Common mistake.** Believing pipes run first because validation "feels" like the first thing.

**Follow-up.** _"Where do Express-level middlewares registered in `main.ts` fit?"_ — before all of it,
including before Nest middleware. They know nothing about DI.

---

### B15. How do you handle configuration and environment variables?

**Answer.** `@nestjs/config` with a **validation schema** (Joi here) that runs at boot, namespaced
config factories via `registerAs`, and a typed facade service so consumers get compile-time safety
instead of `configService.get('SOME_KEY')`.

**Why it matters.** A missing or malformed environment variable should crash the process at second
zero, in front of a deploy pipeline that can roll back — not at 3am on the first request that needs
it.

**Real-world example.** `MONGODB_URI` has **no default**, so the app refuses to boot without it rather
than silently connecting to localhost in production. And a cross-field rule fails startup if the
access and refresh JWT secrets are equal — because then an access token would be accepted as a
refresh token.

**Common mistake.** `process.env.X` scattered through the codebase: untyped, unvalidated, untestable,
and impossible to enumerate.

**Follow-up.** _"How do you handle secrets in production?"_ — never in the image, never in the repo;
injected by the orchestrator's secret store. `.dockerignore` excludes `.env` because a secret baked
into a layer is leaked permanently.

---

### B16. How do you connect to MongoDB?

**Answer.** `MongooseModule.forRootAsync()` in an infrastructure module, so the URI comes from
validated config; feature modules register their own models with `MongooseModule.forFeature()`.

**Why it matters.** `forRoot` opens the connection once; `forFeature` declares model ownership per
module. That is what keeps "who owns this collection?" answerable.

**Real-world example.** `DatabaseModule` opens the connection. `TasksModule` registers the `Task`
model, and no other module touches that collection — which is exactly what makes an extraction
possible later.

**Common mistake.** Calling `forRoot` in several modules and opening several connection pools.

**Follow-up.** _"Should the app boot if MongoDB is down?"_ — no. Without the database there is no
correct response to give. Redis is the opposite: degrade, do not fail.

---

### B17. What is the difference between a Mongoose schema, model and document?

**Answer.** The **schema** is the shape and rules. The **model** is the compiled constructor bound to
a collection — the thing you query. A **document** is one instance, with change tracking, getters and
`.save()`.

**Why it matters.** Documents are expensive. `.lean()` returns plain objects instead, which for a
read-only endpoint is 3–5× less CPU and memory for machinery you never use.

**Real-world example.** Every list endpoint here uses `.lean()`; only code paths that will call
`.save()` hydrate documents.

**Common mistake.** Calling `.lean()` and then `.save()`. There is no `save` on a plain object.

**Follow-up.** _"What does `toObject()` lose?"_ — the same things `.lean()` never had, plus you have
already paid for hydration.

---

### B18. How does authentication work in this project?

**Answer.** Passport strategies wired through `@nestjs/passport`: a **local** strategy for
email/password login, a **JWT** strategy for subsequent requests. Login returns a short-lived access
token in the body and a long-lived refresh token as an **httpOnly cookie**.

**Why it matters.** The split is a deliberate trade: a short access token limits the damage of theft;
the refresh token is long-lived but never readable by JavaScript, so an XSS cannot steal the durable
credential.

**Real-world example.** Refresh tokens are stored **hashed** (SHA-256) in a family, rotated on every
use, with reuse detection — replaying an old token revokes the whole family.

**Common mistake.** Storing the JWT in `localStorage` "because it's easier". Any XSS then owns the
session.

**Follow-up.** _"Why SHA-256 and not bcrypt for the refresh token?"_ — the token is 32 bytes of
CSPRNG output, so there is nothing for a slow hash to protect against. Slow hashing is for
low-entropy secrets like passwords.

---

### B19. What does `@nestjs/swagger` do, and how much is automatic?

**Answer.** It generates an OpenAPI document from the decorators the framework already has.
With the **CLI plugin** enabled in `nest-cli.json`, an AST transform infers `@ApiProperty()` for every
DTO field — types, optionality, enums, and JSDoc as the description.

**Why it matters.** The document is generated _from the code_, so it cannot drift. Every hand-written
API wiki does.

**Real-world example.** `CreateUserDto` has zero Swagger decorators and still documents itself
completely.

**Common mistake.** Setting Swagger up **before** `setGlobalPrefix`/`enableVersioning`, publishing a
document that describes `/users` when the real route is `/api/v1/users`. Nothing warns you.

**Follow-up.** _"Does the plugin run under Jest?"_ — **no.** It is a build-time transform, so DTO
schemas are empty under ts-jest. Generate the shipped document from the built artefact.

---

### B20. How do you write a unit test for a Nest service?

**Answer.** `Test.createTestingModule({ providers: [...] })`, substituting collaborators with fakes,
then `module.get(Service)`.

**Why it matters.** This is the payoff for DI. If the service constructs its own dependencies, there
is no seam and you are into module mocking.

**Real-world example.** `UsersService` tests bind `UsersRepository` to the in-memory implementation
and a stub hasher — no database, no mocking library, milliseconds per test.

**Common mistake.** Believing `.overrideProvider()` can _supply_ a provider that was never
registered. It substitutes; it does not add. The error is `Nest can't resolve dependencies`.

**Follow-up.** _"When would you not mock the database?"_ — when the thing under test _is_ the database
behaviour: unique indexes, atomic `$inc`, transactions. Those get a real `mongod` via
`mongodb-memory-server`, because a hand-written fake would be a fiction that agrees with you.

---

**Next:** [Intermediate — 30 questions](02-intermediate.md)
