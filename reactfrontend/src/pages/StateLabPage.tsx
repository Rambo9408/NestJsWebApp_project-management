import { useEffect, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Divider, Stack, Typography } from '@mui/material';

/**
 * =============================================================================
 * PHASE 2 - THE STATE LAB
 * =============================================================================
 * Five state bugs, each rendered BAD and GOOD side by side so you can click
 * them and watch the difference. Reading about the functional-update form
 * convinces nobody; pressing a button that increments by 1 when it should
 * increment by 3 convinces everybody.
 *
 * Route: /lab/state. It is learning material, not product - delete it whenever
 * it stops being useful. Everything else built in this phase is real.
 * =============================================================================
 */

/* ===========================================================================
 * 1. FUNCTIONAL UPDATES - "why did my counter only go up by one?"
 * ======================================================================== */

function BatchingDemo() {
  const [broken, setBroken] = useState(0);
  const [fixed, setFixed] = useState(0);

  return (
    <DemoCard
      title="1. Functional updates and batching"
      question="Both buttons call their setter three times. Why do they disagree?"
    >
      <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
        <Bad>
          <Typography variant="h4">{broken}</Typography>
          <Button
            variant="outlined"
            color="error"
            onClick={() => {
              /**
               * THREE CALLS, ONE INCREMENT.
               *
               * `broken` is a CONST captured by this render's closure. If it
               * was 0 when this render happened, all three lines read 0:
               *
               *     setBroken(0 + 1);   // queue: set to 1
               *     setBroken(0 + 1);   // queue: set to 1
               *     setBroken(0 + 1);   // queue: set to 1
               *
               * React BATCHES these into one re-render and the last write
               * wins. Result: 1.
               *
               * The mental model that causes this bug is thinking `broken` is
               * a variable that changes. It is not. It is a snapshot of the
               * value for THIS render, and it never changes for as long as
               * this render's closure exists. A new value means a new render
               * with a new closure.
               */
              setBroken(broken + 1);
              setBroken(broken + 1);
              setBroken(broken + 1);
            }}
          >
            +3 (adds 1)
          </Button>
        </Bad>

        <Good>
          <Typography variant="h4">{fixed}</Typography>
          <Button
            variant="contained"
            color="success"
            onClick={() => {
              /**
               * THE FUNCTIONAL UPDATE FORM. Each updater receives the latest
               * QUEUED value rather than the render's snapshot:
               *
               *     setFixed(n => n + 1);   // queue: (0) => 1
               *     setFixed(n => n + 1);   // queue: (1) => 2
               *     setFixed(n => n + 1);   // queue: (2) => 3
               *
               * React applies the queue in order at the next render. Result: 3.
               *
               * THE RULE: if the next value DEPENDS ON the previous one, use
               * the function form. If it does not (`setName(inputValue)`), the
               * direct form is fine and clearer.
               *
               * This is also the fix for a whole family of stale-closure bugs
               * in effects, timers and event handlers - which is why it is
               * worth internalising now rather than in Phase 11.
               */
              setFixed((n) => n + 1);
              setFixed((n) => n + 1);
              setFixed((n) => n + 1);
            }}
          >
            +3 (adds 3)
          </Button>
        </Good>
      </Stack>

      <Note>
        <strong>Batching:</strong> React groups state updates and re-renders once.
        Since React 18 that happens everywhere - promises, timeouts, native event
        handlers. In React 17 it only applied inside React event handlers, so two
        setStates in a <code>.then()</code> caused two renders. A lot of advice online
        predates that change.
      </Note>
    </DemoCard>
  );
}

/* ===========================================================================
 * 2. OBJECT STATE - "I changed it but nothing happened"
 * ======================================================================== */

interface ProfileForm {
  name: string;
  email: string;
}

function ObjectStateDemo() {
  const [broken, setBroken] = useState<ProfileForm>({ name: '', email: '' });
  const [fixed, setFixed] = useState<ProfileForm>({ name: '', email: '' });

  return (
    <DemoCard
      title="2. Object state and immutability"
      question="Type in the broken field. Why does nothing appear?"
    >
      <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
        <Bad>
          <input
            aria-label="Broken name"
            value={broken.name}
            onChange={(event) => {
              /**
               * MUTATE-THEN-SET. The single most common React state bug, and
               * the one that most confuses developers arriving from Angular.
               *
               * The object IS updated - `broken.name` really does change. But
               * React decides whether to re-render by comparing the OLD and
               * NEW state with Object.is. We handed back THE SAME OBJECT
               * REFERENCE, so the comparison says "unchanged" and no render is
               * scheduled. The UI shows the old value while the data holds the
               * new one.
               *
               * ANGULAR BRIDGE: this is exactly the habit Angular allows.
               * Zone.js patches async APIs and re-runs change detection, which
               * then dirty-checks VALUES - so mutating an object and letting
               * the template update is normal, idiomatic Angular.
               *
               * React has no Zone.js and does no dirty checking. It compares
               * REFERENCES. Immutability is not a style preference here, it is
               * the mechanism by which rendering is triggered at all.
               *
               * (This input is also now effectively read-only, which is why it
               * appears frozen rather than merely stale.)
               *
               * NOTE THE DISABLE BELOW. React ships an `immutability` lint rule
               * that catches this statically - it knows `broken` came from
               * useState and that assigning to it is never correct. We have to
               * switch the rule OFF to write the bug at all, which is the
               * strongest possible evidence that it is a bug worth knowing.
               */
              // eslint-disable-next-line react-hooks/immutability -- deliberately demonstrating the mutation bug
              broken.name = event.target.value;
              setBroken(broken);
            }}
            placeholder="Frozen"
          />
          <Typography variant="caption">Rendered: {broken.name || '(empty)'}</Typography>
        </Bad>

        <Good>
          <input
            aria-label="Working name"
            value={fixed.name}
            onChange={(event) => {
              /**
               * A NEW OBJECT. The spread copies the existing fields, then
               * `name` overrides one of them. New reference -> Object.is says
               * changed -> React re-renders.
               *
               * WHY SPREAD THE REST AT ALL: `setFixed({ name })` would DELETE
               * `email`, because state is replaced wholesale, never merged.
               * That is a real difference from class components, where
               * `this.setState({name})` DID merge. Plenty of older tutorials
               * assume merging.
               *
               * NESTING IS THE CATCH. A spread is SHALLOW:
               *     setState({ ...state, user: { ...state.user, name } })
               * and it gets worse with depth. That verbosity is precisely the
               * problem Immer solves, and Redux Toolkit bundles Immer so
               * reducers can be written as if mutating. Phase 18.
               *
               * For a deeply nested update, that nesting is usually telling
               * you the state shape is wrong - flatter state is easier to
               * update AND easier to reason about.
               */
              setFixed({ ...fixed, name: event.target.value });
            }}
            placeholder="Type here"
          />
          <Typography variant="caption">Rendered: {fixed.name || '(empty)'}</Typography>
        </Good>
      </Stack>

      <Note>
        <strong>Controlled components:</strong> both inputs take <code>value</code> from
        state and update it in <code>onChange</code>, so React is the single source of
        truth. That is why breaking the state update freezes the field - the DOM is only
        ever showing what state says. Uncontrolled inputs (a ref, no <code>value</code>)
        are covered in Phase 6.
      </Note>
    </DemoCard>
  );
}

/* ===========================================================================
 * 3. ARRAY STATE
 * ======================================================================== */

function ArrayStateDemo() {
  const [broken, setBroken] = useState<string[]>([]);
  const [fixed, setFixed] = useState<string[]>([]);

  return (
    <DemoCard
      title="3. Array state"
      question="push() updates the array. Why does the list stay empty?"
    >
      <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
        <Bad>
          <Button
            variant="outlined"
            color="error"
            onClick={() => {
              /**
               * Same reference trap as the object case. `push` MUTATES and
               * returns the new LENGTH, not a new array - so React sees the
               * identical reference and does nothing.
               *
               * THE MUTATING ARRAY METHODS TO DISTRUST IN STATE:
               *   push, pop, shift, unshift, splice, sort, reverse
               *
               * `sort` and `reverse` are the sneaky ones: they read like they
               * return a sorted copy, and they sort IN PLACE. `[...items]
               * .sort()` is the safe form, and forgetting the spread silently
               * mutates props you were handed by a parent.
               *
               * NON-MUTATING EQUIVALENTS: map, filter, slice, concat, and the
               * modern toSorted / toReversed / toSpliced / with.
               */
              broken.push(`Item ${String(broken.length + 1)}`);
              setBroken(broken);
            }}
          >
            Add (push)
          </Button>
          <Typography variant="caption">Rendered: {broken.length} items</Typography>
        </Bad>

        <Good>
          <Button
            variant="contained"
            color="success"
            onClick={() => {
              // Functional update AND a new array: correct under rapid clicks
              // and correct with respect to reference identity.
              setFixed((items) => [...items, `Item ${String(items.length + 1)}`]);
            }}
          >
            Add (spread)
          </Button>
          <Typography variant="caption">Rendered: {fixed.length} items</Typography>
          <Stack component="ul" sx={{ m: 0, pl: 2 }}>
            {fixed.map((item) => (
              // The VALUE as key, viable only because these strings are unique
              // by construction. Real data uses a server id. Phase 4 explains
              // what breaks when keys are wrong.
              <Typography component="li" variant="caption" key={item}>
                {item}
              </Typography>
            ))}
          </Stack>
        </Good>
      </Stack>
    </DemoCard>
  );
}

/* ===========================================================================
 * 4. LAZY INITIALISATION
 * ======================================================================== */

// Module-scope counters so the demo can show how often each initialiser ran.
let eagerCalls = 0;
let lazyCalls = 0;

function expensiveInit(which: 'eager' | 'lazy'): number {
  if (which === 'eager') eagerCalls += 1;
  else lazyCalls += 1;
  // Stand-in for real work: parsing localStorage, building a lookup map,
  // hydrating a big default form object.
  let total = 0;
  for (let i = 0; i < 200_000; i += 1) total += i;
  return total;
}

function LazyInitDemo() {
  /**
   * EAGER - the bug.
   *
   * `expensiveInit('eager')` is a FUNCTION CALL, so JavaScript evaluates it
   * before `useState` is even entered. That happens on EVERY RENDER. React
   * throws the result away after the first one, but the work is already done.
   *
   * The cost is invisible in a component that renders twice and brutal in one
   * that renders on every keystroke.
   */
  const [eager] = useState(expensiveInit('eager'));

  /**
   * LAZY - pass the FUNCTION, do not call it.
   *
   * React invokes the initialiser only on the first render. Note the single
   * character of difference: `expensiveInit(...)` vs `() => expensiveInit(...)`.
   *
   * WHEN IT MATTERS: reading and parsing localStorage, building a Map from a
   * large array, generating defaults. When it does not: `useState(0)`,
   * `useState('')` - a literal costs nothing to evaluate, and wrapping it in
   * an arrow is noise.
   *
   * INTERVIEW: "what is lazy initial state and when do you need it?" - the
   * follow-up worth pre-empting is that the initialiser runs once per
   * COMPONENT INSTANCE, not once per application.
   */
  const [lazy] = useState(() => expensiveInit('lazy'));

  const [, forceRender] = useState(0);

  return (
    <DemoCard
      title="4. Lazy initial state"
      question="Press re-render. Which initialiser keeps running?"
    >
      <Stack spacing={1}>
        <Typography variant="body2" color="error.main">
          Eager <code>useState(expensiveInit())</code> - ran <strong>{eagerCalls}</strong> times
        </Typography>
        <Typography variant="body2" color="success.main">
          Lazy <code>useState(() =&gt; expensiveInit())</code> - ran <strong>{lazyCalls}</strong>{' '}
          times
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Both produced {eager === lazy ? 'the same value' : 'different values'}. Only the cost
          differs.
        </Typography>
        <Box>
          <Button variant="outlined" onClick={() => forceRender((n) => n + 1)}>
            Force re-render
          </Button>
        </Box>
      </Stack>

      <Note>
        Counts start at 2 in development - StrictMode renders each component twice on
        purpose to surface impure render logic. Yet another reason render must be pure.
      </Note>
    </DemoCard>
  );
}

/* ===========================================================================
 * 5. DERIVED STATE - the most common unnecessary useEffect
 * ======================================================================== */

function DerivedStateDemo() {
  const [first, setFirst] = useState('Ada');
  const [last, setLast] = useState('Lovelace');

  /**
   * THE ANTI-PATTERN: mirroring props/state into more state and syncing it
   * with an effect.
   *
   * What actually happens on every keystroke:
   *   1. setFirst -> render with the new first name and the STALE full name
   *   2. browser paints that inconsistent frame
   *   3. effect runs -> setFullName
   *   4. render again
   *   5. paint again
   *
   * Two renders and two paints for one keystroke, and between them the UI
   * displays a combination that never existed in the data. On a slow device
   * that flicker is visible.
   *
   * It is also a SECOND SOURCE OF TRUTH: `fullName` can be wrong, and now it
   * needs an effect to stop it being wrong.
   */
  const [fullName, setFullName] = useState(`${first} ${last}`);

  useEffect(() => {
    /*
     * The disable below is the lesson. React ships a rule specifically to stop
     * you writing this, and the rule's own message points at "You Might Not
     * Need an Effect". Having to switch off a lint rule to write the code is
     * the clearest signal available that the code is wrong.
     */
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberately demonstrating the anti-pattern
    setFullName(`${first} ${last}`);
  }, [first, last]);

  /**
   * THE FIX: just calculate it. One render, no effect, no extra state, and it
   * is impossible for this value to be stale because it is recomputed from the
   * current values every time.
   *
   * "But is recomputing on every render slow?" Almost never - it is string
   * concatenation. When it genuinely is expensive, `useMemo` is the answer,
   * and Phase 16 covers measuring before reaching for it. What is never the
   * answer is state plus an effect.
   *
   * THE DECISION RULE, worth memorising for interviews:
   *   Can I calculate it from existing props/state? -> calculate it
   *   Does it come from an external system?         -> effect (or RTK Query)
   *   Is it genuinely independent user input?       -> state
   */
  const derivedFullName = `${first} ${last}`;

  return (
    <DemoCard
      title="5. Derived state"
      question="Both show the same text. One costs twice the renders."
    >
      <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap' }}>
        <input aria-label="First name" value={first} onChange={(e) => setFirst(e.target.value)} />
        <input aria-label="Last name" value={last} onChange={(e) => setLast(e.target.value)} />
      </Stack>

      <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
        <Bad>
          <Typography variant="caption">useState + useEffect</Typography>
          <Typography>{fullName}</Typography>
        </Bad>
        <Good>
          <Typography variant="caption">Computed during render</Typography>
          <Typography>{derivedFullName}</Typography>
        </Good>
      </Stack>

      <Note>
        Open React DevTools Profiler and type one character. The effect version commits
        twice. This is the pattern behind{' '}
        <em>&quot;You Might Not Need an Effect&quot;</em> in the React docs, and it is the
        single most valuable useEffect lesson - covered properly in Phase 11.
      </Note>
    </DemoCard>
  );
}

/* ===========================================================================
 * Small presentational helpers for the lab itself.
 * They exist so each demo above reads as its lesson and nothing else.
 * ======================================================================== */

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
    <Stack spacing={1} sx={{ p: 2, border: 1, borderColor: 'error.light', borderRadius: 1, flex: 1, minWidth: 220 }}>
      <Typography variant="overline" color="error.main">
        Broken
      </Typography>
      {children}
    </Stack>
  );
}

function Good({ children }: { children: React.ReactNode }) {
  return (
    <Stack spacing={1} sx={{ p: 2, border: 1, borderColor: 'success.light', borderRadius: 1, flex: 1, minWidth: 220 }}>
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

/* ======================================================================== */

export function StateLabPage() {
  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4" component="h2" gutterBottom>
          Phase 2 - state lab
        </Typography>
        <Typography color="text.secondary">
          Five state bugs, each shown broken and fixed. Click everything.
        </Typography>
      </Box>

      <BatchingDemo />
      <ObjectStateDemo />
      <ArrayStateDemo />
      <LazyInitDemo />
      <DerivedStateDemo />
    </Stack>
  );
}
