# Coding exercises

> **Part 59.** 50 standalone implementations — the kind you write on a whiteboard
> or in a shared editor with someone watching.

**These are deliberately different from the 66 exercises in the phase docs.**
Those are _"delete the cleanup from this hook and watch the race condition"_ —
excellent for understanding this codebase, useless as interview practice. These
start from an empty file.

**How to use them.** Write the solution before reading it. Then read the
**"what they're probing"** line, which is usually the actual point — most of
these have an obvious solution and a non-obvious follow-up, and the follow-up is
the interview.

**Difficulty:** ● warm-up · ●● standard · ●●● the one that separates people

---

## Contents

| §                                                      | #     |
| ------------------------------------------------------ | ----- |
| [1. JavaScript foundations](#1-javascript-foundations) | 1–10  |
| [2. Async and concurrency](#2-async-and-concurrency)   | 11–20 |
| [3. Hooks from scratch](#3-hooks-from-scratch)         | 21–32 |
| [4. Components](#4-components)                         | 33–41 |
| [5. State and data](#5-state-and-data)                 | 42–50 |

---

## 1. JavaScript foundations

### 1. `chunk(array, size)` ●

Split an array into groups of `size`.

```ts
function chunk<T>(array: T[], size: number): T[][] {
  if (size < 1) throw new RangeError("size must be >= 1");
  const out: T[][] = [];
  for (let i = 0; i < array.length; i += size)
    out.push(array.slice(i, i + size));
  return out;
}
```

**Probing:** whether you handle `size < 1` unprompted. The infinite loop is the
interesting part, not the slicing.

---

### 2. `groupBy(array, keyFn)` ●

```ts
function groupBy<T, K extends PropertyKey>(
  array: T[],
  keyFn: (item: T) => K,
): Record<K, T[]> {
  return array.reduce(
    (acc, item) => {
      const key = keyFn(item);
      (acc[key] ??= []).push(item);
      return acc;
    },
    {} as Record<K, T[]>,
  );
}
```

**Probing:** `Object.create(null)` vs `{}`. With `{}`, a key of `"constructor"`
or `"__proto__"` collides with the prototype — a real prototype-pollution
surface if keys come from user data.

---

### 3. `deepEqual(a, b)` ●●

```ts
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  )
    return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  const ka = Object.keys(a),
    kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => k in b && deepEqual((a as never)[k], (b as never)[k]));
}
```

**Probing:** `Object.is` rather than `===` (so `NaN` equals itself and `+0`
doesn't equal `-0`), and whether you mention cycles, `Date`, `Map`/`Set` — you
don't have to handle them, you have to _know_ they're unhandled.

---

### 4. `deepClone(value)` ●●

```ts
function deepClone<T>(value: T, seen = new WeakMap()): T {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value) as T; // cycles

  const copy: unknown = Array.isArray(value)
    ? []
    : Object.create(Object.getPrototypeOf(value));
  seen.set(value, copy);
  for (const [k, v] of Object.entries(value))
    (copy as never)[k] = deepClone(v, seen);
  return copy as T;
}
```

**Probing:** the `WeakMap`. And whether you say _"in a browser I'd use
`structuredClone`"_ — knowing the platform has it is worth more than the
implementation.

---

### 5. `flatten(array, depth)` ●

```ts
function flatten<T>(array: unknown[], depth = 1): T[] {
  return depth < 1
    ? (array.slice() as T[])
    : array.reduce<T[]>(
        (acc, item) =>
          acc.concat(
            Array.isArray(item) ? flatten<T>(item, depth - 1) : (item as T),
          ),
        [],
      );
}
```

**Probing:** iterative vs recursive for very deep arrays — recursion blows the
stack somewhere around 10k levels.

---

### 6. `get(obj, path, fallback)` — safe deep access ●●

```ts
function get(obj: unknown, path: string, fallback?: unknown): unknown {
  const keys = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
  let current = obj;
  for (const key of keys) {
    if (current === null || typeof current !== "object" || !(key in current))
      return fallback;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
```

**Probing:** whether you point out `?.` covers most real uses now, and that this
is only worth writing when the path is _dynamic_.

---

### 7. `memoize(fn)` ●●

```ts
function memoize<A extends unknown[], R>(
  fn: (...args: A) => R,
): (...args: A) => R {
  const cache = new Map<string, R>();
  return (...args: A): R => {
    const key = JSON.stringify(args);
    if (!cache.has(key)) cache.set(key, fn(...args));
    return cache.get(key) as R;
  };
}
```

**Probing:** three things, and they'll ask for at least one — the cache grows
forever (no eviction), `JSON.stringify` fails on cycles and ignores key order,
and it's wrong for impure functions. A single-entry cache is what `useMemo`
actually does.

---

### 8. `once(fn)` ●

```ts
function once<A extends unknown[], R>(
  fn: (...args: A) => R,
): (...args: A) => R {
  let called = false,
    result: R;
  return (...args: A): R => {
    if (!called) {
      called = true;
      result = fn(...args);
    }
    return result;
  };
}
```

**Probing:** the flag, not `result === undefined` — a function legitimately
returning `undefined` would be called every time.

---

### 9. `curry(fn)` ●●●

```ts
function curry(fn: (...args: never[]) => unknown) {
  return function curried(...args: unknown[]): unknown {
    return args.length >= fn.length
      ? fn(...(args as never[]))
      : (...rest: unknown[]) => curried(...args, ...rest);
  };
}
```

**Probing:** `fn.length` — and that it's wrong for default parameters and rest
args, which don't count toward arity.

---

### 10. `EventEmitter` ●●

```ts
type Handler = (...args: unknown[]) => void;

class EventEmitter {
  private listeners = new Map<string, Set<Handler>>();

  on(event: string, handler: Handler): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
    return () => this.off(event, handler); // unsubscribe, not void
  }
  off(event: string, handler: Handler): void {
    this.listeners.get(event)?.delete(handler);
  }
  emit(event: string, ...args: unknown[]): void {
    // Copy first: a handler that unsubscribes during emit would mutate the set
    // we're iterating.
    for (const h of [...(this.listeners.get(event) ?? [])]) h(...args);
  }
}
```

**Probing:** returning the unsubscribe function, and the iteration copy. Both are
the difference between "works in the demo" and "works".

---

## 2. Async and concurrency

### 11. `sleep(ms)` ● and cancellable sleep ●●

```ts
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function cancellableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const id = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(id);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
```

**Probing:** whether cancellation occurs to you at all, and the already-aborted
check before you set the timer.

---

### 12. `retry(fn, attempts)` with exponential backoff ●●

```ts
async function retry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  baseMs = 200,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < attempts - 1) {
        // Jitter: without it, N clients that failed together retry together and
        // hammer a recovering service in lockstep.
        const delay = baseMs * 2 ** i * (0.5 + Math.random() / 2);
        await sleep(delay);
      }
    }
  }
  throw lastError;
}
```

**Probing:** **jitter**, and _what you retry_. Retrying a 400 or a 403 is
pointless; retrying a non-idempotent POST can double-charge someone.

---

### 13. `timeout(promise, ms)` ●●

```ts
function timeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms),
    ),
  ]);
}
```

**Probing:** that this doesn't _cancel_ anything — the original promise runs to
completion, you just stop listening. Real cancellation needs `AbortSignal` all
the way down.

---

### 14. `promisePool(tasks, limit)` ●●●

Run N async tasks with at most `limit` in flight.

```ts
async function promisePool<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const index = next++; // claim before awaiting
      results[index] = await tasks[index]!();
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, worker),
  );
  return results;
}
```

**Probing:** claiming the index _before_ the await. Read-then-increment across an
await is the classic race, and it's the whole exercise.

---

### 15. `debounce(fn, ms)` ●●

```ts
function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let id: ReturnType<typeof setTimeout> | undefined;
  const debounced = (...args: A) => {
    if (id !== undefined) clearTimeout(id);
    id = setTimeout(() => fn(...args), ms);
  };
  debounced.cancel = () => {
    if (id !== undefined) clearTimeout(id);
  };
  return debounced;
}
```

**Probing:** the `cancel` method (you need it in an effect cleanup), and being
able to state the difference from throttle in one sentence: _debounce waits for
quiet, throttle guarantees a rate_.

---

### 16. `throttle(fn, ms)` ●●

```ts
function throttle<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let last = 0;
  let trailingId: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    const now = Date.now();
    const remaining = ms - (now - last);
    if (remaining <= 0) {
      last = now;
      fn(...args);
    } else if (trailingId === undefined) {
      // Trailing call: without it the LAST event is dropped, which on a scroll
      // handler means you never handle the final position.
      trailingId = setTimeout(() => {
        last = Date.now();
        trailingId = undefined;
        fn(...args);
      }, remaining);
    }
  };
}
```

**Probing:** the trailing edge. Leading-only throttle is the common half-answer.

---

### 17. Sequential vs parallel — spot the bug ●

```ts
// Bug: each await blocks the next. 3 × 1s = 3s.
for (const id of ids) results.push(await fetchOne(id));

// Fixed: 1s.
const results = await Promise.all(ids.map(fetchOne));
```

**Probing:** and then the follow-up — _when is the loop correct?_ When calls
depend on each other, when you must not hammer the server, or when order of
side effects matters.

---

### 18. `Promise.all` vs `allSettled` vs `race` vs `any` ●

**Probing:** `all` rejects on the first failure and you **lose the successes**;
`allSettled` never rejects; `race` settles on the first to _settle_ (including
reject); `any` resolves on the first to _fulfil_.

**The follow-up:** which do you use to fetch a dashboard's five widgets?
`allSettled` — one failing widget shouldn't blank the page.

---

### 19. Implement a single-flight wrapper ●●● ★

```ts
function singleFlight<T>(fn: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null;
  return () => {
    inFlight ??= fn().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}
```

**Probing:** the `finally` — without it the first result is cached forever, which
is a different feature. This is exactly the token-refresh fix in this project:
five parallel 401s must produce **one** refresh, or rotation invalidates the
others and reuse detection logs the user out.

---

### 20. `asyncQueue()` — serialise async work ●●

```ts
function asyncQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task); // run even if the previous one failed
    tail = run.catch(() => undefined); // don't let a rejection poison the chain
    return run;
  };
}
```

**Probing:** the `catch` on the tail. Without it one failure breaks the queue
forever.

---

## 3. Hooks from scratch

### 21. `useDebounce(value, ms)` ●●

```ts
function useDebounce<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id); // the cleanup IS the debounce
  }, [value, ms]);
  return debounced;
}
```

**Probing:** that the _cleanup_ is the mechanism, not an afterthought.

---

### 22. `usePrevious(value)` ●●

```ts
function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  useEffect(() => {
    ref.current = value;
  });
  return ref.current;
}
```

**Probing:** why it isn't in React — writing a ref during render is unsafe under
concurrent rendering, and this pattern invites it. React's own lint rules flag
the variant that does.

---

### 23. `useToggle(initial)` ●

```ts
function useToggle(
  initial = false,
): [boolean, () => void, (v: boolean) => void] {
  const [on, setOn] = useState(initial);
  const toggle = useCallback(() => {
    setOn((v) => !v);
  }, []);
  return [on, toggle, setOn];
}
```

**Probing:** the functional update, and `useCallback` with `[]` — which is only
stable _because_ of the functional update.

---

### 24. `useLocalStorage(key, initial)` ●●

```ts
function useLocalStorage<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    // lazy: read once
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    } // private mode, quota, bad JSON
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* quota */
    }
  }, [key, value]);
  return [value, setValue] as const;
}
```

**Probing:** the lazy initialiser and the try/catch. `localStorage` throws in
Safari private mode and on quota — and this is exactly why tokens _don't_ go
here.

---

### 25. `useEventListener(target, event, handler)` ●●●

```ts
function useEventListener<E extends Event>(
  target: EventTarget | null,
  event: string,
  handler: (e: E) => void,
) {
  const saved = useRef(handler);
  useEffect(() => {
    saved.current = handler;
  }, [handler]); // always latest

  useEffect(() => {
    if (!target) return;
    const listener = (e: Event) => {
      saved.current(e as E);
    };
    target.addEventListener(event, listener);
    return () => {
      target.removeEventListener(event, listener);
    };
  }, [target, event]); // no handler dep
}
```

**Probing:** the ref indirection. Without it, an inline handler re-subscribes on
every render; with `handler` simply omitted from the deps, you get a stale
closure. This is _the_ canonical hook exercise.

---

### 26. `useInterval(callback, delay)` ●●●

```ts
function useInterval(callback: () => void, delay: number | null) {
  const saved = useRef(callback);
  useEffect(() => {
    saved.current = callback;
  }, [callback]);
  useEffect(() => {
    if (delay === null) return; // null pauses
    const id = setInterval(() => {
      saved.current();
    }, delay);
    return () => {
      clearInterval(id);
    };
  }, [delay]);
}
```

**Probing:** same ref pattern, plus `null` as "paused". Naively passing the
callback in deps restarts the interval every render, so it never fires.

---

### 27. `useOnClickOutside(ref, handler)` ●●

```ts
function useOnClickOutside(
  ref: RefObject<HTMLElement | null>,
  handler: () => void,
) {
  useEffect(() => {
    const listener = (event: MouseEvent | TouchEvent) => {
      if (!ref.current || ref.current.contains(event.target as Node)) return;
      handler();
    };
    document.addEventListener("mousedown", listener);
    document.addEventListener("touchstart", listener);
    return () => {
      document.removeEventListener("mousedown", listener);
      document.removeEventListener("touchstart", listener);
    };
  }, [ref, handler]);
}
```

**Probing:** `mousedown` not `click` — with `click`, a button that opens the menu
also closes it, because the opening click's `click` event fires after the menu
mounts.

---

### 28. `useMediaQuery(query)` ●●

```ts
function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", notify);
      return () => {
        mql.removeEventListener("change", notify);
      };
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false, // SSR snapshot
  );
}
```

**Probing:** `useSyncExternalStore` rather than `useState` + `useEffect`. It's the
purpose-built primitive for external sources and it's tearing-safe under
concurrent rendering.

---

### 29. `useFetch(url)` with cancellation ●●●

```ts
function useFetch<T>(url: string) {
  const [state, setState] = useState<{
    data?: T;
    error?: Error;
    loading: boolean;
  }>({
    loading: true,
  });

  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true });
    fetch(url, { signal: controller.signal })
      .then((r) =>
        r.ok
          ? (r.json() as Promise<T>)
          : Promise.reject(new Error(String(r.status))),
      )
      .then((data) => {
        setState({ data, loading: false });
      })
      .catch((error: Error) => {
        if (error.name === "AbortError") return; // expected, not a failure
        setState({ error, loading: false });
      });
    return () => {
      controller.abort();
    };
  }, [url]);

  return state;
}
```

**Probing:** three things — `AbortController` (without it, a stale response from
a _slower earlier_ request overwrites a newer one), swallowing `AbortError`, and
one state object rather than three `useState`s that can disagree.

**The follow-up:** _"would you use this in production?"_ No — no cache, no
dedupe, no retry, no revalidation. That's what RTK Query / React Query are.

---

### 30. `useLatest(value)` ● and why it exists ●●

```ts
function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value; // during render, deliberately
  return ref;
}
```

**Probing:** the honest caveat — writing during render is technically impure. It's
the pragmatic escape hatch for "I need the current value inside a stable
callback", and knowing it's a compromise is the answer.

---

### 31. `useIsMounted()` ●● and why it's usually wrong

```ts
function useIsMounted() {
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return useCallback(() => mounted.current, []);
}
```

**Probing:** the trap. People use it to avoid "setState on an unmounted
component" — a warning React 18 **removed**, because it wasn't a leak. If you
need this, the real fix is usually cancelling the work.

---

### 32. `useReducer`-based `useUndo(initial)` ●●●

```ts
type UndoState<T> = { past: T[]; present: T; future: T[] };
type UndoAction<T> =
  | { type: "set"; value: T }
  | { type: "undo" }
  | { type: "redo" };

function reducer<T>(state: UndoState<T>, action: UndoAction<T>): UndoState<T> {
  const { past, present, future } = state;
  switch (action.type) {
    case "set":
      return action.value === present
        ? state // no-op keeps history clean
        : { past: [...past, present], present: action.value, future: [] };
    case "undo":
      if (past.length === 0) return state;
      return {
        past: past.slice(0, -1),
        present: past[past.length - 1]!,
        future: [present, ...future],
      };
    case "redo":
      if (future.length === 0) return state;
      return {
        past: [...past, present],
        present: future[0]!,
        future: future.slice(1),
      };
  }
}
```

**Probing:** that a new `set` **clears the future** — the standard undo semantic,
and the thing most people forget.

---

## 4. Components

### 33. An accessible `<Modal>` ●●●

Requirements to state _before_ coding — this is the exercise:

- rendered in a **portal** (so parent `overflow: hidden` can't clip it)
- **focus moves in** on open, and **back to the trigger** on close
- **focus is trapped** while open
- **Escape** closes it
- `role="dialog"` `aria-modal="true"` with `aria-labelledby`
- background content is `inert` / not reachable
- body scroll locked

```tsx
function Modal({ open, onClose, title, children }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<Element | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    trigger.current = document.activeElement; // remember, to restore
    ref.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      (trigger.current as HTMLElement | null)?.focus(); // THE forgotten half
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      ref={ref}
      tabIndex={-1}
    >
      <h2 id={titleId}>{title}</h2>
      {children}
    </div>,
    document.body,
  );
}
```

**Probing:** returning focus to the trigger. Everyone traps focus; almost nobody
restores it, and a screen-reader user is left at the top of the document.

---

### 34. `<ErrorBoundary>` ●●

```tsx
class ErrorBoundary extends React.Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    logToService(error, info);
  }
  render() {
    return this.state.error
      ? this.props.fallback(this.state.error)
      : this.props.children;
  }
}
```

**Probing:** that it must be a class (no hook equivalent), and what it does
**not** catch — event handlers, async code, SSR, and errors thrown by the
boundary itself.

---

### 35. A compound `<Tabs>` with Context ●●●

```tsx
const TabsContext = createContext<{
  active: string;
  setActive: (id: string) => void;
} | null>(null);

function Tabs({ defaultTab, children }: TabsProps) {
  const [active, setActive] = useState(defaultTab);
  const value = useMemo(() => ({ active, setActive }), [active]); // stable identity
  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>;
}

function useTabs() {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("Tabs.* must be used inside <Tabs>"); // fail loudly
  return ctx;
}
```

**Probing:** the `useMemo` on the context value (without it every consumer
re-renders on every parent render), and the throwing hook — a context that
silently returns `undefined` produces components that do nothing in production.

**The follow-up:** keyboard support. Real tabs use arrow keys, not Tab, with
`role="tablist"` and roving `tabIndex`.

---

### 36. `<VirtualList>` ●●●

```tsx
const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
const count = Math.ceil(height / rowHeight) + overscan * 2;
const last = Math.min(items.length, first + count);
```

Plus: a full-height spacer so the scrollbar is honest, and the window positioned
with `translateY` (compositor-friendly; `top` forces layout every frame).

**Probing:** the accessibility follow-up. A virtualized list tells assistive tech
it has 20 items when it has 10,000 — you need `aria-setsize`/`aria-posinset`.
★ And **not** `aria-rowcount`, which is grid-family only; on `role="list"` it's
invalid ARIA that's silently discarded. This project shipped that bug.

---

### 37. `<Autocomplete>` ●●●

The state machine matters more than the markup: `idle → typing → loading →
results → selected`, plus a keyboard-highlighted index independent of hover.

**Probing:** the **race**. Type "rea", then "react" — if "rea" resolves last, the
wrong results win. Fix: `AbortController`, or a request sequence number.

**Accessibility:** `role="combobox"`, `aria-expanded`, `aria-activedescendant`
pointing at the highlighted option — the highlight must **not** move real focus
out of the input.

---

### 38. `<Toast>` with a queue ●●

**Probing:** what happens on the sixth toast (queue, don't stack), pause-on-hover,
and `role="status"` vs `role="alert"` — polite waits for the screen reader to
finish, assertive interrupts. Errors are assertive; "saved" is polite.

---

### 39. An accessible clickable card ●●● ★

**The trap is the requirements, not the code.** The card must be clickable _and_
contain its own action button.

Three options, and naming all three is the answer:

1. `onClick` on a `<div>` — no keyboard, no role. Broken.
2. `role="button"` + `tabIndex` + `onKeyDown` — valid **until** the card contains
   a control, then it's `nested-interactive` and the inner button becomes
   announced-but-unreachable.
3. **Overlay:** an absolutely positioned transparent `<button>` that is a
   _sibling_ of the content. Real button semantics for free; the actions sit
   above it with `z-index`.

**Probing:** what the overlay costs — text selection, and right-click "open in
new tab" (use `<a href>` if the card navigates).

---

### 40. `<Form>` with validation, no library ●●

**Probing:** controlled vs uncontrolled, when to validate (on blur first, then on
change once touched — validating on every keystroke from empty is hostile), and
associating errors with `aria-describedby` + `aria-invalid` so they're announced.

---

### 41. An infinite-scroll list ●●●

```tsx
useEffect(() => {
  const el = sentinel.current;
  if (!el || !hasMore) return;
  const io = new IntersectionObserver(([entry]) => {
    if (entry?.isIntersecting) loadMore();
  });
  io.observe(el);
  return () => {
    io.disconnect();
  };
}, [hasMore, loadMore]);
```

**Probing:** `IntersectionObserver` over a scroll handler, guarding against
double-firing while a load is in flight, and the accessibility problem — infinite
scroll makes the footer unreachable and breaks Ctrl+F. A "Load more" button is
often the better product.

---

## 5. State and data

### 42. Write a reducer for a task board ●●

**Probing:** modelling as a discriminated union (`type` + payload) with an
exhaustive `switch` returning `never` in the default, so adding a case is a
compile error rather than a silent no-op.

---

### 43. Normalise nested API data ●●

```ts
// from: [{ id, title, comments: [{ id, body }] }]
// to:   { tasks: { byId, allIds }, comments: { byId, allIds } }
```

**Probing:** _why_ — updating one comment shouldn't require finding and rebuilding
its parent task, and duplicated entities can't get out of sync. And the cost:
every read is now a join you write by hand.

---

### 44. `createSelector` from scratch ●●●

```ts
function createSelector<S, A extends unknown[], R>(
  inputs: { [K in keyof A]: (s: S) => A[K] },
  combiner: (...args: A) => R,
) {
  let lastInputs: A | null = null,
    lastResult: R;
  return (state: S): R => {
    const values = inputs.map((fn) => fn(state)) as A;
    if (lastInputs && values.every((v, i) => Object.is(v, lastInputs![i])))
      return lastResult;
    lastInputs = values;
    lastResult = combiner(...values);
    return lastResult;
  };
}
```

**Probing:** cache size 1, and _why that's enough_ — a selector is usually called
with the same state repeatedly. It's also why a selector shared between
components with different args thrashes.

---

### 45. Implement optimistic update + rollback ●●●

```ts
async function optimistic<T>(
  apply: () => T, // returns an undo token
  undo: (token: T) => void,
  request: () => Promise<unknown>,
) {
  const token = apply();
  try {
    await request();
  } catch (error) {
    undo(token);
    throw error;
  }
}
```

**Probing:** ★ what happens if a _second_ optimistic update lands before the first
resolves — naive rollback restores a state that's now wrong. And: don't also
invalidate the cache, or you refetch and defeat the point.

---

### 46. A tag-based cache invalidator ●●●

```ts
class TagCache {
  private entries = new Map<string, { value: unknown; tags: Set<string> }>();
  private byTag = new Map<string, Set<string>>(); // reverse index

  set(key: string, value: unknown, tags: string[]) {
    this.entries.set(key, { value, tags: new Set(tags) });
    for (const t of tags)
      (this.byTag.get(t) ?? this.byTag.set(t, new Set()).get(t)!).add(key);
  }
  invalidate(tag: string) {
    for (const key of this.byTag.get(tag) ?? []) this.entries.delete(key);
    this.byTag.delete(tag);
  }
}
```

**Probing:** the reverse index — scanning every entry on invalidation is the
naive version and it's `O(n)` per mutation.

---

### 47. Parse and serialise URL filter state ●●

**Probing:** round-tripping. `?status=&page=1` vs an absent key — is empty-string
a filter for "no status" or no filter at all? Pick one and be consistent, or
"clear filters" won't work.

---

### 48. `paginate(items, page, size)` and its off-by-ones ●

**Probing:** `totalPages = Math.ceil(total / size)` with `total === 0` giving 0,
not 1; clamping `page` into range rather than returning empty; and 1-based pages
in the URL vs 0-based offsets in the query.

---

### 49. An LRU cache ●●●

```ts
class LRU<K, V> {
  private map = new Map<K, V>(); // Map preserves insertion order
  constructor(private limit: number) {}

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key)!;
    this.map.delete(key);
    this.map.set(key, value); // move to most-recent
    return value;
  }
  set(key: K, value: V) {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.limit)
      this.map.delete(this.map.keys().next().value as K);
  }
}
```

**Probing:** using `Map`'s insertion order instead of hand-rolling a doubly
linked list — `O(1)` and about fifteen lines shorter.

---

### 50. A state machine for an async form ●●●

```ts
type State =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; data: Result }
  | { status: "error"; error: Error };
```

**Probing:** why this beats `{ loading, error, data }` — three booleans allow
`loading && error && data`, a state that can't happen but that every component
must nonetheless handle. A union makes impossible states unrepresentable, and
that's the sentence to say out loud.

**The follow-up:** what about submitting _again_ after an error? You need a
`retrying` state or a `previousError` field, and noticing that is the point.

---

## Related

- [INTERVIEW-QUESTIONS.md](INTERVIEW-QUESTIONS.md) — 130 questions
- [ARCHITECTURE-QUESTIONS.md](ARCHITECTURE-QUESTIONS.md) — 20 design discussions
- [SENIOR-SCENARIOS.md](SENIOR-SCENARIOS.md) — 40 situations
- [MOCK-INTERVIEW.md](MOCK-INTERVIEW.md) — a full loop
- The 66 _modify-this-codebase_ exercises live at the end of each
  [phase doc](reactfrontend/docs/) — different purpose, both worth doing.
