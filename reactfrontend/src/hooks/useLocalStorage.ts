import { useCallback, useEffect, useState } from 'react';

/**
 * =============================================================================
 * useLocalStorage - syncing React state with an EXTERNAL SYSTEM
 * =============================================================================
 * This is what useEffect is genuinely for. Not "run on mount" - SYNCHRONISE
 * React state with something that lives outside React and does not participate
 * in its render cycle. localStorage, the document title, a WebSocket, a chart
 * library that owns its own DOM node.
 *
 * !! DO NOT PUT AUTH TOKENS IN HERE !!
 * localStorage is readable by any JavaScript on the page, which means any XSS
 * payload and any compromised dependency reads it. That is precisely why the
 * backend puts the refresh token in an httpOnly cookie. This hook is for
 * PREFERENCES - theme, table page size, a dismissed banner - things whose
 * disclosure is harmless. Phase 22 revisits this properly.
 * =============================================================================
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T,
): [T, (value: T | ((previous: T) => T)) => void] {
  /**
   * LAZY INITIALISATION IS NOT OPTIONAL HERE.
   *
   * `localStorage.getItem` is a SYNCHRONOUS DISK-BACKED READ and `JSON.parse`
   * is real work. Written eagerly - `useState(readFromStorage())` - both would
   * run on every single render and the result would be discarded every time
   * after the first.
   *
   * This is the textbook case for the function form, and the difference is
   * measurable rather than theoretical once a component re-renders on
   * keystrokes.
   */
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      /**
       * `as T` IS AN UNCHECKED ASSERTION AND IT IS THE WEAK POINT OF THIS HOOK.
       *
       * Whatever is in localStorage was written by a PREVIOUS VERSION of this
       * app, possibly months ago, possibly by a user editing DevTools. Nothing
       * guarantees it still matches `T`. The type says `T`; reality says
       * "whatever JSON happens to be there".
       *
       * THE RIGOROUS FIX is a Zod schema per key, parsed on read, falling back
       * to the initial value on failure. That is the same "validate at the
       * boundary" argument made about API responses in Phase 1 - localStorage
       * is just as much an untrusted boundary as the network.
       *
       * Left as an assertion here to keep the hook dependency-free, and flagged
       * rather than hidden. Being able to name where your types are lying is
       * more valuable in an interview than pretending they never do.
       */
      return item !== null ? (JSON.parse(item) as T) : initialValue;
    } catch {
      /**
       * THREE REAL FAILURE MODES, all of which happen in production:
       *   - Safari private browsing historically threw on any write
       *   - the quota is full (~5MB)
       *   - the stored JSON is corrupt or was hand-edited
       *
       * A preference that cannot be read must never take down the page, so we
       * fall back to the default. Swallowing an error is usually a smell; here
       * the recovery is genuine and complete.
       */
      return initialValue;
    }
  });

  const setValue = useCallback(
    (value: T | ((previous: T) => T)) => {
      /**
       * Accepts the FUNCTIONAL FORM as well as a plain value, mirroring
       * `useState`'s own API.
       *
       * That is deliberate API design: a custom hook that returns a
       * setState-shaped setter should behave like one. A hook that looks like a
       * built-in but silently drops the updater form is worse than one that
       * looks different, because the failure is invisible at the call site.
       */
      setStoredValue((previous) => (value instanceof Function ? value(previous) : value));
    },
    [],
  );

  /**
   * THE WRITE HAPPENS IN AN EFFECT, not inside `setValue`.
   *
   * WHY: writing during the event handler would be a side effect performed
   * before React has committed the new state. If the render that follows is
   * interrupted or discarded - which concurrent rendering permits - storage
   * would hold a value the UI never showed.
   *
   * Doing it in an effect means the write happens AFTER commit, so storage
   * always reflects what the user actually saw. That ordering is the whole
   * reason effects run when they do.
   */
  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(storedValue));
    } catch {
      // Quota exceeded or storage disabled. A preference failing to persist is
      // not worth an error dialog; the in-memory value still works for this
      // session.
    }
  }, [key, storedValue]);

  return [storedValue, setValue];
}
