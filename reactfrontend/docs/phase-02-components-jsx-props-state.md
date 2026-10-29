# Phase 2 — Components, JSX, Props, State

> Covers brief Parts 8, 9, 10. Two runnable labs at `/lab/components` and
> `/lab/state` — click everything.

---

## What we're learning and why it matters

Everything in React is a component, and *every* interview starts here. But at
4–5 years the questions are not "what is a prop". They are:

- *Why does this component re-render?*
- *Why does my counter only go up by one?*
- *How would you design this component's API so it doesn't grow twelve props?*
- *Should this value be state, or can you derive it?*

Those four questions are this phase.

**The Angular connection:** you already know presentational vs container
components, `@Input()`, content projection, and OnPush. That maps over almost
intact. The one thing that does **not** transfer is the most important idea
here — see §3.

---

## 1. What got built

**Real, permanent:**

| File | Teaches |
|---|---|
| [StatusBadge.tsx](../src/components/ui/StatusBadge.tsx) | `Record` lookup tables, `satisfies`, narrow prop types |
| [PriorityBadge.tsx](../src/components/ui/PriorityBadge.tsx) | When *not* to abstract — the Rule of Three |
| [EmptyState.tsx](../src/components/feedback/EmptyState.tsx) | Slots vs config props; the `&&` rendering bug |
| [ErrorState.tsx](../src/components/feedback/ErrorState.tsx) | Narrowing `unknown`; rendering the backend's `string[]` |
| [LoadingState.tsx](../src/components/feedback/LoadingState.tsx) | Skeleton vs spinner; layout shift |
| [TaskCard.tsx](../src/features/tasks/components/TaskCard.tsx) | Props design, composition, derived state, keyboard a11y |

**Learning material (delete when done):** [StateLabPage](../src/pages/StateLabPage.tsx),
[ComponentsLabPage](../src/pages/ComponentsLabPage.tsx)

**Tests:** 26 passing across 4 files.

---

## 2. Component API design — the lesson worth the most

The single highest-leverage idea in this phase. Compare:

```tsx
// CONFIGURATION — describes what to render
action?: { label: string; onClick: () => void }

// COMPOSITION — accepts what to render
action?: ReactNode
```

The config version looks tidier and is a trap. Caller 1 wants a button.
Caller 2 wants a link. Caller 3 wants an icon; caller 4 wants two buttons;
caller 5 wants one disabled with a tooltip. Each adds a prop — `actionIcon`,
`actionHref`, `actionDisabled`, `secondaryAction` — until the component has
fifteen props and *still* can't express what caller 6 needs.

That growth pattern is the **configuration trap**, and it happens whenever a
component tries to *describe* its children instead of *accepting* them.

`ReactNode` inverts control: `EmptyState` owns the layout, the caller owns the
content. It never needs another prop.

> **Angular bridge:** `ReactNode` props are `<ng-content select="[action]">` —
> content projection. The React version is more flexible because a node is an
> ordinary JavaScript value: store it in a variable, return it from a function,
> pick it with a ternary.

**The other half — props on `TaskCard`:**

```tsx
// BAD — prop explosion
<TaskCard title={t.title} status={t.status} priority={t.priority} dueDate={...} />

// GOOD — the object it is about
<TaskCard task={task} assigneeName={name} />
```

The counter-argument is real: passing the whole object couples the component to
`Task`. If it only needed two fields, `Pick<Task, 'title' | 'status'>` would keep
it generic. We pass the whole task because this component *is about* a task —
the coupling already exists. A generic `<Card>` would be the opposite call.

---

## 3. The thing that does NOT transfer from Angular

**React compares references. Angular dirty-checks values.**

```tsx
broken.name = event.target.value;   // the object IS updated
setBroken(broken);                  // ...and nothing renders
```

The data really changed. But React decides whether to re-render by comparing old
and new state with `Object.is` — and we handed back the **same reference**. So it
concludes "unchanged" and schedules nothing. The UI shows the old value while
the data holds the new one.

In Angular this habit is *fine*. Zone.js patches async APIs, re-runs change
detection, and dirty-checks values — mutating an object and letting the template
update is idiomatic. React has no Zone.js and does no dirty checking.

**Immutability in React is not a style preference. It is the mechanism by which
rendering is triggered at all.**

Two consequences that bite:

```tsx
setFixed({ name })              // DELETES email — state is replaced, never merged
setFixed({ ...fixed, name })    // correct
```

Class components' `this.setState({name})` *did* merge. Plenty of older tutorials
assume it still does.

And the mutating array methods to distrust in state: `push`, `pop`, `shift`,
`unshift`, `splice`, **`sort`**, **`reverse`**. The last two are sneaky — they
read like they return a sorted copy and they sort in place. `[...items].sort()`
is the safe form; forgetting the spread silently mutates props a parent handed
you.

> React ships an ESLint rule — `react-hooks/immutability` — that catches this
> statically. I had to *switch it off* to write the broken demo. That's the
> strongest evidence available that it's a real bug.

---

## 4. Functional updates — "why did my counter go up by one?"

```tsx
setBroken(broken + 1);
setBroken(broken + 1);   // all three read the SAME snapshot
setBroken(broken + 1);   // result: +1
```

`broken` is a `const` captured by this render's closure. It was 0 when the render
happened, so all three lines compute `0 + 1`. React batches them and the last
write wins.

**The mental model that causes this bug** is thinking `broken` is a variable that
changes. It is not — it's a snapshot for *this render*, and it never changes for
as long as this closure exists. A new value means a new render with a new
closure.

```tsx
setFixed(n => n + 1);   // queue: (0) => 1
setFixed(n => n + 1);   // queue: (1) => 2
setFixed(n => n + 1);   // result: +3
```

**The rule:** if the next value depends on the previous one, use the function
form. If it doesn't (`setName(inputValue)`), the direct form is clearer.

This is also the fix for a whole family of stale-closure bugs in effects, timers
and handlers — which is why it's worth internalising now rather than in Phase 11.

**Batching:** React groups updates and re-renders once. Since React 18 that
happens *everywhere* — promises, timeouts, native handlers. In React 17 it only
applied inside React event handlers, so two `setState`s in a `.then()` caused two
renders. A lot of online advice predates that change.

---

## 5. Derived state — the most common unnecessary `useEffect`

```tsx
// BAD
const [fullName, setFullName] = useState('');
useEffect(() => { setFullName(`${first} ${last}`); }, [first, last]);

// GOOD
const fullName = `${first} ${last}`;
```

What actually happens per keystroke in the bad version:

1. `setFirst` → render with new first name and **stale** full name
2. browser paints that inconsistent frame
3. effect runs → `setFullName`
4. render again
5. paint again

Two renders and two paints for one keystroke, and between them the UI displays a
combination that never existed in the data. It's also a **second source of
truth** that can be wrong — and now needs an effect to stop it being wrong.

**The decision rule (memorise this for interviews):**

```
Can I calculate it from existing props/state?  → calculate it
Does it come from an external system?          → effect (or RTK Query)
Is it genuinely independent user input?        → state
```

`TaskCard.isOverdue` follows it — computed during render, never state.

---

## 6. Lazy initial state

```tsx
useState(expensiveInit())        // runs on EVERY render, result thrown away
useState(() => expensiveInit())  // runs once
```

One character of difference. `expensiveInit()` is a function *call*, so
JavaScript evaluates it before `useState` is even entered. React discards the
result after the first render, but the work is already done.

Matters for: parsing `localStorage`, building a `Map` from a large array,
generating defaults. Doesn't matter for `useState(0)` — wrapping a literal in an
arrow is noise.

The lab counts the calls so you can watch it. (They start at 2 — StrictMode
double-renders on purpose.)

---

## 7. Two smaller things worth keeping

**The `&&` rendering bug:**

```tsx
{items.length && <List />}      // renders a literal "0" when empty
{items.length > 0 && <List />}  // correct
```

`&&` skips rendering for `false`, `null`, `undefined` — but `0` and `NaN` are
*printed*. JSX is JavaScript, so JavaScript's truthiness rules leak into markup.

**`satisfies` vs `:`** — in the badge lookup tables:

```tsx
const STATUS_META = { ... } satisfies Record<TaskStatus, Meta>;
```

A type *annotation* would widen each `color` to the full union. `satisfies`
validates the object while preserving the narrower literal types. And
`Record<TaskStatus, ...>` is what makes it safe: add `TaskStatus.BLOCKED` to the
API types and this object is a **compile error** until handled. A `switch` with a
`default` would silently render the new status as "Unknown" for two releases.

That's the most useful trick for keeping UI in sync with a backend enum.

---

## 8. Conditional accessibility in `TaskCard`

When the card is clickable it must behave like a real control — Tab-reachable,
Enter **and** Space, announced as a button. A bare `onClick` on a `div` gives you
none of that, and it's the most common a11y failure in React apps.

When it is *not* clickable, all of that must be absent: `tabIndex={0}` on a
non-interactive element creates a tab stop that does nothing.

```tsx
role={interactive ? 'button' : undefined}
tabIndex={interactive ? 0 : undefined}
onKeyDown={interactive ? handleEnterOrSpace : undefined}
```

**Say this in an interview:** the better solution is a real `<button>` or `<a>`,
letting the browser provide all of it for free. It's avoided here because a
nested button inside the `actions` slot would be invalid HTML and swallow clicks.
That trade-off — hand-rolled ARIA vs nested interactive elements — is a genuine
design tension, not a shortcut.

---

## 9. Interview questions

1. **Why doesn't my component re-render when I mutate state?**
   React compares with `Object.is`. Same reference → no render. Angular's
   dirty-checking allows the habit; React's reference comparison does not.

2. **`setCount(count+1)` three times adds one. Why?**
   `count` is a per-render snapshot, not a live variable. All three read the same
   value; React batches and the last write wins. Use `setCount(c => c + 1)`.

3. **When would you use lazy initial state?**
   When the initial value is expensive to compute — parsing localStorage,
   building a lookup map. *Follow-up:* the initialiser runs once per **component
   instance**, not once per app.

4. **How do you design a reusable component API?**
   Composition over configuration. Accept `ReactNode` slots rather than props
   describing what to render. Reach for a config prop only when the shape is
   genuinely closed.

5. **`{items.length && <List/>}` renders "0". Why?**
   `&&` returns the left operand when falsy, and React renders `0`. Only `false`,
   `null` and `undefined` render nothing.

6. **Should `isOverdue` be state?**
   No — it's derivable from props. State would be a second source of truth,
   always one render stale.

7. **When do you extract a shared component?**
   Based on **rate of change**, not line count. Extract when the copies must
   change together. The Rule of Three: two similar things are a coincidence,
   three is a pattern.

8. **A list page fires one request per row. How do you fix it?**
   That's N+1 in the UI. Lift the data requirement to the list and have the API
   return what the list needs in one response — which is why `TaskCard` takes
   `assigneeName` as a prop instead of fetching it.

---

## 10. Exercises

1. Add `TaskStatus.BLOCKED` to [types/api.ts](../src/types/api.ts). Run
   `npm run typecheck` **before** touching anything else. Note which file errors
   and why that's the `Record` doing its job.
2. In `TaskCard`, change `isOverdue` to `useState` + `useEffect`. Type in the
   date and watch the badge lag one render behind.
3. Refactor `EmptyState.action` to `{label, onClick}`. Then try to render the
   icon-button version from the showcase without adding a prop.
4. Add a `sort by priority` button to `ComponentsLabPage` using
   `TASKS.sort(...)` without a spread. Explain what breaks.
5. In `ArrayStateDemo`, change the key from `item` to `index`, add three items,
   then add a `<input>` inside each `<li>`. Type in the first, add an item at the
   front. Watch the values follow the wrong rows — that's Phase 4.

---

## 11. Quiz

1. What does `satisfies` do that a type annotation doesn't?
2. Why does `setFixed({ name })` lose the `email` field?
3. Which two array methods look pure and aren't?
4. When is index-as-key acceptable?
5. Why is `error: unknown` a better prop type than `error: Error`?
6. What's the difference between `description?: string` and `assigneeId: string | null`?
7. Why does `role="status"` matter on `EmptyState`?

<details>
<summary>Answers</summary>

1. Validates without widening — literal types survive.
2. State is replaced wholesale, never merged. Class `setState` merged; hooks
   don't.
3. `sort` and `reverse` — both mutate in place.
4. Static lists only: never reordered/filtered/inserted, items hold no state.
5. Because a thrown value can be anything. `unknown` forces narrowing in one
   place instead of lying at every call site.
6. `?:` means the field may be **absent**; `| null` means it's **present and
   empty**. "No description written" vs "deliberately unassigned".
7. A user who filters a list down to nothing otherwise hears silence, and can't
   tell empty from loading from broken.

</details>

---

## Verified

```
lint ✅   typecheck ✅   26/26 tests ✅   build ✅
/lab/components → 200    /lab/state → 200
```

Bundle: 457 kB / 145 kB gzip (was 435/138 — the new components cost ~7 kB gzip).

---

**Next: Phase 3 — Hooks** (`useEffect` in depth, `useRef`, `useReducer`,
`useMemo`/`useCallback`, Context, custom hooks). Say `continue`.
