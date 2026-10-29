import { useEffect, useRef } from 'react';

/**
 * =============================================================================
 * usePrevious - the classic useRef demonstration
 * =============================================================================
 * Returns the value from the PREVIOUS render. `undefined` on the first, because
 * there was no previous render - and typing that honestly (`T | undefined`)
 * forces callers to handle the first render instead of crashing on it.
 *
 * USE IT FOR: "did this change?" comparisons - animating on change, logging
 * transitions, firing an analytics event when a status moves to `done`.
 *
 * -----------------------------------------------------------------------------
 * useState vs useRef - the comparison interviewers actually ask for
 * -----------------------------------------------------------------------------
 *                      useState                 useRef
 *   Triggers render    YES                      NO
 *   Value updates      on re-render             IMMEDIATELY (.current)
 *   Read during render safe                     avoid (impure - see below)
 *   Use for            data the UI displays     data the UI does not display
 *
 * THE ONE-LINE RULE: if changing it should update the screen, it is state. If
 * it should not, it is a ref.
 *
 * A ref is an INSTANCE VARIABLE for a function component - `this.something` on
 * a class, with no re-render attached. Its two jobs are DOM handles
 * (`<input ref={inputRef} />`) and mutable values that must survive renders
 * without causing them: timer ids, subscription handles, "has this already
 * run" flags, the previous value.
 *
 * INTERVIEW TRAP: "why not just use a module-level variable?" Because a module
 * variable is shared by every INSTANCE of the component. Render two of them and
 * they fight over one value. A ref is per-instance, which is the whole point.
 * =============================================================================
 */
export function usePrevious<T>(value: T): T | undefined {
  /**
   * `useRef<T | undefined>(undefined)` - the initial value is genuinely absent
   * on the first render, and the type says so.
   *
   * NOTE what is NOT happening here: no `useState`. Storing the previous value
   * in state would schedule a render every time it changed, which for a hook
   * whose entire purpose is passive observation would double the render count
   * of every component that used it.
   */
  const ref = useRef<T | undefined>(undefined);

  useEffect(() => {
    /**
     * MUTATING A REF INSIDE AN EFFECT IS THE CORRECT PATTERN, and it is worth
     * understanding why the timing works.
     *
     * Effects run AFTER the commit phase - after React has rendered and the
     * browser has painted. So during render, `ref.current` still holds the
     * value written by the PREVIOUS render's effect. That is what makes the
     * returned value "previous" rather than "current".
     *
     * WHY NOT MUTATE DURING RENDER:
     *     ref.current = value;   // <- would break
     * Two reasons. It makes render impure, and StrictMode's double-render would
     * then overwrite the previous value with the current one before you ever
     * read it. And with concurrent rendering React may render a component
     * without committing it - a render that is thrown away must not have left
     * a mutation behind.
     *
     * "Render must be pure" is not a style rule. It is the precondition for
     * StrictMode, concurrent rendering and Suspense all working.
     */
    ref.current = value;
  }, [value]);

  /**
   * Reading `ref.current` DURING render. Strictly this is the impurity the
   * comment above warns about - and it is unavoidable for this hook, which is
   * why `usePrevious` is not in React's official API. It is safe here because
   * we only READ, and the value is deliberately one render stale.
   *
   * Worth knowing rather than glossing over: it means `usePrevious` interacts
   * badly with concurrent features that may render a component twice before
   * committing. For the comparisons it is normally used for, that is
   * acceptable. Being able to say WHY a common hook is not in core is a strong
   * senior signal.
   *
   * AND REACT AGREES - `react-hooks/refs` flags the line below, which is why it
   * needs an explicit disable. That is not a lint rule being pedantic; it is
   * the framework telling us this hook is a deliberate exception to its own
   * rules. React's documentation shows the same implementation with the same
   * caveat.
   *
   * THE ALTERNATIVE, if you want no exception at all: track the previous value
   * in state alongside the current one and compare during render
   * ("adjusting state while rendering", in the React docs). It is more code and
   * more state; for a passive observer this is the accepted trade.
   */
  // eslint-disable-next-line react-hooks/refs -- see above: reading a deliberately-stale ref is this hook's entire purpose
  return ref.current;
}
