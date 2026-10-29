# Angular → React

> The companion to the backend's [`express-vs-nestjs.md`](../../nestbackend/docs/express-vs-nestjs.md).
> That one maps what you already knew onto a new framework; this one does the
> same for the front end.
>
> **This is a translation document, not a positioning one.** How to *talk* about
> having more Angular experience than React is
> [POSITIONING.md](../../POSITIONING.md). This is how to *think* in React when
> your instincts are Angular.

---

## Table of contents

1. [The one difference everything descends from](#1-the-one-difference-everything-descends-from)
2. [Concept map](#2-concept-map)
3. [Components and templates](#3-components-and-templates)
4. [Inputs, outputs and slots](#4-inputs-outputs-and-slots)
5. [Services and dependency injection](#5-services-and-dependency-injection)
6. [RxJS and async state](#6-rxjs-and-async-state)
7. [Lifecycle vs effects](#7-lifecycle-vs-effects)
8. [Forms](#8-forms)
9. [Routing and guards](#9-routing-and-guards)
10. [HTTP and interceptors](#10-http-and-interceptors)
11. [Change detection vs reconciliation](#11-change-detection-vs-reconciliation)
12. [What you genuinely lose](#12-what-you-genuinely-lose)
13. [What you genuinely gain](#13-what-you-genuinely-gain)
14. [Interview questions](#14-interview-questions)
15. [Quiz](#15-quiz)

---

## 1. The one difference everything descends from

Learn this and most of React stops being surprising.

| | Angular | React |
| --- | --- | --- |
| How it detects change | Walks the tree comparing **property values** | Compares **references** with `Object.is` |
| How it knows when to look | Zone.js patches async APIs | You call a setter |
| Mutating an object | Works fine | **Invisible** |

Five things people find confusing about React are all consequences of that
single choice:

- **Why must state be immutable?** Because the bailout check is
  `Object.is(prev, next)`. Mutating and re-setting the same reference is
  indistinguishable from no change, so nothing re-renders. It is not a style
  preference; it is the mechanism.
- **Why dependency arrays?** React cannot observe what your function reads.
  Angular's compiler can see template bindings; a plain JavaScript closure has
  no such surface. So you declare it.
- **Why `key`?** Reconciliation needs identity, and position is not identity.
  This is `trackBy`, made mandatory.
- **Why does everything "re-render"?** Because *render* means *call the
  function*, not *touch the DOM*. It is cheap. What is not cheap is a large tree
  reconciled repeatedly.
- **Why no two-way binding?** `[(ngModel)]` requires the framework to own the
  write path. React's data flow is one-directional by design, so you pass a
  value down and a callback up.

> **Interview.** "What was hardest coming from Angular?" — this is the answer.
> One idea that explains five surface behaviours shows you understand the model
> rather than the API.

---

## 2. Concept map

| Angular                          | React                                | Honest note                                                       |
| -------------------------------- | ------------------------------------ | ----------------------------------------------------------------- |
| `@Component`                     | function component                   | Same idea, far less ceremony                                      |
| Template (`.html`)               | JSX in the same file                  | JSX is JavaScript, not a template language                        |
| `@Input()`                       | props                                | Direct                                                            |
| `@Output()` + `EventEmitter`     | callback prop                        | React is genuinely simpler — no emitter, no subscription          |
| `ng-content`                     | `children` / `ReactNode` prop        | React's is more flexible: slots are ordinary **values**           |
| `ng-template` + `ngTemplateOutlet` | a prop holding JSX                  | Same use case, no compiler involvement                            |
| `*ngIf`                          | `&&` or ternary                      | ⚠ `{count && <X/>}` renders `0` — use `count > 0 &&`              |
| `*ngFor` + `trackBy`             | `.map()` + `key`                     | `trackBy` **is** `key`. Same problem, same fix                    |
| `ngOnInit`                       | `useEffect(fn, [])`                  | ⚠ Not equivalent — runs after paint, twice under StrictMode       |
| `ngOnDestroy`                    | effect cleanup return                | Direct                                                            |
| `ngOnChanges`                    | derive during render                 | Usually you should not sync at all                                 |
| `@ViewChild`                     | `useRef`                             | Direct                                                            |
| Service + DI                     | imports, hooks, Context              | **The biggest real loss** — see §5                                |
| `providedIn: 'root'`             | a module-level singleton             | Simpler, less testable                                            |
| RxJS `Observable`                | RTK Query / promises / a hook        | No stream primitive in React — see §6                             |
| `async` pipe                     | `{ data, isLoading }` from a hook    | Same job: subscribe, unwrap, clean up                             |
| Reactive Forms                   | React Hook Form + Zod                | RHF is internally closer to *template*-driven (uncontrolled)      |
| `Validators`                     | a Zod schema                         | Zod also produces the **type**; Angular's validators do not       |
| `routerLink`                     | `<Link>`                             | Direct                                                            |
| `<router-outlet>`                | `<Outlet />`                         | Direct                                                            |
| `canActivate` guard              | a wrapper component                  | ⚠ Neither is security — the API is                                |
| Resolver                         | a router `loader`                    | Very close in intent                                              |
| `HttpInterceptor`                | a wrapped `fetch` / RTK `baseQuery`  | You write it; nothing is automatic                                |
| `NgModule`                       | ES modules                           | React has no module system of its own                             |
| `ChangeDetectionStrategy.OnPush` | `React.memo`                         | Same intent; both defeated by unstable references                 |
| Pipes (`| date`)                 | plain functions / `useMemo`          | No template language, so no pipes needed                          |
| Zone.js                          | *(nothing)*                          | React never guesses when to update                                |

---

## 3. Components and templates

**Angular** splits a component into a class, a template and a stylesheet, and
the template is compiled — `*ngIf` is a structural directive the compiler
rewrites.

**React** has one function returning JSX, and JSX is sugar for
`React.createElement`. It produces a plain object. That is why you can put it in
a variable, return it from a function, pass it as a prop, or store it in an
array.

```tsx
// A "template" is just a value.
const badge = task.isOverdue ? <Chip label="Overdue" /> : null;
return <Card>{badge}</Card>;
```

**What this buys you:** no template compiler, no separate expression syntax, and
full TypeScript coverage over what would be template bindings. Angular templates
are only partially type-checked even with `strictTemplates`.

**What it costs:** no structural directives, so common patterns are hand-written
(`items.length === 0 ? <Empty/> : items.map(...)`), and nothing stops a component
becoming a 400-line function.

→ [phase-02](phase-02-components-jsx-props-state.md)

---

## 4. Inputs, outputs and slots

```ts
// Angular
@Input() task!: Task;
@Output() selected = new EventEmitter<string>();
this.selected.emit(task.id);
```

```tsx
// React
interface Props { task: Task; onSelect?: (id: string) => void }
onSelect?.(task.id);
```

The callback **is** the function. No emitter, no subscription, no `.emit()`.
This is one place React is simply less machinery for the same result.

**Slots are the bigger difference.** `ng-content` with `select` needs compiler
support; in React a slot is a prop that happens to hold JSX:

```tsx
<TaskCard task={task} actions={<OverflowMenu id={task.id} />} />
```

`actions` is a value. You can compute it, pass it through, or store it — none of
which a projected template can do.

→ `TaskCard`, `EmptyState`, and the compound
[`Modal`](../src/components/modals/Modal.tsx)

---

## 5. Services and dependency injection

**This is the largest genuine loss, and saying so is a stronger interview answer
than pretending Context replaces it.**

Angular gives you a hierarchical injector: constructor injection, per-instance
or per-module scoping, and override-by-token for tests.

React has three partial replacements:

| Angular need | React answer | What is lost |
| --- | --- | --- |
| Shared stateless logic | a plain module import | nothing — this is simpler |
| Shared **stateful** logic | a custom hook | hooks share *logic*, **not state** — each call gets its own |
| An ambient value deep in the tree | Context | no scoping hierarchy, no token override, every consumer re-renders |
| Swapping an implementation in tests | manual mock / injected prop | no injector to reconfigure |

**The misconception worth naming:** extracting a hook does **not** share state
between components. `useCounter()` called in two places gives two counters. That
surprise is what sends people to Redux.

**Context is DI for values, not a container.** It has no reducers, no devtools,
and no scoping — and every consumer re-renders when the value changes, which is
why this project pushes consumption down to leaves (`ThemeModeToggle`,
`SessionControls`) rather than reading context in the layout.

→ [phase-03](phase-03-hooks.md)

---

## 6. RxJS and async state

There is no React equivalent of RxJS, and pretending otherwise is the fastest
way to write bad React.

| RxJS pattern | React |
| --- | --- |
| `http.get()` + `async` pipe | RTK Query hook |
| `switchMap` cancelling a stale request | `AbortController`, or RTK Query's own dedupe |
| `debounceTime` | a `useDebounce` hook (a `setTimeout` + cleanup) |
| `combineLatest` | just read both values during render |
| `BehaviorSubject` as a store | a Redux slice, or Context |
| `shareReplay` | the RTK Query cache |
| A genuine stream (SSE, WebSocket) | a hook with an effect and a cleanup |

**What is genuinely worse:** `debounce → switchMap → retry → catchError` is four
operators in Angular and a hand-written hook here. Composable async is RxJS's
real strength and React has nothing like it.

**What is genuinely better:** most components do not need a stream. They need
"fetch this, cache it, tell me if it is loading" — and RTK Query does that in one
line without teaching anyone marble diagrams.

→ [phase-08-09](phase-08-09-redux-and-rtk-query.md),
[phase-15](phase-15-sse-notifications.md)

---

## 7. Lifecycle vs effects

**The trap:** `useEffect(fn, [])` looks like `ngOnInit` and is not.

| | `ngOnInit` | `useEffect(fn, [])` |
| --- | --- | --- |
| When | Before the first render completes | **After** paint |
| How often | Once | Once — **twice in StrictMode dev** |
| Cleanup | `ngOnDestroy`, a separate method | The returned function, same place |

Two consequences:

- **StrictMode double-invocation is a feature.** If mounting twice breaks your
  effect, the effect was not idempotent and would have broken eventually anyway.
- **Cleanup being co-located is a real improvement.** Angular's setup and
  teardown are two methods that can drift apart; React puts them in one closure
  so they cannot.

**And the rule that matters most:** most `useEffect` calls should not exist.
Angular habits produce `ngOnChanges`-style syncing, which in React is a second
source of truth that is always one render stale. If you can derive it during
render, derive it.

→ [phase-03](phase-03-hooks.md)

---

## 8. Forms

| | Angular Reactive Forms | React Hook Form |
| --- | --- | --- |
| Value lives in | a `FormGroup` | the DOM (uncontrolled), read on submit |
| Re-render on keystroke | no (it is outside change detection) | no — this is the point |
| Validation | `Validators` | a Zod schema via a resolver |
| Types | separate from the validators | `z.infer` — one source |

RHF is architecturally closer to Angular's **template-driven** forms than to
reactive ones: the DOM holds the value and the library subscribes. That is what
makes it fast, and it is why `register()` returns props to spread rather than a
control object to bind.

**The Zod advantage worth stating:** one schema gives validation *and* the
TypeScript type, so they cannot drift. And the schema mirrors the NestJS DTO,
which is the contract you are actually bound by.

**The rule that does not change:** client-side validation is for **feedback
speed**. It is not correctness and it is not security. The server validates the
same rules because anything here is bypassable with one `curl`.

→ [phase-05-06](phase-05-06-routing-and-forms.md)

---

## 9. Routing and guards

Nearly a direct port. `<router-outlet>` → `<Outlet />`, `routerLink` → `<Link>`,
nested routes → nested routes, resolvers → `loader`.

**The differences that matter:**

- **Routes are ordinary values.** An Angular `Routes` array is configuration
  processed by the framework; a React route can be composed, wrapped and
  conditionally built with plain JavaScript.
- **A guard is a component.** No `canActivate` interface — a wrapper renders
  either its children or a `<Navigate />`. Which means a guard can use hooks.
- **`<Link>` renders a real `<a href>`.** Middle-click, "open in new tab" and
  screen readers keep working. Attaching `onClick` to a `<div>` breaks all three
  and is the most common accessibility failure in React navigation.

⚠ **Neither framework's guard is security.** It hides UI. The NestJS guard is
the boundary — and an audit on this project found eight endpoints where the API
enforced nothing while the UI looked correct.

→ [phase-05-06](phase-05-06-routing-and-forms.md),
[phase-10-11](phase-10-11-authorization-rbac.md)

---

## 10. HTTP and interceptors

Angular gives you `HttpClient` and an `HttpInterceptor` chain, registered once
and applied everywhere. React gives you `fetch`.

Everything an interceptor did, you write:

| Interceptor concern | Where it lives here |
| --- | --- |
| Attach the bearer token | `services/httpClient.ts` and RTK Query's `prepareHeaders` |
| CSRF header | same |
| Refresh on 401 and retry | `services/refreshClient.ts` — single-flight |
| Error normalisation | the `HttpError` class |
| Loading indicator | the component, from `isLoading` |

**The trap this project actually hit:** there are **two** transports — a
hand-rolled `fetch` wrapper and RTK Query's `fetchBaseQuery` — so every
interceptor concern has to be implemented twice and kept in agreement. A
relative `baseUrl` worked in one and threw `Failed to parse URL` in the other,
because they resolve relative URLs differently.

The refresh logic is shared between them deliberately, so the single-flight
guarantee holds across both.

→ [phase-07](phase-07-api-integration.md)

---

## 11. Change detection vs reconciliation

| | Angular | React |
| --- | --- | --- |
| Trigger | Zone.js sees async activity | you call a setter |
| Work | walk components, compare bindings | call components, diff element trees |
| Opt-out | `ChangeDetectionStrategy.OnPush` | `React.memo` |
| Defeated by | mutating an `@Input` object under OnPush | inline objects/arrays/arrows as props |

The symmetry is worth noticing: **both** optimisations compare references, and
**both** are silently defeated the same way. An Angular developer who has debugged
OnPush not firing already understands why `React.memo` "doesn't work".

**Where they diverge:** Angular's default is safe and slow (check everything);
React's default is *call everything and diff*, which sounds worse and is usually
cheaper because the diff is over a lightweight element tree, not the DOM.

→ [phase-04](phase-04-rendering-reconciliation-keys.md)

---

## 12. What you genuinely lose

Say these unprompted when asked to compare. They read as experience.

1. **Dependency injection.** No hierarchical, overridable, per-instance service
   graph. Test doubles are wired by hand.
2. **Structure by default.** Angular tells you where things go. React gives you
   `useState` and wishes you luck — which is why a React codebase's architecture
   is a team decision, and why it drifts.
3. **RxJS for composable async.** Four operators become a hand-written hook.
4. **Batteries.** Angular ships routing, HTTP, forms, i18n and testing. React
   ships a renderer; every other choice is yours to make and maintain forever.
5. **Template type-checking as a compile step.** You get better types in React
   overall, but you lose the compiler's view of the template as a distinct thing.

---

## 13. What you genuinely gain

1. **JSX is JavaScript.** No template language, no structural directives, no
   separate expression syntax.
2. **Much better TypeScript ergonomics.** Props are a type. Generic components
   are ordinary generics.
3. **A smaller conceptual surface.** Once reference equality clicks, there is
   genuinely less to know.
4. **Server state solved properly.** RTK Query / React Query handle caching,
   dedupe, invalidation and revalidation. Angular has no blessed equivalent.
5. **Composition without ceremony.** A slot is a value; a wrapper is a function.

---

## 14. Interview questions

1. **What was hardest coming from Angular?** Change detection by value vs
   bailout by reference — and the five behaviours that descend from it.
2. **Why must React state be immutable?** `Object.is` bailout. Mutation is
   invisible, silently.
3. **Is `useEffect(fn, [])` the same as `ngOnInit`?** No — after paint, twice in
   StrictMode dev, and cleanup is co-located.
4. **What replaces Angular's DI?** Imports for logic, Context for ambient
   values, hooks for stateful behaviour — and none of them is an injector. Say
   what is lost.
5. **Does extracting a custom hook share state?** No. Hooks share logic; each
   call gets its own state.
6. **What replaces RxJS?** For server state, a query library. For real streams,
   a hook with cleanup. Composable async operators have no equivalent.
7. **`trackBy` vs `key`?** The same concept. React makes it mandatory and
   attaches component identity to it.
8. **`OnPush` vs `React.memo`?** Same intent, same defeat condition: a new
   reference every render.
9. **Are React route guards security?** No, and neither are Angular's. The API
   is the boundary.
10. **Which would you choose for a new project?** A real answer names the
    constraint — team familiarity, hiring, whether you want decisions made for
    you — not "React is better."

---

## 15. Quiz

1. React re-renders when a prop object is mutated in place. **True or false?**
2. What does `{items.length && <List/>}` render when the array is empty?
3. Name the React equivalent of `trackBy`.
4. Which runs first: `ngOnInit` or a `useEffect` with `[]`?
5. Two components call the same custom hook. How many pieces of state exist?
6. What single comparison drives React's re-render bailout?
7. `<Link>` renders which HTML element?
8. Name one thing `React.memo` and `OnPush` are both defeated by.
9. Where does a React "guard" enforce security?
10. What does Zod give you that Angular's `Validators` do not?

<details>
<summary>Answers</summary>

1. **False.** `Object.is(prev, next)` is true for the same reference, so nothing
   renders.
2. **`0`.** The number is falsy but a valid ReactNode, so it prints. Use
   `items.length > 0 &&`.
3. **`key`.**
4. **`ngOnInit`** — it runs before the view is displayed; `useEffect` runs after
   paint.
5. **Two.** Hooks share logic, not state.
6. **`Object.is(prevState, nextState)`.**
7. **A real `<a href>`** — which is what keeps middle-click and screen readers
   working.
8. **An unstable reference** — an inline object, array or arrow function passed
   as a prop (or a mutated `@Input` under OnPush).
9. **Nowhere.** It hides UI; the backend enforces access.
10. **The TypeScript type**, via `z.infer` — so validation and types cannot
    drift.

</details>

---

**Next:** [interview/01-beginner.md](interview/01-beginner.md) if you are shaking
off rust, or [POSITIONING.md](../../POSITIONING.md) for how to talk about this
background in an interview.
