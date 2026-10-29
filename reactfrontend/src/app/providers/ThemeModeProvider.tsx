import { useCallback, useMemo, type ReactNode } from 'react';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { ThemeModeContextInternal, type ThemeMode } from './themeModeContext';

/**
 * =============================================================================
 * CONTEXT - what it is for, and what it is NOT for
 * =============================================================================
 * Context solves exactly one problem: PROP DRILLING. Passing a value through
 * five components that do not use it, purely to reach the sixth.
 *
 * IT IS NOT A STATE MANAGER. It is a TRANSPORT. No reducers, no devtools, no
 * middleware, no selectors, and - the part that bites - NO ABILITY TO RE-RENDER
 * ONLY THE CONSUMERS THAT CARE. When the value changes, EVERY consumer
 * re-renders, whether or not it reads the field that changed.
 *
 * WHEN CONTEXT IS THE RIGHT CALL:
 *   - the value changes RARELY (theme, locale, the current user)
 *   - much of the tree needs it
 *   - it is genuinely app-wide, not feature-wide
 *
 * WHEN IT IS THE WRONG CALL:
 *   - the value changes OFTEN (form input, mouse position) - every consumer
 *     re-renders on every change and there is no opt-out
 *   - it is server data - that is RTK Query's job (Phase 20)
 *   - you need selectors, time-travel debugging or middleware - that is Redux
 *
 * THEME IS THE TEXTBOOK GOOD CASE: it changes when a human clicks a button,
 * perhaps twice a day, and the whole tree needs it.
 *
 * -----------------------------------------------------------------------------
 * CONTEXT vs REDUX - the interview question this file exists to answer
 * -----------------------------------------------------------------------------
 *                      Context                  Redux Toolkit
 *   Purpose            transport                state management
 *   Re-render control  none - all consumers     selectors, granular
 *   Devtools           none                     time-travel, action log
 *   Middleware         none                     yes
 *   Boilerplate        almost none              some
 *   Async              you build it             RTK Query
 *
 * The honest summary: Context is not a lightweight Redux, it is a different
 * tool. Reach for Context for rarely-changing app-wide values; reach for Redux
 * when you need selectors, middleware or debugging. And for SERVER data, reach
 * for neither - see Phase 19.
 * =============================================================================
 */

export function ThemeModeProvider({ children }: { children: ReactNode }) {
  // Persisted, so a reload does not throw the choice away. Exactly the kind of
  // harmless preference localStorage is appropriate for - unlike auth tokens.
  const [mode, setMode] = useLocalStorage<ThemeMode>('taskflow:theme-mode', 'light');

  const toggleMode = useCallback(() => {
    // Functional update, so this callback needs no dependency on `mode` and
    // therefore keeps a stable identity across every toggle. If it depended on
    // `mode`, its identity would change on each toggle, changing the context
    // value's identity too - and defeating the useMemo below.
    setMode((current) => (current === 'light' ? 'dark' : 'light'));
  }, [setMode]);

  /**
   * =========================================================================
   * THE MOST IMPORTANT LINE IN ANY CONTEXT PROVIDER
   * =========================================================================
   * WITHOUT useMemo:
   *
   *     <ThemeModeContext value={{ mode, toggleMode }}>
   *
   * that object literal is REBUILT ON EVERY RENDER of this provider. A new
   * reference means React treats the context value as changed, so EVERY
   * CONSUMER IN THE APP RE-RENDERS - even though `mode` and `toggleMode` are
   * both identical to last time.
   *
   * The failure mode is nasty because it is invisible: the app is correct, just
   * slow, and the cause is one pair of missing braces. It is the number-one
   * Context performance bug and a very common interview question.
   *
   * THE DEEPER FIX, when a context value holds both frequently- and
   * rarely-changing data: SPLIT IT INTO TWO CONTEXTS. The classic pairing is
   * `StateContext` + `DispatchContext` - dispatch never changes, so components
   * that only dispatch never re-render when state does. Not needed here (both
   * fields change together, and rarely), but it is the answer to "how do you
   * optimise a Context that re-renders too much" and worth naming before the
   * interviewer does.
   *
   * THE CHEAPER FIX, applied in RootLayout: push consumption down to the
   * smallest leaf that needs it, so the re-render is small either way.
   * =========================================================================
   */
  const value = useMemo(() => ({ mode, toggleMode }), [mode, toggleMode]);

  /**
   * `<Context value={...}>` - React 19 lets the context object itself act as
   * the provider. Pre-19 this was `<Context.Provider value={...}>`, which is
   * what most tutorials still show and which continues to work.
   */
  return <ThemeModeContextInternal value={value}>{children}</ThemeModeContextInternal>;
}
