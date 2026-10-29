# Phase 1 — Project setup, architecture and configuration

> **Goal of this phase:** understand what a NestJS application _is_ before writing a single feature.
> By the end you can explain how a Nest app boots, what a module actually is, how configuration is
> validated and injected, and why every structural decision in this repo was made.

Files delivered in this phase:

```
package.json  tsconfig.json  tsconfig.build.json  nest-cli.json
eslint.config.mjs  .prettierrc  .editorconfig  .gitignore  .dockerignore
.env.example  .env.development  .env.test  docker-compose.yml
src/main.ts  src/app.module.ts  src/app.controller.ts  src/app.service.ts
src/config/{config.module,config.types,env.validation,env.util,app-config.service,index}.ts
src/config/namespaces/{app,database,redis,jwt,cache,throttle,index}.ts
src/common/constants/{injection-tokens,index}.ts
```

Everything below follows the teaching format from the brief:
**What → Why → How → Example → Real-world → Common mistake → Alternative → Trade-offs → Interview
question → Senior follow-up.**

---

## Table of contents

1. [The one compiler flag that makes NestJS possible](#1-the-one-compiler-flag-that-makes-nestjs-possible)
2. [What actually happens at bootstrap](#2-what-actually-happens-at-bootstrap)
3. [What a NestJS module really is](#3-what-a-nestjs-module-really-is)
4. [Why _this_ folder structure](#4-why-this-folder-structure)
5. [Configuration: validate at boot, inject everywhere](#5-configuration-validate-at-boot-inject-everywhere)
6. [`registerAs` and your first provider token](#6-registeras-and-your-first-provider-token)
7. [`@Global()` — the one you must be able to defend](#7-global--the-one-you-must-be-able-to-defend)
8. [Global prefix, versioning and graceful shutdown](#8-global-prefix-versioning-and-graceful-shutdown)
9. [Local infrastructure decisions](#9-local-infrastructure-decisions)
10. [Trace the boot log](#10-trace-the-boot-log-do-this-once)
11. [Phase 1 interview questions](#11-phase-1-interview-questions)
12. [Phase 1 scenario questions](#12-phase-1-scenario-questions)
13. [Self-check before Phase 2](#13-self-check-before-phase-2)

---

## 1. The one compiler flag that makes NestJS possible

**What.** `tsconfig.json` sets two options Nest cannot live without:

```jsonc
"experimentalDecorators": true,   // lets you write @Injectable(), @Get(), ...
"emitDecoratorMetadata": true     // makes tsc emit runtime type information
```

**Why.** TypeScript types are erased at compile time. So how does Nest know that this constructor
wants an `AppConfigService`?

```ts
@Injectable()
export class AppService {
  constructor(private readonly config: AppConfigService) {}
}
```

**How.** Because `emitDecoratorMetadata` makes the compiler emit an extra line next to the class:

```js
// simplified compiler output
AppService = __decorate(
  [
    Injectable(),
    __metadata("design:paramtypes", [AppConfigService]), // <-- this
  ],
  AppService,
);
```

`design:paramtypes` is stored in the `reflect-metadata` registry — a real runtime object that
survives type erasure. At bootstrap Nest reads it, sees the class needs an `AppConfigService`,
resolves that token and passes the instance in.

**Real-world.** This is why `main.ts` starts with `import 'reflect-metadata'`, and why a decorator
must be present for metadata to be emitted at all: the compiler only emits `design:paramtypes` for
classes that have **at least one decorator**. That is the mechanical reason behind the rule "always
put `@Injectable()` on a provider".

**Common mistake.** Copying a class into a plain TS project (or a Jest setup) without those flags
and getting `Nest can't resolve dependencies` or `Reflect.getMetadata is not a function`.

**Alternative.** Explicit tokens everywhere: `constructor(@Inject(AppConfigService) config: ...)`.
This works without `emitDecoratorMetadata` and is exactly what you must do for interfaces and
non-class values (Phase 3). It is more verbose, which is why Nest uses reflection as the default.

**Trade-off.** Nest's DI is bound to a TypeScript compile step and a runtime polyfill. That is
unusual for Node, and it is the price of not writing wiring code by hand.

> **Interview:** _TypeScript types disappear at runtime — so how does NestJS know what to inject?_
> **Follow-up:** _Why can't you inject an interface, and what do you do instead?_

---

## 2. What actually happens at bootstrap

**What.** `NestFactory.create(AppModule)` does five things, in order:

1. **Scan** the module graph from `AppModule`, recursively following `imports`.
2. **Build a container per module** — conceptually a `Map<Token, Provider>`.
3. **Resolve dependencies depth-first** and instantiate every singleton exactly once.
4. **Run lifecycle hooks**: `onModuleInit` → `onApplicationBootstrap`.
5. **Build the HTTP router** from controller metadata and mount it on the adapter (Express here).

Only then does `app.listen(port)` open a socket.

**Why it matters.** _The entire object graph is wired before the first request arrives._ A missing
provider, a bad environment variable or a circular dependency crashes the process at second zero,
not at 3 a.m. under load. In Express, the equivalent mistake — a `require()` returning `undefined`
because of a typo — surfaces on the first request that hits that code path, possibly weeks later.

**Real-world.** This is what makes container orchestration behave sensibly: a pod that cannot boot
never becomes ready, so the load balancer never sends it traffic and the rollout halts. Fail-fast at
boot is a _deployment safety_ feature, not just a developer convenience.

**Common mistake.** Doing heavy work in a constructor (opening connections, running migrations).
Constructors run during graph construction, where you cannot `await` anything meaningful and errors
are hard to attribute. Use `onModuleInit` / `onApplicationBootstrap` instead — we do exactly that
for Redis and Mongo in Phases 5 and 10.

**Trade-off.** Slower start-up than Express (milliseconds, not seconds) and a stack of framework
frames in your traces. Worth it for the guarantee.

> **Interview:** _Walk me through what happens between `NestFactory.create()` and the first served
> request._
> **Follow-up:** _Where would you open a database connection, and why not in the constructor?_

---

## 3. What a NestJS module really is

**What.** A Nest module is **not** a file. It is a node in the dependency-injection graph, declared
with four keys:

| Key           | Question it answers                                         |
| ------------- | ----------------------------------------------------------- |
| `imports`     | Which **other modules'** exported providers may I use?      |
| `providers`   | Which classes/values should the container build **for me**? |
| `controllers` | Which classes handle incoming HTTP requests?                |
| `exports`     | Which of **my** providers may modules that import me use?   |

**Why.** Encapsulation. A provider in `providers` but not in `exports` is **private**. Importing the
module does not give you access to it. This is the one thing Express cannot give you: with
`require()`, every file can reach every other file, so "module boundaries" are a naming convention
enforced by nothing.

**How — the mental model.**

```text
UsersModule
  providers: [UsersService, PasswordHasher]   ← both instantiated
  exports:   [UsersService]                   ← only this one is public

AuthModule
  imports: [UsersModule]
  → can inject UsersService     ✅
  → cannot inject PasswordHasher ❌  "Nest can't resolve dependencies of AuthService (?)"
```

**Real-world.** This is the mechanism that makes a modular monolith real rather than aspirational.
When `TasksModule` can only see `UsersService` and never `UsersRepository`, the coupling between
features stays at the level of a deliberate API — which is exactly the boundary you would cut along
if you later extracted a microservice.

**Common mistake.** Fixing a resolution error by adding `@Global()` or by importing the _provider_
instead of the _module_. The honest fix is always: export it from the owning module, import that
module in the consumer.

**Alternative.** Nest also supports **dynamic modules** (`forRoot`, `register`, `forFeature`) for
modules that must be configured by their consumer. `ConfigModule.forRoot({...})` in
`src/config/config.module.ts` is one; we write our own in Phase 10.

**Trade-off.** More ceremony than `require()`. In exchange, the compiler and the container tell you
when a boundary is violated, instead of a code reviewer noticing it six months later.

> **Interview:** _What is the difference between `providers` and `exports`?_
> **Follow-up:** _A provider is registered in two modules that are both imported by a third. How
> many instances exist?_ (Answer: two — a provider's instance is scoped to the module that declares
> it. Declaring the same class in two modules yields two independent singletons, which is a classic
> source of "my cache is empty" bugs. The fix is one owning module that exports it.)

---

## 4. Why _this_ folder structure

**What.** Three tiers with a strict dependency direction:

```text
features (auth, users, projects, tasks, comments, notifications, activity-logs)
    ↓
infrastructure (config, database, cache, queue, events, health)
    ↓
common (guards, pipes, interceptors, filters, decorators, middleware, constants)
```

**Why not the layered layout** (`controllers/`, `services/`, `models/`)? Because it groups by
_technical role_ instead of by _reason to change_. Adding a field to a task edits four folders, and
the directory listing describes the framework rather than the product. Grouping by feature keeps a
change local, which is the practical definition of maintainability.

**Why the direction rule?** Without it, "modular" decays into a ball of mud in about six months.
Two concrete tests you can apply in review:

- _Does anything in `common/` import from a feature?_ If a guard needs `UsersService`, it is not
  common — it belongs to `auth/`.
- _Do two features import each other?_ That is the circular dependency smell. Phase 4 shows why
  `forwardRef()` is a last resort and what to do instead (extract a shared module, or invert the
  dependency with an event).

**Real-world.** When the notifications module eventually becomes its own service (Phase 20), the
work is: move the folder, replace in-process event subscriptions with a message broker, give it its
own database. If notifications had been reaching into `TasksRepository`, that same migration is a
rewrite.

**Common mistake.** A `shared/` folder that becomes a junk drawer. Every module imports it, it
imports every module, and now you have a cycle at the architecture level. Keep `common/` free of
business knowledge, and prefer a _named_ shared module (e.g. `PaginationModule`) over a generic one.

**Trade-off.** More folders for a small app, and slightly more thinking per file about where
something belongs. That thinking _is_ the architecture.

> **Interview:** _How do you organise a NestJS codebase, and why?_
> **Follow-up:** _How would you stop a junior developer from importing `TasksRepository` inside
> `notifications/`?_ (Answers worth knowing: don't export it from `TasksModule`; enforce with an
> ESLint boundary rule such as `import/no-restricted-paths` or `eslint-plugin-boundaries`; and
> review the module's `exports` list as the module's public API.)

---

## 5. Configuration: validate at boot, inject everywhere

**What.** A four-layer pipeline:

```text
process.env  (string | undefined)
   │
   ▼  Joi schema ........... src/config/env.validation.ts
   │
   ▼  registerAs() ......... src/config/namespaces/*.ts
   │
   ▼  AppConfigService ..... src/config/app-config.service.ts
   │
   ▼  this.config.database.uri   // string, guaranteed
```

**Why.** Every environment variable is a possibly-undefined string. Without a boundary layer you get
this, spread across the codebase:

```ts
const port = parseInt(process.env.PORT || "3000", 10);
const port = Number(process.env.PORT ?? 3000);
const port = +process.env.PORT!;
```

Three parsers, three defaults, three chances to be wrong.

**How — the fail-fast demo.** Run it yourself, it takes ten seconds:

```bash
JWT_ACCESS_SECRET=tooshort npm run start:dev
```

```
ERROR [ExceptionHandler] Error: Config validation error:
"JWT_ACCESS_SECRET" must be at least 32 characters. Generate one with: node -e "..."
```

The process never listens. Compare that to the alternative: `jsonwebtoken` cheerfully signs tokens
with the literal string `"undefined"`, and you have shipped an auth system anyone can forge tokens
for.

**Real-world rules this project enforces:**

1. **No default for `MONGODB_URI`.** A fallback like `mongodb://localhost` is precisely how a
   production pod ends up writing to nowhere and reporting success.
2. **Access and refresh secrets must differ** — a cross-field Joi rule. Sign both with one secret
   and a stolen refresh token is also a valid access token, which defeats the point of having two.
3. **`abortEarly: false`** so you see _all_ invalid variables at once. With the default you fix one,
   restart, discover the next, restart… ten variables, ten restarts.
4. **`ignoreEnvFile` in production** so a stale `.env.production` accidentally copied into the image
   can never override real secrets from the orchestrator.

**Common mistake.** Reading `process.env` deep inside a service. It hides a dependency, is
unmockable without `jest.mock`, and skips validation. There is exactly **one** legitimate
`process.env` read in this codebase — computing `envFilePath` inside `ConfigModule.forRoot()`,
because that runs before `ConfigService` exists.

**Alternative.** `class-validator` + `class-transformer` on an `EnvironmentVariables` class via the
`validate:` option, or `zod`. Same guarantee, one fewer dependency (we already use class-validator
for DTOs), a bit more boilerplate. Both are common in production Nest code; know that both exist.

**Trade-off.** Four layers to read one variable is over-engineering for a three-variable script.
For anything with more than one backing service it pays for itself the first time someone typos a
key.

> **Interview:** _How do you manage configuration and secrets in a NestJS app?_
> **Follow-up:** _Your app boots fine locally but crashes in staging with a config error. Walk me
> through your debugging._ (Which file was loaded — `.env.staging` exists? `ignoreEnvFile` on? Is the
> secret injected as an env var or mounted as a file? Does the CI image contain a stale `.env`?)

---

## 6. `registerAs` and your first provider token

**What.** `registerAs('app', factory)` produces two things: a config factory _and_ a **provider
token**, exposed as `appConfig.KEY` (its value is the string `CONFIGURATION(app)`).

**Why it matters now.** Because it makes the central idea of Nest DI concrete, weeks before Phase 3
formally covers it:

> A provider is a `{ token, recipe }` pair. The container is a `Map<Token, Instance>`.
> Injection is a lookup by token.

**How.** Two ways to read the same value:

```ts
// A) stringly-typed path — no compiler help, typo silently returns undefined
this.configService.get<number>('app.port');

// B) token-based — fully typed, autocompleted, rename-safe
constructor(
  @Inject(appConfig.KEY) private readonly cfg: ConfigType<typeof appConfig>,
) {}
this.cfg.port; // number
```

**Real-world.** Option B is what you want in a module that needs exactly one namespace — it also
documents, in the constructor signature, precisely which configuration that module is allowed to
see. Our `AppConfigService` facade (option C) is better when a class needs several namespaces or
derived helpers like `isProduction`.

**Common mistake.** Registering with a raw string in one file and injecting a _slightly different_
raw string in another. Those are two different tokens, and Nest cannot help you. Always export a
constant — see `src/common/constants/injection-tokens.ts`.

**Trade-off.** `@Inject(token)` is more verbose than a plain constructor parameter, and it is the
only option for interfaces and non-class values.

> **Interview:** _What is a provider token and why do string/symbol tokens exist?_
> **Follow-up:** _Show me how you would inject two different Redis connections into the same class._
> (Two tokens — `REDIS_CLIENT` and `REDIS_SUBSCRIBER` — because a connection in subscriber mode
> cannot issue normal commands. Same class, two instances, distinct tokens.)

---

## 7. `@Global()` — the one you must be able to defend

**What.** `AppConfigModule` is decorated with `@Global()`, so its exports are available everywhere
without an `imports:` entry.

**Why here.** Configuration is one of the _few_ legitimate cases: nearly every module needs it, it
is read-only and stateless, and writing `imports: [AppConfigModule]` in fifteen modules is noise
rather than information. Logging is the other classic case.

**Why not everywhere.** `@Global()` hides the dependency graph. Read a module's `imports` and you
should be able to see what it depends on; globals make that list a lie. Overuse turns your DI
container back into a bag of globals — the exact problem DI exists to solve.

**Common mistake.** Reaching for `@Global()` to silence a `Nest can't resolve dependencies` error.
That is treating the symptom. The fix is `exports:` in the owner plus `imports:` in the consumer.

**Mechanics worth knowing.** `@Global()` only removes the need for the import statement. The module
is still instantiated once, and it must still appear in the root module's `imports` for Nest to load
it at all.

**Design note.** We deliberately set `isGlobal: false` on `ConfigModule.forRoot()` and made _our_
wrapper global instead. That keeps a single owner for configuration: consumers depend on our module
and our typed facade, not directly on a third-party package. If `@nestjs/config` is ever replaced,
the blast radius is one file.

> **Interview:** _When is `@Global()` appropriate?_
> **Follow-up:** _What are the downsides, and how would you decide between a global module and an
> explicitly imported shared module?_

---

## 8. Global prefix, versioning and graceful shutdown

### Global prefix

`app.setGlobalPrefix('api')` → every route lives under `/api`. It leaves the domain free for
non-API paths (static assets, webhooks, `/metrics`) and makes reverse-proxy rules trivial. Health
endpoints are usually _excluded_ so infrastructure can probe a stable path — we do that in Phase 18.

### URI versioning

```ts
app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
// → GET /api/v1/tasks
```

| Strategy                     | Pro                                              | Con                                                            |
| ---------------------------- | ------------------------------------------------ | -------------------------------------------------------------- |
| **URI** (`/v1/…`)            | Visible in logs, browser, curl; trivial to route | "Impure" — the resource did not change, its representation did |
| Header (`X-API-Version`)     | Clean URLs                                       | Invisible in logs; easy to forget in a client                  |
| Media type (`Accept: …;v=2`) | Most RESTful                                     | Clients get it wrong constantly                                |

We chose URI because debuggability beats purity in practice. The senior point: versioning is a
promise about backward compatibility, and the cheapest version is the one you never cut — prefer
additive changes, and reserve a new version for genuinely breaking ones.

### Graceful shutdown

`app.enableShutdownHooks()` makes Nest listen for `SIGTERM`/`SIGINT` and run `onModuleDestroy` →
`beforeApplicationShutdown` → `onApplicationShutdown`.

**Why it is not optional in production.** A rolling deploy sends `SIGTERM`. Without hooks the process
dies instantly: in-flight HTTP requests are cut, Mongo/Redis sockets are left open, and — worst —
half-processed BullMQ jobs are abandoned until their lock expires, delaying every retry. With hooks,
modules close connections and drain workers first.

> **Interview:** _What happens to in-flight requests during a deployment?_
> **Follow-up:** _Your pod takes 40s to shut down and Kubernetes kills it at 30s. What do you
> change?_ (`terminationGracePeriodSeconds`, stop accepting new work first, bound the drain time,
> make jobs idempotent so a forced kill is survivable — Phase 12.)

---

## 9. Local infrastructure decisions

**MongoDB runs as a single-node replica set.** Not for redundancy — for features. Multi-document
**transactions** and **change streams** only exist on a replica set. Developing against a standalone
`mongod` and deploying to a replica set is a classic "works on my machine" trap: the transaction
code compiles, then throws `Transaction numbers are only allowed on a replica set member` in
staging.

The container bootstraps itself: its healthcheck runs `rs.status()` and, on the first boot when that
throws, `rs.initiate()`.

**Mongo runs without auth locally.** Enabling auth on a replica set also requires _internal member_
authentication via a shared keyfile — which would mean committing a secret just to run
`docker compose up`. Instead the port is bound to `127.0.0.1`, so nothing outside the machine can
reach it. Production is different and non-negotiable: auth, TLS, least-privilege users, network
policy.

**Redis has AOF persistence on.** Losing a cache is free; losing queued jobs is not, and BullMQ
stores jobs in Redis. In production you would usually split the queue Redis from the cache Redis for
exactly that reason — a cache can be flushed at will.

**Only the backing services are containerised in Phase 1.** The API runs on the host so hot-reload
and the debugger stay fast. Phase 17 adds the multi-stage `Dockerfile` and an `api` service.

> **Interview:** _Why would you run a single-node replica set in development?_
> **Follow-up:** _What else differs between your local Mongo and production, and how do you keep
> those differences from biting you?_

---

## 10. Trace the boot log (do this once)

```bash
npm run build && node dist/main.js
```

```
[NestFactory]    Starting Nest application...
[InstanceLoader] ConfigHostModule dependencies initialized
[InstanceLoader] ConfigModule dependencies initialized
[AppService]     Booted in "development" mode          ← our constructor ran here
[InstanceLoader] AppConfigModule dependencies initialized
[InstanceLoader] AppModule dependencies initialized
[RoutesResolver] AppController {/api} (version: 1)
[RouterExplorer] Mapped {/api, GET} (version: 1) route
[RouterExplorer] Mapped {/api/ping, GET} (version: 1) route
[NestApplication] Nest application successfully started
```

Read it top to bottom and you can see the whole model:

- Modules initialise **leaf-first**: `ConfigHostModule` → `ConfigModule` → `AppConfigModule` →
  `AppModule`. Dependencies before dependents.
- `AppService`'s constructor log appears _before_ `AppModule` reports initialised — providers are
  built during their module's initialisation, not after.
- Routes are mapped **after** the container is complete, from controller metadata.
- The server starts listening last.

Verify:

```bash
curl localhost:3000/api/v1        # {"name":"taskflow-api","environment":"development",...}
curl localhost:3000/api/v1/ping   # {"status":"ok",...}
curl -i localhost:3000/api/v1 | head -12   # helmet's security headers
curl -o /dev/null -w "%{http_code}" localhost:3000/   # 404 — the global prefix is real
```

---

## 11. Phase 1 interview questions

**1. What problem does NestJS solve that Express does not?**
Express gives you routing and middleware and stops there; every team invents its own structure, DI,
validation and error handling. Nest supplies an opinionated architecture (modules, providers,
controllers), a DI container, and purpose-built hooks for cross-cutting concerns (guards, pipes,
interceptors, filters). The value is not features — it is that a new developer can find things, and
that boundaries are enforced by the framework instead of by convention.
_Follow-up:_ When would you **not** use Nest? A tiny service or a lambda where the bootstrap
overhead and learning curve exceed the benefit; or a team already productive in a codebase with its
own conventions.

**2. How does NestJS know what to inject when TypeScript types are erased?**
`emitDecoratorMetadata` makes tsc write `design:paramtypes` into the `reflect-metadata` store, which
exists at runtime. Nest reads it and resolves each constructor parameter by token. Interfaces have
no runtime representation, which is why they need an explicit `@Inject(TOKEN)`.

**3. What is a module, and what is the difference between `providers` and `exports`?**
A module is a node in the DI graph. `providers` are built for this module and are **private** to it;
`exports` is the module's public API. Importing a module gives you only its exports.

**4. What is a dynamic module and when have you used one?**
A module whose definition is computed from options passed by the consumer, returned from a static
method as a `DynamicModule`. `ConfigModule.forRoot()`, `MongooseModule.forRootAsync()`,
`JwtModule.register()`. Use `forRoot`/`forRootAsync` for once-per-app configuration, `register` for
per-consumer configuration, `forFeature` for feature-scoped registration against a configured root.
The `Async` variants exist so options can depend on injectables such as `ConfigService`.

**5. Why validate environment variables at startup?**
So misconfiguration is a boot failure rather than a runtime surprise. A container that refuses to
start never receives traffic; a container that starts misconfigured causes an outage — and in the
JWT-secret case, a security incident.

**6. `@Global()` — when and why?**
For genuinely cross-cutting, stateless, read-only modules such as config and logging. Not as a fix
for resolution errors: it hides the dependency graph and reproduces the global-variable problem DI
was meant to remove.

**7. Where do you put logic that must run for every request?**
Depends on what it needs. Express-level `app.use()` in `main.ts` for things that must also cover
requests that never reach a route (security headers, CORS, body parsing). Nest middleware when you
want module scoping. A **guard** for allow/deny decisions. An **interceptor** when you need to
observe or transform the response. A **filter** for error shaping.

**8. What is the difference between `app.get()` and constructor injection?**
`app.get()` is an imperative lookup by token — the service-locator pattern. It is correct in
`main.ts` and in tests, where there is no constructor to inject into. Using it inside application
code re-hides dependencies and defeats the compile-time graph. It also cannot resolve request-scoped
providers; that needs `resolve()`.

**9. Why URI versioning over header versioning?**
Debuggability: the version appears in logs, browser history and curl commands, and routing is
trivial at the proxy. Header and media-type versioning keep URLs cleaner and are more RESTfully
pure, but are invisible in tooling and more often misused by clients.

**10. What does `enableShutdownHooks()` actually buy you?**
Nest listens for termination signals and runs shutdown lifecycle hooks, so modules can close
database and Redis connections and drain queue workers before the process exits. Without it, a
rolling deploy severs in-flight requests and abandons in-progress jobs.

**11. Why does `MONGODB_URI` have no default?**
Because there is no safe fallback for "where our data lives". A default like `mongodb://localhost`
lets a misconfigured production instance start, write to the wrong place, and report success. Fail
loudly instead.

**12. What is the difference between `tsconfig.json` and `tsconfig.build.json`?**
The build config extends the base and excludes tests and `*.spec.ts`, so `dist/` contains only
production code. Smaller image, no test helpers shipped to production.

**13. `.env.example` is committed but `.env` is not. Why both?**
`.env.example` is documentation: it tells the next developer and CI which variables exist and what
they mean, with placeholder values. Real values are environment-specific and, in production, come
from a secret manager — never from a file in the image.

**14. Why is `trust proxy` more than a logging nicety?**
Behind a load balancer, the TCP peer is the proxy. Without `trust proxy`, `req.ip` is the balancer's
address, so IP-based rate limiting buckets your entire user base as one client, and
`X-Forwarded-Proto`-dependent decisions (secure cookies, HTTPS redirects) are wrong. Trust exactly
the number of hops you control — `X-Forwarded-For` is client-supplied and forgeable otherwise.

**15. Why is a liveness probe not allowed to touch the database?**
Because a liveness failure means "restart this process". If the probe fails when the database is
slow, Kubernetes restarts healthy pods during a database blip and turns a degradation into an
outage. Database checks belong in _readiness_, which only removes the instance from rotation.

---

## 12. Phase 1 scenario questions

**Scenario A — "It works locally but the container exits immediately in staging."**
Read the exit log first: a config validation error names the variable. Then check, in order: is
`NODE_ENV` set in the container (it drives `envFilePath`)? Is `ignoreEnvFile` on, meaning the
platform must supply everything? Is the secret injected as an env var or mounted as a file the app
never reads? Did a stale `.env` get baked into the image (check `.dockerignore`)? The general lesson:
a boot crash with a named variable is the _good_ outcome — the design worked.

**Scenario B — "Nest can't resolve dependencies of the TasksService (?, ProjectsService)."**
Read the `?` — it marks the argument index that failed. Then walk the checklist: (1) is the missing
class decorated `@Injectable()`? (2) is it in some module's `providers`? (3) is it in that module's
`exports`? (4) does the consuming module `imports` that module? (5) is there a circular import
between the two files? Ninety percent of cases are (3) or (4). Phase 4 covers the remainder,
including `forwardRef` and why it usually signals a design problem.

**Scenario C — "A teammate wants to add `@Global()` to `UsersModule` because three modules need it."**
Push back. Three explicit imports are three lines of self-documentation. `@Global()` is for
stateless, read-only, universally-needed infrastructure. If `UsersModule` really is needed
everywhere, the more likely diagnosis is that too much logic has accumulated in it and something
should be extracted.

**Scenario D — "Should the app start if Redis is unavailable?"**
Depends on the role Redis plays. As a _cache_, no — degrade gracefully: log, serve from Mongo, and
report `degraded` in readiness. As the _queue backend or session store_, the app cannot do its job,
so failing readiness (not liveness) is correct, so the instance leaves the load balancer rotation
but is not restart-looped. We implement exactly this split in Phase 18.

---

## 13. Self-check before Phase 2

You are ready when you can, without looking:

- [ ] Explain how Nest resolves a constructor dependency, starting from `emitDecoratorMetadata`.
- [ ] Draw the boot sequence from `NestFactory.create()` to `app.listen()`.
- [ ] Explain `providers` vs `exports` and predict the error when one is missing.
- [ ] Explain why a provider declared in two modules yields two instances.
- [ ] Justify `@Global()` on config and refuse it for a feature module.
- [ ] Explain the four configuration layers and what class of bug each removes.
- [ ] Explain what `registerAs(...).KEY` is, in terms of tokens.
- [ ] Say why the API runs on the host but Mongo/Redis run in Docker in this phase.

**Next:** Phase 2 — modules, controllers, providers and dependency injection, building the first two
real feature modules (`users`, `projects`) and proving the DI rules with code you can run.
