# Phase 3 — Hooks

> Covers brief Parts 11, 14, 15, 16, 17, 31. Runnable lab at `/lab/hooks`.
> This is the phase that decides whether you sound like a 2-year or a 5-year
> React developer.

---

## The one sentence this phase exists to unteach

> ~~"useEffect is componentDidMount."~~

It is not. It is a **synchronisation primitive**: *after render, make this
external thing match my state — and when my dependencies change, do it again.*
Mount is merely the first time that happens.

Essentially every useEffect bug in this phase is a symptom of reading it as a
lifecycle hook. That's why the lab exists — five failure modes you can click.

**Angular bridge:** `ngOnInit` runs once and `ngOnDestroy` runs once. That
one-to-one mapping is exactly what breaks your intuition here. `useEffect` may
run 50 times, and its cleanup runs **before every re-run**, not just on unmount.

---

## 1. What got built

**Real, permanent:**

| File | Teaches |
|---|---|
| [useDebounce.ts](../src/hooks/useDebounce.ts) | Correct effect + cleanup; `switchMap` semantics |
| [usePrevious.ts](../src/hooks/usePrevious.ts) | `useRef` vs `useState`; why this hook isn't in core |
| [useDisclosure.ts](../src/hooks/useDisclosure.ts) | `useCallback` at a hook boundary; hooks share logic, not state |
| [useLocalStorage.ts](../src/hooks/useLocalStorage.ts) | Lazy init; syncing a genuine external system |
| [themeModeContext.ts](../src/app/providers/themeModeContext.ts) | Throwing consumer hook; Fast Refresh file split |
| [ThemeModeProvider.tsx](../src/app/providers/ThemeModeProvider.tsx) | The provider `useMemo`; Context vs Redux |
| [useTaskFilters.ts](../src/features/tasks/useTaskFilters.ts) | `useReducer` for invariants; exhaustiveness; UI↔API adapter |

**Learning material:** [HooksLabPage](../src/pages/HooksLabPage.tsx)
**Tests:** 43 passing (17 new).

Dark mode now works from the header — that's Context, `useLocalStorage` and
`useMemo` all proving themselves in one button.

---

## 2. Stale closures — the `[]` trap

```tsx
useEffect(() => {
  const id = setInterval(() => console.log(count), 1000);
  return () => clearInterval(id);
}, []);   // logs 0. Forever. However many times you click.
```

`[]` does **not** mean "run once". It means *"never resubscribe — and keep
render one's values forever."* That second half is where the bug lives.

A closure captures **values**, not variables. `count` was 0 when this effect was
created, and this effect is never recreated.

**The naive fix makes it worse:** adding `count` to the deps tears down and
recreates the interval on every click, so the clock stutters. Correct values,
broken behaviour.

**Two real fixes:**

```tsx
setCount(c => c + 1)   // functional update — the effect never reads count
countRef.current       // a ref — when you must READ a fresh value
```

**The principle: don't fight the dependency array — remove the dependency.**
Functional updates, refs, and moving values to module scope are all ways to
*need less*.

---

## 3. Infinite loops — the object-in-deps trap

```tsx
const options = { limit: 10 };        // new reference every render
useEffect(() => { ... }, [options]);  // deps "changed" → run → setState
                                      // → render → new object → ...
```

`exhaustive-deps` can't save you here: `options` genuinely *is* a dependency.
The problem is its **identity**. Deps are compared with `Object.is`, and
`{} !== {}`.

Three fixes, in order of preference:

1. **Move it outside the component** — it's a constant
2. **Depend on the primitives** — `[options.limit]`
3. `useMemo` it

Reach for `useMemo` *last*. The first two remove the problem; the third caches
around it.

---

## 4. When NOT to use `useEffect`

```tsx
// ANTI-PATTERN
const [results, setResults] = useState(items);
useEffect(() => { setResults(items.filter(i => i.includes(query))); }, [query]);

// FIX: delete the effect
const results = items.filter(i => i.includes(query));
```

Two renders per keystroke, one frame of stale results, and a second source of
truth that needs an effect to stop it being wrong.

**When you DO need it:** synchronising with something *outside React* — the DOM,
a subscription, a timer, localStorage, an SSE stream. If the "external system"
is really just other React state, you almost certainly don't need it.

`useLocalStorage` is the honest case: localStorage genuinely lives outside React
and doesn't participate in rendering.

---

## 5. `useRef` — the comparison interviewers ask for

| | `useState` | `useRef` |
|---|---|---|
| Triggers render | **yes** | **no** |
| Value updates | on re-render | immediately (`.current`) |
| Read during render | safe | avoid — impure |
| Use for | data the UI displays | data the UI does not |

**One-line rule:** if changing it should update the screen, it's state. If it
shouldn't, it's a ref.

A ref is an **instance variable** for a function component — `this.something`
with no re-render attached. Two jobs: DOM handles, and mutable values that must
survive renders without causing them (timer ids, subscription handles, previous
values).

**Interview trap — "why not a module-level variable?"** Because that's shared by
every *instance* of the component. Render two and they fight over one value. A
ref is per-instance.

**A genuinely interesting finding:** React's `react-hooks/refs` lint rule flags
`usePrevious` — reading `ref.current` during render is impure. That's not the
rule being pedantic; it's why `usePrevious` **is not in React's core API**
despite being in every tutorial. Being able to explain that is a strong senior
signal. (The file carries an explained disable and names the pure alternative.)

---

## 6. `useReducer` — the real criterion

> ~~"useReducer for complex state."~~ Nobody can apply that.

**The real one:** use a reducer when the next state depends on the previous
state **and several fields must change together to stay consistent.**

`useTaskFilters` is the textbook case, because of one rule:

> **Any change to a filter must reset the page to 1.**

Miss it and the user filters to "urgent", stays on page 4, sees an empty list —
a bug that looks like "no results" and is really pagination. With five
`useState`s, *every* handler must remember `setPage(1)`, and the fifth one
written six months later won't.

A reducer makes the invariant **structural**. There is nowhere to forget it.

| `useState` | `useReducer` |
|---|---|
| independent values | values that change together |
| simple updates | transitions with invariants |
| logic in handlers | logic in one pure function |
| needs a component to test | pure function — trivial |

**Exhaustiveness checking** — the most useful five lines in any reducer:

```tsx
default: {
  const exhaustive: never = action;   // compile error if a case is missing
  return exhaustive;
}
```

`default: return state` silently ignores unknown actions — dispatch appears to
do nothing, no error, and you debug the component for an hour.

**Angular bridge:** this is NgRx without the store — same action/reducer shape,
scoped to one component, no module registration. It's also exactly what RTK's
`createSlice` generates, so Phase 18 will feel like a shortcut rather than magic.

---

## 7. Context — transport, not state management

Context solves exactly one problem: **prop drilling**.

It is **not** a state manager. No reducers, no devtools, no middleware, no
selectors, and — the part that bites — **no ability to re-render only the
consumers that care.** Value changes → *every* consumer re-renders.

| | Context | Redux Toolkit |
|---|---|---|
| Purpose | transport | state management |
| Re-render control | none | selectors, granular |
| Devtools | none | time-travel, action log |
| Middleware | none | yes |
| Async | you build it | RTK Query |

**Context is not a lightweight Redux. It's a different tool.** And for *server*
data, reach for neither — that's Phase 19/20.

### The most important line in any provider

```tsx
const value = useMemo(() => ({ mode, toggleMode }), [mode, toggleMode]);
```

Without it, that object literal is rebuilt every render → new reference →
**every consumer in the app re-renders**, even though nothing changed. The app
is correct, just slow, and the cause is one pair of missing braces. Number-one
Context performance bug.

**Three fixes, cheapest first:**

1. **Push consumption down** to the smallest leaf that needs it — that's why
   `ThemeModeToggle` is its own component instead of inline in `RootLayout`
2. **`useMemo` the value** (always do this)
3. **Split the context** — `StateContext` + `DispatchContext`. Dispatch never
   changes, so dispatch-only components never re-render when state does

### The throwing consumer hook

```tsx
export function useThemeMode() {
  const context = use(ThemeModeContext);
  if (context === undefined) throw new Error('useThemeMode must be used within a ThemeModeProvider');
  return context;
}
```

This is React's answer to Angular's `NullInjectorError`. A friendly default
value would silently hand a component a no-op `toggleMode`, and you'd spend an
afternoon wondering why a button does nothing.

Note `use()` rather than `useContext()` — the modern API, and unlike
`useContext` it may be called conditionally.

---

## 8. `memo` / `useCallback` / `useMemo` — and when they do nothing

```tsx
const Child = memo(ChildImpl);

<Child onPing={() => setPings(n => n+1)} />   // memo NEVER hits
<Child onPing={stableCallback} />              // memo works
```

`React.memo` compares props shallowly. An inline arrow is a new reference every
render, so equality fails, the memo never hits, and **you pay the comparison
cost for nothing.** That's why `memo` and `useCallback` are almost always used
together — either both or neither.

**Angular bridge:** `React.memo` is `ChangeDetectionStrategy.OnPush` — same idea,
same trap (OnPush is also defeated by a new object literal in the template).

**Two distinct reasons to memoise, and conflating them is why so much code is
uselessly memoised:**

- **For cost** — the computation is genuinely expensive
- **For identity** — the reference must stay stable for a memoised child, an
  effect dependency, or a context value

`createTheme` isn't slow. It's memoised for *identity*.

**Don't memoise by reflex.** Every `useMemo`/`useCallback` costs a comparison,
retained memory, and a dependency array that can go stale. React Compiler is
designed to make most of this manual — but knowing *why* it exists is still
what gets asked.

**Where `useCallback` is genuinely non-negotiable:** functions returned from a
shared hook (`useDisclosure`). They escape into consumers you can't see. The
instability originates in your hook and the consumer can't fix it.

---

## 9. Custom hooks — the actual test

> **Does it need React's state or lifecycle?**

`useDebounce` needs `useState` + `useEffect` → hook. `formatDate` needs neither
→ **must not** be a hook. Wrapping a pure function in a hook is the most common
form of hook cargo-cult.

```tsx
function useName() { return useState(''); }   // pointless — renames a built-in
```

Extract when a hook encapsulates a **decision or an invariant**, not when it
saves typing.

**The Angular difference that matters most:** every component calling
`useDisclosure()` gets its **own independent state**. A hook shares *logic*,
never *state*. An injected Angular service is a singleton — two components share
one instance. To genuinely share, you need Context or a store. (There's a test
pinning exactly this.)

---

## 10. Interview questions

1. **Why does my useEffect run twice in dev?** StrictMode double-invokes
   mount/unmount to surface missing cleanup. Add cleanup; don't remove
   StrictMode.

2. **My interval logs a stale value. Why?** `[]` deps captured render one's
   values permanently. Fix with a functional update or a ref — not by adding the
   dep, which recreates the interval.

3. **When does cleanup run?** Before **every** re-run of the effect, and on
   unmount. Not just unmount — that misreading is what makes `useDebounce` look
   broken.

4. **useState or useReducer?** Reducer when several fields must change together
   to preserve an invariant. Bonus: the reducer is a pure function, so it's
   testable without rendering.

5. **Context vs Redux?** Context is transport, Redux is state management. No
   selectors in Context means every consumer re-renders. Server data belongs in
   neither.

6. **How do you optimise a Context that re-renders too much?** Push consumption
   to leaves; `useMemo` the value; split into state + dispatch contexts.

7. **When is `React.memo` useless?** When the parent passes inline
   functions/objects — shallow equality always fails and you pay the comparison
   for nothing.

8. **useState vs useRef?** Ref doesn't trigger renders and updates immediately.
   If it should update the screen it's state.

9. **How do you make a switch exhaustive?** Assign the discriminant to `never`
   in the default branch.

10. **How do you test complex state logic?** Extract a pure reducer and test the
    function. Hard-to-test state logic is a message about where it lives.

---

## 11. Exercises

1. In `StaleClosureDemo`, replace the ref fix with `[count]` deps. Watch the
   interval reset on every click — correct values, broken timing.
2. Delete `return () => clearTimeout(id)` from `useDebounce`. Run the tests. Note
   that only the *cancellation* test fails — and that it's the only one that
   proves the hook works.
3. Remove `useMemo` from `ThemeModeProvider`'s value. Open the Profiler, toggle
   the theme, and compare commit counts.
4. Add `{ type: 'SET_LIMIT'; value: number }` to `TaskFiltersAction` and don't
   handle it. Find where the compile error appears and why.
5. Move `useThemeMode()` from `ThemeModeToggle` up into `RootLayout`. Profile a
   toggle before and after.
6. Write `useTaskFilters` with five `useState`s instead. Count how many places
   need `setPage(1)`.

---

## 12. Quiz

1. What does `[]` actually mean?
2. When does an effect's cleanup run?
3. Why does an object in a dependency array cause an infinite loop?
4. Why is `usePrevious` not in React's core API?
5. What are the two distinct reasons to memoise?
6. Why must `useDisclosure`'s callbacks be wrapped in `useCallback` when an
   in-component handler often needn't be?
7. Why is `createContext(undefined)` better than a default object?
8. Two components call `useDisclosure()`. Do they share state?

<details>
<summary>Answers</summary>

1. "Never resubscribe, and keep render one's values forever." Not "run once".
2. Before every re-run **and** on unmount.
3. A new object literal is a new reference each render; deps are compared with
   `Object.is`, so they always look changed.
4. Reading `ref.current` during render is impure — React's own lint rule flags
   it, and it interacts badly with concurrent rendering.
5. **Cost** (expensive computation) and **identity** (stable reference for a
   memoised child / effect dep / context value).
6. They escape into unknown consumers who can't fix the instability themselves.
   Inside a component you control both sides and can measure.
7. It makes "no provider" detectable, so the hook can throw a named error instead
   of silently handing over a no-op.
8. **No.** Hooks share logic, never state — unlike an Angular service singleton.

</details>

---

## Verified

```
lint ✅   typecheck ✅   43/43 tests ✅   build ✅
/lab/hooks → 200   /lab/state → 200   /lab/components → 200   / → 200
```

Bundle: 467 kB / 147 kB gzip (+2.4 kB gzip).

---

**Next: Phase 4 — Rendering, reconciliation and keys.** The `key` corruption
demo promised in Phase 2's exercises gets built for real.
