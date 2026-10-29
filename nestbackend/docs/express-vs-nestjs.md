# Express → NestJS: a translation guide

You already know Express, Node, TypeScript, MongoDB, JWT, CSRF, caching, SSE, Docker and CI/CD.
**None of that is wasted.** NestJS does not change what a backend does; it changes _where code lives_
and _how it is wired_.

This document is the bridge. Read it once now, and again after Phase 9 — the second read is when
the guard/interceptor/filter distinction really lands.

> **Want the tour of this specific codebase** (startup, the full request pipeline with file links,
> auth, notifications, the React side)? That's [HOW-IT-WORKS.md](../../HOW-IT-WORKS.md). This file
> is the _concepts_ bridge; that one is the _map_.

---

## The one-page map

| Express                                        | NestJS                                      | What actually changes                                                |
| ---------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------- |
| `express.Router()`                             | `@Controller('users')`                      | Routes become **metadata** instead of imperative calls               |
| `router.get('/:id', h)`                        | `@Get(':id')`                               | Same routing; declarative, so Swagger can read it too                |
| `req.params.id`                                | `@Param('id') id: string`                   | Extraction is declarative and can be validated/transformed by a pipe |
| `req.query`                                    | `@Query() q: ListDto`                       | Same, plus automatic type coercion                                   |
| `req.body`                                     | `@Body() dto: CreateUserDto`                | Same, plus validation before the handler runs                        |
| `req.headers.x`                                | `@Headers('x') x: string`                   | Same                                                                 |
| `res.json(data)`                               | `return data`                               | Nest serialises the return value; throw for errors                   |
| `res.status(201)`                              | `@HttpCode(201)`                            | Declarative; POST already defaults to 201                            |
| `app.use(mw)`                                  | **Middleware / Guard / Interceptor**        | Express's single hook splits into purpose-built ones                 |
| `authMiddleware`                               | **Guard** (`CanActivate`)                   | Returns boolean; runs before pipes; can read route metadata          |
| `checkRole('admin')`                           | **Guard** + `@Roles()` + `Reflector`        | Role lives as metadata on the route, not in a closure                |
| `express-validator`, manual `if (!body.email)` | **Pipe** + DTO class                        | Declarative, typed, and feeds the OpenAPI schema                     |
| `(err, req, res, next)`                        | **Exception filter**                        | Centralised, typed, scoped globally or per-controller                |
| Response-shaping middleware                    | **Interceptor**                             | Wraps the handler as an RxJS stream: before **and** after            |
| `require('./userService')`                     | **Provider** + constructor injection        | Dependencies are declared and swappable in tests                     |
| `module.exports = new Service()`               | `@Injectable()` + `providers: []`           | The container owns the lifecycle, not the module system              |
| `config/index.js`                              | `ConfigModule` / `ConfigService`            | Same data, injected instead of globally required                     |
| Folder conventions                             | **Modules**                                 | Boundaries the framework actually enforces                           |
| `server.close()` on SIGTERM                    | `enableShutdownHooks()` + `OnModuleDestroy` | Every module gets a chance to clean up                               |

---

## 1. Route handler → controller

```js
// Express
const router = express.Router();

router.get('/:id', async (req, res, next) => {
  try {
    const user = await userService.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (err) {
    next(err);
  }
});

app.use('/api/v1/users', router);
```

```ts
// NestJS
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<UserDto> {
    const user = await this.usersService.findById(id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
```

**Four things disappeared:**

1. **`res`** — you return a value; Nest serialises it.
2. **`try/catch` + `next(err)`** — a thrown `HttpException` is turned into a response by an exception
   filter. An async handler that rejects is caught by the framework, not by you.
3. **The manual mount path** — `@Controller('users')` plus the global prefix and version produce
   `/api/v1/users`.
4. **`require('./userService')`** — the service arrives through the constructor, so a test can pass a
   fake without touching the module system.

> You _can_ still get `res` with `@Res()`. Doing so opts you out of Nest's response handling
> (interceptors that transform the body stop working) — use it only for streaming or file downloads,
> and prefer `@Res({ passthrough: true })` when you only need to set a cookie or header.

---

## 2. `app.use()` splits into four things

This is the single biggest conceptual shift, and the most common interview topic. In Express,
everything is middleware:

```js
app.use(helmet()); // security headers
app.use(requestLogger); // logging
app.use(authenticate); // auth
app.use('/admin', requireAdmin); // authorization
app.use(validateBody(schema)); // validation
app.use(wrapResponse); // response shaping
app.use(errorHandler); // errors
```

Nest gives each job a dedicated hook with a different signature and a different position in the
pipeline:

```text
request
  │
  ├─ Express middleware (main.ts app.use)   helmet, cors, compression, cookies
  ├─ Nest middleware (configure())          request id, raw logging
  ├─ Guards            CanActivate          authN / authZ   → throws 401/403
  ├─ Interceptors (pre) NestInterceptor     start timer, correlation id
  ├─ Pipes             PipeTransform        validate + transform DTOs → throws 400
  ├─ ► CONTROLLER → SERVICE → DATABASE
  ├─ Interceptors (post)                    shape response, cache, log duration
  └─ Exception filters ExceptionFilter      only if something threw
response
```

**Why bother splitting it?** Because each hook gets exactly the context it needs:

| Hook            | Signature                   | Has access to                                         | Use it for                                                                                       |
| --------------- | --------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Middleware      | `(req, res, next)`          | Raw request/response                                  | Anything Express-shaped; runs before routing is resolved                                         |
| **Guard**       | `canActivate(ctx): boolean` | `ExecutionContext` + **route metadata** (`Reflector`) | Allow/deny. Runs _before_ pipes, so you never validate a body for a caller who is not allowed in |
| **Pipe**        | `transform(value, meta)`    | The single argument being bound                       | Validation and coercion of one parameter                                                         |
| **Interceptor** | `intercept(ctx, next)`      | Both sides of the handler, as an `Observable`         | Timing, response shaping, caching, retries                                                       |
| **Filter**      | `catch(err, host)`          | The thrown error + host                               | Turning errors into consistent HTTP responses                                                    |

The practical payoff: a guard can read `@Roles(Role.ADMIN)` off the route with `Reflector`, which a
generic Express middleware cannot do without you inventing your own metadata mechanism. And an
interceptor sees _after_ the handler, which Express middleware cannot without monkey-patching
`res.json`.

**Order matters, and it is exam material:** guards run **before** pipes. So an unauthorised request
is rejected before you spend CPU validating its body — and, more importantly, a validation error can
never leak information to a caller who was not authenticated.

---

## 3. Manual wiring → dependency injection

```js
// Express: the dependency is hard-coded by `require`
const db = require('../db');
const userService = require('./user.service'); // already an instance

async function findById(id) {
  return db.collection('users').findOne({ _id: id });
}
```

Testing that means `jest.mock('../db')` and hoping nothing else imported it first.

```ts
// NestJS: the dependency is declared, the container supplies it
@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private readonly userModel: Model<User>) {}
}

// in a test
const moduleRef = await Test.createTestingModule({
  providers: [
    UsersService,
    { provide: getModelToken(User.name), useValue: mockModel }, // ← swap, no jest.mock
  ],
}).compile();
```

**The rule:** a class declares **what** it needs; the module decides **which implementation** it
gets. That is the Dependency Inversion Principle, made mechanical. It is also why Phase 3
(`useClass` / `useValue` / `useFactory`) matters so much — those are the three ways to answer
"which implementation".

---

## 3b. How NestJS actually works underneath

Four facts remove most of the "magic":

1. **Nest is not a replacement for Express — by default it _is_ Express.** `NestExpressApplication`
   wraps a real Express app. `app.use(helmet())` in [main.ts](../src/main.ts) is literally Express
   middleware. Nest adds structure on top (and can swap Express for Fastify without touching your
   controllers).

2. **Decorators are just metadata.** `@Get(':id')`, `@Roles(Role.ADMIN)`, `@Public()` don't _do_
   anything when the line runs — they attach a label to the class/method using `reflect-metadata`
   (that's why `import 'reflect-metadata'` is the first line of `main.ts`). Something else reads the
   label later:

   ```ts
   // decorator: writes a label
   export const Roles = (...roles: Role[]) => SetMetadata('roles', roles);

   // guard: reads the label at request time
   const required = this.reflector.getAllAndOverride<Role[]>('roles', [handler, controllerClass]);
   ```

3. **At startup Nest turns your classes into an Express router.** It scans every module, reads the
   `@Controller`/`@Get` labels, and registers ordinary Express routes whose handler is a wrapper:
   run guards → run interceptors → run pipes → call your method → send the return value. The
   "pipeline" in [§2](#2-appuse-splits-into-four-things) is that wrapper — there is no other magic.

4. **The DI container is a startup-time dependency graph.** TypeScript emits constructor parameter
   types (`emitDecoratorMetadata`), so Nest knows `TasksService` needs a `TasksRepository`, builds
   one, and passes it in. If it can't resolve a dependency you get the famous _"Nest can't resolve
   dependencies of the X (?)"_ error **at startup**, not at 3 a.m. on the first request that touches
   it. Express gives you no equivalent early warning.

---

## 3c. Side by side, using this project's own code

**"Return the current user" — protected by a token.**

```js
// Express: you build the auth plumbing and remember to apply it everywhere
const jwt = require('jsonwebtoken');

function authenticate(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: 'Unauthorized' });
  }
}

app.get('/api/v1/auth/me', authenticate, async (req, res, next) => {
  try {
    res.json(await userService.findById(req.user.sub));
  } catch (err) {
    next(err);
  }
});
// Forget `authenticate` on one new route and it is silently public.
```

```ts
// NestJS (this repo): secure by default, opt OUT with @Public()
@Get('me')
me(@CurrentUser('id') userId: string) {
  return this.usersService.findById(userId);
}
// JwtAuthGuard is registered globally (auth.module.ts), so this is already protected.
// A new route you forget to think about is private, not public.
```

The _inversion_ is the real difference: in Express, security is something you add to each route; in
this Nest app it's the default and **exposure** is the explicit act (`@Public()` appears on exactly
login, register, refresh, the service-info routes, the liveness/readiness probes and one
non-production teaching endpoint).

**"Only admins may list users."**

```js
// Express
app.get(
  '/users',
  authenticate,
  (req, res, next) =>
    req.user.role === 'admin' ? next() : res.status(403).json({ message: 'Forbidden' }),
  listUsers,
);
```

```ts
// NestJS: one decorator on the controller class covers every route in it
@Roles(Role.ADMIN)
@Controller('users')
export class UsersController {
  /* every handler here is admin-only */
}
```

**"Don't let a non-member see this project" — the case where Nest's guards earn their keep.**
Express middleware would have to fetch the project, find the id in params _or_ body _or_ query, and
be re-applied per route. Here `ProjectAccessGuard` ([source](../src/projects/guards/project-access.guard.ts))
does all of that once, and a route opts in with one line: `@UseGuards(ProjectAccessGuard)`.

**"A rule that must hold wherever it's triggered."** "Never delete or demote the last admin" lives in
`UsersService.assertNotLastAdmin`, not in a controller or middleware. An HTTP route, a queue worker
and a one-off script all call the same service, so they all obey the same rule. In Express codebases
this rule typically ends up copy-pasted into route handlers — and (as this project's own history
shows) guarding only _one_ of the two ways to violate it is an easy mistake either way.

---

## 3d. Honest trade-offs: when is Express the better tool?

| NestJS gives you                                        | …and costs you                                                                                |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Enforced structure — every module looks the same        | **Boilerplate**: a module, controller, service and DTO for a feature Express does in 20 lines |
| DI → trivially testable, swappable implementations      | A learning curve (tokens, scopes, module visibility) and "can't resolve dependency" errors    |
| Secure-by-default pipelines (global guards, validation) | Indirection: to find what runs for a request you must know the pipeline, not just read a file |
| Swagger/OpenAPI generated from the same decorators      | Decorator + `reflect-metadata` dependence (build tooling must support it)                     |
| Large teams stay consistent                             | Slower to start, and overkill for a script, a webhook relay or a 5-route service              |

**Rule of thumb:** a small service, a prototype or a serverless function → Express (or Fastify)
is fine and faster to write. A long-lived API with many contributors, many modules and real
authorization rules → Nest's structure pays back, which is why this project uses it.

---

## 4. Your existing knowledge, one line each

| You already know                        | In NestJS it becomes                               | Notes                                                                                                                                                         |
| --------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **JWT middleware**                      | `JwtAuthGuard` + Passport `JwtStrategy`            | The strategy validates and returns the user; the guard attaches it to `request.user`. Same flow, two named roles. Phase 7                                     |
| **bcrypt on register/login**            | A provider in `auth/`                              | Unchanged logic; injectable so tests can use a cheap hasher. Phase 7                                                                                          |
| **Role checks**                         | `@Roles()` decorator + `RolesGuard` + `Reflector`  | The role becomes route metadata instead of a closure argument. Phase 8                                                                                        |
| **CSRF (double-submit cookie)**         | A guard (`CsrfGuard`) + `@CsrfProtected()`         | Only needed because the refresh token is a cookie; header-only Bearer APIs are not CSRF-exposed. Applied to `/auth/refresh` and `/auth/logout` only. Phase 16 |
| **Mongoose models**                     | `MongooseModule.forFeature()` + `@InjectModel()`   | Same schemas, same queries; the model arrives via DI. Phase 5                                                                                                 |
| **Manual Redis `get`/`set`**            | A `CacheService` provider (+ optional interceptor) | Same cache-aside logic, one place to change. Phase 10                                                                                                         |
| **`res.write('data: ...')` for SSE**    | `@Sse()` returning an `Observable<MessageEvent>`   | Nest handles the framing and heartbeats; you emit events. Phase 11                                                                                            |
| **`setInterval` / cron worker scripts** | BullMQ producer + `@Processor` consumer            | Retries, backoff, delayed jobs and failure inspection for free. Phase 12                                                                                      |
| **`console.log` / morgan**              | `nestjs-pino` + correlation ids                    | Structured JSON logs, one request id across services. Phase 18                                                                                                |
| **Dockerfile + compose**                | Identical                                          | Multi-stage build; the Node knowledge transfers unchanged. Phase 17                                                                                           |
| **CI: lint → test → build → deploy**    | Identical                                          | Same pipeline; `npm run lint`, `test`, `build`. Phase 17                                                                                                      |
| **Modular monolith by folders**         | Modular monolith by **modules**                    | The difference is enforcement. Phase 20                                                                                                                       |

---

## 5. What is genuinely new (do not hand-wave these)

1. **The DI container and provider tokens** — Phases 2–4. This is where senior interviews spend
   their time.
2. **Provider scopes** (singleton / request / transient) and the performance cost of request scope.
3. **Module encapsulation** — `providers` vs `exports`, and why the same class registered in two
   modules gives you two instances.
4. **The execution order** of middleware → guards → interceptors → pipes → handler → interceptors →
   filters.
5. **`ExecutionContext`** — the abstraction that lets one guard work for HTTP, WebSocket and
   microservice transports (`context.switchToHttp()` vs `switchToWs()`).
6. **Decorator-driven metadata** — `SetMetadata`, `Reflector`, and how custom decorators are built
   from them.

Everything else on your CV maps onto something with a different name.

---

## 6. Honest framing for the interview

When asked "how much NestJS experience do you have?", the strongest honest answer connects the two
columns of this document:

> "Two-plus years of Node/TypeScript backend work — REST APIs, MongoDB, JWT, caching, SSE, Docker,
> CI/CD. NestJS is what I'm specialising in now. Most of it mapped directly onto what I'd already
> built by hand: guards are the auth middleware I was writing, interceptors are response middleware
> with access to both sides of the handler, providers are the services I was requiring manually.
> What was genuinely new to me was the DI container — provider tokens, custom providers, scopes —
> and module encapsulation, so that's where I've put the most deliberate practice."

That answer is accurate, shows self-awareness about what was new, and gives the interviewer an
obvious next question you are well prepared for.
