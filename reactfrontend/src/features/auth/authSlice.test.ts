import { describe, expect, it } from 'vitest';
import reducer, {
  restoreFailed,
  selectIsAuthenticated,
  sessionExpired,
  sessionRestored,
  signedIn,
  signedOut,
  userUpdated,
  type AuthSliceState,
} from './authSlice';
import { uiSlice, toastAdded, toastDismissed, selectToasts } from '../ui/uiSlice';
import { Role, type User } from '@/types/api';

/**
 * =============================================================================
 * TESTING SLICES - pure functions, no store required
 * =============================================================================
 * A reducer is `(state, action) => newState`. Call it directly. No store, no
 * Provider, no render, no mocks - the same argument made for `taskFiltersReducer`
 * in Phase 3, now applied to Redux proper.
 *
 * `createStore` in a test is a smell unless you are specifically testing
 * middleware or cross-slice interaction. Testing a reducer through a store adds
 * setup and tests nothing extra.
 * =============================================================================
 */

const user: User = {
  id: 'u1',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  role: Role.MEMBER,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

describe('authSlice', () => {
  /**
   * `reducer(undefined, {type:'@@INIT'})` is how you get the initial state
   * without exporting it. Passing `undefined` makes the reducer fall back to
   * its default, which is exactly what the store does on creation.
   */
  const initial = reducer(undefined, { type: '@@INIT' });

  it('starts in "restoring", not "anonymous"', () => {
    /**
     * THE MOST IMPORTANT ASSERTION IN THIS FILE.
     *
     * Starting anonymous would make RequireAuth redirect every logged-in user
     * to /login on every reload, before the boot refresh resolves - throwing
     * away the page they asked for. The symptom is a login page that flashes on
     * refresh, and it is hard to reproduce because it depends on network
     * timing.
     *
     * A one-word change to the initial state would cause it. This test makes
     * that a failing build.
     */
    expect(initial.status).toBe('restoring');
    expect(initial.user).toBeNull();
  });

  it('authenticates on sessionRestored and on signedIn', () => {
    expect(reducer(initial, sessionRestored({ user }))).toEqual({
      status: 'authenticated',
      user,
    });
    expect(reducer(initial, signedIn({ user }))).toEqual({ status: 'authenticated', user });
  });

  it.each([
    ['signedOut', signedOut()],
    ['sessionExpired', sessionExpired()],
    ['restoreFailed', restoreFailed()],
  ])('clears the user on %s', (_label, action) => {
    /**
     * THREE ACTIONS, ONE OUTCOME - and they are deliberately separate rather
     * than one `setAuth`.
     *
     * They mean different things, and that difference is what makes the
     * devtools log readable: `auth/sessionExpired` tells you the refresh token
     * died; `auth/signedOut` tells you the user clicked the button. A shared
     * `setAuth` would tell you nothing.
     *
     * ASSERTING THE USER IS CLEARED matters on its own: leaving a stale user
     * behind after logout would keep their name in the header, which on a
     * shared machine looks exactly like the session leaking.
     */
    const authenticated: AuthSliceState = { status: 'authenticated', user };
    const result = reducer(authenticated, action);

    expect(result.status).toBe('anonymous');
    expect(result.user).toBeNull();
  });

  it('does not mutate the state it was given', () => {
    /**
     * PROVING IMMER IS IMMUTABLE.
     *
     * The reducer body reads `state.user = action.payload.user`, which LOOKS
     * like the mutation Phase 2 spent a demo warning against. This asserts it
     * is not: the input is untouched and the output is a new reference.
     *
     * Without a new reference React would not re-render - the Phase 2 bug,
     * which Immer prevents by construction rather than by discipline.
     */
    const authenticated: AuthSliceState = { status: 'authenticated', user };
    const result = reducer(authenticated, signedOut());

    expect(authenticated.status).toBe('authenticated');
    expect(authenticated.user).toBe(user);
    expect(result).not.toBe(authenticated);
  });

  it('updates the cached user without changing status', () => {
    const authenticated: AuthSliceState = { status: 'authenticated', user };
    const renamed = { ...user, name: 'Ada King' };

    const result = reducer(authenticated, userUpdated(renamed));

    expect(result.user?.name).toBe('Ada King');
    expect(result.status).toBe('authenticated');
  });

  describe('selectors', () => {
    it('reports authentication from status, not from user presence', () => {
      /**
       * A SUBTLE BUT REAL DISTINCTION. `selectIsAuthenticated` checks
       * `status === 'authenticated'`, not `user !== null`.
       *
       * During `restoring` the user is null, so both agree. But the two would
       * diverge the moment any code set a user without setting the status -
       * and deriving auth from "is there a user object" is how you end up
       * treating a half-restored session as logged in.
       *
       * Status is the single source of truth; user is data.
       */
      expect(selectIsAuthenticated({ auth: { status: 'restoring', user: null } })).toBe(false);
      expect(selectIsAuthenticated({ auth: { status: 'anonymous', user: null } })).toBe(false);
      expect(selectIsAuthenticated({ auth: { status: 'authenticated', user } })).toBe(true);
    });
  });
});

describe('uiSlice', () => {
  const initial = uiSlice.reducer(undefined, { type: '@@INIT' });

  it('queues multiple toasts rather than replacing', () => {
    /**
     * THE REASON `toasts` IS AN ARRAY.
     *
     * With a single `currentToast`, two overlapping events - a save succeeding
     * while a background refetch fails - would mean the second silently
     * overwrites the first, and the user never learns their save worked. Real
     * apps produce overlapping notifications constantly.
     */
    const one = uiSlice.reducer(initial, toastAdded('Saved', 'success'));
    const two = uiSlice.reducer(one, toastAdded('Refresh failed', 'error'));

    expect(selectToasts({ ui: two })).toHaveLength(2);
    expect(two.toasts.map((t) => t.severity)).toEqual(['success', 'error']);
  });

  it('generates a unique id per toast via prepare', () => {
    /**
     * The id comes from `prepare`, NOT from the reducer - because a reducer
     * must be pure. Generating it inside would break time-travel replay (a
     * different id each run) and StrictMode's double-invoke.
     *
     * Asserting the ids differ proves `prepare` is actually running, which is
     * easy to break by "simplifying" the action creator into a plain reducer.
     */
    const one = uiSlice.reducer(initial, toastAdded('A'));
    const two = uiSlice.reducer(one, toastAdded('B'));

    expect(two.toasts[0]?.id).not.toBe(two.toasts[1]?.id);
  });

  it('dismisses by id, leaving the others', () => {
    const one = uiSlice.reducer(initial, toastAdded('A'));
    const two = uiSlice.reducer(one, toastAdded('B'));
    const targetId = two.toasts[0]?.id ?? '';

    const result = uiSlice.reducer(two, toastDismissed(targetId));

    expect(result.toasts).toHaveLength(1);
    expect(result.toasts[0]?.message).toBe('B');
  });

  it('defaults severity to info', () => {
    const result = uiSlice.reducer(initial, toastAdded('Just so you know'));
    expect(result.toasts[0]?.severity).toBe('info');
  });
});
