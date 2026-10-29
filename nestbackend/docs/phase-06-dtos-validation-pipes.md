# Phase 6 — DTOs, validation and pipes

> **Goal:** delete every hand-written validation check in the codebase and replace it with
> declarative rules the framework enforces before your handler runs.

Verified: `lint` ✅ · `tsc` ✅ · **73 tests passing** (was 60) ✅ · `build` ✅

```
src/common/pipes/validation.provider.ts     the global ValidationPipe (APP_PIPE)
src/common/pipes/parse-object-id.pipe.ts    a custom pipe
src/common/pipes/validation.spec.ts         16 assertions about pipe behaviour
src/common/transforms/string.transforms.ts  @Trim / @TrimLower / @TrimUpper / @ToBoolean
src/common/validators/is-strong-password.validator.ts   a custom validator
+ decorators on every DTO; every manual check removed from every service
```

---

## 1. What actually got deleted

| Was | Now |
| --- | --- |
| `if (!dto.email?.includes('@')) throw new BadRequestException(...)` × 4 | `@IsEmail()` |
| `if (!dto.name \|\| dto.name.trim().length < 2) throw ...` | `@Length(2, 80)` |
| `if (!dto.password \|\| dto.password.length < 8) throw ...` | `@IsStrongPassword()` |
| `if (!/^[A-Z]{2,10}$/.test(...)) throw ...` | `@Matches(/^[A-Z]+$/)` + `@Length(2,10)` |
| `Object.values(Role).includes(role as Role)` × 4 | `@IsEnum(Role)` |
| `buildPaginationQuery(page, limit)` — 15 lines of parse/default/clamp | `@Type(() => Number) @IsInt() @Min(1) @Max(100)` |
| `overdue === 'true'` | `@ToBoolean()` |
| `if (!projectId) throw new BadRequestException('projectId is required')` | `@IsMongoId()` on a query DTO |
| six loose `@Query('x') x?: string` params per controller | one `@Query() query: ListXQuery` |

`BadRequestException` is no longer imported by **any** service. That is the measurable result.

---

## 2. `@Body() dto: CreateUserDto` was a lie until this phase

In Phases 2–5 that annotation was **compile-time only** — at runtime the body was whatever the
client sent. `ValidationPipe` with `transform: true` is what makes it true, and the spec proves it:

```ts
expect(result).toBeInstanceOf(CreateUserDto);   // false without transform: true
expect(result.skip).toBe(20);                    // a GETTER — needs a real prototype
expect(result.page).toBe(1);                     // class default — absent on a plain object
```

Believing the annotation without the pipe is the single most dangerous misconception a new Nest
developer can have.

---

## 3. The four options that matter

```ts
new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: false },
})
```

**`whitelist: true` — strip properties with no decorator.** This is the security flag. Without it,
`Object.assign(user, dto)` or `new Model(dto)` writes everything the client sent. That is **mass
assignment**: `{"role":"admin"}` on a profile-update endpoint is the most common
privilege-escalation bug in tutorial-grade APIs (GitHub was compromised this way in 2012). The spec
asserts `isAdmin` is rejected.

**`forbidNonWhitelisted: true` — reject rather than silently strip.** Silent stripping means
`{"nmae": "typo"}` returns 200 with nothing changed, and someone loses an hour. Failing loudly turns
a silent no-op into a self-explanatory 400.
*When to prefer stripping:* a public API with third-party clients you cannot coordinate, where a new
field in someone's payload should not break them. A real strictness-vs-compatibility trade-off.

**`transform: true`** — see above.

**`enableImplicitConversion: false`, deliberately.** Implicit conversion infers from the TypeScript
type and lets you drop every `@Type()`. Convenient — and it will coerce `"abc"` to `NaN`, and any
non-empty string to `true`. Explicit conversions are easier to review. Both choices are common; be
able to argue yours.

**On `disableErrorMessages` in production:** we leave it **off**. The information "leaked" is field
names your OpenAPI document publishes anyway, and the cost is legitimate clients receiving a bare
"Bad Request" with no way to know what was wrong. Security theatre that makes the product worse is a
bad trade. If you do enable it, log the detail server-side with a correlation id.

---

## 4. `APP_PIPE` vs `app.useGlobalPipes()`

```ts
app.useGlobalPipes(new ValidationPipe({...}))      // you construct it → NO dependency injection
{ provide: APP_PIPE, useClass: ValidationPipe }    // Nest constructs it → DI works
```

Fine for `ValidationPipe`, which needs options rather than dependencies — but useless the moment a
global guard needs a `ConfigService` or a repository. The same four tokens cover every global
enhancer:

```
APP_PIPE   APP_GUARD   APP_INTERCEPTOR   APP_FILTER
```

Multiple providers of the same type run in **registration order**, which matters a lot for guards and
interceptors.

---

## 5. Pipes: what, where, and the four scopes

A pipe implements `PipeTransform` and runs on **one bound argument**, doing two jobs: **transform**
and **validate**. Throwing produces a 400 before the controller runs.

```
middleware → guards → interceptors(pre) → PIPES → handler
```

**Pipes run after guards**, deliberately: an unauthorised caller is rejected before you spend CPU
validating their body, and a validation error can never leak field names to someone who was not
allowed in.

| Scope | Binding |
| --- | --- |
| Global | `APP_PIPE` / `useGlobalPipes` |
| Controller | `@UsePipes()` on the class |
| Route | `@UsePipes()` on the method |
| **Argument** | `@Param('id', ParseObjectIdPipe)` ← tightest, and right for this one |

Built-ins: `ParseIntPipe`, `ParseFloatPipe`, `ParseBoolPipe`, `ParseArrayPipe`, `ParseUUIDPipe`,
`ParseEnumPipe`, `DefaultValuePipe`, `ValidationPipe`. There is no `ParseObjectIdPipe` — MongoDB is
not a Nest concern — which makes it the canonical "write your own" example, at about fifteen lines.

**Why it earns its place:** `GET /users/not-an-id` without it reaches Mongoose, throws `CastError`,
and becomes a **500**. A client's typo recorded as a server error: your alerts fire, your error
budget burns, and the dashboard saying "we are broken" is lying.

*A quirk worth knowing:* `ObjectId.isValid` returns true for any 12-byte string, so `"123456789012"`
passes. Add `/^[0-9a-fA-F]{24}$/` if that matters.

---

## 6. Transform runs before validate — and must never throw

```ts
export function Trim(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value);
}
```

The `typeof` guard is not defensive noise. Transforms see **unvalidated** input by definition, so
`{"name": {"$ne": null}}` would make an unguarded `value.trim()` throw a TypeError inside
class-transformer and surface as a **500** — a malformed request becoming a server error, and a cheap
way for an attacker to fill your error logs. Guarded, the non-string passes through and the validator
rejects it properly with a 400.

> **Transforms must be total functions.**

---

## 7. Nested validation — the most commonly missed hole

```ts
@ValidateNested({ each: true })
@Type(() => AddProjectMemberDto)     // ← without this, NOTHING is validated
members?: AddProjectMemberDto[];
```

Without `@Type()`, the array elements stay plain objects, class-validator has no metadata to check,
and **anything passes silently**. The DTO looks validated; the nested payload is not; and
`{ userId: { $ne: null } }` sails into a Mongo query. The spec asserts the failure names `userId`.

`@ArrayMaxSize(50)` is not cosmetic either — without a bound, one request can ask you to validate and
insert a million members.

---

## 8. Mapped types

```ts
export class UpdateUserDto extends PartialType(OmitType(CreateUserDto, ['password'] as const)) {}
export class UpdateProjectDto extends PartialType(PickType(CreateProjectDto, ['name','description'])) {}
```

| Helper | Effect |
| --- | --- |
| `PartialType(T)` | all fields optional, **decorators preserved** |
| `PickType(T, [...])` | only these |
| `OmitType(T, [...])` | everything except these |
| `IntersectionType(A, B)` | merge |

**Why they matter beyond keystrokes:** hand-copied DTOs *drift*. Add `@Length(2,80)` to
`CreateUserDto.name` and a hand-written update DTO keeps the old rule, so the same field is validated
differently depending on the verb.

**Import from `@nestjs/swagger`, not `@nestjs/mapped-types`** — the swagger version also carries
`@ApiProperty` metadata across, so Phase 15's docs are correct for free. Mixing both in one project
is a classic "why is my field missing from the docs?".

---

## 9. `@ValidateIf` — absent vs explicitly null

```ts
@ValidateIf((o: AssignTaskDto) => o.assigneeId !== null)
@IsMongoId()
assigneeId: string | null;      // null means "unassign" — a meaningful value
```

`@IsOptional()` skips validation for `null` **and** `undefined`, which would let `""` or `0` through
unchecked. `@ValidateIf` keeps `null` legal while still validating any real value. This
absent-vs-null distinction is exactly what PATCH bodies get wrong.

---

## 10. Custom validators — and a warning

The constraint-class + factory-decorator pattern (`is-strong-password.validator.ts`) is what you need
for any rule the library lacks. Two notes worth carrying into an interview:

**On password rules:** NIST SP 800-63B says **length** is what matters and explicitly discourages
composition rules — they push users toward `Password1!` and toward reuse. The highest-value controls
are a long minimum, a check against breached-password lists (HIBP's k-anonymity API), and rate
limiting on login.

**On `@IsUniqueEmail()`** — the popular async-validator demo. It has three real problems:

1. **It guarantees nothing.** Check-then-act: two concurrent registrations both pass. Only the unique
   index prevents the duplicate — so you still need the index and the 11000 translation.
2. **It puts I/O in the validation layer**, making an unauthenticated endpoint a free
   database-load generator.
3. **It couples DTOs to repositories**, so your wire contract can no longer be shared or generated
   without dragging in persistence.

> **The position this project takes:** validators check **shape**; services check **business rules**;
> the database **enforces invariants**. The naive answer is "use a custom async validator"; the
> better answer explains why that is not where correctness lives.

---

## 11. Phase 6 interview questions

**1. What is a pipe and when does it run?** A class implementing `PipeTransform` that transforms
and/or validates one bound argument, after guards and before the handler.

**2. Why do pipes run after guards?** So an unauthorised caller is rejected before you spend CPU
validating, and so validation errors cannot leak schema details to someone not allowed in.

**3. What does `transform: true` actually do?** Constructs a real DTO instance via class-transformer,
so `instanceof` holds, `@Type()` conversions run, class defaults apply and getters work.

**4. What is mass assignment and which option prevents it?** Writing client-supplied fields the
client should not control (`{"role":"admin"}`). `whitelist: true` strips undecorated properties;
`forbidNonWhitelisted` rejects them instead.

**5. `whitelist` vs `forbidNonWhitelisted` — when would you use only the first?** A public API with
uncoordinated third-party clients, where a stray field should not break them.

**6. `APP_PIPE` vs `useGlobalPipes`?** The provider form is built by the container, so it can inject.
The imperative form cannot.

**7. Why does `@ValidateNested()` need `@Type()`?** Otherwise elements stay plain objects with no
metadata, and validation silently passes everything.

**8. `@IsOptional()` vs `@ValidateIf()`?** `@IsOptional` skips validation for `null` **and**
`undefined`. `@ValidateIf` lets you keep `null` meaningful while validating real values.

**9. Why not `enableImplicitConversion`?** It is implicit: `"abc" → NaN`, `"false" → true`. Explicit
`@Type()` is easier to review. Defensible either way.

**10. Why must a `@Transform` never throw?** It sees unvalidated input, so an unguarded
`value.trim()` on an object becomes a 500 instead of a 400.

**11. `PartialType` from `@nestjs/swagger` or `@nestjs/mapped-types`?** Swagger's does the same and
carries API metadata; mixing both causes missing documentation.

**12. Where do you validate: DTO, service, or database?** All three, for different things. DTO =
shape. Service = business rules that need other data. Database = invariants that must hold under
concurrency.

**13. Would you use an async `@IsUnique()` validator?** No — see §10. It cannot guarantee uniqueness,
it puts I/O in validation, and it couples DTOs to persistence.

**14. How do you validate a query string as a number?** `@Type(() => Number)` + `@IsInt()`, because
HTTP query values are always strings. Order is transform then validate.

**15. How do you handle a boolean query parameter?** Explicitly: `value === 'true'`.
`@Type(() => Boolean)` is wrong, because `Boolean("false")` is `true`.

**16. Should `limit` be clamped or rejected?** We reject with `@Max(100)`. Silent clamping makes a
client believe it received everything, which is a very hard bug to spot. Clamping is defensible for
a public API — state which you chose.

**17. How do you test a pipe?** Directly — `new ValidationPipe(opts).transform(value, metadata)`. No
HTTP, no container. And read `getResponse().message`, not `error.message`, or your assertion tests
nothing.

---

## 12. Phase 6 scenarios

**A — "A user promoted themselves to admin through the profile endpoint."**
Mass assignment. The update DTO either had `role` on it or `whitelist` was off. Fix: remove the field
from the DTO (`OmitType`), turn on `whitelist` + `forbidNonWhitelisted`, and add the authorization
guard — the DTO controls *shape*, the guard controls *who*. Then audit for other permission-bearing
fields accepted from bodies: `ownerId`, `userId`, `isActive`, `price`.

**B — "Validation passes but the nested array contains garbage."**
Missing `@Type()` next to `@ValidateNested()`. Add it, and add a test that asserts the failure names
the nested field — this is a hole that reappears every time someone adds a new nested DTO.

**C — "Our error rate spiked; every 500 is a TypeError in class-transformer."**
An unguarded `@Transform` receiving a non-string. Someone is posting objects where strings are
expected — possibly probing for NoSQL injection. Guard the transforms, and check whether those values
reach a query builder anywhere.

**D — "The frontend team says our 400s are useless."**
Either `disableErrorMessages` is on in production, or `stopAtFirstError` is hiding the rest. Give
them the full constraint list, and make the messages actionable ("must be at least 10 characters"),
not "invalid input".

**E — "A GET endpoint started returning 500s after we added a pipe."**
Route ordering: a static path declared after `:id` now matches the parameter route and hits
`ParseObjectIdPipe`. Move static segments above parameterised ones.

---

**Next:** Phase 7 — authentication. Passport, JWT access and refresh tokens, hashed and rotated
refresh tokens with reuse detection, httpOnly cookies, `@Public()` routes, and the complete
login → guard → strategy → `request.user` flow.
