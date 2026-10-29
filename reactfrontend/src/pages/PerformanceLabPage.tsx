import { useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Divider, Stack, Typography } from '@mui/material';
import { VirtualList } from '@/components/tables/VirtualList';

/**
 * =============================================================================
 * PHASE 16 - THE PERFORMANCE LAB
 * =============================================================================
 * Route: /lab/performance. Two demos with numbers you can read off the screen,
 * because "it feels faster" is not a measurement.
 * =============================================================================
 */

const ROW_COUNT = 10_000;

interface Row {
  id: number;
  label: string;
}

/**
 * Built ONCE at module scope, not per render. 10,000 objects rebuilt on every
 * render would itself be the performance problem the page is demonstrating -
 * and it is a genuinely common way demos mislead.
 */
const ROWS: Row[] = Array.from({ length: ROW_COUNT }, (_, index) => ({
  id: index,
  label: `Row ${String(index + 1)} - some representative text content`,
}));

function VirtualisationDemo() {
  const [mode, setMode] = useState<'virtual' | 'naive'>('virtual');
  const [lastRenderMs, setLastRenderMs] = useState<number | null>(null);
  const start = useRef(0);

  /**
   * A CRUDE BUT HONEST MEASUREMENT: stamp the clock before the state change and
   * read it after paint.
   *
   * The React DevTools Profiler is the real tool and gives per-component commit
   * times. This exists so the difference is visible without opening another
   * panel - and because a number on the page is more persuasive than a
   * flamegraph nobody opens.
   */
  const switchTo = (next: 'virtual' | 'naive') => {
    start.current = performance.now();
    setMode(next);
    /**
     * `requestAnimationFrame` fires BEFORE the next paint; the nested one fires
     * after it. That double-rAF is the standard trick for "measure until the
     * user could actually see it" - a single rAF measures render, not paint.
     */
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setLastRenderMs(performance.now() - start.current);
      });
    });
  };

  return (
    <DemoCard
      title={`1. Virtualization - ${ROW_COUNT.toLocaleString()} rows`}
      question="Switch to 'naive' and watch the number. Then try scrolling it."
    >
      <Stack spacing={2}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Button
            variant={mode === 'virtual' ? 'contained' : 'outlined'}
            size="small"
            onClick={() => {
              switchTo('virtual');
            }}
          >
            Virtualized (~20 nodes)
          </Button>
          <Button
            variant={mode === 'naive' ? 'contained' : 'outlined'}
            color="error"
            size="small"
            onClick={() => {
              switchTo('naive');
            }}
          >
            Naive ({ROW_COUNT.toLocaleString()} nodes)
          </Button>
          {lastRenderMs !== null && (
            <Typography variant="body2">
              last switch: <strong>{lastRenderMs.toFixed(0)} ms</strong> to paint
            </Typography>
          )}
        </Stack>

        {mode === 'virtual' ? (
          <VirtualList
            label="Virtualized rows"
            items={ROWS}
            rowHeight={40}
            height={320}
            renderRow={(row) => <Typography variant="body2">{row.label}</Typography>}
          />
        ) : (
          <Box
            sx={{ height: 320, overflowY: 'auto', border: 1, borderColor: 'error.light', borderRadius: 1 }}
          >
            {/*
              EVERY row in the DOM. On a mid-range machine this is a visible
              freeze; on a phone it is seconds. Open DevTools > Elements and
              watch the node count.
            */}
            {ROWS.map((row) => (
              <Box key={row.id} sx={{ height: 40, display: 'flex', alignItems: 'center', px: 2 }}>
                <Typography variant="body2">{row.label}</Typography>
              </Box>
            ))}
          </Box>
        )}
      </Stack>

      <Note>
        <strong>Paginate before you virtualize.</strong> Our task and project lists are
        paginated server-side at 20 rows, so virtualizing them would be pure overhead.
        Windowing is for lists that must genuinely scroll as one - a live log, an
        infinite feed, a picker over every user.
        <br />
        <br />
        And it has real costs: <strong>Ctrl+F stops finding off-screen rows</strong>,
        screen readers need explicit <code>aria-setsize</code>/<code>aria-posinset</code>,
        and printing captures only the visible window.
      </Note>
    </DemoCard>
  );
}

/* ===========================================================================
 * 2. Where memoisation actually pays - and where it does not
 * ======================================================================== */

function ExpensiveComputationDemo() {
  const [input, setInput] = useState('');
  const [multiplier, setMultiplier] = useState(1);

  /**
   * GENUINELY EXPENSIVE, and memoised on the value it depends on.
   *
   * Without the memo, typing in the unrelated text box would re-run two million
   * iterations on every keystroke - the input would visibly lag. WITH it, the
   * work happens only when `multiplier` changes.
   *
   * THE POINT OF SHOWING BOTH INPUTS TOGETHER: `useMemo` is not about making
   * the expensive thing fast. It is about NOT REDOING it when something
   * unrelated changed. That distinction is what people miss when they memoise
   * `a + b`.
   */
  const expensive = useMemo(() => {
    let total = 0;
    for (let i = 0; i < 2_000_000; i += 1) total += (i % 7) * multiplier;
    return total;
  }, [multiplier]);

  return (
    <DemoCard
      title="2. useMemo where it pays"
      question="Type in the text box. The 2M-iteration loop does not re-run."
    >
      <Stack spacing={2}>
        <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', gap: 2 }}>
          <input
            aria-label="Unrelated input"
            placeholder="type freely - no lag"
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
            }}
          />
          <Button
            size="small"
            variant="outlined"
            onClick={() => {
              setMultiplier((m) => m + 1);
            }}
          >
            Change the dependency ({multiplier})
          </Button>
        </Stack>
        <Typography variant="body2" color="text.secondary">
          result: {expensive.toLocaleString()}
        </Typography>
      </Stack>

      <Note>
        <strong>Do not memoise by reflex.</strong> Every <code>useMemo</code> costs a
        dependency comparison and retained memory. It pays when the computation is
        materially more expensive than that bookkeeping - or when the REFERENCE must
        stay stable for a memoised child, an effect dependency or a context value.
        Those are two different reasons, and conflating them is why so much code is
        uselessly memoised.
        <br />
        <br />
        <strong>Measure first.</strong> React DevTools Profiler → record → interact →
        read the commit times and the &quot;why did this render?&quot; panel. Optimising
        without that is guessing.
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

function Note({ children }: { children: React.ReactNode }) {
  return (
    <Alert severity="info" sx={{ mt: 2 }}>
      <Typography variant="body2">{children}</Typography>
    </Alert>
  );
}

export function PerformanceLabPage() {
  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4" component="h2" gutterBottom>
          Phase 16 - performance lab
        </Typography>
        <Typography color="text.secondary">
          Open the React DevTools Profiler alongside these. A number you measured beats a
          technique you remembered.
        </Typography>
      </Box>

      <VirtualisationDemo />
      <ExpensiveComputationDemo />
    </Stack>
  );
}
