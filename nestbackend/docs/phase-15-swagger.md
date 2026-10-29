# Phase 15 — Swagger / OpenAPI

> **Goal:** publish the API contract *from the code*, understand exactly how much of it is
> automatic, and find out — the hard way — where the automation stops.

Verified: `GET /api/docs` serves the UI ✅ · `GET /api/docs-json` serves OpenAPI 3.0 ✅ ·
6 assertions in [swagger.integration.spec.ts](../src/swagger.integration.spec.ts) ✅

Files: [src/swagger.ts](../src/swagger.ts) · [nest-cli.json](../nest-cli.json) ·
[src/main.ts](../src/main.ts#L200)

---

## 1. Why generate a contract at all

The honest answer is not "documentation is nice". It is four specific things:

| | Why it pays |
| --- | --- |
| **It is the contract** | Generated *from* the code, so it cannot drift. Every hand-written API wiki drifts — usually within a sprint. |
| **It generates clients** | `openapi-generator` turns the JSON into a typed SDK. This is also why Phase 9 deliberately did *not* wrap responses in an envelope: `GET /users/:id` returning a `User` generates a client that returns a `User`. |
| **It is executable** | "Try it out" is the fastest way for a frontend developer to answer their own question without booking a call with you. |
| **It is a review surface** | Reading the generated document is the quickest way to notice an endpoint that leaks a field, or one that quietly has no authentication. |

That last one is underrated. A missing `@ApiBearerAuth` is invisible in a code diff and glaring in
the document.

---

## 2. Order of operations in `main.ts` — this is the classic bug

```ts
app.setGlobalPrefix('api');
app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

setupSwagger(app, config);   // <-- AFTER, always
```

`SwaggerModule.createDocument()` walks the router **as it exists at that moment**. Call it before
`setGlobalPrefix` and the document describes `/users` and `/auth/login` — routes that do not exist.
The UI renders perfectly, every "Try it out" returns 404, and a generated client is wrong on every
single call.

Nothing warns you. That is why the e2e test asserts real paths rather than merely "a document was
produced":

```ts
expect(paths).toContain('/api/v1/users');
expect(paths).toContain('/api/v1/tasks/{id}');
```

---

## 3. How much is automatic: the CLI plugin

`nest-cli.json` enables the Swagger **CLI plugin**:

```json
"compilerOptions": {
  "plugins": [{ "name": "@nestjs/swagger", "options": { "introspectComments": true } }]
}
```

This is an **AST transform**. During `nest build` it reads the TypeScript source and *rewrites it*,
injecting `@ApiProperty()` on every DTO field with the type, optionality, enum values and — with
`introspectComments` — the JSDoc comment as the description.

The consequence is that a DTO like this:

```ts
export class CreateUserDto {
  /** The user's email address. Must be unique. */
  @IsEmail()
  email!: string;

  @IsEnum(Role)
  @IsOptional()
  role?: Role;
}
```

needs **zero** Swagger decorators and still documents itself completely. Without the plugin you
would write `@ApiProperty({ description: '...', required: false, enum: Role })` on every field of
every DTO — hundreds of lines that duplicate what the compiler already knows, and that go stale the
first time someone edits the type and not the decorator.

### What the plugin cannot infer

Everything about *meaning*:

- **What an endpoint does** — `@ApiOperation({ summary })`
- **Which errors it returns** — `@ApiResponse({ status: 409, description: 'Email already in use' })`
- **Which security applies** — `@ApiBearerAuth('access-token')`
- **What a tag groups** — `.addTag('projects', '...')`

So the split is: *shapes* are free, *semantics* are hand-written. That is the right split.

---

## 4. Declaring security: the name has to match on both sides

```ts
// in swagger.ts — declares the SCHEME
.addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')

// on a controller — says this endpoint USES it
@ApiBearerAuth('access-token')
@Controller('users')
```

Get the name wrong on either side and it fails **silently**: the Authorize button still appears, you
still paste a token into it, and it is simply never attached to any request. You then debug a 401
that has nothing to do with your auth code.

The test pins it:

```ts
expect(response.body.components.securitySchemes['access-token'])
  .toMatchObject({ type: 'http', scheme: 'bearer' });

expect(listUsers.security?.[0]).toHaveProperty('access-token');
```

---

## 5. Serving docs in production is a **decision**, not a default

```ts
if (!config.app.swaggerEnabled) {
  logger.log('Swagger is disabled (SWAGGER_ENABLED=false)');
  return;
}
```

An OpenAPI document is a complete map of your attack surface: every route, every parameter, every
field name, every enum value, every validation rule.

That is not *secret* — security through obscurity is not security, and an attacker will enumerate
your API anyway — but handing them a machine-readable map with a "Try it out" button is a
considerable convenience, and a public production API rarely needs an interactive explorer.

The three real options, and when each is right:

| Approach | When |
| --- | --- |
| **Off in production** (this project's default) | Public API, external consumers get a published spec out of band |
| **Behind authentication** | Internal API, staff need the explorer |
| **Published to a developer portal** | Partner-facing API where the docs *are* the product |

`SWAGGER_ENABLED` makes it an explicit, auditable environment decision rather than something that
happens to be true because nobody thought about it.

---

## 6. The finding: the CLI plugin is **build-time only**

This is the most useful thing in the phase, and it came out of writing a test that *should* have
passed.

```ts
expect(Object.keys(schemas.CreateUserDto.properties)).toEqual([]);   // ← yes, EMPTY
```

Under `ts-jest`, DTO schemas have **no properties at all**. The schema *entry* exists (the
controller references the type), but it is empty.

**Why:** the plugin is an AST transform that runs inside `nest build`. Jest compiles the sources
itself, with `ts-jest`, and never runs it. Nothing errors — you just get an empty object.

**The documented workaround does not work either.** Wiring the plugin into ts-jest via

```json
"astTransformers": { "before": ["@nestjs/swagger/plugin"] }
```

fails with `beforeTransformer.factory is not a function` on ts-jest 29: the plugin's entry point
does not expose the `factory`/`version`/`name` shape ts-jest expects.

### Three practical consequences

1. **Generate the shipped document from the BUILT artefact.** Boot `dist/main` in CI and curl
   `/api/docs-json`. A document produced by a test run is missing every DTO property — publish that
   to a client generator and you generate clients with empty request bodies.
2. **A test can safely assert paths, tags and security** — all of which come from decorators the
   compiler preserves as metadata — **but not inferred DTO properties.**
3. **If DTO schemas genuinely matter to a contract test, write explicit `@ApiProperty()`** on those
   DTOs. Hand-written decorators survive any compiler.

The assertion is deliberately left in the suite, asserting the *empty* result, with the reasoning in
a comment. A test that documents a real limitation is worth more than a deleted test — and if a
future ts-jest version fixes this, the test goes red and tells us.

> **Interview value:** "the Swagger plugin is a build-time AST transform, so it does not run under
> ts-jest" is the kind of specific, load-bearing detail that only comes from having hit it.

---

## 7. Commit the document and diff it in CI

The strongest version of contract testing, and genuinely underused:

```
nest build → boot dist/main → curl /api/docs-json → diff against openapi.json (committed)
```

An unintended breaking change — a renamed field, a newly-required parameter, a removed endpoint —
then shows up as a **reviewable diff in the pull request** rather than as a support ticket from the
mobile team three weeks later.

The CI workflow ([.github/workflows/ci.yml](../../.github/workflows/ci.yml)) has the step stubbed with
exactly this note; wiring it fully needs a committed baseline, which is a project decision rather
than a code one.

---

## 8. Why?

| Question | Answer |
| --- | --- |
| **Why OpenAPI over hand-written docs?** | Generated docs cannot drift from the code. Hand-written ones always do. |
| **Why not another approach?** | GraphQL gives introspection for free but is a whole-architecture choice, not a documentation one. Postman collections are hand-maintained — same drift problem. tRPC gives end-to-end types but only for TypeScript clients on the same repo. |
| **Trade-offs** | The document adds ~1MB to the running process and a small boot cost. Decorator noise on controllers is real (though the plugin removes most of it). Publishing your attack surface is a genuine consideration. |
| **When to use** | Any REST API with a consumer that is not you. Which is almost all of them. |
| **When to avoid** | An internal service with exactly one consumer that lives in the same repository and shares types directly. Even then, the review-surface argument often wins. |

---

## 9. Express comparison

| Express | NestJS |
| --- | --- |
| `swagger-jsdoc` — write YAML in JSDoc comments above each route | Decorators the framework already has, plus an AST plugin that infers the rest |
| The YAML is a *parallel document* that must be kept in sync by hand | The document is derived from the same types the compiler checks |
| Security schemes referenced by string in both the YAML and the definition — same silent-mismatch failure mode | Same failure mode, but at least the scheme name is in TypeScript |

The structural win is not the tooling, it is that Nest **already knows** the routes, the parameter
sources, the DTO types and the guards. The document is a projection of information the framework
holds anyway. In Express none of that is available to introspect, so the documentation has to be
written twice.

---

**Next:** [Phase 16 — security hardening](phase-16-security.md)
