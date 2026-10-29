import { useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Stack, Typography } from '@mui/material';
import { HEALTH_URL } from '@/config/env';

/**
 * =============================================================================
 * PHASE 1 PROOF-OF-WIRING
 * =============================================================================
 * This page exists to answer one question honestly: does the React dev server
 * actually reach the NestJS backend? A Phase 1 that ends with a styled page and
 * no proven connection has not integrated anything.
 *
 * IT WILL BE DELETED IN PHASE 9. Every line of data-fetching here is replaced
 * by roughly three lines of RTK Query. Keep it until then as the reference
 * implementation of "what RTK Query is doing for you", because the fastest way
 * to understand a data-fetching library is to have written the loading flag,
 * the error branch and the cancellation by hand exactly once.
 * =============================================================================
 */

/**
 * A DISCRIMINATED UNION for request state - not four independent booleans.
 *
 * THE PROBLEM WITH BOOLEANS:
 *   const [isLoading, setLoading] = useState(false);
 *   const [error, setError] = useState<Error|null>(null);
 *   const [data, setData] = useState<Data|null>(null);
 *
 * That models 2 x 2 x 2 = 8 states, and only 4 are real. Nothing stops
 * `isLoading && error && data`, so every consumer must defend against
 * combinations that should be unrepresentable - and the classic bug (a spinner
 * rendering forever next to an error message) lives in exactly that gap.
 *
 * A union makes illegal states UNREPRESENTABLE. `status` is the discriminant:
 * TypeScript narrows on it, so `state.data` only type-checks inside the
 * `success` branch. The compiler now enforces that every render path handles
 * loading, error and empty - which is Part 28's requirement turned into a
 * compile-time guarantee rather than a code-review convention.
 *
 * INTERVIEW: "how do you model async state?" - this is the answer, and it
 * generalises far beyond fetching.
 */
type HealthState =
  | { status: 'loading' }
  | { status: 'success'; data: unknown }
  | { status: 'error'; message: string };

export function ConnectivityPage() {
  /**
   * INITIAL STATE IS 'loading', NOT 'idle'.
   *
   * The obvious first draft has an `idle` state and then calls
   * `setState({status:'loading'})` at the top of the effect. That is wrong in
   * a way that is worth understanding, and the `react-hooks/set-state-in-effect`
   * lint rule flags it:
   *
   *   React renders (idle) -> paints -> effect runs -> setState(loading)
   *   -> React renders AGAIN -> paints
   *
   * Two render+paint cycles before a single byte has been requested, and the
   * user can actually see the `idle` frame. The state was never really idle -
   * this component fetches immediately on mount, so `loading` IS its initial
   * condition. Encoding that in `useState` removes both the extra render and
   * an entire unreachable branch from the union.
   *
   * THE GENERAL RULE: if an effect's first act is to set state unconditionally,
   * that state usually belongs in the initial value instead.
   */
  const [state, setState] = useState<HealthState>({ status: 'loading' });

  /**
   * A counter used purely to re-trigger the effect on "Retry".
   *
   * WHY NOT just call the fetch function from onClick? Because then the fetch
   * logic lives in two places and can drift. Incrementing a value the effect
   * depends on means there is ONE code path, and it is the one the effect
   * already manages cleanup for.
   */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    /**
     * =======================================================================
     * THE RACE CONDITION, and why cleanup is not optional
     * =======================================================================
     * Click Retry three times quickly and three requests are in flight. They
     * can resolve IN ANY ORDER. Without cancellation, a slow first response
     * can land after a fast third one and overwrite fresh state with stale
     * state - the UI shows an answer to a question nobody asked last.
     *
     * This is THE most common useEffect data-fetching bug, and it is invisible
     * on a fast local network, which is why it reaches production.
     *
     * AbortController fixes it properly: the cleanup function runs before the
     * effect re-runs (and on unmount), aborting the previous request so its
     * `.then` never resolves.
     *
     * ANGULAR BRIDGE: this is exactly what `switchMap` does in an RxJS
     * pipeline - cancel the in-flight inner observable when a new value
     * arrives. React has no built-in operator for it, so the pattern is manual.
     * Recognising "this needs switchMap semantics" is your Angular experience
     * transferring directly.
     * =======================================================================
     */
    const controller = new AbortController();

    /**
     * NOTE THE URL: `HEALTH_URL` is '/health/live', NOT '/api/v1/health/live'.
     * The backend deliberately excludes health probes from the global prefix
     * and from versioning so infrastructure can probe a path that never
     * changes. Our Vite proxy only forwards '/api', so this request would 404
     * against the dev server - which is why vite.config.ts needs the health
     * path proxied too. See the proxy config.
     */
    fetch(HEALTH_URL, { signal: controller.signal })
      .then((response): Promise<unknown> => {
        if (!response.ok) throw new Error(`Backend returned ${response.status}`);
        /**
         * THE EXPLICIT `Promise<unknown>` RETURN TYPE IS NOT DECORATION.
         * `response.json()` is typed `Promise<any>` by the DOM lib, and `any`
         * propagates - without this annotation the parsed body would flow into
         * state as `any` and every downstream check would quietly stop
         * happening. Our `no-unsafe-return` lint rule catches exactly that.
         *
         * `unknown` is the honest type: we genuinely do not know the shape
         * until something validates it. That is why the state union stores
         * `data: unknown` and the render only stringifies it.
         */
        return response.json();
      })
      .then((data: unknown) => setState({ status: 'success', data }))
      .catch((error: unknown) => {
        /**
         * An aborted fetch rejects with an AbortError. That is NOT a failure -
         * it is us cancelling on purpose. Rendering it as an error would show
         * a scary message every time the user navigates away mid-request.
         * Swallowing precisely this one error is correct; swallowing all of
         * them is how bugs disappear.
         */
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      });

    return () => controller.abort();
    /**
     * THE DEPENDENCY ARRAY. `[attempt]` means: run on mount, and re-run
     * whenever `attempt` changes. Not "run once" - that is the mental model
     * that causes stale-closure bugs, and we take it apart properly in the
     * useEffect phase.
     *
     * Leaving the array off entirely would run the effect after EVERY render;
     * since the effect calls setState, that render would trigger the effect
     * again - an infinite loop. That is the #1 useEffect failure mode.
     */
  }, [attempt]);

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4" component="h2" gutterBottom>
          Phase 1 - stack connectivity
        </Typography>
        <Typography color="text.secondary">
          React (Vite, :5173) proxying to NestJS (:3000). If this reads healthy, the
          full-stack wiring is real.
        </Typography>
      </Box>

      {/*
        EVERY BRANCH IS HANDLED - loading, error and success. The `switch` on
        the discriminant means TypeScript would flag a missing case if we
        added one to the union. This is Part 28 enforced by the compiler.
      */}
      {state.status === 'loading' && (
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <CircularProgress size={20} />
          {/*
            `role="status"` announces the change to screen readers without
            stealing focus. A bare spinner is invisible to a screen-reader
            user, who experiences it as the page simply doing nothing.
          */}
          <Typography role="status">Checking backend...</Typography>
        </Stack>
      )}

      {state.status === 'error' && (
        <Alert
          severity="error"
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => {
                /**
                 * BOTH updates happen in an EVENT HANDLER, which is where
                 * React wants state changes - not inside an effect.
                 *
                 * They are BATCHED into a single re-render. Since React 18
                 * that is true everywhere (automatic batching), including
                 * inside promises and timeouts; in React 17 it only held for
                 * React event handlers, so two setStates in a `.then` caused
                 * two renders. Worth knowing because a lot of "why does this
                 * render twice" advice online predates the change.
                 *
                 * `setAttempt(n => n + 1)` is the FUNCTIONAL UPDATE form: it
                 * receives the latest value from React rather than closing
                 * over this render's copy. With a plain `setAttempt(attempt+1)`
                 * two rapid clicks could both read the same stale `attempt`
                 * and produce one increment instead of two.
                 */
                setState({ status: 'loading' });
                setAttempt((n) => n + 1);
              }}
            >
              Retry
            </Button>
          }
        >
          {/*
            An error state WITH A RECOVERY PATH. An error message the user can
            only stare at is half a feature - Part 28 lists "Retry" as its own
            required state for exactly this reason.
          */}
          Cannot reach the backend: {state.message}
          <br />
          Start it with <code>npm run dev:api</code> from the repo root.
        </Alert>
      )}

      {state.status === 'success' && (
        <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
          <Chip label="Backend reachable" color="success" />
          <Box
            component="pre"
            sx={{ p: 2, bgcolor: 'grey.100', borderRadius: 1, overflowX: 'auto', width: '100%' }}
          >
            {JSON.stringify(state.data, null, 2)}
          </Box>
        </Stack>
      )}
    </Stack>
  );
}
