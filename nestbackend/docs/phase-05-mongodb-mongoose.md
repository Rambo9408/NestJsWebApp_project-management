# Phase 5 — MongoDB and Mongoose

> **Goal:** replace the in-memory stores with a real database, and understand every decision that
> comes with it — schema design, indexes, `lean()`, `populate` and N+1, aggregation, transactions,
> and concurrency.

Verified: `lint` ✅ · `tsc` ✅ · **60 tests passing**, including **14 integration tests against a real
`mongod` replica set** (`mongodb-memory-server`) ✅ · `build` ✅

```
src/database/            database.module.ts  transaction.runner.ts  schema.helpers.ts
                         schemas/counter.schema.ts  database.integration.spec.ts
src/users/schemas/       user.schema.ts
src/users/repositories/  users.repository.ts (port) + in-memory + mongo
src/projects/schemas/    project.schema.ts        (+ same repository split)
src/tasks/               schema, repository, service, controller, module
src/comments/            schema, repository, service, controller, module
```

---

## 1. Schema vs Model vs Document (and POJO)

| Term | What it is |
| --- | --- |
| **Schema** | The definition — fields, validators, indexes, hooks. Knows no connection. |
| **Model** | The schema compiled against a connection and bound to a collection. What you query. |
| **Document** | One record. A live object with `.save()`, virtuals, change tracking. |
| **POJO** | What `.lean()` returns. No `save()`, no virtuals, **no `toJSON` transform**. |

Analogy for interviews: schema = class definition, model = the class bound to a table, document = an
instance.

`.lean()` is roughly **3–5× faster** and uses far less memory, because hydration is the expensive
part. Use it for every read you will not mutate — which is most reads. The trap is that it also
skips the `toJSON` transform, which is why every repository here maps `_id → id` by hand.

---

## 2. Modelling: embed or reference?

| | Embed | Reference |
| --- | --- | --- |
| When | Child is owned by the parent, read with it, and the array is **bounded** | Child has independent identity, is queried alone, or the array is **unbounded** |
| Here | `Project.members` (tens) | `Task.projectId`, `Comment.taskId` (unbounded) |
| Free bonus | Single-document writes are **atomic** — no transaction needed | — |
| Cost | 16MB document cap; document relocation; every parent read pays | You need a transaction for multi-collection consistency |

Getting this backwards is *the* classic MongoDB mistake — the "massive array anti-pattern".

Note the honesty in `comment.schema.ts`: comments are a separate collection, and that is **exactly
why** `DELETE /tasks/:id` needs a transaction. If they were embedded, the delete would be one
atomic write. References buy unbounded growth and independent queries; they cost you free atomicity.

---

## 3. Indexes

**The ESR rule: Equality, Sort, Range** — in that order in a compound index.

```ts
UserSchema.index({ role: 1, createdAt: -1 });                 // filter by role, sort by date
TaskSchema.index({ projectId: 1, status: 1, createdAt: -1 }); // the project board
TaskSchema.index({ assigneeId: 1, status: 1, dueDate: 1 });   // "my tasks"
ProjectSchema.index({ 'members.userId': 1, status: 1, createdAt: -1 });  // MULTIKEY
```

**The prefix rule:** an index on `{a, b}` serves queries on `a` and on `a+b`, but **not on `b`
alone**. Get the order wrong and the index exists, looks reasonable, and is never used. `.explain()`
is how you find out.

**Multikey**: indexing a field inside an array creates one index entry per element. That is what
makes `members.userId: X` a lookup. You **cannot** compound two array fields — MongoDB rejects it,
because the entry count would be the product of the lengths.

**Partial indexes** — underused, and cheap:

```ts
ProjectSchema.index({ ownerId: 1, createdAt: -1 },
  { partialFilterExpression: { status: ProjectStatus.ACTIVE } });
```

Most projects end up archived; indexing only the active ones keeps the index small, and indexes
should stay in RAM. Note `$ne` is **not supported** inside `partialFilterExpression` — the task
"overdue" index expresses it as an explicit `$in` of the open states instead.

**`unique: true` is an index declaration, not a validator.** Three consequences:

1. It is enforced by MongoDB, so it survives concurrency. The application's `findByEmail` check
   exists only to produce a friendly 409 — **validate in the app, enforce in the database**.
2. A violation is a driver error with `code: 11000`, not a Mongoose `ValidationError`, so it must be
   translated or clients get a 500.
3. On existing data with duplicates, the index **build** fails — a deployment failure, which is why
   index changes belong in migrations.

### A bug I hit, worth keeping

```
[MONGOOSE] Warning: Duplicate schema index on {"reference":1} found.
SyncIndexesError: An existing index has the same name as the requested index...
```

`Task.reference` had **both** `@Prop({ index: true })` and `TaskSchema.index({reference:1},{unique:true})`.
Both derive the same name (`reference_1`) with different options, so the second cannot be created —
and in development you keep whichever was made first, possibly the **non-unique** one. Your
constraint silently does not exist.

> **Rule:** declare a field's index in exactly one place. `@Prop({ index })` for simple single-field
> indexes; `Schema.index()` for anything with options (unique, partial, compound, TTL). Never both.

---

## 4. `populate` and N+1

```ts
// N+1 — 50 tasks becomes 51 SEQUENTIAL round trips
const tasks = await taskModel.find(...);
for (const t of tasks) t.assignee = await userModel.findById(t.assigneeId);

// populate — 2 queries, because Mongoose batches the ids into one `$in`
.populate({ path: 'assigneeId', select: 'name email' })
```

**`populate` is not a JOIN.** It runs in the application, in two round trips, and you **cannot
filter or sort the parent by a populated field** — `.populate('assigneeId').sort('assignee.name')`
silently does nothing. For that you need `$lookup` inside an aggregation, which runs server-side.

`select` is not optional: without it you fetch every user field on every row.

The integration test asserts the populated object has exactly `['email','id','name']` — proof the
projection worked.

**The populate mapping bug**, caught here by ESLint's `no-base-to-string`: after populate,
`assigneeId` holds the *document*, so `String(...)` produces `"[object Object]"`. That ships
silently. Hence the `idToString` helper — whose own first version infinitely recursed, because BSON's
`ObjectId` has an `_id` accessor returning itself. Check the most specific member (`toHexString`)
before a generic structural one.

---

## 5. Aggregation

```ts
{ $match: { projectId } },            // FIRST — so an index can be used
{ $group: { _id: '$status', count: { $sum: 1 },
            overdue: { $sum: { $cond: [ ...predicate..., 1, 0 ] } } } },
{ $sort: { _id: 1 } }
```

**Pipeline order is a performance decision, not style.** `$match` first, so the index is usable and
later stages see fewer documents. A `$match` placed after `$group` or `$unwind` cannot use an index
at all — the most common aggregation mistake.

The application-side alternative fetches every task in the project and reduces in JavaScript: O(n)
over the network, O(n) memory in Node, slower every week. This transfers four documents regardless
of collection size.

---

## 6. Concurrency — three different tools

| Tool | Where | What it protects against |
| --- | --- | --- |
| **Atomic `$inc`** | `counter.schema.ts` | Two creates allocating the same task reference |
| **Conditional update** | `changeStatus` | Two people dragging the same card; last-write-wins |
| **`optimisticConcurrency`** (`__v`) | `task.schema.ts` | Lost updates via `save()` on a stale document |

```ts
// The obvious sequence generator is WRONG — check-then-act
const next = (await taskModel.countDocuments({ projectId })) + 1;

// Correct: one server-side atomic operation
findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { upsert: true, new: true })
```

The integration test fires **ten concurrent creates** and asserts ten distinct references. With
`count() + 1` several would collide and the unique index would reject them.

```ts
// Conditional update = optimistic concurrency without a version field
findOneAndUpdate({ _id: id, status: expectedFrom }, { $set: { status: to } })
```

If it matches nothing, the state moved — **409 Conflict** is the honest answer, because the client's
view is stale. Read-modify-write would silently discard the other person's change and report success.

Note the caveat: `optimisticConcurrency` only applies to `save()` on a hydrated document.
`findByIdAndUpdate` bypasses it entirely — which is why the status path uses a conditional filter.

---

## 7. Transactions

```ts
await this.transactions.run(async (session) => {
  const removed = await commentsRepository.removeByTask(task.id, session);
  await tasksRepository.remove(task.id, session);
  return removed;
});
```

**Requirements:** a replica set (or sharded cluster). On a standalone `mongod` you get
`Transaction numbers are only allowed on a replica set member or mongos` at *runtime* — which is why
`docker-compose.yml` and the test harness both run a single-node replica set.

**Four things that matter inside one:**

1. **Every operation must receive the session.** One that forgets runs outside the transaction and
   will not roll back — the most common transaction bug, and it fails silently.
2. **The callback may run more than once.** `withTransaction` retries transient errors, so the body
   must be idempotent — and must contain **no emails, no queue publishes, no external calls**. You
   cannot roll back an email.
3. **Keep it short.** Locks are held; the default `transactionLifetimeLimitSeconds` is 60.
4. **`session.endSession()` in a `finally`.** A leaked session holds server state until it times out.

**A Mongoose footgun the code calls out:** `create()` with a session must be given an **array** —
`create([doc], { session })`. The single-document overload silently ignores the options, so the write
escapes the transaction.

**They do not work across services.** When tasks and comments live in different databases (Phase 20),
you need the saga pattern and compensating actions instead.

Both halves are tested: the commit path (`deletedComments: 2`, zero orphans) and the **rollback**
path (insert, throw, assert the count is unchanged).

---

## 8. Connection tuning

| Option | Why |
| --- | --- |
| `maxPoolSize` | Requests **wait** when the pool is exhausted — an undersized pool shows up as *latency*, not errors. Oversizing moves the problem to the server (~1MB RAM per connection). `maxPoolSize × instances` must stay well below the server's limit |
| `serverSelectionTimeoutMS: 5000` | Default 30s means a request hitting a dead primary hangs for 30s holding a socket. 5s sheds load but survives a normal election (1–2s) |
| `socketTimeoutMS: 20000` | One unindexed query can pin a connection indefinitely; enough of them exhaust the pool, and one slow endpoint takes down every endpoint |
| `autoIndex: !isProduction` | Building an index on a large collection is a foreground operation that can stall the database exactly as your new version starts serving. In production, indexes come from migrations |
| `strictQuery` | Strips filter fields not in the schema, so a typo like `{ ownerid: x }` cannot silently match **every** document |

**A real error worth recognising:** `strictQuery` is a *Mongoose* option, not a *driver* option.
Putting it in `forRootAsync`'s options hands it to the driver, which rejects the whole connection
with `MongoParseError: option strictquery is not supported`. It belongs in schema options (or a
global `mongoose.set`).

---

## 9. The port pattern, applied — and deliberately not applied

`UsersRepository` and `ProjectsRepository` became **abstract classes** with two implementations:

```ts
{ provide: UsersRepository, useClass: MongoUsersRepository }      // production
{ provide: UsersRepository, useClass: InMemoryUsersRepository }   // unit tests
```

**Abstract class vs interface + token** — the two answers to the same question, both idiomatic:

| | Abstract class (here) | Interface + string token (Phase 3) |
| --- | --- | --- |
| Ergonomics | Type **and** token; no `@Inject` | `@Inject(TOKEN)` at every consumer |
| Cost | A real class in the bundle; single inheritance | None at runtime |
| Use when | It is your own abstraction inside your app | The shape is external, or one object implements several contracts |

`TasksRepository` is a **plain concrete class**, and the comment says why: the things worth testing
about tasks *are* the database behaviours (atomic sequences, conditional updates, aggregation,
transactions). An in-memory reimplementation of those would be a fiction that passes while
production breaks. Phase 3's own rule — *"a port for a class you will never swap is architecture
theatre"* — cuts both ways, and being able to explain the asymmetry is worth more than uniformity.

---

## 10. Phase 5 interview questions

**1. Schema, model, document?** Definition / compiled-and-bound-to-a-collection / one record. Plus
POJO from `.lean()`.

**2. What does `.lean()` change?** Returns plain objects instead of hydrated documents: 3–5× faster,
much less memory, but no `save()`, no virtuals, and **no `toJSON` transform** — so id mapping must be
explicit.

**3. Embed or reference?** Embed bounded, owned, read-together data; reference unbounded or
independently-queried data. Embedding gives atomic single-document writes for free; referencing
costs you a transaction.

**4. What is the ESR rule?** Equality fields, then Sort, then Range in a compound index. Plus the
prefix rule: `{a,b}` cannot serve a query on `b` alone.

**5. Is `unique: true` a validator?** No — an index declaration. Enforced by the server, reported as
error code 11000, and its build fails on existing duplicate data.

**6. Your uniqueness check is `findOne` then `create`. What is wrong?** Check-then-act is not atomic.
The app check is for the friendly message; the unique index is the guarantee. Catch 11000 and
translate it to 409.

**7. What is N+1 and how does `populate` help?** One query per parent row. `populate` batches the ids
into a single `$in`, so 51 queries become 2.

**8. What can `populate` *not* do?** Filter or sort the parent by a populated field — it happens in
the application, not the server. Use `$lookup` for that.

**9. Why must `$match` come first in a pipeline?** Only then can an index be used, and later stages
see fewer documents. After `$group`/`$unwind` it cannot use an index at all.

**10. When do you actually need a MongoDB transaction?** Only for multi-document or
multi-collection all-or-nothing writes. A single document write is already atomic. Consider whether a
better data model (embedding) removes the need first.

**11. What breaks a transaction silently?** An operation that does not receive the session. Also:
side effects inside the callback, since `withTransaction` may retry it.

**12. What are the alternatives to a transaction across services?** Sagas with compensating actions,
or the outbox pattern — because distributed transactions across databases are not available (Phase 20).

**13. How do you generate a sequential id in MongoDB?** A counters collection with an atomic
`findOneAndUpdate` + `$inc` + `upsert`. Never `count() + 1`. For very high throughput, hand out
ranges and accept gaps — gaps are fine, duplicates never are.

**14. Two users drag the same card at once. What happens?** With read-modify-write, one change is
silently lost. With a conditional update (`{_id, status: from}`), the second one matches nothing and
gets a 409, so the client can refresh and retry.

**15. Why is `autoIndex` off in production?** Index builds are expensive and can stall the database
at deploy time. Create indexes deliberately, out of band, and verify before the release.

**16. How do you debug a slow query?** `.explain('executionStats')`: look at `winningPlan.stage`
(`IXSCAN` vs `COLLSCAN`), `totalKeysExamined` vs `totalDocsExamined` vs `nReturned` (a large ratio
means a bad or missing index), `executionTimeMillis`, and whether a `SORT` stage appears — an
in-memory sort aborts past 32MB with "Sort exceeded memory limit". Also check the profiler
(`db.setProfilingLevel`) or Atlas's slow-query log for what is actually slow in production.

**17. Why does `findByIdAndUpdate` need `new: true` and `runValidators: true`?** Without the first,
you get the pre-update document. Without the second, schema validators (`enum`, `maxlength`) are
**not** applied to updates — a real path to corrupt data.

**18. What is `select: false` and why use it?** It excludes a field from every query unless
explicitly requested. On `passwordHash` it makes the safe behaviour the default, so even a controller
returning a raw document cannot leak it. Defence in depth.

**19. How do you avoid NoSQL injection with `$regex`?** Escape user input before interpolating it.
Unescaped input is both a syntax hazard and a DoS vector (catastrophic backtracking). And know that
non-anchored regex cannot use an index — a text index or a search engine is the real answer at scale.

**20. Soft delete vs hard delete?** Soft keeps history and referential sanity, at the cost of every
query remembering the filter. Centralise the filter in the repository (and match it with a partial
index), or accept that one call site will eventually forget.

---

## 11. Phase 5 scenario questions

**A — "An endpoint went from 80ms to 4s over three months, no code changes."**
Data grew past the point where a missing index mattered. `.explain('executionStats')` on the query;
look for `COLLSCAN` and a huge `totalDocsExamined / nReturned` ratio. Common causes: a filter field
with no index, a compound index whose order does not match (prefix rule), or an in-memory `SORT`
stage. Fix with the right compound index in ESR order, built in the background/out of band.

**B — "We get duplicate users occasionally, even though we check for the email first."**
Check-then-act. Two requests pass the check concurrently. Add the unique index (validate in the app,
enforce in the database), backfill/deduplicate before creating it, and translate 11000 to 409.

**C — "Deleting a task sometimes leaves comments behind."**
Two writes, no transaction — or a transaction where one operation did not receive the session. Wrap
both in `withTransaction`, thread the session through every call, and add the rollback test. If a
replica set is not available, the alternative is a background reconciliation job that deletes
orphans — eventual consistency, deliberately chosen.

**D — "Our list endpoint times out on page 5,000."**
`skip` makes the server walk and discard 5,000 × limit documents. Switch to cursor pagination
(`_id > lastId` with the sort key in the index) — O(1) regardless of depth. It also removes the
`countDocuments` call, which on a large filtered collection can cost more than the page itself.

**E — "Mongo connections hit the server limit after we scaled to 30 pods."**
`maxPoolSize × instances` exceeded the ceiling. Lower `maxPoolSize`, or move to a connection proxy.
Watch for the failure signature: latency, not errors, because requests queue for a socket.

**F — "A migration added an index and took the site down."**
`autoIndex` at startup, or a foreground index build on a large collection. Build indexes out of band
before the deploy, verify with `getIndexes()`, and keep `autoIndex: false` in production.

---

**Next:** Phase 6 — DTOs, validation and pipes. Every manual `if (!dto.email) throw` written in
Phases 2–5 gets deleted and replaced with declarative decorators plus a global `ValidationPipe`
(`whitelist`, `forbidNonWhitelisted`, `transform`), custom pipes (`ParseObjectIdPipe`), nested
validation, and a custom validator.
