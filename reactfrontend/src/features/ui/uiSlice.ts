import { createSlice, nanoid, type PayloadAction } from '@reduxjs/toolkit';

/**
 * =============================================================================
 * uiSlice - CLIENT state that is genuinely cross-cutting
 * =============================================================================
 * THE TOAST QUEUE IS THE TEXTBOOK CASE FOR REDUX, and it is worth being precise
 * about why, because most things people put in Redux are not.
 *
 * A toast is RAISED in one place and RENDERED in a completely different one:
 *
 *     TaskCard          -> "Task moved to Done"
 *     RegisterForm      -> "Welcome"
 *     an RTK Query error handler, five components deep
 *              |
 *              v
 *     <Toaster /> in RootLayout
 *
 * Those components share no ancestor except the root. Prop-drilling a
 * `showToast` callback through every one of them is the exact problem a store
 * exists to solve, and there is no natural component to own the state.
 *
 * WHY NOT CONTEXT: it would work, and for a toast queue alone it would be a
 * reasonable choice. Redux wins here only because the store already exists for
 * auth and RTK Query, so this costs one file rather than one more provider -
 * and because middleware can dispatch into it (Phase 9 shows a global error
 * handler doing exactly that), which Context cannot do from outside React.
 *
 * -----------------------------------------------------------------------------
 * WHAT DOES *NOT* BELONG IN THIS SLICE - the more valuable half
 * -----------------------------------------------------------------------------
 *   SERVER DATA          tasks, projects, users. That is RTK Query's job
 *                        (Phase 9). Copying it into a slice throws away
 *                        caching, deduplication and invalidation, and gives you
 *                        a second copy that can go stale.
 *
 *   FILTER / SORT / PAGE  the URL owns these (Phase 5). They describe what the
 *                        user is looking at, so they must survive a refresh and
 *                        a shared link. Putting them in Redux breaks both.
 *
 *   FORM STATE           React Hook Form owns it (Phase 6). Redux would
 *                        re-render the whole form on every keystroke, which is
 *                        precisely what RHF exists to avoid.
 *
 *   ONE COMPONENT'S OPEN/CLOSED  `useDisclosure` (Phase 3). A modal only its
 *                        own subtree cares about does not belong in global
 *                        state; putting it there is how a store ends up holding
 *                        forty booleans.
 *
 * THE TEST: does state need to be read or written by components that share no
 * meaningful ancestor, AND is it client-owned? Both, or it goes elsewhere.
 * =============================================================================
 */

export type ToastSeverity = 'success' | 'info' | 'warning' | 'error';

export interface Toast {
  id: string;
  message: string;
  severity: ToastSeverity;
}

export interface UiSliceState {
  /**
   * A QUEUE, not a single `currentToast`.
   *
   * Two things happening at once - a save succeeding while a background refetch
   * fails - would otherwise mean the second silently overwrites the first, and
   * the user never learns their save worked. Real applications produce
   * overlapping notifications constantly.
   */
  toasts: Toast[];
  /** Persisted in Phase 12 alongside the theme; ephemeral for now. */
  sidebarOpen: boolean;
}

const initialState: UiSliceState = {
  toasts: [],
  sidebarOpen: true,
};

export const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    /**
     * ===========================================================================
     * `prepare` - the escape hatch for impure action creation
     * ===========================================================================
     * A REDUCER MUST BE PURE. Generating the id inside it with `nanoid()` would
     * make it impure, and that breaks two things that are not negotiable:
     *   - StrictMode double-invokes reducers in development, so the two calls
     *     would produce different ids
     *   - time-travel debugging replays actions; a reducer that generates its
     *     own id produces a different result on replay, so the devtools lie
     *
     * `prepare` runs when the ACTION IS CREATED, before it reaches the reducer.
     * The id is baked into the action, so the reducer stays a pure function of
     * (state, action) and replay is deterministic.
     *
     * This is the same rule as Phase 4's "render must be pure", applied to
     * reducers - and for the same underlying reason: anything that may be
     * replayed must not depend on when it ran.
     *
     * INTERVIEW: "where do you generate ids / timestamps in Redux?" - in
     * `prepare` or the dispatching code, never in the reducer.
     * ===========================================================================
     */
    toastAdded: {
      reducer: (state, action: PayloadAction<Toast>) => {
        state.toasts.push(action.payload);
      },
      prepare: (message: string, severity: ToastSeverity = 'info') => ({
        payload: { id: nanoid(), message, severity },
      }),
    },

    toastDismissed: (state, action: PayloadAction<string>) => {
      /**
       * `filter` returns a new array, which is fine inside Immer - assigning to
       * `state.toasts` records the write on the draft.
       *
       * `state.toasts.push(...)` above works too. BOTH are correct here; what
       * is NOT correct is mutating the draft AND returning a value from the
       * same reducer. Immer throws on that, and it is the most common mistake
       * people make when they first stop writing spreads by hand.
       */
      state.toasts = state.toasts.filter((toast) => toast.id !== action.payload);
    },

    sidebarToggled: (state) => {
      state.sidebarOpen = !state.sidebarOpen;
    },
  },
});

export const { toastAdded, toastDismissed, sidebarToggled } = uiSlice.actions;

export const selectToasts = (state: { ui: UiSliceState }) => state.ui.toasts;
export const selectSidebarOpen = (state: { ui: UiSliceState }) => state.ui.sidebarOpen;

export default uiSlice.reducer;
