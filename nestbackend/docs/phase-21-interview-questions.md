# Phase 21 — The interview question bank

**132 questions**, every one answerable from code in this repository.

| Set | Count | What it covers |
| --- | --- | --- |
| [Beginner](interview/01-beginner.md) | **20** | Modules, controllers, providers, DI, DTOs, pipes, guards, the lifecycle |
| [Intermediate](interview/02-intermediate.md) | **30** | Custom providers, scopes, circular deps, RBAC, caching, queues, events, testing |
| [Advanced](interview/03-advanced.md) | **30** | DI internals, resolution order, Mongoose mechanics, auth design, Redis, probes, Docker |
| [Senior / architecture](interview/04-senior-architecture.md) | **20** | Monolith vs microservices, multi-tenancy, zero-downtime deploys, observability, judgement |
| [Scenarios](interview/05-scenarios.md) | **32** | "Here's a situation — what do you do?" |

Every entry in the first four sets uses the same structure:

> **Answer** · **Why it matters** · **Real-world example** (from this codebase) · **Common mistake** ·
> **Follow-up** (what a good interviewer asks next)

The scenario set uses **diagnosis → fix → trade-off**, because a fix without a stated cost is not a
senior answer.

---

## How to use this

**Do not read it front to back.** It is a reference, and reading it like a book produces recognition,
not recall.

The method that works:

1. **Cover the answer.** Say yours out loud, at full length, as if to a person. Silent reading feels
   like knowing and is not.
2. **Compare.** You are checking for the *why*, not the vocabulary.
3. **Open the file.** Every "real-world example" names one. Read it. The code is the thing you will
   actually remember under pressure — a comment you have read is far stickier than a bullet point.
4. **Answer the follow-up too.** That is where interviews are won or lost; the first question is
   usually just the setup.

**Spend most of your time on Intermediate and Advanced.** That is where a 4–5 year interview lives.
Beginner questions are screening — you need them to be *fast* and *specific*, not long.

---

## The 12 that come up most

If you have one evening, these:

| # | Question | Set |
| --- | --- | --- |
| 1 | How does Nest's DI actually work? | [A1](interview/03-advanced.md) |
| 2 | The three custom provider recipes and when each applies | [I1](interview/02-intermediate.md) |
| 3 | Provider scopes and scope bubbling | [I3](interview/02-intermediate.md) |
| 4 | Circular dependencies — and why `forwardRef` is the *last* answer | [I4](interview/02-intermediate.md) |
| 5 | The request lifecycle, in order | [B14](interview/01-beginner.md) |
| 6 | Guard vs interceptor vs middleware vs pipe | [B13](interview/01-beginner.md) |
| 7 | `APP_GUARD` and friends — why not `useGlobalGuards`? | [I6](interview/02-intermediate.md) |
| 8 | Refresh-token rotation, families and reuse detection | [A14](interview/03-advanced.md) |
| 9 | When CSRF applies — and when it is theatre | [A16](interview/03-advanced.md) |
| 10 | Liveness vs readiness, and the outage from conflating them | [A22](interview/03-advanced.md) |
| 11 | Caching: cache-aside, stampedes, and when *not* to | [I13](interview/02-intermediate.md) |
| 12 | Monolith vs microservices, and what you have already done to allow a split | [S1](interview/04-senior-architecture.md) |

---

## Questions to ask *them*

An interview is two-directional, and these signal seniority better than anything you say about
yourself:

- "How do you handle database migrations — is there a review step?"
- "What does your deploy look like? How long from merge to production, and how do you roll back?"
- "What's your test strategy? What's the suite's runtime?"
- "How do you find out something is broken — alerts, or a customer?"
- "What's the on-call rotation, and what was the last incident?"
- "Where's the technical debt you'd fix first if you had a month?"

The last one is the most useful question in an interview. The answer tells you whether the team knows
its own weak points — and a team that cannot name any is telling you something.

---

## On the experience question

The brief for this project was explicit, and it is worth restating here because it is the one thing
you should rehearse until it is automatic: **do not claim 4–5 years of NestJS.**

The full answer is [S20](interview/04-senior-architecture.md), and its shape is:

> 2+ years of professional Node/TypeScript/Express/MongoDB/Angular — **true, verifiable, and most of it
> transfers**. NestJS specifically: more recent, deliberately deep, and demonstrable in a codebase you
> can walk someone through line by line.

Three reasons this is the strong play and not the safe one:

1. **It survives interrogation.** An inflated claim collapses at the first *"walk me through how you
   handled that"*, and the collapse costs you the interview and the reference.
2. **Depth beats duration, and interviewers know it.** Explaining why `forwardRef` is the wrong first
   answer, or why a liveness probe must not touch the database, demonstrates more than five years of
   CRUD.
3. **It sets you up to say the most useful sentence in any interview:** *"I haven't done that in
   production. Here's how I'd approach it, and here's the closest thing I have done."* Interviewers can
   tell the difference between that and a fluent bluff far more often than candidates expect — and the
   first one reads as senior.

Avoid both failure modes: **inflating**, and **apologising** (*"I only have two years…"*), which invites
the interviewer to agree with you. State the facts, then move immediately to what you can do.

---

**Next:** [Phase 22 — mock senior NestJS interview](phase-22-mock-interview.md)
