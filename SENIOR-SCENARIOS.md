# Senior scenarios

> **Part 58.** 40 situations, each with the reasoning that separates a senior
> answer from a competent one.
>
> These are not knowledge questions. Every one of them can be answered correctly
> by someone who knows less than you and reasons better — which is exactly why
> they get asked.

**What interviewers are listening for.** In roughly this order:

1. **Do you gather information before acting?** The junior answer starts fixing.
2. **Do you distinguish the symptom from the cause?**
3. **Do you consider people?** Most senior problems are not technical problems.
4. **Do you say what you'd give up?** Every real decision costs something.
5. **Do you know when to stop?** Knowing which problems _not_ to solve is most of
   the job.

**How to practise.** Say your answer out loud in under two minutes before
reading. If your answer starts with a solution, you've probably failed step 1.

Scenarios marked **★** happened, in some form, in this project.

---

## Contents

| §                                                     | #     |
| ----------------------------------------------------- | ----- |
| [Debugging under pressure](#debugging-under-pressure) | 1–8   |
| [Incidents and production](#incidents-and-production) | 9–15  |
| [Code review and quality](#code-review-and-quality)   | 16–23 |
| [Technical decisions](#technical-decisions)           | 24–31 |
| [People and process](#people-and-process)             | 32–40 |

---

## Debugging under pressure

### 1. "It works on my machine." ★

**The situation.** A bug reproduces for QA and never for you.

**What to do.** Stop trying to reproduce it and start finding the _difference_.
Environment, data, timing, browser, permissions, build. Ask QA for the exact
sequence, and for their user — role differences are the most common cause and the
easiest to miss because you're testing as an admin.

**The senior move:** get the difference into a test. ★ The `DELETE /tasks/:id`
500 in this project only happened against a standalone `mongod`, because
transactions require a replica set — a pure environment difference that no amount
of code reading would have found.

**What they're listening for:** you treat "can't reproduce" as information, not as
a dead end.

---

### 2. A test is flaky. It passes on rerun.

**What to do.** Quarantine it — but _file the bug_, don't just skip it. A flaky
test is usually reporting a real race that will bite in production.

Common causes in order: a fixed `setTimeout` instead of waiting on a condition;
shared state between tests; a real race in the code; test order dependence.

**The senior move:** say out loud that "rerun until green" is how a suite becomes
worthless. Once people learn to rerun, they rerun past real failures too.

**What loses the point:** `retries: 3` as the answer.

---

### 3. A bug only appears in production.

**What to do.** Narrow the difference: build mode (minification, `NODE_ENV`),
data volume, real latency, real concurrency, CDN caching, environment config.

Then improve _observability_ before guessing — if you can't see it, you'll be
changing code by hypothesis and shipping to check.

**The senior move:** treat "we can't debug this" as the bug to fix first.

---

### 4. Users report the app is slow. No further detail.

**What to do.** Refuse to optimise anything yet. Establish _which_ slow: initial
load, a specific interaction, or one screen. They have unrelated causes.

Then get a number and a baseline. Then find the _biggest_ contributor rather than
the most interesting one.

**The senior move:** ★ report honestly when the fix doesn't help. Code splitting
here made cold load _worse_ — 213 → 245 kB gzip, because separate gzip streams
share no dictionary. It was kept for cache stability, and that trade-off was
written down rather than quietly buried.

---

### 5. A memory leak in a long-lived page.

**What to do.** Heap snapshots, take three at intervals, compare retained sizes.
Look for the usual suspects: subscriptions without cleanup, timers, event
listeners on `window`, detached DOM held by a closure.

**In React specifically:** a missing effect cleanup. ★ Delete the cleanup from
this project's SSE hook and you leak an `EventSource` per mount plus duplicate
notifications forever.

**The senior move:** ask whether the page is _meant_ to live that long. Sometimes
the fix is remounting on navigation.

---

### 6. An intermittent 401 that logs users out at random. ★

**What to do.** Look for concurrency, not for token expiry. This exact shape — a
few requests fire at once, all 401, all trigger a refresh, rotation invalidates
the earlier ones, reuse detection kills the session — is one of the most common
auth bugs in SPAs.

**The fix:** single-flight refresh. One in-flight promise everyone awaits.

**The senior move:** naming _reuse detection_ as the mechanism rather than
describing the symptom. It shows you understand why the security feature is
firing correctly on your own bug.

---

### 7. A test passes but you don't believe it. ★

**What to do.** Break the code and confirm the test fails. That's the only way to
find out.

**Why this matters:** this project found two vacuous tests that way. One MSW
handler re-validated the old token, so _"retries with the new token"_ passed even
when the client replayed the stale one. Another asserted "no refetch after an
optimistic update" and passed even with `invalidatesTags` added, because the
refetch dispatches _after_ the promise resolves.

**And the reverse case, which is the subtler skill:** ★ when a mutation _doesn't_
break a test, check whether the test is vacuous **or the mutation failed to
create the bug**. Assuming the first here would have led to weakening a test that
was already correct.

---

### 8. The stack trace points at a library.

**What to do.** It's almost never the library. Read the trace for the last frame
in _your_ code and start there — usually you passed something the library didn't
expect.

**When it genuinely is the library:** search the issue tracker before writing a
reproduction, pin a version to unblock, and file upstream. Forking is a
maintenance commitment, not a fix.

---

## Incidents and production

### 9. Production is down. You're first to notice.

**Order of operations:** communicate → mitigate → diagnose. In that order.

Tell people it's down and that you're on it _before_ you start debugging, because
the second-worst thing in an incident is five people debugging in silence.

**Mitigate before you understand.** Roll back, feature-flag off, scale up. Root
cause is a _post-incident_ activity — the urge to understand first is the most
common senior mistake in incidents.

**The senior move:** say "restore service, then learn" explicitly.

---

### 10. A deploy caused it. Roll back or fix forward?

**Default: roll back.** It's the known-good state and it's fast.

**Fix forward when** the rollback is unsafe — a migration already ran, or the bad
version wrote data the old code can't read. Which is exactly why migrations must
be backward-compatible: expand → migrate → contract, so any two adjacent versions
can run simultaneously.

**The senior move:** noticing that "can we roll back?" is a question you should
have answered _before_ deploying.

---

### 11. The container reports healthy but users get errors. ★

**What to do.** The healthcheck is checking the wrong thing. Liveness ("is the
process alive?") passing while readiness ("can it serve?") should be failing.

**And the inverse, which this project shipped:** ★ the container reported
_unhealthy_ with `FailingStreak: 11` and nobody had connected it to anything. A
global rate limit of 10 requests/15 min against a 30-second healthcheck meant the
container was **rate-limiting its own liveness probe**.

**The senior move:** treating an unexplained health status as a bug rather than
noise. It had been sitting there, visible, for the whole session.

---

### 12. Error rates spike after a dependency update.

**What to do.** Pin and roll back first, diagnose after. Then read the changelog
for behavioural changes rather than API changes — the ones that break you compile
fine.

**The senior move:** ask why it wasn't caught. Usually the answer is that the
update path has no integration test, and _that's_ the fix.

---

### 13. A rate limit is causing an outage. ★

**What to do.** Establish whether it's protecting you or attacking you.

**The failure shape worth knowing:** a limit applied to something that shouldn't
have one creates a feedback loop — throttled probe → container killed → less
capacity → survivors throttled sooner → collapse under load it could otherwise
serve. The control designed to protect the service takes it down, precisely when
it's busiest.

**The general rule:** a request from your own platform is not traffic. Probes,
scrapes and readiness checks are control plane and must not share a budget with
users.

---

### 14. A customer reports data they shouldn't be able to see.

**Treat it as a security incident**, not a bug. Different process: preserve
evidence, establish scope (who else, how long, what data), notify per policy,
_then_ fix.

**Where to look first:** ★ the **collection** endpoint. Route-level auth and
object-level auth get attention; the list endpoint that forgot to scope by the
caller is the one that leaks quietly. In this project `GET /tasks` returned every
task in the database while `GET /tasks/:id` checked ownership correctly.

**The senior move:** ask "what else has the same shape?" — and audit every list
endpoint, not just the reported one.

---

### 15. You find a vulnerability in your own code from six months ago.

**What to do.** Report it yourself, immediately, with the same seriousness you'd
give someone else's. Assess exploitability and whether it _was_ exploited before
worrying about how it happened.

**The senior move:** in the retro, ask what would have caught it — not who wrote
it. ★ The authorization audit here found eight endpoints with no object-level
check; the durable output wasn't eight fixes, it was a guard and a test pattern
that makes the ninth one hard to write.

---

## Code review and quality

### 16. A PR works but you'd have built it differently.

**Approve it.** "I'd have done it differently" is not a review comment.

**Block only for:** correctness, security, or a decision that's expensive to
reverse. Everything else is a comment marked as optional, or a conversation
outside the PR.

**The senior move:** knowing that style debates in review cost more than the
inconsistency they prevent, and that lint config is where that argument belongs.

---

### 17. A junior's PR has fifteen problems.

**Don't leave fifteen comments.** That reads as an attack regardless of tone, and
they'll fix the fifteen without learning the two things that mattered.

**Pick the two or three that matter**, explain _why_ with a concrete failure, and
offer to pair on the rest. Say what's good first — specifically, not as ritual.

**The senior move:** noticing that fifteen problems in one PR is usually a
_scoping_ failure, and the real fix is smaller PRs.

---

### 18. Someone reviews your PR and they're wrong.

**Assume you're missing context first**, and ask a question rather than defending.
If they're still wrong, disagree explicitly with reasoning — and if it's not
worth the argument, say _"I don't think that's right, but I'll change it"_ rather
than silently complying.

**The senior move:** taking it out of the PR thread and into a conversation after
two round-trips. Text is a bad medium for disagreement.

---

### 19. The codebase has no tests and you're asked to add a feature.

**Don't stop to write a test suite.** You'll be six weeks in with no feature.

**Do:** write tests for what you touch, add the _harness_ (so the next person has
somewhere to put one), and pick the highest-blast-radius area for any extra
effort — auth, money, deletion.

**The senior move:** making the argument in terms of risk rather than
craftsmanship. "We can't safely change billing" lands; "we should have tests"
doesn't.

---

### 20. You inherit code you think is bad.

**Assume it made sense.** Constraints you can't see: a deadline, a
since-removed dependency, a requirement that changed. Find out before rewriting.

**Then:** improve what you touch, and make the case for larger changes with
evidence — incident frequency, time-to-change, bug density.

**The senior move:** resisting the rewrite. Rewrites lose the accumulated
bug fixes that make the ugly code correct.

---

### 21. A teammate wants to add a large dependency for one feature.

**Ask what it costs**, concretely: bundle size, transitive deps, maintenance
status, licence, and what happens if it's abandoned.

**Then ask what we'd write instead** and how long that takes. ★ This project
hand-rolled a ~40-line virtual list rather than adding one — _for learning_, and
the doc says explicitly to use `react-window` in production, because variable row
heights, scroll restoration and RTL are real work.

**The senior move:** the answer differs by _layer_. A date formatter for one
call site is usually `Intl`. A virtualization library in a data-heavy product is
worth every kilobyte.

---

### 22. Coverage dropped 3% on your PR. CI is red.

**Look at what's uncovered**, not at the number. If it's a config object, raise
the threshold or exclude it. If it's a branch that handles failure, write the
test — that's the branch that matters.

**The senior move:** saying coverage is a useful floor and a terrible target, and
that the real question is _"does a test fail when I break this?"_

---

### 23. Someone proposes a strict lint rule that will touch 400 files.

**Ask what bug it prevents.** If the answer is a real class of bug, do it — in a
separate, mechanical PR with no logic changes, and add the rule in the same
commit so it can't regress.

**If it's a preference,** it's a preference. 400 files of churn destroys `git
blame` for everyone.

**The senior move:** ★ knowing that some rules are worth the pain. This project
runs `react-hooks/exhaustive-deps` as an **error**, because lying to that linter
produces bugs that only appear on the second interaction.

---

## Technical decisions

### 24. The PM wants a feature you think is a bad idea.

**Separate "bad idea" from "not my call".** If it's a product judgement, state
your concern once, clearly, and then build it well.

If it's a _technical_ consequence they can't see — this makes the next three
features slower, this can't be undone, this has a security implication — that's
information they don't have, and giving it is your job.

**The senior move:** disagree-and-commit, out loud. And write down the concern, so
if it goes wrong the conversation is about the decision rather than about memory.

---

### 25. You're asked for an estimate on something you don't understand.

**Don't give a number.** Give a _spike_: "two days to understand it, then I'll
estimate."

If pressed, give a range with the uncertainty attached — "somewhere between one
and four weeks, and I'll know which by Thursday" — and say what would narrow it.

**The senior move:** naming what makes it uncertain, rather than padding a number
and hoping.

---

### 26. Ship the hack now or do it properly?

**Ask when the fix happens.** "Later" is not a date, and everyone knows it.

**Ship the hack when:** the deadline is real, the blast radius is contained, and
the cost of the shortcut is _visible_ — a comment, a ticket, a failing-loudly
fallback.

**Refuse when:** it's in a security boundary, it's a data-shape decision (those
compound), or it's the kind of shortcut that gets built on before anyone revisits
it.

**The senior move:** ★ this project keeps a list of deliberately-open known
issues in `ROADMAP.md`. Debt you've written down is a decision; debt you haven't
is a surprise.

---

### 27. Two engineers disagree about architecture and it's stalled.

**Find the disagreement.** Usually it's not the architecture — it's an unstated
assumption about scale, team size, or how long this will live.

**Then make it decidable:** what evidence would settle it? A prototype, a
benchmark, a look at how often that code actually changes.

**If it's genuinely a judgement call:** it needs a decider, not more discussion.
Being the person who says "we've spent enough, here's the call and here's why" is
a senior act.

---

### 28. You want to adopt a new technology. Make the case.

**Not "it's better."** Name the _specific_ problem it solves that you have today,
what it costs to adopt (learning, migration, hiring), and how you'd back out.

**Then propose the smallest version:** one service, one route, one screen. A
technology decision you can't reverse should never be made at full scale first.

**The senior move:** ★ saying when _not_ to adopt. This project has no SSR: it's
an authenticated internal tool, so there's no SEO value and every page needs a
session anyway. That's a stronger answer than knowing how RSC works.

---

### 29. Your performance fix didn't work. ★

**Say so.** Immediately, with the numbers.

Then decide whether to revert or keep it for a different reason — and be honest
about which. This project kept its code splitting _despite_ a worse cold load,
because redeploys cost a returning user ~8.5 kB instead of 213 kB. That's a
defensible call, and it's only defensible because it's stated as a trade-off
rather than a win.

**The senior move:** the willingness to report a negative result at all. Most
people quietly keep the change and say nothing.

---

### 30. A library you depend on is abandoned.

**Assess before panicking:** does it still work, is the API surface small, is
there a fork with traction, how deeply is it embedded?

**Options:** stay (pin it, accept the risk), fork (you now own it), migrate
(cost), or vendor the parts you use (often the cheapest for small libraries).

**The senior move:** treating "how hard would this be to replace?" as a question
you ask at _adoption_ time, not at abandonment time.

---

### 31. You're asked to add a feature the architecture doesn't support.

**Don't force it in, and don't demand a rewrite.** Both are the same mistake at
different scales.

**Do:** name what would have to change, estimate it honestly, and offer a
constrained version that fits today. Then let the people with the business
context choose.

**The senior move:** noticing when the third such request arrives. One awkward
feature is a feature; three are a signal that the model is wrong.

---

## People and process

### 32. You're the only one who understands a critical system.

**That's a risk you own**, not job security. Fix it: document the _why_ (the what
is in the code), pair on the next change, and deliberately let someone else take
the one after.

**The senior move:** recognising it as a _team_ failure to notice. Bus factor is a
process problem, not a personal one.

---

### 33. You disagree with your manager's technical decision.

**Once, clearly, with reasoning.** Then commit — visibly, without sniping about it
afterwards, because half-hearted execution makes the decision fail for the wrong
reasons and teaches nobody anything.

**Escalate only if** it's a safety, security or legal issue.

**The senior move:** writing the concern down, so the retro can be about the
decision rather than about who remembers what.

---

### 34. A teammate is consistently shipping poor work.

**Assume a cause you can't see first:** unclear requirements, missing context, a
skills gap nobody has named, or something outside work.

**Then be specific and private.** "Your PRs need a lot of review" is useless.
"These three PRs each missed error handling — let's look at why" is actionable.

**The senior move:** knowing what's yours and what's your manager's. Feedback is
yours; performance management isn't.

---

### 35. You made a mistake that cost the team a day.

**Say so early, plainly, without a performance of remorse.** Then focus on what
would have caught it.

**The senior move:** the blameless framing applied to _yourself_. ★ In this
project I wrote _"VERIFIED LOAD-BEARING"_ on a test comment, then checked and it
was false — jsdom has no layout, so the test could never have caught that bug. The
correction is in the file, along with what jsdom _can_ and can't see.

That's more useful to the next person than the original claim would have been if
it had happened to be true.

---

### 36. The team wants to rewrite. You think it's a mistake.

**Ask what specifically is wrong**, and whether the rewrite fixes _that_. Usually
the complaint is "it's hard to change", and a rewrite fixes it for six months
until the same pressures produce the same result.

**Offer the alternative:** strangler-fig. New work in the new shape, old code
migrated as it's touched, always shippable.

**When a rewrite IS right:** the platform is dead, the security model can't be
retrofitted, or the thing is small enough to redo in weeks.

---

### 37. You're asked to interview someone in a stack you don't know.

**Interview the reasoning, not the syntax.** How do they debug? How do they decide
what to test? What did they get wrong recently and what did they change?

**Be honest with the candidate** that it's not your stack. It's fairer, and it
usually produces a better conversation.

---

### 38. Onboarding a new engineer. What do you do first?

**Get them shipping something small in week one** — the pipeline, the review
process, the deploy. Confidence comes from completing the loop, not from reading.

**Then:** pair on a real change, and let them write the onboarding doc updates,
because they're the only person who can see what's missing.

**The senior move:** asking them what was confusing, and _fixing it_ rather than
explaining it.

---

### 39. Your estimate was wrong and you'll miss the date.

**Say it as soon as you know**, not on the date. The value of the warning decays
to zero at the deadline.

**Bring options, not just news:** cut scope, add time, add people (rarely helps),
or ship a reduced version. Let the people who own the trade-off make it.

**The senior move:** saying _why_ it slipped in a way that improves the next
estimate.

---

### 40. You're the most experienced person in the room and nobody is speaking up.

**Talk last.** Once you state an opinion, you've anchored the discussion and the
quiet people will agree with you rather than think.

**Ask questions instead**, and ask the quietest person directly and specifically —
"you've worked on this area, what are we missing?" beats "any thoughts?".

**The senior move:** understanding that your influence is now a _bug source_. The
seniority that makes people listen is the same thing that stops them disagreeing,
and managing that is part of the job.

---

## Related

- [INTERVIEW-QUESTIONS.md](INTERVIEW-QUESTIONS.md) — 130 technical questions
- [ARCHITECTURE-QUESTIONS.md](ARCHITECTURE-QUESTIONS.md) — 20 design discussions
- [MOCK-INTERVIEW.md](MOCK-INTERVIEW.md) — a full loop with follow-ups
- [POSITIONING.md](POSITIONING.md) — talking about experience honestly
