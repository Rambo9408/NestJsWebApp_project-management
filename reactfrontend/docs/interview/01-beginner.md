# Beginner — 20 questions

> The ones that open almost every React interview. They look easy; the
> difference between a weak and a strong answer is entirely in the **why**.
>
> If your React is rusty, start here and do not skip — these are the questions
> where hesitation costs most, because the interviewer reads it as "does not
> use this daily".

Format matches the backend's [`interview/`](../../../nestbackend/docs/interview/)
set: answer, why it matters, a real example from this codebase, the common
mistake, and the follow-up.

---

### B1. What is React, and what problem does it solve?

**Answer.** A library for describing UI as a function of state. You write what
the interface should look like for a given state; React works out the minimum
DOM operations to get there.

**Why it matters.** The alternative — jQuery-era imperative DOM manipulation — is
a state machine you maintain by hand: show this, hide that, update this label.
It works until two features touch the same element, at which point the bugs are
un-debuggable because the DOM *is* the state. React makes state the single source
and the DOM a derived output.

**Real-world example.** `TaskCard` never touches the DOM. It receives a `Task`
and returns what it should look like. When the task changes, React figures out
what to update — and that is why the same component renders correctly in a list,
a search result and a detail page.

**Common mistake.** Calling it a framework and stopping. React is a renderer;
routing, state management, forms and data fetching are all separate decisions.
That is the substantive difference from Angular.

**Follow-up.** *"So is it a framework or a library?"* — a library, and the honest
consequence is that a React codebase's architecture is a team decision rather
than a framework one. That is a real cost, not just a talking point.

---

### B2. What is JSX?

**Answer.** Syntax sugar for `React.createElement` (or `jsx()` with the modern
transform). It compiles to a plain JavaScript object describing what to render —
not DOM, not HTML, not a string.

**Why it matters.** Because it produces a **value**, you can store it in a
variable, return it from a function, pass it as a prop, or put it in an array.
Angular's templates are a compiler feature; JSX is just JavaScript, which is why
React needs no `ngTemplateOutlet` equivalent.

**Real-world example.** `TaskCard`'s `actions` prop takes a `ReactNode`. The
caller passes an overflow menu, or nothing, or three buttons. That is inversion
of control with no framework support at all.

**Common mistake.** "JSX is HTML in JavaScript." It is neither HTML nor a string
— which is why attributes are `className` and `htmlFor`, and why you can write
`{condition && <Thing/>}`.

**Follow-up.** *"What does `<div id="x">hi</div>` actually evaluate to?"* — an
object roughly `{ type: 'div', props: { id: 'x', children: 'hi' } }`.

---

### B3. What is a component?

**Answer.** A function that takes props and returns JSX. That is the whole
definition for modern React.

**Why it matters.** Because it is an ordinary function, composition is ordinary
function composition — no module registration, no declarations array, no
selectors.

**Real-world example.** Every component in this project is a function.
`ErrorBoundary` is the single class, because error boundaries have no hook
equivalent.

**Common mistake.** Defining a component **inside** another component. It is a
new function identity every render, so React unmounts and remounts the whole
subtree — losing state, focus and scroll position.

**Follow-up.** *"When would you still write a class?"* — error boundaries, and
essentially nothing else.

---

### B4. Props vs state?

**Answer.** Props come from the parent and are read-only inside the component.
State is owned by the component and changing it schedules a re-render.

**Why it matters.** The distinction is about **ownership**, which decides where a
value lives. Mutating a prop is not just discouraged — it does nothing, because
the parent will pass the original value again on its next render.

**Real-world example.** `TaskCard` takes `task` and `assigneeName` as props and
holds no state at all. That is what lets it render in three places and be tested
with no store and no router.

**Common mistake.** Copying a prop into state "so I can change it". Now there are
two sources of truth and the copy is stale the moment the prop updates.

**Follow-up.** *"When is copying a prop into state legitimate?"* — when you
genuinely want an initial value that then diverges, like a form's default. And
you should name it `initialX` so the intent is visible.

---

### B5. How does `useState` work?

```tsx
const [count, setCount] = useState(0);
```

**Answer.** It returns the current value and a setter. Calling the setter
schedules a re-render, during which `useState` returns the new value.

**Why it matters.** The setter is **asynchronous with respect to your code** —
`count` does not change on the line after you call it, because `count` is a
`const` captured by this render.

**Real-world example.** The comment delete dialog stores the comment being
deleted, not a boolean plus an id. One nullable value makes "open with no id"
unrepresentable.

**Common mistake.**

```tsx
setCount(count + 1);
setCount(count + 1);   // still only +1 — both read the same captured value
setCount((c) => c + 1); // the fix
```

**Follow-up.** *"What does the function argument to `useState` do?"*
`useState(expensive())` runs on **every** render and throws the result away;
`useState(() => expensive())` runs once.

---

### B6. Why must state be immutable?

**Answer.** React's bailout check is `Object.is(prev, next)`. Mutating an object
and setting it back passes the same reference, so React concludes nothing
changed and does not re-render.

**Why it matters.** It is not a style preference — it is the mechanism. And it
fails **silently**: no error, no warning, just a UI that does not update.

**Real-world example.** Redux Toolkit lets you write `state.x = 1` in a reducer
because Immer gives you a mutable **draft** and produces a new immutable object
from the recorded changes. That is why it is safe there and forbidden
everywhere else.

**Common mistake.** `items.push(newItem); setItems(items);` — same array, no
render. Use `setItems([...items, newItem])`.

**Follow-up.** *"Coming from Angular, why is this different?"* — Angular compares
property values, so mutation is visible to it. React compares references.

---

### B7. Conditional rendering — what are the options?

**Answer.** `&&` for one branch, a ternary for two, an early `return null` for
"render nothing".

**Why it matters.** There are no structural directives, so this is plain
JavaScript — with one trap that catches everyone.

**Real-world example.** `TaskCard` uses a ternary for the assignee, deliberately:
"Unassigned" is information the user needs, and blank space would leave them
unsure whether the field is empty or still loading.

**Common mistake.**

```tsx
{items.length && <List />}   // renders "0" when the array is empty
{items.length > 0 && <List />}  // the fix
```

`0` is falsy but a valid ReactNode, so it prints.

**Follow-up.** *"What about `undefined` and `null`?"* — both render nothing,
which is why `&&` works at all.

---

### B8. How do you render a list?

```tsx
{tasks.map((task) => <TaskCard key={task.id} task={task} />)}
```

**Answer.** `.map()` over the array, returning an element per item, each with a
`key`.

**Why it matters.** It is `*ngFor` with `trackBy` made mandatory rather than
optional.

**Common mistake.** Forgetting `key` — React warns — or using the array index,
which is worse because it is silent.

**Follow-up.** *"Why does React warn about missing keys?"* — see B9.

---

### B9. What is `key` for?

**Answer.** Identity across renders. React uses it to decide whether to **update**
an existing component or **unmount and remount** a new one.

**Why it matters.** Not uniqueness for its own sake — identity. State, focus,
scroll position and animations are attached to a component instance, and `key`
is what tells React which instance is which.

**Real-world example.** In `LoadingState`, the index **is** the correct key: the
skeleton placeholders are indistinguishable, stateless and never reordered.
There is no identity to preserve because there is no identity.

**Common mistake.** Index keys on a list that can reorder or filter. Delete the
first row of a list of text inputs and every value shifts up by one — visually
plausible, behaviourally wrong.

**Follow-up.** *"Can I use `Math.random()` as a key?"* — no. A new key every
render means React remounts every item, every time.

---

### B10. Controlled vs uncontrolled components?

**Answer.** Controlled: the value comes from React state and changes flow through
a handler. Uncontrolled: the DOM holds the value and you read it with a ref or on
submit.

**Why it matters.** Controlled gives you validation-as-you-type and derived UI;
uncontrolled gives you fewer re-renders.

**Real-world example.** React Hook Form is uncontrolled by design — which is why
typing in a large form does not re-render it. Architecturally it is closer to
Angular's *template-driven* forms than to reactive ones.

**Common mistake.** Switching a component between the two — passing `value`
without `onChange`, or letting `value` become `undefined`. React warns about
exactly this.

**Follow-up.** *"Which do you default to?"* — controlled for small forms and
anything with live feedback; a library for large ones.

---

### B11. What is `useEffect` for?

**Answer.** Synchronising with something **outside** React: a subscription, a
timer, a DOM API, a network request.

**Why it matters.** It is an escape hatch that looks like a lifecycle method, and
that resemblance causes most of its misuse.

**Real-world example.** The SSE hook opens an `EventSource` and returns a cleanup
that closes it. That is a textbook fit: an external system with a lifetime.

**Common mistake.** Using it to sync state from props. `useEffect(() =>
setX(props.y), [props.y])` renders twice and is stale in between. Derive during
render instead.

**Follow-up.** *"When should you NOT use an effect?"* — see I5. This is the most
common React interview follow-up that exists.

---

### B12. What does the dependency array do?

**Answer.** It tells React when to re-run the effect. Empty means once on mount;
omitted means every render; populated means when any listed value changes.

**Why it matters.** It must list **every reactive value the effect reads** — not
"when I want it to run". React cannot inspect a closure, so you declare it.

**Real-world example.** This project runs `react-hooks/exhaustive-deps` as an
**error**, not a warning, because a lie there produces bugs that appear on the
second interaction and nowhere in testing.

**Common mistake.** Removing a dependency to stop a loop. That fixes the symptom
and creates a stale closure. The real fix is usually a functional update or
moving the value inside the effect.

**Follow-up.** *"Why does an object dependency cause an infinite loop?"* — a new
object every render compares unequal every render.

---

### B13. What is cleanup, and when does it run?

**Answer.** The function returned from an effect. React runs it before the next
run of that effect and on unmount.

**Why it matters.** Without it, subscriptions, timers and listeners outlive the
component.

**Real-world example.** Delete the cleanup from this project's SSE hook and you
leak an `EventSource` per mount and get duplicate notifications forever.

**Common mistake.** Assuming it only runs on unmount. It runs before **every**
re-run, which is what makes the debounce pattern work at all.

**Follow-up.** *"Why does my effect run twice in development?"* — StrictMode
mounts, unmounts and remounts to surface missing cleanup. If that breaks your
effect, the effect was not idempotent.

---

### B14. What are the Rules of Hooks?

**Answer.** Call them unconditionally, at the top level, from a component or
another hook. Never inside a condition, loop or nested function.

**Why it matters.** React stores hook state in an array indexed by **call
order**. A conditional call shifts every subsequent hook onto the wrong slot —
your `useState` reads someone else's value.

**Real-world example.** `TaskDetailPage` needs "fetch only if there is an id", so
it uses RTK Query's `skip` option rather than returning early. An early return
before the hook would break the count.

**Common mistake.** An early `return` for a loading or error case placed *above*
a hook.

**Follow-up.** *"How does React know which state belongs to which `useState`?"* —
purely by call order, which is the entire reason for the rule.

---

### B15. What is prop drilling, and is it bad?

**Answer.** Passing a prop through components that do not use it, purely to reach
a descendant.

**Why it matters.** Three levels of a prop something genuinely needs is fine.
The problem is *intermediate components taking props they ignore*, which couples
them to a shape they have no interest in.

**Real-world example.** `ThemeModeToggle` reads the theme from Context four
levels below the provider, because threading `mode` and `toggleMode` through
`AppProviders → RouterProvider → RootLayout → Toolbar` would touch three
components that do not care.

**Common mistake.** Reaching for Context immediately. Often the better fix is
**composition** — pass the rendered element down instead of the data.

**Follow-up.** *"What does Context cost?"* — every consumer re-renders when the
value changes, which is why you push consumption down to leaves.

---

### B16. What is Context for?

**Answer.** Making a value available to a subtree without passing it explicitly.

**Why it matters.** It is **dependency injection for values**, not state
management. No reducers, no devtools, no scoping hierarchy.

**Real-world example.** Theme mode and the compound `Modal`'s shared close
handler. Both are low-frequency, tree-scoped values — the right fit.

**Common mistake.** Putting frequently-changing state in a Context high in the
tree, then wondering why the whole app re-renders.

**Follow-up.** *"Context or Redux?"* — see I13.

---

### B17. What are the common React events, and how do they differ from DOM
events?

**Answer.** `onClick`, `onChange`, `onSubmit` and friends, camelCased, receiving
a **SyntheticEvent** — a cross-browser wrapper over the native event.

**Why it matters.** `onChange` in React fires on every keystroke, unlike the
native DOM `change` event which fires on blur. That difference alone catches
people.

**Common mistake.** Forgetting `e.preventDefault()` on a form submit, so the page
reloads and the app resets.

**Follow-up.** *"Is React still using event delegation?"* — yes, attached at the
React root since 18 (it was `document` before).

---

### B18. How do you pass data from child to parent?

**Answer.** The parent passes a callback down; the child calls it.

**Why it matters.** Data flows down, events flow up. There is no two-way binding
because React's data flow is deliberately one-directional.

**Real-world example.** `TaskCard`'s `onSelect` — the parent decides that
selecting navigates; the card only reports that it was selected.

**Common mistake.** Trying to mutate a prop, or reaching for a store for
parent-child communication that a callback handles.

**Follow-up.** *"How is this different from `@Output()`?"* — the callback **is**
the function. No emitter, no subscription, no `.emit()`.

---

### B19. What is a fragment and why does it exist?

**Answer.** `<>...</>` — groups children without adding a DOM node.

**Why it matters.** A component returns one element. Before fragments, that meant
a wrapper `<div>`, which broke CSS grid and flex layouts and produced "div soup".

**Common mistake.** Using `<></>` where you need a `key` — in a list you need the
long form, `<React.Fragment key={id}>`.

**Follow-up.** *"When does the wrapper div actually matter?"* — any time the
parent's layout depends on direct children, which is most grid and flex layouts.

---

### B20. What does "lifting state up" mean?

**Answer.** Moving state to the nearest common ancestor so two siblings can share
it.

**Why it matters.** It is the default answer for sibling communication, and it
comes before Context or a store.

**Real-world example.** `TasksPage` owns the filters and passes results down;
`TaskCard` owns nothing.

**Common mistake.** Lifting too far. State at the top of the tree re-renders
everything below it — the cost is real and it is why "colocate state" is the
counter-rule.

**Follow-up.** *"When do you stop lifting and reach for a store?"* — when the
common ancestor is so far up that the intermediate components become couriers,
or when unrelated parts of the app need the same value.

---

## Self-check before moving on

You should be able to answer these without looking:

1. What does `Object.is` have to do with re-rendering?
2. Why does `{count && <X/>}` print `0`?
3. What is `key` for, and when is the index acceptable?
4. Name two things that break if you delete an effect's cleanup.
5. Why can a hook not go inside an `if`?

If any of those is shaky, that is the section to reread — not the next file.

---

**Next:** [02 — Intermediate](02-intermediate.md)
