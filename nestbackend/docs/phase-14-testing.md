# Phase 14 — Testing strategy

> **Goal:** name the strategy that has been accumulating since Phase 2, split the suites, and put
> numbers on it.

Verified: `lint` ✅ · **141 tests, 17 suites** ✅ · coverage **81.9% statements / 53.5% branches**,
above the configured thresholds ✅

```
npm run test         all 141      ~100s
npm run test:unit    90 tests     ~12s    no database, no network
npm run test:e2e     51 tests     ~90s    real mongod, real HTTP
npm run test:cov     + thresholds
```

---

## 1. The three levels, and what each is *for*

| | What it proves | Cost | Where |
| --- | --- | --- | --- |
| **Unit** | one class's logic, every branch | ms | `*.spec.ts` |
| **Integration** | real infrastructure behaves as assumed | seconds | `*.integration.spec.ts` |
| **E2E** | the whole app from the outside | seconds | same files, via HTTP |

The split is not academic. **A unit test cannot prove anything about MongoDB**, because there is no
MongoDB in it — which is why the unique index, the atomic `$inc`, `populate`, aggregation and
transactions are all tested against a real `mongod`. A hand-written fake would be a fiction that
agrees with us.

Equally, **an e2e test is a terrible place to enumerate branches**. Every `RolesGuard` case — no
metadata, no user, wrong role, right role — is one cheap assertion in a unit test and a whole HTTP
round trip in an e2e one.

> Unit tests tell you *why* it broke. E2E tests tell you *that* it broke. You need both, in that
> ratio.

---

## 2. What to mock — the judgement call people get wrong

"Unit test" does not mean "mock every dependency".

| Dependency | Decision | Why |
| --- | --- | --- |
| `UsersRepository` | **real** (in-memory) | Cheap, ours, no I/O. Mocking it would assert we called `create()` — a test of the mock |
| `PasswordHasher` | **fake** | bcrypt is deliberately slow; 50 registrations = 12s of hashing that tests nothing |
| `ProjectsService` (from another module) | **fake** | Otherwise the whole chain behind it must be constructed |
| `EventEmitter2` | **real** | It has no I/O, and a real bus is closer to production than a stub |
| `CacheService` | **pass-through fake** | A *caching* fake would make business-rule tests depend on cache behaviour |

> **Mock at boundaries you do not own or cannot afford** — network, clock, randomness, expensive CPU.
> Do not mock your own cheap collaborators: over-mocked tests pass while the app is broken, because
> they only ever assert that mocks were called.

**Fake fidelity matters more than fake convenience.** `projects.service.spec.ts` has a fake
`UsersService` that *throws* `NotFoundException` for an unknown id, exactly as the real one does. A
fake that returned `null` instead would produce a green suite and a broken application — the most
expensive kind of test.

---

## 3. Techniques worth stealing

**Contract tests** (`password-hasher.spec.ts`) — one `describe.each` suite run against **every**
implementation of a port. Add argon2 and you get its coverage by adding one line to the array; if it
fails, it fails *before* you change the one line in the module. This is the defence against the risk
a token introduces: a new implementation that satisfies the **type** but not the **contract**.

**Fake `ExecutionContext`** — guards, interceptors and filters are classes with one method. Supply
the three members they actually read and test them directly:

```ts
const context = { getHandler: () => h, getClass: () => C,
                  switchToHttp: () => ({ getRequest: () => ({ user }) }) } as unknown as ExecutionContext;
```

**Driving both branches of an interceptor** — `of(value)` for success, `throwError(() => e)` for
failure. That is what lets a test catch "the logging interceptor produces no line for failed
requests", which is a real bug and invisible to a happy-path test.

**`getModelToken` / `getQueueToken`** — every convenience decorator (`@InjectModel`, `@InjectQueue`,
`@InjectConnection`) is `@Inject` with a generated token. Once you know that, none of them are magic
and all of them are replaceable.

**A `@Global()` fake module** — `overrideProvider` **replaces** a provider the graph already
contains; it does not **supply** a missing one. When a module depends on global infrastructure the
test never imported, declare a tiny `@Global()` module exporting a stub.

**Asserting absence.** `does not notify when adding a member fails` is as valuable as its positive
twin — *"we emailed you about something that did not happen"* is a real and embarrassing bug class.

**Bounded stream reads.** The SSE test loops until the frame arrives *or a deadline passes*. A stream
test that waits forever is a suite that hangs in CI, which is worse than one that fails.

---

## 4. Infrastructure: one `mongod`, many databases

`test/global-setup.ts` starts a single `MongoMemoryReplSet` for the whole run; each suite gets its
own **database name**.

Before: three suites × one mongod each = **~10 minutes**. After: **30 seconds**.

That is not just convenience — *a test suite nobody runs locally is worse than one that is slightly
less isolated.* Isolation where it matters (data), sharing where it does not (the daemon).

### Running the integration suites without the bundled `mongod`

`mongodb-memory-server` downloads a real `mongod` binary and spawns it. On some Windows machines
(antivirus, locked-down temp folders) the spawn fails with **`Error: spawn UNKNOWN`** and every
integration suite dies in `globalSetup` before a single test runs.

`test/global-setup.ts` therefore has an opt-in escape hatch: if **`MONGO_TEST_URI`** is set, it uses
that server instead of starting one. Point it at the docker-compose replica set (which supports the
transactions the cascade-delete tests need):

```bash
npm run infra:up                       # from the repo root, once
cd nestbackend
MONGO_TEST_URI="mongodb://127.0.0.1:27018/?directConnection=true" npx jest --runInBand
```

PowerShell: `$env:MONGO_TEST_URI="mongodb://127.0.0.1:27018/?directConnection=true"; npx jest --runInBand`

Two consequences of using a _persistent_ server instead of a throwaway one:

- **Stale data.** An in-memory server vanishes after the run; a real one keeps last run's users, so
  the next run's `register` would return 409. `global-setup` therefore **drops the suites' own
  databases first** — only names matching `taskflow_test` or `taskflow_*_test`. The development
  database `taskflow` is never touched.
- **A name-matching bug worth remembering.** The first version of that cleanup used the pattern
  `taskflow_.+_test`, which does _not_ match `taskflow_test` (it needs at least one character
  between the underscores). One suite kept its stale data and failed identically on every run —
  a reminder to test the cleanup itself by running the suite **twice in a row**.

Without `MONGO_TEST_URI` nothing changes: the in-memory replica set is used, as in CI.

### Case study: a rule that only guarded one door

`UsersService.remove` refused to delete the last admin, and a unit test proved it. But
`PUT /users/:id/role` called `update()`, which had no such check — so the same outcome (a system
nobody can administer) was one request away. A live end-to-end run found it: demoting the only admin
returned `200`.

The fix puts the rule in one private method, `assertNotLastAdmin`, called by both `remove` and
`update` (when the role is being changed _away from_ admin). The new tests cover three cases —
refuses to demote the last admin; allows it when another admin exists; allows a no-op
`admin → admin`. To confirm the test is load-bearing, the guard was temporarily disabled and the
"refuses to demote" test **failed**; with the guard restored it passes.

The general lesson: **when a business rule protects an invariant, enumerate every operation that can
break that invariant, not just the obvious one** — and put the rule where all of them pass through.

It is a **replica set** because transactions do not exist on a standalone `mongod` — the same reason
`docker-compose.yml` runs one, and the same reason developing against standalone and deploying
against a replica set is a trap.

`test/global-teardown.ts` stops it. Without that, Jest hangs after the last test — the same open-handle
class of problem as forgetting to `quit()` a Redis client.

---

## 5. Things deliberately not tested end to end, and what is tested instead

**Rate limiting** is skipped in e2e (`skipIf: () => config.isTest`): the suites make dozens of
requests in seconds, and a realistic limit would fail them *intermittently* — which is how a suite
becomes something people re-run until it goes green.

> "We disabled it in tests" is a smell **unless you can say what you test instead.**

The answer is `redis-throttler.storage.spec.ts`: the counter, the window initialisation (including
the `PTTL == -1` trap), bucket separation per client and per named throttler, and the degraded path.
That is the more valuable test anyway — the interesting behaviour is the algorithm, not the HTTP
plumbing.

**The BullMQ worker** is not registered under `NODE_ENV=test` — it would poll a Redis that is not
there, producing noise and an open handle. The **producer** stays registered, so the enqueue path is
exercised and falls back to inline delivery, running the exact same handler. Only the scheduling
differs.

---

## 6. Coverage — a number that lies if you let it

```
statements 60   branches 45   functions 55   lines 60      (current: 81.9 / 53.5 / 78.5 / 83.6)
```

**Why the thresholds are lower than the actual numbers:** a threshold is a ratchet against
regression, not a target. Set at exactly today's value it fails on the first legitimate refactor;
set far below, it never fires. Slightly under is the useful place.

**Why `dto/`, `schemas/`, `entities/` and `*.module.ts` are excluded:** they are declarations, not
logic. Including them inflates the number and, worse, invites tests that assert a DTO has a field —
which proves nothing and breaks on every rename.

**Branch coverage is the honest metric.** 100% statements with 40% branches means every line ran and
half the decisions never did. The gap between 83.6% lines and 53.5% branches here is mostly error
paths in the Mongo repositories — worth knowing, and a more useful backlog than "get to 90%".

> Coverage tells you what was **executed**, never what was **verified**. A test with no assertions
> gives 100%.

---

## 7. Phase 14 interview questions

**1. Unit vs integration vs e2e — where do you draw the line?** By what each can prove. Units prove
logic and enumerate branches cheaply; integration proves your assumptions about real infrastructure;
e2e proves the pieces are wired together.

**2. What do you mock?** Boundaries you do not own or cannot afford. Not your own cheap collaborators.

**3. Why is over-mocking dangerous?** The test asserts that mocks were called, so it stays green while
behaviour breaks — and it breaks on every refactor, so it is expensive *and* useless.

**4. How do you test a guard?** Directly, with a fake `ExecutionContext`. No HTTP, no container.

**5. How do you test an interceptor's error path?** Make `CallHandler.handle()` return
`throwError(() => e)`.

**6. How do you test code that depends on a Mongoose model?** Replace the token
(`getModelToken(Name)`) for a unit test, or use `mongodb-memory-server` when the database behaviour
*is* what you are testing.

**7. `overrideProvider` fails with "can't resolve dependencies". Why?** It substitutes an existing
provider; it cannot supply a missing one. Provide a `@Global()` fake module instead.

**8. What is a contract test and when do you need one?** One suite run against every implementation of
a port. You need it the moment a token has more than one implementation — including a test double.

**9. Is 100% coverage a good goal?** No. It measures execution, not verification, and the last 10%
usually costs more than it prevents. Watch **branch** coverage and the trend.

**10. How do you keep an e2e suite fast?** Share expensive infrastructure (one `mongod`, many
databases), run units separately in CI's fast lane, and avoid enumerating branches over HTTP.

**11. How do you test something you disabled in tests?** Test the algorithm directly, and say so
where you disabled it.

**12. How do you test an SSE stream?** Against a really listening server, reading the raw
`text/event-stream` frames, with a bounded loop and an abort.

**13. What makes a test flaky, and what do you do about it?** Shared state, real timers, ordering
assumptions, and unbounded waits. Fix the cause — a re-run culture destroys the value of the suite.

---

## 8. Phase 14 scenarios

**A — "Our suite takes 25 minutes and nobody runs it."** Find the fixed cost first — usually
per-suite infrastructure. Share it. Then split fast unit tests from slow e2e ones so a developer can
run the fast lane in seconds.

**B — "Coverage is 95% but bugs keep shipping."** Look at branch coverage and at whether the tests
assert outcomes or interactions. `expect(mock).toHaveBeenCalled()` everywhere is the signature of a
suite that measures the mocks.

**C — "A test passes locally and fails in CI."** Order dependence (shared state between suites),
timezone/locale, or a real timer. Run with `--runInBand` and a fixed seed to confirm.

**D — "We refactored and 200 tests broke, but nothing was wrong."** They asserted implementation, not
behaviour. Tests that mock everything are coupled to the call graph — which is exactly what a
refactor changes.

**E — "How would you test that a user cannot read another user's data?"** As a first-class test, at
the e2e level, per resource — because it is a *policy* and policies are what regressions quietly
break. The authorization suite in Phase 8 is that test.
