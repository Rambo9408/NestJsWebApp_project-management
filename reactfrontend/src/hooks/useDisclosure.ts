import { useCallback, useMemo, useState } from 'react';

/**
 * =============================================================================
 * useDisclosure - open/close state for modals, drawers, menus, accordions
 * =============================================================================
 * Three lines of state that would otherwise be re-typed in twenty components.
 *
 * WHEN A CUSTOM HOOK EARNS ITS KEEP - this one clears the bar for a reason
 * worth stating: it is not saving typing, it is guaranteeing that every
 * disclosure in the app behaves identically. The moment you need "close on
 * Escape" or "return focus to the trigger", you add it HERE and every modal in
 * the app gets it. With the state inlined in twenty components, you would add
 * it to the three you remembered.
 *
 * WHEN A CUSTOM HOOK DOES NOT EARN ITS KEEP - and this matters as much:
 *
 *     // pointless
 *     function useName() { return useState(''); }
 *
 * That adds a layer, a file and an import while removing nothing. A hook is
 * worth extracting when it encapsulates a DECISION or an INVARIANT, not when it
 * merely renames a built-in.
 *
 * ANGULAR BRIDGE: this is the closest React gets to an injectable service with
 * state - shared LOGIC, not shared INSTANCE. Every component calling
 * `useDisclosure()` gets its OWN independent state. That is the single most
 * important difference from an Angular service, which is a singleton by
 * default. Two components using this hook do not see each other's state; two
 * components injecting the same Angular service do.
 *
 * To genuinely SHARE one instance, you need Context or a store - which is
 * exactly the distinction Phase 17 and Phase 18 build on.
 * =============================================================================
 */

export interface Disclosure {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

export function useDisclosure(initialOpen = false): Disclosure {
  const [isOpen, setIsOpen] = useState(initialOpen);

  /**
   * =========================================================================
   * WHY useCallback HERE, when this project warns against reflexive memoising
   * =========================================================================
   * These functions are RETURNED FROM A HOOK, so they cross a boundary the
   * hook cannot see past. A consumer may:
   *   - pass `close` to a `React.memo`'d child
   *   - list `open` in another effect's dependency array
   *
   * Without useCallback, every render of the consumer creates new function
   * identities, which defeats the memo and re-runs the effect. The consumer
   * cannot fix that themselves - the instability originates here.
   *
   * THE PRINCIPLE: memoise at the point where a value ESCAPES into an unknown
   * consumer. Inside a component you control both sides and can measure;
   * exporting an unstable reference from a shared hook is a tax you impose on
   * everyone who uses it and can never pay back.
   *
   * The empty dependency arrays are safe because each uses only the SETTER,
   * which React guarantees is stable for the component's lifetime. Note
   * `toggle` uses the FUNCTIONAL form - `setIsOpen(v => !v)` - specifically so
   * it does not need `isOpen` as a dependency. Reading `isOpen` here would
   * force `[isOpen]` and the callback would change identity on every toggle,
   * undoing the entire point.
   *
   * That trick - functional updates to keep a dependency array empty - is one
   * of the most useful in React, and it comes up constantly in Phase 16.
   * =========================================================================
   */
  const open = useCallback(() => {
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const toggle = useCallback(() => {
    setIsOpen((value) => !value);
  }, []);

  /**
   * The OBJECT is memoised too, and for the same reason as the functions.
   *
   * Without this, `useDisclosure()` would return a brand-new object on every
   * render even though all four fields are stable. A consumer doing
   * `const modal = useDisclosure()` and passing `modal` to a memoised child
   * would break the memo - the child sees a new prop every time.
   *
   * `isOpen` is the only real dependency: the three callbacks never change.
   *
   * HONEST TRADE-OFF: for a hook used in two places this is over-engineering,
   * and inlining `useState` would be simpler. It is justified here because
   * this hook is intended for wide use and the cost of an unstable return
   * value scales with the number of consumers.
   */
  return useMemo(() => ({ isOpen, open, close, toggle }), [isOpen, open, close, toggle]);
}
