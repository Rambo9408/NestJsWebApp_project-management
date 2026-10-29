import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { AppProviders } from '@/app/providers/AppProviders';
import { ErrorBoundary } from '@/components/feedback/ErrorBoundary';
import { router } from '@/app/router';
import '@/index.css';

/**
 * =============================================================================
 * THE ENTRY POINT
 * =============================================================================
 * ANGULAR BRIDGE: this is `main.ts` + `bootstrapApplication`. The mental model
 * is genuinely similar - find a host element, mount the app into it.
 * =============================================================================
 */

const container = document.getElementById('root');

/**
 * An EXPLICIT null check rather than the `!` non-null assertion that the Vite
 * template ships (`document.getElementById('root')!`).
 *
 * `!` tells the compiler "trust me" and produces `Cannot read properties of
 * null` if you were wrong - an error that points at React's internals rather
 * than at the actual cause, which is a missing div in index.html. Three lines
 * turn that into a message that says what to fix.
 *
 * The wider principle: `!` and `as` are the two ways to switch TypeScript off.
 * Every use should be a decision you could defend, not a reflex to make a red
 * squiggle go away.
 */
if (!container) {
  throw new Error('Root element #root not found - check index.html');
}

createRoot(container).render(
  /**
   * ===========================================================================
   * STRICTMODE - and the double-render that will confuse you within an hour
   * ===========================================================================
   * In DEVELOPMENT ONLY, StrictMode deliberately:
   *   - renders every component twice
   *   - runs every effect twice (mount -> unmount -> mount)
   *
   * IT IS NOT A BUG, AND YOU SHOULD NOT REMOVE IT. It is a detector. Both
   * behaviours surface code that is not idempotent:
   *   - A component that mutates something during render breaks when rendered
   *     twice. Render must be a pure function of props and state.
   *   - An effect that subscribes without unsubscribing leaks. Double-invoking
   *     mount/unmount means a missing cleanup function shows up on day one
   *     instead of as a slow memory leak in production.
   *
   * This is why the ConnectivityPage effect uses an AbortController. Under
   * StrictMode it fires, aborts, and fires again - and because cleanup is
   * correct, exactly one result lands. Without cleanup you would see two
   * network requests in DevTools and reach for the wrong fix (removing
   * StrictMode) instead of the right one (adding cleanup).
   *
   * It is stripped from production builds entirely - zero runtime cost.
   *
   * INTERVIEW, and it is asked constantly: "why does my useEffect run twice?"
   * The answer is StrictMode in development, and the follow-up you should
   * volunteer is that the double-run is revealing missing cleanup rather than
   * causing a problem.
   * ===========================================================================
   */
  <StrictMode>
    {/*
      ORDER MATTERS, and this specific order is deliberate:

      ErrorBoundary is OUTERMOST so it catches render errors from the router,
      the providers and every page. Putting it inside the router would leave
      any failure in provider setup uncaught, and the user would get a blank
      white page - the worst possible error state because it is
      indistinguishable from a network failure.

      AppProviders sits ABOVE RouterProvider so pages can consume the theme.
    */}
    <ErrorBoundary>
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>
    </ErrorBoundary>
  </StrictMode>,
);
