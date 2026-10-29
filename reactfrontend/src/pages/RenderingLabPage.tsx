import { memo, useRef, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Divider, Stack, Typography } from '@mui/material';

/**
 * =============================================================================
 * PHASE 4 - THE RENDERING LAB
 * =============================================================================
 * Route: /lab/rendering.
 *
 * The single most valuable demo here is the FIRST one, because it shows a bug
 * that is invisible in the DOM, invisible in the React DevTools element tree,
 * and produces no error. State attaches itself to the wrong row and the user
 * submits the wrong data.
 *
 * Everybody has read "don't use index as key". Very few people have watched it
 * corrupt data in front of them, which is why it keeps happening.
 * =============================================================================
 */

/* ===========================================================================
 * 1. KEYS AND COMPONENT IDENTITY - the demo promised in Phase 2
 * ======================================================================== */

interface Row {
  id: string;
  label: string;
}

const INITIAL_ROWS: Row[] = [
  { id: 'a', label: 'Ada' },
  { id: 'b', label: 'Grace' },
  { id: 'c', label: 'Katherine' },
];

/**
 * A child with its OWN internal state that the parent knows nothing about.
 *
 * THIS IS THE CRUX. If children were stateless, key choice would only affect
 * performance. The moment a child holds state - an uncontrolled input, a
 * checkbox, an open/closed toggle, focus, scroll position - the key decides
 * WHICH child that state belongs to.
 *
 * An uncontrolled `<input>` is used deliberately: its value lives in the DOM,
 * so it is the purest demonstration that React is REUSING A DOM NODE rather
 * than re-creating it.
 */
function RowWithState({ label }: { label: string }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Typography sx={{ minWidth: 90 }}>{label}</Typography>
      <input aria-label={`Note for ${label}`} placeholder="type a note..." />
    </Stack>
  );
}

function KeysDemo() {
  const [indexRows, setIndexRows] = useState(INITIAL_ROWS);
  const [idRows, setIdRows] = useState(INITIAL_ROWS);

  const prependIndex = () =>
    setIndexRows((rows) => [{ id: crypto.randomUUID(), label: 'NEW' }, ...rows]);
  const prependId = () => setIdRows((rows) => [{ id: crypto.randomUUID(), label: 'NEW' }, ...rows]);

  return (
    <DemoCard
      title="1. Keys and component identity"
      question="Type a note in EVERY row on both sides, then press 'Add to top'. Watch where the notes go."
    >
      <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
        <Bad>
          <Typography variant="caption">key={'{index}'}</Typography>
          <Button size="small" variant="outlined" color="error" onClick={prependIndex}>
            Add to top
          </Button>
          <Stack spacing={1}>
            {indexRows.map((row, index) => (
              /**
               * THE BUG.
               *
               * React uses the key to answer one question: "is this the SAME
               * component as last render, or a different one?"
               *
               * Prepending a row shifts every index by one. The element that
               * was key=0 is now key=1. So React concludes: "component 0 still
               * exists, its label prop just changed from Ada to NEW". It
               * REUSES the existing DOM node and only patches the text.
               *
               * The input inside that node is never re-created, so the note you
               * typed for Ada is now sitting next to NEW. Your data moved rows.
               *
               * NOTHING WARNS YOU. The key is present and unique, so React is
               * satisfied. The DOM looks right. Only the state is wrong.
               *
               * IN THIS PROJECT the same bug would mean a checkbox selecting
               * the wrong task, or an inline edit saving to the wrong id.
               */
              <RowWithState key={index} label={row.label} />
            ))}
          </Stack>
        </Bad>

        <Good>
          <Typography variant="caption">key={'{row.id}'}</Typography>
          <Button size="small" variant="contained" color="success" onClick={prependId}>
            Add to top
          </Button>
          <Stack spacing={1}>
            {idRows.map((row) => (
              /**
               * THE FIX, and the reason it works.
               *
               * The key is tied to the DATA, not to the position. Ada's key is
               * 'a' whether she is first or fourth, so React matches her
               * element to the same component instance and MOVES the existing
               * DOM node instead of re-labelling a different one.
               *
               * The new row has a key React has never seen, so it MOUNTS a
               * fresh component - with a fresh, empty input.
               */
              <RowWithState key={row.id} label={row.label} />
            ))}
          </Stack>
        </Good>
      </Stack>

      <Note>
        <strong>A key is an identity, not a number.</strong> It is scoped to its
        siblings, so it need only be unique within the list. Index keys are safe when a
        list is static - never reordered, filtered or inserted into - AND the children
        hold no state. Break either condition and you get this.
        <br />
        <br />
        <strong>The other use of keys:</strong> changing a key deliberately FORCES a
        remount. <code>&lt;Form key={'{userId}'} /&gt;</code> resets every field when the
        user switches - far cleaner than an effect that clears them one by one.
      </Note>
    </DemoCard>
  );
}

/* ===========================================================================
 * 2. WHAT ACTUALLY RE-RENDERS
 * ======================================================================== */

/**
 * Render counters via refs, not module variables.
 *
 * A module-level `let` would be shared by every INSTANCE of the component - the
 * Phase 3 point about why refs exist - and React's lint rules reject
 * reassigning module state from a component outright, because a render that
 * gets discarded must not leave a mutation behind.
 *
 * Refs are per-instance and survive renders. Reading one during render is still
 * impure, hence the disables: this is instrumentation, and the React DevTools
 * Profiler is the real tool.
 */
function useRenderCount(): number {
  const count = useRef(0);
  // eslint-disable-next-line react-hooks/refs -- instrumentation only
  count.current += 1;
  // eslint-disable-next-line react-hooks/refs -- instrumentation only
  return count.current;
}

function PlainChild() {
  const renders = useRenderCount();
  return <Typography variant="body2">Plain child - rendered {renders}x</Typography>;
}

const MemoChild = memo(function MemoChild() {
  const renders = useRenderCount();
  return <Typography variant="body2">memo() child - rendered {renders}x</Typography>;
});

function RenderPropagationDemo() {
  const [count, setCount] = useState(0);

  return (
    <DemoCard
      title="2. What re-renders when state changes"
      question="Neither child uses `count`. Why does one still re-render?"
    >
      <Stack spacing={2}>
        <Button variant="contained" onClick={() => setCount((n) => n + 1)}>
          Re-render parent ({count})
        </Button>

        <Stack spacing={1} sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
          <PlainChild />
          <MemoChild />
          {/*
            THE THIRD OPTION, and the one most people never learn:
            `children` passed from ABOVE.

            This element was created in THIS component's render, so it is not a
            true demonstration of the pattern - but the pattern itself is worth
            naming, because it beats memo and needs no comparison at all:

                function Parent({ children }) {
                  const [count, setCount] = useState(0);
                  return <div>{children}</div>;   // children never re-render
                }

            React does not re-render `children` when Parent's state changes,
            because that element object was created by Parent's PARENT and its
            reference is unchanged. Restructuring to lift expensive subtrees
            into `children` is free optimisation - no memo, no useCallback, no
            dependency arrays to keep correct.

            INTERVIEW: "how do you stop a child re-rendering without memo?" -
            pass it as children from a component that does not own the state.
          */}
        </Stack>
      </Stack>

      <Note>
        <strong>The default is: when a component re-renders, all its descendants
        re-render.</strong> React does not check whether their props changed - it just
        re-runs them. That is usually FINE, because rendering is cheap; the expensive
        part is the DOM, and reconciliation skips DOM work when the output is unchanged.
        <br />
        <br />
        &quot;Re-render&quot; means React called your function and diffed the result. It
        does NOT mean the browser touched the DOM.
      </Note>
    </DemoCard>
  );
}

/* ===========================================================================
 * 3. RENDER PHASE vs COMMIT PHASE
 * ======================================================================== */

function PhasesDemo() {
  return (
    <DemoCard
      title="3. Render phase vs commit phase"
      question="Why does this distinction explain half of React's rules?"
    >
      <Stack spacing={2}>
        <Box component="pre" sx={{ m: 0, p: 2, bgcolor: 'action.hover', borderRadius: 1, overflowX: 'auto', fontSize: 13 }}>
{`setState(next)
   |
   v
[ SCHEDULE ]  React queues the update. Nothing has happened yet.
   |          Multiple setStates in one tick are BATCHED into one pass.
   v
[ RENDER PHASE ]  React calls your component function.
   |              You return an element tree (plain objects, not DOM).
   |              React diffs it against the previous tree - RECONCILIATION.
   |
   |    MUST BE PURE. Interruptible, may be discarded, may run twice
   |    (StrictMode). No DOM writes, no fetches, no ref mutation.
   v
[ COMMIT PHASE ]  React applies the minimum set of DOM operations.
   |              Refs are attached. Synchronous, never interrupted.
   |              useLayoutEffect runs HERE - before paint.
   v
[ BROWSER PAINT ]
   |
   v
[ useEffect ]  runs AFTER paint, so it never blocks pixels.`}
        </Box>
      </Stack>

      <Note>
        <strong>Everything follows from this split:</strong> render must be pure because
        it can be discarded or replayed - which is what makes StrictMode&apos;s
        double-render, concurrent rendering and Suspense possible. <code>useEffect</code>{' '}
        runs after paint so it cannot delay pixels; <code>useLayoutEffect</code> runs
        before paint, which is why it is right for measuring the DOM and wrong for
        everything else. An Error Boundary catches render-phase throws and nothing else -
        an event handler runs on a fresh stack React is not part of.
      </Note>
    </DemoCard>
  );
}

/* ===========================================================================
 * 4. RECONCILIATION - the two rules
 * ======================================================================== */

function ReconciliationDemo() {
  const [wrapped, setWrapped] = useState(false);

  return (
    <DemoCard
      title="4. Reconciliation and element type"
      question="Type a note, then toggle the wrapper. Why is it lost?"
    >
      <Stack spacing={2}>
        <Button variant="outlined" onClick={() => setWrapped((w) => !w)}>
          {wrapped ? 'Unwrap' : 'Wrap in a <div>'}
        </Button>

        {/*
          RULE 1: DIFFERENT ELEMENT TYPE -> DESTROY AND REBUILD.

          React compares the type at each position. `<div>` vs `<span>` -
          different type - so it does not attempt to diff the subtree at all. It
          unmounts everything below and mounts a fresh tree. All state inside is
          gone, including this uncontrolled input's value.

          THIS IS AN OPTIMISATION, not a limitation. A general tree-diff is
          O(n^3); React's heuristic is O(n). It buys that by assuming a changed
          type means a changed subtree - which is true in practice, essentially
          always.

          RULE 2 is the key rule from demo 1: at the SAME type, siblings are
          matched by KEY.

          THE PRACTICAL CONSEQUENCE, and it catches people out: conditionally
          wrapping a subtree destroys its state. If you must keep it, keep the
          structure identical and vary the styling instead.
        */}
        {wrapped ? (
          <div>
            <input aria-label="Note" placeholder="type, then toggle" />
          </div>
        ) : (
          <span>
            <input aria-label="Note" placeholder="type, then toggle" />
          </span>
        )}
      </Stack>

      <Note>
        <strong>Reconciliation in two rules:</strong> (1) different element type at the
        same position → tear down and rebuild; (2) same type → keep the instance, update
        the props, and match siblings by key. That is the entire algorithm at the level
        an interview cares about.
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
      sx={{ p: 2, border: 1, borderColor: 'error.light', borderRadius: 1, flex: 1, minWidth: 260 }}
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
      sx={{ p: 2, border: 1, borderColor: 'success.light', borderRadius: 1, flex: 1, minWidth: 260 }}
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

export function RenderingLabPage() {
  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4" component="h2" gutterBottom>
          Phase 4 - rendering lab
        </Typography>
        <Typography color="text.secondary">
          Keys, component identity, the render/commit split, and reconciliation.
        </Typography>
      </Box>

      <KeysDemo />
      <RenderPropagationDemo />
      <PhasesDemo />
      <ReconciliationDemo />
    </Stack>
  );
}
