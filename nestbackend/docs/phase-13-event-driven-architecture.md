# Phase 13 — Events and event-driven architecture

> **Goal:** invert the dependencies that Phase 4 papered over with `forwardRef`, and add a feature
> (the audit log) without touching a single existing service.

Verified: `lint` ✅ · `tsc` ✅ · **129 tests passing** ✅ · `build` ✅ ·
**`forwardRef` count in the codebase: 0**

```
src/events/domain-events.ts                       the vocabulary
src/events/events.module.ts                       EventEmitterModule.forRoot
src/projects/listeners/user-deletion.listener.ts  the veto, in the module that owns the rule
src/activity-logs/                                one wildcard listener, zero service changes
```

> **What is wired today (read this before the rest of the chapter).** The *mechanism* is complete
> and tested: the bus, the catalogue, the veto pattern and the wildcard audit listener. But only two
> events are actually **emitted** by application code — `user.registered` and
> `user.deletion_requested`. The `task.*`, `comment.added` and `project.*` events are declared in
> `domain-events.ts` and have no emitter yet, so the activity log currently contains user
> registrations only.
>
> This is a good exercise rather than a flaw to hide: it is exactly case **B** in the scenarios at the
> end of this chapter ("add the emits first"). Doing it means giving service methods an `actorId`
> (the controller already has it via `@CurrentUser()`), emitting after each successful write, and —
> because `emit` is not transactional — emitting _after_ the write commits, not inside it.

---

## 1. The payoff — `forwardRef` is gone

**Phase 4 (the cycle):**

```ts
// users.service.ts
@Inject(forwardRef(() => ProjectsService)) private readonly projectsService: ProjectsService,
const owned = await this.projectsService.countActiveOwnedBy(id);
if (owned > 0) throw new ConflictException(...);

// users.module.ts   imports: [forwardRef(() => ProjectsModule)]
// projects.module.ts imports: [forwardRef(() => UsersModule)]
```

**Phase 13 (inverted):**

```ts
// users.service.ts — knows nothing about projects
const request = { userId: id, blockers: [], actorId: id, occurredAt: new Date() };
await this.events.emitAsync(DomainEvent.USER_DELETION_REQUESTED, request);
if (request.blockers.length > 0) throw new ConflictException(request.blockers.join('; '));

// projects/listeners/user-deletion.listener.ts — the rule lives where it can be answered
@OnEvent(DomainEvent.USER_DELETION_REQUESTED)
async onUserDeletionRequested(event) {
  const owned = await this.projects.countActiveOwnedBy(event.userId);
  if (owned > 0) event.blockers.push(`Cannot delete a user who owns ${owned} active project(s)…`);
}
```

```
BEFORE   UsersService ⇄ ProjectsService                    (cycle, forwardRef ×4)
AFTER    UsersService ──emits──▶ [bus] ◀──listens── ProjectsModule
```

Neither module imports the other. The bus is *infrastructure*, so depending on it is not a
feature-to-feature dependency at all.

> **`forwardRef` compiled. It did not fix the design. This did.**

**Notice where the rule moved.** It is about *projects*, so it belongs to the module that can answer
it without asking anyone. Phase 4 had it in `UsersService`, which is precisely why `UsersService`
needed to know projects exist. And the day billing needs to veto a deletion too, it adds a listener
and nothing in `UsersService` changes.

---

## 2. Events are facts; commands are instructions

```
sendWelcomeEmail(user)      a COMMAND — one handler, the caller owns the outcome
UserRegistered { user }     an EVENT  — zero or many, the emitter does not care
```

**The test for a good event name:** delete every listener — does the emitter still make sense?
`project.member_added` survives. `project.send_member_email` does not; it is a command in disguise,
and it will acquire a second listener that has nothing to do with email.

**Payload size** — thin (ids only, N listeners = N queries), fat (everything, becomes a versioned
contract, can be stale), or **medium** (ids + the handful of fields every listener needs). This
project uses medium. In-process events can carry rich objects safely; the moment they cross a broker
they must be serialisable and versioned — one more reason to keep them small and boring from the
start.

---

## 3. What an in-process bus is *not*

`@nestjs/event-emitter` is a **synchronous, in-memory** dispatcher.

| | |
| --- | --- |
| ✗ **Not durable** | A crash between emit and handle loses the event. No retry, no dead letter |
| ✗ **Not cross-process** | Instance #3's emit never reaches instance #7 |
| ✗ **Not transactional** | A listener that throws does not roll back the emitter's write |

**So when is it right?** Decoupling modules *inside* one process, where losing the reaction is
acceptable; genuinely optional work (audit logs, metrics, cache warming); and as a **stepping
stone** — the emit points are exactly where a broker plugs in later (Phase 20), with no change to the
calling code.

**When to reach past it:** anything that must survive a restart, run exactly once, or reach another
service. Then it is BullMQ (Phase 12) or a broker — and the honest pattern is the **transactional
outbox**: write the event to the database in the *same transaction* as the state change, and let a
separate process publish it. That is the only way to avoid "the write committed but the event was
lost", which an in-memory bus cannot solve at all.

**The default this project uses:** emit in-process for optional reactions; enqueue a BullMQ job for
anything a user would notice if it went missing. Note the notification path does **both** — reacts to
an event, then enqueues durable work. That combination is the practical answer.

### `emit` vs `emitAsync`

`emit` is fire-and-forget and ignores results — async listeners become floating promises, which is an
unhandled-rejection risk *and* untestable, because your assertion can run before the listener does.

`emitAsync` awaits every listener. It is used **once**, for the veto, and the costs are real: the
emitter now waits for its listeners (partly defeating the decoupling), and a listener that throws
aborts the whole flow. Which is why the vetoing listener **objects** (pushes a string) rather than
throwing — so several objections can be collected and reported together. *"You own 3 projects; you
have an unpaid invoice"* is a far better error than whichever of the two fired first.

**When the veto pattern is wrong:** if the objection is a core *invariant* rather than a policy, an
event is too loose — anyone can forget to register the listener and there is no compile-time signal.
A shared "account lifecycle" service (Phase 4's option 3) is the stricter answer. The trade here is
deliberate.

---

## 4. The audit log — one class, zero service changes

```ts
@OnEvent('**')
async onAnyDomainEvent(payload, eventName) { … }
```

Without events, **every** service would need a dependency on the logger and a line in every method —
four services, four places to forget. With a wildcard listener it was **one new class and no changes
to any existing code**. `ActivityLogsModule` imports users, projects, tasks and comments: **none of
them.**

> The number of places that must change when you add a cross-cutting reaction goes from N to 1.

That is also what makes it the clearest microservice candidate (Phase 20) — it already communicates
only through events.

**Three details in that listener:**

- `@OnEvent('**')`, not `'*'`. With `delimiter: '.'`, a single `*` matches **one segment**, so it
  silently matches nothing — no error, no events, and the listener looks correct.
- **It never throws.** Most events use `emit` (a throw is an unhandled rejection), but
  `user.deletion_requested` uses `emitAsync` — where a throw would *abort the delete*. The same
  listener is reached from both paths, so swallowing is the only behaviour correct on both.
  *Counter-argument:* if the log is a **compliance** requirement, silently losing entries is worse
  than failing the operation — then the write belongs in the same transaction, not in a listener.
- **It redacts.** An audit log is long-lived, widely readable and frequently exported — exactly the
  wrong place for a token to end up.

---

## 5. A schema error worth keeping

```
Cannot determine a type for the "ActivityLog.subjectId" field
(union/intersection/ambiguous type was used).
```

`subjectId: string | null` has no single runtime constructor, so the emitted metadata is ambiguous
and Mongoose refuses to guess. `@Prop({ type: String })` fixes it — and the useful realisation is
that `@Prop` reads **the same emitted metadata that dependency injection does** (Phase 1), so it
inherits exactly the same limits. Any nullable or union-typed property needs its type stated.

---

## 6. Phase 13 interview questions

**1. Event vs command?** An event is a past-tense fact with zero or many listeners; a command is an
instruction with one handler and a caller who owns the outcome.

**2. How do you break a circular dependency without `forwardRef`?** Extract the shared concept, move
the rule to the module that can answer it, or invert with a domain event — this phase does the last
two together.

**3. `emit` vs `emitAsync`?** Fire-and-forget vs awaited. Use `emitAsync` only when you genuinely
need the listeners' effects before continuing, and know that it re-couples the emitter to them.

**4. Is `@nestjs/event-emitter` a message queue?** No — in-memory, in-process, not durable, not
retried. It decouples modules; it does not deliver work.

**5. When would you move to a broker?** Cross-process, cross-service, must-survive-restart, or
must-run-exactly-once. Then Kafka/RabbitMQ/NATS plus a transactional outbox.

**6. What is the transactional outbox and what problem does it solve?** Write the event to the
database in the same transaction as the state change; a separate publisher drains it. It closes the
"state committed, event lost" gap that no in-memory bus can.

**7. Thin or fat event payloads?** Thin means N listeners cause N queries; fat means a versioned
contract that can be stale. Medium is the usual compromise.

**8. A listener throws — what happens?** With `emit`, an unhandled rejection. With `emitAsync`, it
propagates to the emitter and can abort the operation. Design listeners for whichever path they are
on — and prefer collecting objections over throwing.

**9. How do you test event-driven code?** Assert the emitter EMITS (with the right payload), and test
listeners in isolation. Only prove the wiring end-to-end in an integration test — otherwise every
unit test needs the whole bus.

**10. What are the downsides of events?** Flow becomes non-obvious ("who reacts to this?"), ordering
and causality are harder to reason about, and debugging spans emitters and listeners that never
mention each other. Naming conventions and an audit log of events help; so does keeping the number of
listeners per event small.

**11. Why does the veto listener push a string instead of throwing?** So several objections can be
collected and returned together, and so one listener cannot pre-empt another.

**12. `@OnEvent('*')` matches nothing. Why?** With a `.` delimiter, `*` matches one segment. Use
`**`.

---

## 7. Phase 13 scenarios

**A — "Two modules need each other and CI fails at boot."** Short term, `forwardRef` on both sides to
unblock. Same day: find the missing concept. Usually one "need" is really a third responsibility, or
a notification that should be an event. This phase is the worked example.

**B — "We added an audit requirement across 12 services."** If they already emit events, it is one
listener. If they do not, add the emits first — that refactor pays for itself the second time
something cross-cutting is asked for.

**C — "An event fired but the listener never ran."** Check the name (typo, or `*` vs `**`), check the
listener's module is actually imported, and check whether you used `emit` and asserted too early.

**D — "We emitted an event, the process crashed, and the reaction never happened."** Expected — the
bus is in-memory. Move that reaction to a durable queue, or adopt an outbox.

**E — "Our event listeners are slowing down requests."** Something is using `emitAsync` where `emit`
would do, or a listener does real work inline. Listeners should be fast and optional; anything slow
belongs in a job.

**F — "Nobody can tell what happens when a user registers."** The cost of decoupling. Mitigate with a
central event catalogue (this project's `domain-events.ts`), consistent naming, and the activity log
itself — which is a runtime map of what actually fires.
