import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Divider, Stack, Typography } from '@mui/material';
import { useDebounce } from '@/hooks/useDebounce';
import { usePrevious } from '@/hooks/usePrevious';

/**
 * =============================================================================
 * PHASE 3 - THE HOOKS LAB
 * =============================================================================
 * useEffect failure modes, each runnable. Route: /lab/hooks.
 *
 * WHY useEffect GETS ITS OWN LAB: it is the hook that causes the most bugs, and
 * essentially all of them come from one wrong sentence:
 *
 *     "useEffect is componentDidMount"
 *
 * It is not. It is a SYNCHRONISATION primitive. It says: "after render, make
 * this external thing match my state - and when my dependencies change, do it
 * again". Mount is merely the first time that happens.
 *
 * Every demo below is a symptom of reading it as a lifecycle hook.
 * =============================================================================
 */

/* ===========================================================================
 * 1. STALE CLOSURE - the empty dependency array trap
 * ======================================================================== */

function StaleClosureDemo() {
  const [count, setCount] = useState(0);
  const [brokenLog, setBrokenLog] = useState<number[]>([]);
  const [fixedLog, setFixedLog] = useState<number[]>([]);

  /**
   * BROKEN. `[]` means "never re-run", so this effect's closure captured
   * `count` from the FIRST render - when it was 0 - and keeps that snapshot
   * forever.
   *
   * The interval fires every second and logs 0. Not "the current count". Zero,
   * for as long as the page is open, no matter how many times you click.
   *
   * WHY PEOPLE WRITE THIS: they wanted "start the interval once on mount", read
   * `[]` as "componentDidMount", and got it. What they did not realise is that
   * "run once" also means "capture the values from render one, permanently".
   *
   * `exhaustive-deps` would flag this immediately - which is why it is an
   * ERROR in this project rather than a warning, and why the disable below is
   * needed to demonstrate the bug at all.
   */
  useEffect(() => {
    const id = setInterval(() => {
      setBrokenLog((log) => [...log.slice(-4), count]);
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately demonstrating the stale closure
  }, []);

  /**
   * FIXED, and note WHICH fix.
   *
   * The naive repair is to add `count` to the deps - but then the interval is
   * torn down and recreated on every single click, so the timing resets and
   * the clock stutters. Correct values, broken behaviour.
   *
   * The right fix is the FUNCTIONAL UPDATE. `setCount(c => ...)` receives the
   * latest value from React, so the effect never needs to read `count` at all -
   * which means it genuinely can have an empty dependency array, honestly.
   *
   * THE PRINCIPLE, and it generalises far beyond intervals: do not fight the
   * dependency array. Remove the dependency. Functional updates, refs and
   * moving values out of the component are all ways to need less.
   *
   * (`countRef` below is the other standard tool, for when you must READ a
   * fresh value rather than update one.)
   */
  const countRef = useRef(count);
  useEffect(() => {
    countRef.current = count;
  }, [count]);

  useEffect(() => {
    const id = setInterval(() => {
      // Reads the ref, which is always current. The effect itself depends on
      // nothing, so it is created once and never torn down.
      setFixedLog((log) => [...log.slice(-4), countRef.current]);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <DemoCard
      title="1. Stale closures"
      question="Click a few times and watch both logs. Why does one only ever say 0?"
    >
      <Stack spacing={2}>
        <Box>
          <Typography variant="h5">count: {count}</Typography>
          <Button variant="contained" onClick={() => setCount((c) => c + 1)}>
            Increment
          </Button>
        </Box>
        <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
          <Bad>
            <Typography variant="caption">deps [], reads `count`</Typography>
            <Typography>[{brokenLog.join(', ')}]</Typography>
          </Bad>
          <Good>
            <Typography variant="caption">deps [], reads a ref</Typography>
            <Typography>[{fixedLog.join(', ')}]</Typography>
          </Good>
        </Stack>
      </Stack>
      <Note>
        A closure captures VALUES, not variables. <code>[]</code> does not mean &quot;run
        once&quot; - it means &quot;never resubscribe, and keep render one&apos;s values
        forever&quot;. That second half is where the bug lives.
      </Note>
    </DemoCard>
  );
}

/* ===========================================================================
 * 2. INFINITE LOOP - the object-in-deps trap
 * ======================================================================== */

function InfiniteLoopDemo() {
  const [runs, setRuns] = useState(0);
  const [armed, setArmed] = useState(false);

  /**
   * THE CLASSIC INFINITE LOOP, and the reason it happens is Phase 2's lesson
   * wearing a different hat.
   *
   * An object or array literal in the component body is a NEW REFERENCE on
   * every render:
   *
   *     const options = { limit: 10 };       // new object, every render
   *     useEffect(() => { ... }, [options]); // deps "changed" -> effect runs
   *                                          // effect setStates -> re-render
   *                                          // -> new object -> deps changed...
   *
   * `exhaustive-deps` cannot save you: `options` genuinely IS a dependency. The
   * problem is its identity, not its presence. Dependencies are compared with
   * Object.is, and `{} !== {}`.
   *
   * We gate it behind a button because an actual infinite loop would lock the
   * tab. Ten runs is enough to see it.
   */
  const options = { limit: 10 };

  useEffect(() => {
    if (!armed || runs >= 10) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the setState IS the loop being demonstrated
    setRuns((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `options` is intentionally an unstable reference
  }, [options, armed]);

  return (
    <DemoCard
      title="2. Infinite loops"
      question="An object in the dependency array. Why does this never settle?"
    >
      <Stack spacing={2}>
        <Typography>
          Effect runs: <strong>{runs}</strong> {runs >= 10 && '(capped so the tab survives)'}
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" color="error" onClick={() => setArmed(true)} disabled={armed}>
            Arm the loop
          </Button>
          <Button
            onClick={() => {
              setArmed(false);
              setRuns(0);
            }}
          >
            Reset
          </Button>
        </Stack>
      </Stack>
      <Note>
        <strong>Three real fixes,</strong> in order of preference: (1) move the object
        outside the component - it is a constant; (2) depend on the PRIMITIVE fields
        (<code>[options.limit]</code>) rather than the object; (3){' '}
        <code>useMemo</code> it. Reach for useMemo last - the first two remove the
        problem instead of caching it.
      </Note>
    </DemoCard>
  );
}

/* ===========================================================================
 * 3. WHEN NOT TO USE useEffect AT ALL
 * ======================================================================== */

const CATALOGUE = [
  'Wire the RTK Query API slice',
  'Add refresh-token rotation',
  'Server-side pagination for tasks',
  'SSE notification stream',
  'Role-based route guards',
];

function UnnecessaryEffectDemo() {
  const [query, setQuery] = useState('');

  /**
   * THE ANTI-PATTERN: an effect that filters a list into state.
   *
   *     const [results, setResults] = useState(CATALOGUE);
   *     useEffect(() => {
   *       setResults(CATALOGUE.filter(t => t.includes(query)));
   *     }, [query]);
   *
   * Two renders per keystroke, one frame showing stale results, and a second
   * source of truth that must be kept in sync.
   *
   * THE FIX IS TO DELETE THE EFFECT. `results` is derivable from `query`, so
   * derive it. Same lesson as Phase 2's derived state, now applied to a list.
   *
   * "Should I useMemo this filter?" Almost certainly not. Five strings and a
   * substring check is nanoseconds - far cheaper than the memo bookkeeping
   * itself. Measure before memoising; Phase 16 shows how.
   */
  const results = CATALOGUE.filter((task) => task.toLowerCase().includes(query.toLowerCase()));

  /**
   * DEBOUNCING IS A DIFFERENT QUESTION and it is worth separating.
   *
   * Filtering an in-memory array needs no debounce - it is instant. Debouncing
   * exists to avoid firing a NETWORK REQUEST per keystroke. Here it stands in
   * for what Phase 20 does for real against /api/v1/tasks?search=.
   */
  const debouncedQuery = useDebounce(query, 400);

  return (
    <DemoCard
      title="3. You might not need an effect"
      question="Filtering a list. Where should the filtered result live?"
    >
      <Stack spacing={2}>
        <input
          aria-label="Filter tasks"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Type to filter..."
        />
        <Typography variant="caption" color="text.secondary">
          Live: &quot;{query}&quot; | Debounced (400ms, this is what would hit the API):{' '}
          <strong>&quot;{debouncedQuery}&quot;</strong>
        </Typography>
        <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2 }}>
          {results.map((task) => (
            <Typography component="li" variant="body2" key={task}>
              {task}
            </Typography>
          ))}
        </Stack>
        {results.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            No matches.
          </Typography>
        )}
      </Stack>
      <Note>
        <strong>When you DO need useEffect:</strong> synchronising with something
        outside React - the DOM, a subscription, a timer, localStorage, an SSE stream.
        If the &quot;external system&quot; is really just other React state, you almost
        certainly do not need it.
      </Note>
    </DemoCard>
  );
}

/* ===========================================================================
 * 4. useMemo / useCallback / React.memo - all three, and when they do nothing
 * ======================================================================== */

/**
 * A memoised child. `React.memo` skips re-rendering when props are SHALLOWLY
 * EQUAL to last time.
 *
 * THE CATCH THAT MAKES memo USELESS IN PRACTICE: if a parent passes an inline
 * arrow function, that prop is a new reference every render, shallow equality
 * fails, and the memo never once hits. You pay the comparison cost and get
 * nothing. That is why `React.memo` and `useCallback` are almost always used
 * together - either both or neither.
 *
 * ANGULAR BRIDGE: `React.memo` is `ChangeDetectionStrategy.OnPush`. Same idea -
 * skip work when inputs have not changed - and the same trap, since OnPush also
 * compares references and is defeated by a new object literal in the template.
 */
const ExpensiveChild = memo(function ExpensiveChild({
  label,
  onPing,
}: {
  label: string;
  onPing: () => void;
}) {
  /**
   * A RENDER COUNTER - and note it needs TWO lint disables.
   *
   * Mutating and reading a ref during render is impure, and `react-hooks/refs`
   * says so. It is tolerated here for the same reason a `console.log` in render
   * is tolerated: this is an instrument, not product code. It exists to make an
   * invisible thing visible.
   *
   * THE PROPER TOOL is the React DevTools Profiler, which counts renders
   * without touching your components at all. Use that in real work; this is
   * inline so the lesson is visible without opening another panel.
   *
   * WHY NOT useState for the counter: setState during render is an infinite
   * loop. There is no pure way to count your own renders, which is itself the
   * point - React does not want you to know or care.
   */
  const renders = useRef(0);
  // eslint-disable-next-line react-hooks/refs -- instrumentation only; the Profiler is the real tool
  renders.current += 1;

  return (
    <Stack spacing={1} sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 1, flex: 1 }}>
      <Typography variant="caption">{label}</Typography>
      {/* eslint-disable-next-line react-hooks/refs -- instrumentation only */}
      <Typography variant="h6">rendered {renders.current}x</Typography>
      <Button size="small" onClick={onPing}>
        Ping
      </Button>
    </Stack>
  );
});

function MemoDemo() {
  const [unrelated, setUnrelated] = useState(0);
  const [pings, setPings] = useState(0);

  // NEW FUNCTION EVERY RENDER -> memo defeated -> child always re-renders.
  const unstableOnPing = () => setPings((n) => n + 1);

  // STABLE IDENTITY -> memo works -> child skips re-rendering.
  const stableOnPing = useCallback(() => setPings((n) => n + 1), []);

  /**
   * useMemo for an ACTUALLY expensive computation.
   *
   * Two million iterations is genuinely slow - the sort of work useMemo exists
   * for. Without it, this would re-run on every unrelated state change and
   * visibly stutter the button.
   *
   * BE HONEST ABOUT THE THRESHOLD: memoising `a + b` or `items.filter(...)` on
   * a short array is NEGATIVE value. useMemo itself costs a dependency-array
   * comparison and permanent memory for the cached value. It pays only when the
   * computation is materially more expensive than that bookkeeping, or when the
   * REFERENCE must stay stable for a memoised child or an effect dependency.
   *
   * Those are two distinct reasons - cost and identity - and conflating them is
   * why so much code is uselessly memoised.
   */
  const expensiveValue = useMemo(() => {
    let total = 0;
    for (let i = 0; i < 2_000_000; i += 1) total += i % 7;
    return total;
  }, []);

  return (
    <DemoCard
      title="4. memo, useCallback, useMemo"
      question="Press 'unrelated render'. Why does only one child re-render?"
    >
      <Stack spacing={2}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Button variant="contained" onClick={() => setUnrelated((n) => n + 1)}>
            Unrelated render ({unrelated})
          </Button>
          <Typography variant="caption">pings: {pings}</Typography>
          <Typography variant="caption" color="text.secondary">
            memoised value: {expensiveValue}
          </Typography>
        </Stack>
        <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
          <Bad>
            <ExpensiveChild label="memo + INLINE arrow" onPing={unstableOnPing} />
          </Bad>
          <Good>
            <ExpensiveChild label="memo + useCallback" onPing={stableOnPing} />
          </Good>
        </Stack>
      </Stack>
      <Note>
        <strong>Do not memoise by reflex.</strong> Every useMemo/useCallback costs a
        comparison, retained memory and a dependency array that can go stale. Reach for
        them when profiling shows a real cost, or when a reference must stay stable for a
        memoised child or an effect. React Compiler is designed to make most of this
        manual work unnecessary - but knowing WHY it exists is still what gets asked.
      </Note>
    </DemoCard>
  );
}

/* ===========================================================================
 * 5. useRef - previous values and DOM access
 * ======================================================================== */

function RefDemo() {
  const [status, setStatus] = useState<'todo' | 'in_progress' | 'done'>('todo');
  const previousStatus = usePrevious(status);

  /**
   * A DOM REF - the other job refs do.
   *
   * `useRef<HTMLInputElement>(null)` then `ref={inputRef}` gives React a place
   * to store the real DOM node after commit. This is the escape hatch for the
   * things React has no declarative API for: focus, text selection, media
   * playback, measuring an element, integrating a non-React library.
   *
   * `.current` is `null` until after the first commit, which is exactly why the
   * type includes null and why `?.` is required rather than decorative.
   *
   * ANGULAR BRIDGE: this is `@ViewChild` + `ElementRef`, and the same warning
   * applies in both frameworks - reach for it only when there is no declarative
   * alternative. Managing DOM by hand alongside a framework that also manages
   * it is how you get fights over the same node.
   */
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <DemoCard title="5. useRef" question="Track a previous value, and touch the DOM directly.">
      <Stack spacing={2}>
        <Box>
          <Typography>
            Status: <strong>{status}</strong>
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Previous: <strong>{previousStatus ?? '(none - first render)'}</strong>
            {previousStatus !== undefined &&
              previousStatus !== status &&
              ` - changed from ${previousStatus}`}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
          {(['todo', 'in_progress', 'done'] as const).map((value) => (
            <Button
              key={value}
              size="small"
              variant={status === value ? 'contained' : 'outlined'}
              onClick={() => setStatus(value)}
            >
              {value}
            </Button>
          ))}
        </Stack>

        <Divider />

        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <input ref={inputRef} aria-label="Focus target" placeholder="Focus me via ref" />
          <Button size="small" onClick={() => inputRef.current?.focus()}>
            Focus
          </Button>
        </Stack>
      </Stack>
      <Note>
        <strong>State vs ref:</strong> if changing it should update the screen, it is
        state. If it should not, it is a ref. Mutating <code>.current</code> never
        triggers a render - which is the feature, and the trap if you expected one.
      </Note>
    </DemoCard>
  );
}

/* ======================================================================== */

function DemoCard({
  title,
  question,
  children,
}: {
  title: string;
  question: string;
  children: React.ReactNode;
}) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" component="h3" gutterBottom>
          {title}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          {question}
        </Typography>
        <Divider sx={{ mb: 2 }} />
        {children}
      </CardContent>
    </Card>
  );
}

function Bad({ children }: { children: React.ReactNode }) {
  return (
    <Stack
      spacing={1}
      sx={{ p: 2, border: 1, borderColor: 'error.light', borderRadius: 1, flex: 1, minWidth: 220 }}
    >
      <Typography variant="overline" color="error.main">
        Broken
      </Typography>
      {children}
    </Stack>
  );
}

function Good({ children }: { children: React.ReactNode }) {
  return (
    <Stack
      spacing={1}
      sx={{ p: 2, border: 1, borderColor: 'success.light', borderRadius: 1, flex: 1, minWidth: 220 }}
    >
      <Typography variant="overline" color="success.main">
        Correct
      </Typography>
      {children}
    </Stack>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <Alert severity="info" sx={{ mt: 2 }}>
      <Typography variant="body2">{children}</Typography>
    </Alert>
  );
}

export function HooksLabPage() {
  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4" component="h2" gutterBottom>
          Phase 3 - hooks lab
        </Typography>
        <Typography color="text.secondary">
          useEffect failure modes, memoisation, and refs. Open the console and React
          DevTools Profiler while you click.
        </Typography>
      </Box>

      <StaleClosureDemo />
      <InfiniteLoopDemo />
      <UnnecessaryEffectDemo />
      <MemoDemo />
      <RefDemo />
    </Stack>
  );
}
