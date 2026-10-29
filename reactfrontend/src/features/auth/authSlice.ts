import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { User } from '@/types/api';

/**
 * =============================================================================
 * authSlice - session state, migrated OUT of Context
 * =============================================================================
 * WHY MOVE IT? Phase 3 argued that Context is the right tool for rarely-changing
 * app-wide values, and auth qualifies. That argument was correct then and is
 * still correct in isolation. What changed is the SURROUNDINGS:
 *
 *   1. RTK QUERY'S baseQuery NEEDS THE TOKEN. It is a plain function, not a
 *      component, so it cannot call `useAuth()`. With auth in the store it can
 *      call `getState()`. With auth in Context, the token would have to be
 *      smuggled through a module variable anyway - which is what `tokenStore`
 *      already is, and having TWO sources of session truth is the thing worth
 *      avoiding.
 *
 *   2. MUTATIONS NEED TO UPDATE IT. `login` is an RTK Query mutation; on
 *      success it must set the user. Cross-slice reactions are what
 *      `extraReducers` exists for, and Context has no equivalent.
 *
 *   3. DEVTOOLS. Every session transition becomes an inspectable, replayable
 *      action. Debugging "why did I get logged out?" goes from guesswork to
 *      reading a list.
 *
 * BE HONEST IN AN INTERVIEW: this is not "Redux is better than Context". It is
 * "the integration cost of keeping them separate exceeded the cost of moving".
 * A codebase with no RTK Query would be perfectly well served by the Context
 * version, and that version is still in git history.
 *
 * WHAT DID NOT MOVE: the theme. It has no interaction with data fetching, so
 * `ThemeModeProvider` stays Context - which is the point. Redux is not where
 * everything goes; it is where cross-cutting client state that other machinery
 * must read goes.
 * =============================================================================
 */

/**
 * THE SAME THREE-STATE UNION as the Context version, and for the same reason:
 * `user: User | null` plus `isLoading` makes `{ user: null, isLoading: false }`
 * ambiguous - it means both "checked, nobody is logged in" and "have not
 * started checking". A route guard cannot distinguish those, so it either
 * redirects logged-in users on every reload or spins forever.
 *
 * NOTE the shape is flat rather than a discriminated union of whole-state
 * objects. Redux Toolkit's Immer works on drafts, and a union that swaps its
 * entire shape makes `state.user = x` a type error in half the branches. The
 * `status` field still discriminates for CONSUMERS via selectors - which is
 * where the narrowing actually matters.
 */
export type AuthStatus = 'restoring' | 'authenticated' | 'anonymous';

export interface AuthSliceState {
  status: AuthStatus;
  user: User | null;
}

const initialState: AuthSliceState = {
  /**
   * `restoring`, NOT `anonymous`.
   *
   * Starting anonymous would flash the login page for one frame on every reload
   * for every logged-in user - and worse, the route guard would REDIRECT before
   * the boot refresh resolved, throwing away the page they asked for.
   */
  status: 'restoring',
  user: null,
};

export const authSlice = createSlice({
  name: 'auth',
  initialState,

  /**
   * ===========================================================================
   * IMMER - "mutating" code that is actually immutable
   * ===========================================================================
   * `state.user = action.payload.user` looks like the exact mutation Phase 2
   * spent a whole demo warning against. It is not.
   *
   * Redux Toolkit wraps every reducer in Immer. `state` here is a DRAFT - a
   * Proxy that records the writes you perform and then produces a brand-new
   * object with those changes applied, leaving the original untouched. React
   * sees a new reference, so it re-renders. The immutability guarantee is
   * intact; only the syntax changed.
   *
   * WHY THIS MATTERS BEYOND ERGONOMICS: the hand-written equivalent for deep
   * state is a spread pyramid -
   *     { ...state, a: { ...state.a, b: { ...state.a.b, c: value } } }
   * - which is tedious, and every level you forget to spread is a silent
   * mutation bug of exactly the kind Phase 2 demonstrated.
   *
   * THE ONE RULE: either mutate the draft OR return a new value. Never both.
   * Doing both is the classic Immer error and RTK will throw.
   *
   * INTERVIEW: "is Redux Toolkit still immutable?" - yes; Immer produces a new
   * state from recorded draft mutations. The mutation is a lie the Proxy tells
   * you for readability.
   * ===========================================================================
   */
  reducers: {
    /**
     * `PayloadAction<T>` types `action.payload`. Without it the payload is
     * `unknown` and every reducer needs a cast - so this generic is what makes
     * the whole slice type-safe end to end, including the auto-generated action
     * creator's argument.
     */
    sessionRestored: (state, action: PayloadAction<{ user: User }>) => {
      state.status = 'authenticated';
      state.user = action.payload.user;
    },

    signedIn: (state, action: PayloadAction<{ user: User }>) => {
      state.status = 'authenticated';
      state.user = action.payload.user;
    },

    /**
     * THREE ACTIONS THAT DO ALMOST THE SAME THING, deliberately not merged into
     * one `setAuth`.
     *
     * WHY: actions describe EVENTS, not setters. `signedIn`, `signedOut` and
     * `sessionExpired` all end in `anonymous` or `authenticated`, but they mean
     * different things - and that difference is exactly what makes the devtools
     * log readable. Scrolling a list of `auth/setAuth` tells you nothing;
     * seeing `auth/sessionExpired` tells you the refresh token died rather than
     * the user clicking Sign out.
     *
     * It also matters for the future: an analytics middleware can react to
     * `signedIn` without reacting to `sessionRestored`, which would otherwise
     * fire a "login" event on every page load.
     *
     * INTERVIEW: "how do you name Redux actions?" - as events that happened,
     * not as commands to the store. `userAddedToCart`, not `setCart`.
     */
    signedOut: (state) => {
      state.status = 'anonymous';
      state.user = null;
    },

    sessionExpired: (state) => {
      state.status = 'anonymous';
      state.user = null;
    },

    /** The boot-time refresh finished and there was no valid session. */
    restoreFailed: (state) => {
      state.status = 'anonymous';
      state.user = null;
    },

    /** Profile edits (PATCH /auth/me) update the cached user in place. */
    userUpdated: (state, action: PayloadAction<User>) => {
      state.user = action.payload;
    },
  },
});

export const {
  sessionRestored,
  signedIn,
  signedOut,
  sessionExpired,
  restoreFailed,
  userUpdated,
} = authSlice.actions;

/**
 * =============================================================================
 * SELECTORS - and why they are exported from the slice
 * =============================================================================
 * A component doing `useAppSelector(s => s.auth.user)` couples itself to the
 * STATE SHAPE. Rename the slice or nest it and every one of those call sites
 * breaks, in a way TypeScript catches but a reviewer has to fix by hand across
 * fifty files.
 *
 * A selector is the public API of the slice. Change the shape, update the
 * selector, and nothing else moves. This is the same encapsulation argument as
 * not exporting a raw Context object (Phase 3).
 *
 * `RootState` is imported as a TYPE ONLY, from the store. That is deliberate: a
 * value import would make this module depend on the store, and the store
 * depends on this slice - a genuine circular import. `import type` is erased at
 * compile time, so the cycle never exists at runtime.
 *
 * NO `createSelector` HERE. Memoised selectors matter when a selector DERIVES
 * something (filters, maps, computes) and would otherwise return a new
 * reference every call, defeating `useSelector`'s equality check. These return
 * existing references, so memoising them would add cost and no benefit - the
 * same "measure before memoising" discipline as Phase 3.
 * =============================================================================
 */
export const selectAuthStatus = (state: { auth: AuthSliceState }) => state.auth.status;
export const selectCurrentUser = (state: { auth: AuthSliceState }) => state.auth.user;
export const selectIsAuthenticated = (state: { auth: AuthSliceState }) =>
  state.auth.status === 'authenticated';

export default authSlice.reducer;
