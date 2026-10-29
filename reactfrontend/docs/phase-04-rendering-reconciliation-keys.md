# Phase 4 — Rendering, Reconciliation and Keys

> Covers brief Parts 12, 13 (and previews 52). Runnable lab at `/lab/rendering`.
> Short on new code, heavy on the model that makes every earlier phase make
> sense.

---

## Why this phase matters more than it looks

Phases 2 and 3 gave you rules: *don't mutate state, keys must be stable, render
must be pure, cleanup runs before every re-run.* This phase is the **one model
those rules all follow from.** After it, they stop being things to memorise.

It's also where senior interviews separate people. "What happens when you call
`setState`?" has a two-sentence junior answer and a five-minute senior one.

---

## 1. What happens when you call `setState()`

```
setState(next)
   │
   ▼
[ SCHEDULE ]      React queues the update. Nothing has happened yet.
   │              Multiple setStates in one tick are BATCHED into one pass.
   ▼
[ RENDER PHASE ]  React calls your component function.
   │              You return an element tree — plain objects, not DOM.
   │              React diffs it against the previous tree → RECONCILIATION.
   │
   │   MUST BE PURE. Interruptible, may be discarded, may run twice
   │   (StrictMode). No DOM writes, no fetches, no ref mutation.
   ▼
[ COMMIT PHASE ]  React applies the minimum set of DOM operations.
   │              Refs attached. Synchronous, never interrupted.
   │              useLayoutEffect runs HERE — before paint.
   ▼
[ BROWSER PAINT ]
   │
   ▼
[ useEffect ]     Runs AFTER paint, so it never blocks pixels.
```

**Everything follows from the render/commit split:**

| Rule from an earlier phase | Why |
|---|---|
| Render must be pure | It can be discarded or replayed — that's what makes StrictMode, concurrent rendering and Suspense possible |
| StrictMode double-renders | To catch impurity, since a discarded render must leave no trace |
| `useEffect` runs after paint | So it can't delay pixels. `useLayoutEffect` runs before — right for measuring the DOM, wrong for everything else |
| Error Boundaries don't catch handler errors | They catch throws during the render walk. A handler runs later, on a fresh stack React isn't part of |
| Refs attach "after render" | They're attached during commit |

> **Angular bridge:** Angular's change detection *walks components and
> dirty-checks bindings*. React *re-runs your function and diffs the returned
> tree*. Angular asks "which bindings changed?"; React asks "what does the tree
> look like now, and what's the minimum DOM edit to get there?" That's why
> Angular can watch a mutated object and React cannot.

---

## 2. "Re-render" does not mean "DOM update"

**The default: when a component re-renders, all its descendants re-render.**
React does not check whether their props changed — it just re-runs them.

That's usually **fine**, and this is the part people over-correct on. Calling a
function and building plain objects is cheap. The expensive part is the DOM, and
reconciliation skips DOM work when the output is unchanged.

> "Re-render" means React called your function and diffed the result. It does
> **not** mean the browser touched the DOM.

Three ways to stop a subtree re-rendering, cheapest first:

1. **Pass it as `children`** from a component that doesn't own the state — that
   element was created by the *parent's* parent, so its reference is unchanged
   and React skips it. No memo, no dependency arrays, free.
2. **`React.memo`** — shallow prop comparison. Needs `useCallback`/`useMemo` on
   the parent side or it never hits (Phase 3, §8).
3. **Move state down** so fewer components are above it.

**Interview: "how do you stop a child re-rendering without `memo`?"** Pass it as
`children` from a component that doesn't own the state. Most people don't know
this one.

---

## 3. Reconciliation — the whole algorithm in two rules

**Rule 1 — different element type at the same position → destroy and rebuild.**

React doesn't attempt to diff the subtree. It unmounts everything below and
mounts fresh. All state inside is gone.

```tsx
{wrapped ? <div><input /></div> : <span><input /></span>}
```

Toggle that and the input's value vanishes. Try it in the lab.

This is an **optimisation, not a limitation**: a general tree-diff is O(n³);
React's heuristic is O(n). It buys that by assuming a changed type means a
changed subtree — true in practice, essentially always.

**Practical consequence:** conditionally wrapping a subtree destroys its state.
If you need to keep it, keep the structure identical and vary the styling.

**Rule 2 — same type → keep the instance, update props, and match siblings by
key.**

That's it. That's reconciliation at the level any interview cares about.

---

## 4. Keys — the demo Phase 2 promised

This is the most valuable thing in the lab, because the bug is **invisible**:
nothing in the DOM looks wrong, nothing appears in the DevTools element tree,
and there is no warning. The key is present and unique, so React is satisfied.

```tsx
{rows.map((row, index) => <RowWithState key={index} label={row.label} />)}
```

Type a note in each row, then prepend a row:

```
BEFORE (typed)          AFTER prepending, key={index}
key 0: Ada    "call"    key 0: NEW    "call"      ← Ada's note
key 1: Grace  "email"   key 1: Ada    "email"     ← Grace's note
key 2: Kath   "review"  key 2: Grace  "review"    ← Kath's note
                        key 3: Kath   ""
```

**Every note moved down one row.**

React uses the key to answer one question: *is this the same component as last
render, or a different one?* Prepending shifts every index. The element that was
`key=0` is now `key=1`, so React concludes "component 0 still exists, its label
prop changed from Ada to NEW" — and **reuses the DOM node**, patching only the
text. The input inside is never re-created.

**In this project** that's a checkbox selecting the wrong task, or an inline edit
saving to the wrong id.

With `key={row.id}`, Ada's key is `'a'` whether she's first or fourth. React
matches her to the same instance and *moves* the node. The new row has a key
React has never seen, so it mounts fresh — with an empty input.

### When index keys are actually fine

Both conditions must hold:

1. The list is **static** — never reordered, filtered, or inserted into
2. The children hold **no state**

`ErrorState`'s message list and `LoadingState`'s skeletons both qualify, which is
why they use indexes deliberately rather than by accident.

### The other use of keys — forcing a remount

```tsx
<TaskForm key={taskId} task={task} />
```

Changing a key **deliberately** destroys and rebuilds. Every field resets when
the user switches tasks — far cleaner than an effect that clears them one by one,
and it's the idiomatic React answer to "reset state when a prop changes."

**A key is an identity, not a number.** It's scoped to its siblings, so it only
needs to be unique within the list — not globally.

---

## 5. Virtual DOM and Fiber — at interview depth

**Virtual DOM:** the element tree your components return is plain JavaScript
objects (`{type, props, key}`), not DOM nodes. Creating them is cheap; React
diffs two trees and applies the minimum DOM operations. The DOM is slow;
objects are not.

**Fiber** (React 16+) is the *reimplementation of the reconciler* as a linked
list of units of work rather than a recursive call stack. The recursive version
couldn't be paused — once it started, it ran to completion, blocking the main
thread on a large tree.

Fiber makes rendering **interruptible**. React can render part of a tree, yield
to the browser to handle a keystroke, and resume. That's what enables:

- **Concurrent rendering** — a low-priority render is interrupted by a
  high-priority one
- **`useTransition`** — mark an update as non-urgent so typing stays responsive
- **Suspense** — pause a subtree while data loads

**And it's why render must be pure.** An interrupted render is discarded and
replayed. A render with side effects would apply them twice, or apply them for a
tree the user never saw.

> **Don't go deeper than this in an interview** unless asked. "Fiber made
> reconciliation interruptible, which is what concurrent features are built on,
> and it's why render must be pure" is a complete senior answer. Reciting
> `beginWork`/`completeWork` internals signals you've read a blog post, not that
> you've debugged a slow app.

---

## 6. One thing the route check surfaced

`/nonexistent` returns **HTTP 200**, not 404 — the dev server serves
`index.html` for every path and React Router renders the 404 client-side.

That's correct SPA behaviour, and it's a **production configuration
requirement**: nginx needs

```nginx
location / { try_files $uri $uri/ /index.html; }
```

Without it, a user refreshing on `/tasks/abc123` gets a real 404 from nginx,
because no such file exists on disk. It's the single most common SPA deployment
bug, and Phase 46 configures it properly.

---

## 7. Interview questions

1. **What happens when you call `setState`?** Schedule → batch → render phase
   (call the function, diff the tree) → commit phase (minimal DOM ops, attach
   refs) → paint → effects. The render/commit split is the answer to most
   follow-ups.

2. **Why must render be pure?** It can be interrupted, discarded and replayed.
   Side effects would run for a tree the user never saw.

3. **Does a re-render mean a DOM update?** No. It means React called your
   function and diffed. Reconciliation skips DOM work when output is unchanged.

4. **What does `key` actually do?** Tells React which element corresponds to
   which component instance between renders. It's an identity, scoped to
   siblings.

5. **What breaks with index keys?** React reuses the wrong instance, so
   *component state* attaches to the wrong data. No warning, nothing visibly
   wrong in the DOM.

6. **When are index keys fine?** Static list, no reordering/filtering/insertion,
   and stateless children.

7. **How do you reset a component's state when a prop changes?** Change its key.
   Idiomatic React, and better than an effect that clears fields.

8. **What is Fiber?** The reconciler reimplemented as interruptible units of work
   instead of a recursive stack — the foundation for concurrent rendering,
   transitions and Suspense.

9. **`useEffect` vs `useLayoutEffect`?** Effect after paint (never blocks
   pixels); layout effect during commit, before paint (right for measuring the
   DOM, wrong by default).

10. **How do you stop a child re-rendering without `memo`?** Pass it as
    `children` from a component that doesn't own the state.

---

## 8. Exercises

1. In the keys demo, type in all three rows on **both** sides, then prepend. Now
   do it again but *remove* the middle row instead. Predict the corruption first.
2. Change the good side to `key={row.label}`, then add two rows both labelled
   `NEW`. Find the React warning in the console and explain it.
3. In the reconciliation demo, change `<span>` to `<div>` so both branches have
   the same type. Type, toggle — the value survives. Explain why.
4. Wrap `PlainChild` in `memo()`. Does the render count stop climbing? It takes
   no props, so predict before you run it.
5. Restructure `RenderPropagationDemo` so the children are passed in as
   `children` from a wrapper that doesn't own `count`. Watch both counters stop.
6. Open the Profiler, record a theme toggle, and use "Why did this render?" to
   find every component that re-rendered. Then move `useThemeMode()` up into
   `RootLayout` and compare.

---

## 9. Quiz

1. Which phase can be interrupted?
2. Which phase attaches refs?
3. What are the two reconciliation rules?
4. Does `key` need to be globally unique?
5. Why does conditionally wrapping a subtree lose its state?
6. What problem did Fiber solve?
7. Why is `<Form key={userId} />` better than an effect that clears fields?

<details>
<summary>Answers</summary>

1. Render. Commit is synchronous and never interrupted.
2. Commit.
3. Different type at the same position → tear down and rebuild. Same type → keep
   the instance, update props, match siblings by key.
4. No — only unique among its siblings.
5. The element type at that position changed, so React destroys the subtree
   rather than diffing it.
6. Recursive reconciliation couldn't be paused, so a large tree blocked the main
   thread. Fiber made it interruptible.
7. It resets *all* state by identity, including state you forgot about, and it
   happens during render rather than one paint later.

</details>

---

## Verified

```
lint ✅   typecheck ✅   43/43 tests ✅   build ✅
/  /lab/rendering  /lab/hooks  /lab/state  /lab/components → all 200
```

Bundle: 474 kB / 149 kB gzip.

---

**Next: Phase 5 — React Router** (nested routes, layout routes, dynamic params,
query params, lazy routes, error routes). Then Phase 6 brings forms with React
Hook Form + Zod, and Phase 7 wires the real NestJS API.
