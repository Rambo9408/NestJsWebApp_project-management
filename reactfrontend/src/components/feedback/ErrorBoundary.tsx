import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * =============================================================================
 * ERROR BOUNDARY
 * =============================================================================
 * THE ONE PLACE A CLASS COMPONENT IS STILL REQUIRED.
 *
 * There is no hook equivalent of `componentDidCatch`. The React team has said
 * this is intentional-for-now rather than an oversight, but the practical
 * consequence today is: if you want to catch a render error, you write a class.
 * Knowing this is a small but reliable interview signal - it shows you know
 * WHERE the hooks model has edges, rather than reciting "hooks replaced
 * classes".
 *
 * WHAT IT CATCHES: errors thrown during RENDER, in lifecycle methods, and in
 * constructors of the tree BELOW it.
 *
 * WHAT IT DOES NOT CATCH, and this is the part people get wrong:
 *   - Event handlers        (an onClick that throws - use try/catch)
 *   - Asynchronous code     (setTimeout, promise callbacks)
 *   - Server-side rendering
 *   - Errors thrown in the boundary ITSELF
 *
 * The reason is mechanical, not arbitrary: a boundary works by React catching
 * an exception as it walks the tree during rendering. An event handler runs
 * long after that walk finished, on a fresh call stack React is not part of.
 *
 * THIS IS WHY AN ERROR BOUNDARY IS NOT AN API ERROR HANDLER. A failed fetch
 * rejects a promise; no boundary will ever see it. API errors are DATA - they
 * belong in the error state of the component that made the call, which is what
 * RTK Query's `isError`/`error` gives us in Phase 9. A boundary is the net for
 * genuine BUGS - reading a property of undefined while rendering.
 *
 * ANGULAR BRIDGE: closest relative is a global `ErrorHandler`, but Angular's is
 * app-wide and catches async errors through Zone.js. React boundaries are
 * POSITIONAL - you place them in the tree, and each one protects only its own
 * subtree. That is a feature: a crash in the notifications widget can leave the
 * rest of the dashboard usable, which a single global handler cannot express.
 * =============================================================================
 */

interface Props {
  children: ReactNode;
  /** Render prop for a custom fallback. Defaults to the built-in panel. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  /**
   * Called during the RENDER phase. It must be pure - no logging, no side
   * effects - because React may call it more than once for the same error.
   * Its only job is to map an error to new state.
   */
  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  /**
   * Called during the COMMIT phase, so side effects ARE allowed here. This is
   * the correct place to report to Sentry/Datadog.
   *
   * The render/commit split is not trivia - it is the same distinction that
   * explains why `useEffect` runs after paint and why StrictMode can invoke
   * render twice. We cover it properly in the Rendering phase.
   */
  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Placeholder for a real reporter (Sentry, Datadog). `console.error` is
    // deliberately allowed by our lint config - unlike console.log, it is a
    // legitimate production signal, and stripping it would hide real crashes.
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div role="alert" style={{ padding: '2rem', fontFamily: 'system-ui' }}>
        <h1>Something went wrong</h1>
        {/*
          The message is shown because this is a learning project and you are
          the only user. IN PRODUCTION, render a generic string and send the
          detail to your error tracker: an exception message can leak an
          internal path, a query, or a user's data onto a shared screen.
          The backend applies exactly this rule in all-exceptions.filter.ts.
        */}
        <p>{error.message}</p>
        <button type="button" onClick={this.reset}>
          Try again
        </button>
      </div>
    );
  }
}
