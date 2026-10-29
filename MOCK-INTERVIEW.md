# Mock interview

> **Phase 28.** A full loop — five rounds, as they'd actually run, with the
> follow-ups interviewers use to find the bottom of an answer.

**How to use this.** Do it in real time, out loud, with a timer. Reading it is
close to worthless: the failure mode in interviews is knowing something and being
unable to say it in order, and you can only find that by talking.

Each round has:

- **the questions**, in the order they'd come
- **what a strong answer contains** — the checklist, not a script
- **the follow-up** — where they go if your first answer is good
- **the tell** — what a weak answer sounds like

**Grade yourself honestly.** At the end of each round, mark each question
**solid / shaky / missed**. Shaky is the useful category: it's the answer you
have but can't deliver, and it's fixable in an evening.

---

## The setup

**Role:** Senior Frontend Engineer (React), mid-size product company.
**Loop:** recruiter screen → technical screen → coding → system design →
behavioural + team fit.

**Your position going in:** strong TypeScript, Angular professionally, React
learned properly and rebuilt recently, full-stack project against your own
NestJS API. See [POSITIONING.md](POSITIONING.md) — do that first, because Round 1
is entirely positioning.

---

# Round 1 — Recruiter / hiring manager screen (30 min)

Low technical depth, high stakes. This round is where people get filtered on
*framing*, not knowledge.

### 1.1 "Tell me about yourself."

**Strong answer contains:** current level and stack, the shape of your
experience, one concrete recent thing, and — voluntarily — where the gaps are.
Ninety seconds, not five minutes.

**The follow-up:** "What's the thing you're most proud of in that project?"
Have a specific answer. "The authorization audit" beats "the architecture".

**The tell:** a chronological career recital. They asked for a summary, not a CV
readback.

---

### 1.2 "How many years of React?"

**Strong answer contains:** the accurate number, no inflation, and an immediate
redirect to substance. See the scripted version in
[POSITIONING.md](POSITIONING.md#part-3--answering-the-hard-questions).

**The follow-up:** "So most of your professional work has been Angular?" — said
neutrally, and it is *not* a trap. Agree, and explain what transfers.

**The tell:** hesitation, or a number that doesn't match your CV dates. Either
one costs more than the honest answer would have.

---

### 1.3 "Why are you leaving / looking?"

**Strong answer contains:** something you're moving *toward*. Scope, product
type, technical depth.

**The tell:** criticising your current employer. It's the single most common
own-goal in this round, and interviewers hear it as "will say this about us".

---

### 1.4 "What are you looking for in your next role?"

**Strong answer contains:** two or three specifics that are checkable — code
review culture, ownership of a domain, a team where you're not the most senior
person. Vague answers ("growth", "challenge") read as no preference.

---

### 1.5 "Any questions for me?"

**Always yes.** Good ones for this round: how the team is structured, what the
first three months look like, why the role is open.

**The tell:** "What does the company do?" You should know.

---

# Round 2 — Technical screen (60 min)

Rapid-fire, breadth-first. They're establishing a floor, then probing for depth
in one or two places.

### 2.1 "Walk me through what happens when `setState` is called."

**Strong answer contains:** schedules an update → React re-renders the component
(calls the function) → reconciles the new element tree against the old → commits
only the differences to the DOM → runs effects. And: updates batch, and calling
it with the same value can bail out.

**The follow-up:** "You said 'the same value' — how is that compared?"
→ `Object.is`. Which is why mutation is invisible.

**The tell:** "it re-renders the component" and nothing else. Re-render is not
the interesting part; *what happens after* is.

---

### 2.2 "What's the difference between state and a ref?"

**Strong:** state is rendered and changing it schedules a render; a ref is a
mutable box that survives renders and changing it does nothing. Refs are for DOM
handles and for "remember across renders without rendering it".

**Follow-up:** "Give me a case for the second." → a `isFirstRender` flag, a
latest-value ref inside a stable callback, a timer id.

---

### 2.3 "Explain the dependency array."

**Strong:** every reactive value the effect reads. Not "when I want it to run".
Say that lying to the linter produces bugs that appear on the *second*
interaction, which is why it should be an error rather than a warning.

**Follow-up:** "What if a function has to be a dependency and it changes every
render?" → `useCallback` at the definition, or move it inside the effect, or a
latest-ref if it genuinely shouldn't re-subscribe.

**The tell:** "I just put in what I need." That's the answer that produces stale
closures.

---

### 2.4 "What is `key` for?"

**Strong:** identity across renders, not uniqueness. React uses it to decide
update-vs-remount. Wrong keys attach state to the wrong row.

**Follow-up:** "When is the index fine?" → stateless, never reordered, never
filtered.
**Second follow-up:** "Show me a bug." → a list of inputs with index keys,
delete the first row, the values shift.

---

### 2.5 "`useMemo` — when do you reach for it?"

**Strong:** when you've measured, or when *referential identity* matters (a
dependency of another hook, a prop to a memoised child). Say that most
computations are cheaper than the comparison.

**Follow-up:** "So is `React.memo` everywhere a good default?" → No, and name what
defeats it: inline objects, arrays and arrow functions.

**The tell:** "for performance." That's the question, not the answer.

---

### 2.6 "How do you fetch data in React?"

**Strong:** name the layers. `useEffect` + fetch works and you'd rarely write it,
because you immediately need caching, dedupe, cancellation, retry and
revalidation — which is what RTK Query or React Query exist for. Server state is
a **cache**, not state.

**Follow-up:** "What's wrong with `useEffect` + fetch specifically?" → race
conditions on rapid navigation (a slower earlier request resolving last),
waterfalls, no dedupe, no cache.

---

### 2.7 "Where do you store an auth token?"

**Strong:** access token **in memory**, refresh token in an **httpOnly cookie**,
and the sentence that matters — neither is "secure", they trade different risks.
`localStorage` is readable by any XSS; a cookie needs CSRF protection.

**Follow-up:** "How does the refresh work?" → rotation with reuse detection.
**The one they're hoping for:** "What if five requests 401 at once?" →
single-flight. If you volunteer this before being asked, the round is going well.

---

### 2.8 "How do you test a component?"

**Strong:** query by role and accessible name so tests break when the *experience*
breaks, not the markup. Mock at the network layer (MSW), not by stubbing `fetch`.

**Follow-up:** "How do you know your tests are any good?" → break the code and
see if they fail. Mention finding your own vacuous tests that way.

---

### 2.9 "Anything you find hard about React?"

**Strong:** a real answer. Effects are the sharp edge — they're an escape hatch
that looks like a lifecycle, and most misuse is people syncing state that should
be derived.

**The tell:** "not really." Nobody believes it.

---

# Round 3 — Live coding (60 min)

Usually one problem with escalating requirements. The escalation *is* the
interview; the first version is a warm-up.

### 3.1 "Build a search box that filters a list from an API."

**Do this before writing code:**

- Ask about list size (does it need virtualization?)
- Ask whether search is client- or server-side
- Ask whether the query should be in the URL

**Version 1 — make it work.** Controlled input, filter, render. Talk while you
type; silence is the worst outcome in this round.

**Version 2 — "it fires a request per keystroke."** Debounce, and say *why the
cleanup is the mechanism*:

```ts
useEffect(() => {
  const id = setTimeout(() => { setDebounced(query); }, 300);
  return () => { clearTimeout(id); };
}, [query]);
```

**Version 3 — "sometimes it shows the wrong results."** ⭐ **This is the real
question.** Type `rea` then `react`; if `rea` resolves last it wins. Fix with
`AbortController` (or a sequence number), and say which and why.

**Version 4 — "make it shareable."** Move the query to the URL search params.
Now back/forward work and the filtered view is a link.

**Version 5 — "10,000 results."** Push back first: is pagination the right
answer? Only virtualize if the list must genuinely be one continuous scroll — and
mention that virtualization breaks Ctrl+F and needs `aria-setsize`.

**Version 6 — "make it accessible."** `role="combobox"`, `aria-expanded`,
`aria-activedescendant` — and the detail: the highlight moves the *descendant*,
focus stays in the input.

**What they're actually scoring:** whether you clarify before coding, whether you
narrate, whether you spot the race unprompted, and whether you push back on
version 5.

---

### 3.2 The likely alternates

If it isn't a search box it's one of these. All are in
[CODING-EXERCISES.md](CODING-EXERCISES.md) with solutions:

- **`useEventListener`** (#25) — the ref-indirection problem
- **An accessible modal** (#33) — focus *return* is the scored part
- **`promisePool`** (#14) — claim the index before awaiting
- **Compound `<Tabs>`** (#35) — memoise the context value
- **An async form state machine** (#50) — make impossible states unrepresentable

---

# Round 4 — System design (60 min)

### 4.1 "Design the frontend for a task management app."

**Spend the first five minutes on requirements, not architecture.** Interviewers
score this heavily and candidates skip it.

Ask: how many users, how many tasks per view, real-time or polling, offline,
mobile, who are the roles, is there an existing API.

**Then structure the answer:**

1. **Data flow** — where state lives, and the four buckets: server state (a
   cache), URL state (filters — say why this matters), global client state,
   local state.
2. **The API contract** — how you avoid drift. Generated types, checked in CI.
   And the honest caveat about response schemas.
3. **Auth** — token storage, refresh, and *the frontend is not the boundary*.
4. **Real-time** — SSE vs WebSockets, and why one-directional traffic favours
   SSE. Then how it works with more than one server instance (pub/sub).
5. **Performance** — what you'd measure before optimising.
6. **Failure states** — what the user sees when the API is down. This is the one
   people forget and it's the most product-relevant.

**Follow-up: "How does the real-time part scale?"** → connections are the
constraint, not messages; fan-out to a large group wants a broker; a reconnecting
client loses missed events unless you implement `Last-Event-ID` with durable ids.

**Follow-up: "Two users edit the same task."** → say plainly that last-write-wins
is the default, then optimistic concurrency with a version field, and ask *how bad
a lost update is* before designing further.

---

### 4.2 "Walk me through a system you've built."

Use the [architecture walkthrough](ARCHITECTURE-QUESTIONS.md#1-walk-me-through-this-systems-architecture)
— ninety seconds at the right altitude.

**The follow-ups you should want:**

- *"Why a monolith?"* → what microservices buy, what they cost, what signal you'd
  watch for. Not dogma.
- *"What would you change?"* → response schemas, real-browser E2E, the bundle.
  Having a real answer here is a strong signal.
- *"What went wrong?"* → the rate limiter. It's the best story you have: a
  plausible-looking config that capped the whole API, found empirically, with a
  visible symptom nobody had connected.

---

### 4.3 "How would you migrate a large Angular app to React?"

Strangler-fig, route-level split at a reverse proxy, start with a leaf route.
Then the half that decides it: **who maintains the old app during the migration?**

See [ARCHITECTURE-QUESTIONS.md #18](ARCHITECTURE-QUESTIONS.md).

---

# Round 5 — Behavioural (45 min)

Answer in **STAR** — situation, task, action, result — but keep situation short.
Most people spend three minutes on setup and thirty seconds on what they did.

### 5.1 "Tell me about a bug that was hard to find."

**Use:** the rate limiter, or the intermittent-401 refresh race.

**The structure that scores:** what the symptom was → what you *ruled out* → how
you found it → what you changed so it can't recur. The ruling-out is the part
that shows method.

---

### 5.2 "Tell me about a time you were wrong."

**Use:** the false "VERIFIED LOAD-BEARING" test comment. You asserted a test was
load-bearing, checked, found it wasn't because jsdom has no layout, and published
the correction in the file.

**Why this is a good answer:** it's a *technical* mistake with a *process* lesson,
you found it yourself, and the fix generalises. Avoid "I work too hard" answers
and avoid mistakes with no resolution.

---

### 5.3 "Tell me about a disagreement with a colleague."

**Structure:** what you each believed → what you did to find the *actual*
disagreement (usually an unstated assumption) → how it resolved → what you'd do
differently.

**The tell:** a story where you were right and they came around. Interviewers hear
it as "cannot be moved".

---

### 5.4 "Tell me about a time you pushed back."

**Strong:** you disagreed, gave the technical consequence they couldn't see,
were overruled, and executed well anyway. Disagree-and-commit is the thing being
tested — not whether you won.

---

### 5.5 "How do you handle code review?"

**Strong:** block on correctness, security and expensive-to-reverse decisions;
comment optionally on everything else. "I'd have done it differently" is not a
review comment. And: fifteen problems in one PR is a scoping failure, not fifteen
comments.

---

### 5.6 "What do you do when you don't know something?"

**Strong:** timebox, ask, and say clearly what you *do* know and where the
boundary is. Then the specific behaviour: writing down what you learned so the
next person doesn't repeat it.

---

### 5.7 "Any questions for us?"

Ask three, and make at least one uncomfortable in a productive way:

- "What does code review look like here — who blocks, and on what?"
- "What's the thing about this codebase you'd warn a new joiner about?"
- "How do decisions get made when two senior engineers disagree?"
- "What's on your roadmap that you're not sure how to build yet?"

**The tell:** no questions, or only questions about perks.

---

# Scoring yourself

After each round:

| Round             | Solid | Shaky | Missed |
| ----------------- | ----- | ----- | ------ |
| 1 — Screen        |       |       |        |
| 2 — Technical     |       |       |        |
| 3 — Coding        |       |       |        |
| 4 — System design |       |       |        |
| 5 — Behavioural   |       |       |        |

**How to read it:**

- **Missed in Round 2** → knowledge gap. Go to the linked phase doc.
- **Shaky anywhere** → delivery gap. You know it; practise saying it. This is the
  cheapest thing on the list to fix and the most commonly ignored.
- **Missed in Round 3** → practise from an empty file, with a timer, narrating.
- **Missed in Round 4** → you probably jumped to architecture without gathering
  requirements. Redo it and spend five minutes on questions.
- **Missed in Round 5** → you don't have your stories ready. Write six of them
  down as bullet points; do not script them word for word, because scripted
  behavioural answers are audible.

---

## The three things that decide it

1. **Specificity.** One real bug with a mechanism beats five general answers.
   That's what the ★ questions across these documents are for.
2. **Volunteering limits.** Saying "I haven't shipped SSR" before being caught
   makes everything else credible. Never conceding anything means they have to
   start testing you.
3. **Reasoning out loud.** In coding and design rounds you're scored on the
   process, not the artefact. Silence reads as being stuck even when you aren't.

---

## Related

- [POSITIONING.md](POSITIONING.md) — do this before Round 1
- [INTERVIEW-QUESTIONS.md](INTERVIEW-QUESTIONS.md) — 130 questions
- [CODING-EXERCISES.md](CODING-EXERCISES.md) — 50 implementations
- [ARCHITECTURE-QUESTIONS.md](ARCHITECTURE-QUESTIONS.md) — 20 design discussions
- [SENIOR-SCENARIOS.md](SENIOR-SCENARIOS.md) — 40 situations
