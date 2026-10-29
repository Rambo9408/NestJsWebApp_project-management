import { useEffect, useState } from 'react';

/**
 * =============================================================================
 * useDebounce - the canonical custom hook, and a correct useEffect
 * =============================================================================
 * Returns a value that lags behind the input, only updating once the input has
 * been still for `delayMs`.
 *
 * THE PROBLEM IT SOLVES: a search box that queries the API on every keystroke.
 * Typing "authentication" fires 14 requests, 13 of which are already obsolete
 * when they land. That is wasted backend capacity, wasted mobile battery, and -
 * because responses can arrive out of order - a genuine correctness bug where
 * the results for "auth" overwrite the results for "authentication".
 *
 * ANGULAR BRIDGE: this is `debounceTime(300)` in an RxJS pipe. RxJS gives it to
 * you as one operator; React makes you build it from an effect and a timer.
 * That difference is worth being honest about in an interview - RxJS is
 * genuinely better at this specific class of problem, and React's answer is
 * that most apps need three or four such utilities, not a whole stream library.
 *
 * WHY THIS IS A HOOK AND NOT A UTILITY FUNCTION: it needs `useState` (to hold
 * the delayed value across renders) and `useEffect` (to schedule and cancel).
 * That is the actual test for "should this be a custom hook" - does it need
 * React's state or lifecycle? A pure transformation like `formatDate` must not
 * be a hook, and wrapping it in one is the most common form of hook cargo-cult.
 * =============================================================================
 */
export function useDebounce<T>(value: T, delayMs = 300): T {
  /**
   * GENERIC over T, so it debounces a string, a number, or a whole filter
   * object with no change. `useDebounce(searchTerm)` infers `string`;
   * `useDebounce(filters)` infers the filter type. Writing this as
   * `(value: string)` would mean a second near-identical hook the first time
   * you needed to debounce anything else.
   */
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebounced(value);
    }, delayMs);

    /**
     * =========================================================================
     * THE CLEANUP FUNCTION IS THE ENTIRE HOOK
     * =========================================================================
     * Without it this does nothing useful: every keystroke would schedule a
     * timer and all of them would eventually fire, so you would get the same 14
     * updates, merely 300ms late.
     *
     * WHAT ACTUALLY HAPPENS on each keystroke:
     *   1. `value` changed, so React runs the CLEANUP of the previous effect
     *   2. that clears the pending timer - the previous update never happens
     *   3. the new effect schedules a fresh timer
     *
     * Only when 300ms pass with no keystroke does a timer survive to fire.
     * That "cancel the previous one" is exactly `switchMap` semantics.
     *
     * WHEN CLEANUP RUNS - and this is the part people get wrong: BEFORE every
     * re-run of the effect, AND on unmount. Not only on unmount. Reading
     * useEffect as "componentDidMount + componentWillUnmount" makes this
     * behaviour look like a bug rather than the design.
     *
     * MEMORY LEAK IF OMITTED: a timer holding a closure over a component that
     * has since unmounted, then calling setState on it. React no longer warns
     * about this (the warning was removed in 18 as too noisy), so it fails
     * silently.
     * =========================================================================
     */
    return () => {
      clearTimeout(timeoutId);
    };
    /**
     * `delayMs` IS IN THE DEPENDENCY ARRAY, and it must be.
     *
     * Omitting it is tempting - "the delay never changes" - and it is the exact
     * habit that produces stale closures. If a caller ever passes a computed
     * delay, this effect would keep using the first one forever, and the bug
     * would be invisible because the code looks correct.
     *
     * The rule has no exceptions worth learning: declare everything the effect
     * reads. `react-hooks/exhaustive-deps` is set to `error` in this project
     * precisely so this is not a judgement call.
     */
  }, [value, delayMs]);

  return debounced;
}
