import { configureStore } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import { apiSlice } from '@/services/apiSlice';
import { errorToastMiddleware } from './errorToastMiddleware';
import authReducer from '@/features/auth/authSlice';
import uiReducer from '@/features/ui/uiSlice';

/**
 * =============================================================================
 * THE STORE
 * =============================================================================
 * `configureStore` replaces the old `createStore` + `applyMiddleware` +
 * `composeWithDevTools` dance, and it is not merely shorter - it ships sensible
 * defaults that used to be manual setup:
 *
 *   - redux-thunk, already wired
 *   - the Redux DevTools extension, already connected
 *   - IN DEVELOPMENT ONLY, two runtime checks that catch real bugs:
 *
 *       serializableCheck  warns when a non-serialisable value (a Date, a Map,
 *                          a Promise, a class instance) enters state or an
 *                          action. Those break time-travel debugging and
 *                          persistence, and the failure otherwise appears much
 *                          later as "why can I not replay this?".
 *
 *       immutableCheck     warns when state is mutated OUTSIDE a reducer -
 *                          the Phase 2 bug, caught at runtime rather than by
 *                          reading code.
 *
 *     Both are stripped from production builds, so they cost nothing shipped.
 *
 * ANGULAR BRIDGE: this is `StoreModule.forRoot(reducers)` in NgRx. The
 * `reducer` map here is the same idea as the reducer map there. What NgRx
 * spreads across actions.ts / reducer.ts / selectors.ts / effects.ts, RTK
 * collapses into one `createSlice` call - which is the single biggest
 * ergonomic difference between them.
 * =============================================================================
 */
export const store = configureStore({
  /**
   * THE REDUCER MAP DEFINES THE STATE SHAPE. These keys are what selectors read
   * (`state.auth`, `state.ui`), which is exactly why selectors live in the
   * slice: rename a key here and one file changes, not fifty call sites.
   *
   * RTK Query's api reducer joins this map in Phase 9.
   */
  reducer: {
    auth: authReducer,
    ui: uiReducer,
    /**
     * RTK Query keeps its entire cache in ONE reducer, mounted at the key it
     * was configured with. `[apiSlice.reducerPath]` is a computed key rather
     * than the literal `'api'` so the two can never disagree - rename
     * `reducerPath` and this follows automatically.
     */
    [apiSlice.reducerPath]: apiSlice.reducer,
  },

  /**
   * ===========================================================================
   * MIDDLEWARE - and why `getDefaultMiddleware()` must be called, not replaced
   * ===========================================================================
   * Returning a bare array here would DROP the defaults: thunk, and the two
   * development-only checks (serializable, immutable). Losing thunk silently
   * breaks every async action, and the failure message points nowhere useful.
   *
   * `.concat()` preserves them and appends ours. ORDER MATTERS - middleware
   * runs in sequence, so `apiMiddleware` must see the rejected action before
   * `errorToastMiddleware` reacts to it.
   *
   * `apiSlice.middleware` is NOT OPTIONAL. It powers caching, invalidation,
   * polling and subscription lifetimes. Without it, hooks appear to work and
   * then nothing ever refetches - a genuinely confusing failure, because the
   * first render looks correct.
   * ===========================================================================
   */
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(apiSlice.middleware, errorToastMiddleware),
});

/**
 * REFETCH ON RECONNECT AND ON WINDOW FOCUS.
 *
 * A tab left open overnight shows yesterday's data. This makes returning to it
 * trigger a background refetch, so the user sees current data without pressing
 * anything - and because it is a BACKGROUND refetch, the cached data stays on
 * screen while it happens rather than flashing a spinner.
 *
 * TUNE IT: on a heavily-used dashboard, focus-refetching every query on every
 * tab switch can be a lot of traffic. `refetchOnFocus` can be set per endpoint,
 * and `keepUnusedDataFor` bounds how often it actually fires.
 */
setupListeners(store.dispatch);

/**
 * =============================================================================
 * TYPES INFERRED FROM THE STORE, never hand-written
 * =============================================================================
 * `RootState` is derived with `ReturnType<typeof store.getState>`. Add a slice
 * to the map above and RootState grows automatically.
 *
 * WRITING IT BY HAND -
 *     interface RootState { auth: AuthSliceState; ui: UiSliceState }
 * - would be a second source of truth that silently drifts the first time
 * somebody adds a slice and forgets to update it. Selectors would then compile
 * against a state shape that does not exist.
 *
 * Same principle as inferring form types from Zod schemas in Phase 6: derive
 * types from the thing that defines them.
 */
export type RootState = ReturnType<typeof store.getState>;

/**
 * `AppDispatch` matters more than it looks. The default `Dispatch` type does
 * not know about thunks or RTK Query's middleware, so `dispatch(someThunk())`
 * would be a type error. Inferring it from the real store picks up every
 * middleware's augmentation.
 */
export type AppDispatch = typeof store.dispatch;
