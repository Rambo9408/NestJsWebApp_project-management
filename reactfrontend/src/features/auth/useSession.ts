import { useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { tokenStore } from './tokenStore';
import { authApi } from './authApi';
import {
  selectAuthStatus,
  selectCurrentUser,
  signedIn,
  signedOut,
} from './authSlice';
import type { User } from '@/types/api';

/**
 * =============================================================================
 * useSession - the same API the Context version had
 * =============================================================================
 * `{ status, user, signIn, signOut }` - deliberately identical in shape to
 * `useAuth()` from Phase 7, so migrating from Context to Redux touched the
 * IMPLEMENTATION and not the twelve call sites.
 *
 * THAT IS THE WHOLE ARGUMENT FOR WRAPPING A STORE IN A HOOK. Components depend
 * on `useSession()`, not on `useAppSelector(s => s.auth.user)`. Swap Context for
 * Redux - or Redux for something else later - and the blast radius is this file.
 *
 * Components that reach into the store shape directly are components that must
 * be edited when the store shape changes. Same encapsulation argument as
 * exporting selectors rather than raw state, one level up.
 *
 * INTERVIEW: "how do you keep components decoupled from your state library?" -
 * a feature-level hook is the seam. It also makes the component testable by
 * mocking one hook instead of building a store.
 * =============================================================================
 */
export function useSession() {
  const dispatch = useAppDispatch();
  const status = useAppSelector(selectAuthStatus);
  const user = useAppSelector(selectCurrentUser);

  /**
   * TWO SEPARATE `useAppSelector` CALLS, not one returning an object.
   *
   *     const { status, user } = useAppSelector(s => ({ status: ..., user: ... }))
   *
   * That version returns a NEW OBJECT every call. `useSelector` compares
   * results with reference equality by default, so it would see a change on
   * every store update - including updates to completely unrelated slices - and
   * re-render this component every time.
   *
   * It is the Context-value identity bug from Phase 3, wearing a Redux costume.
   *
   * Two selectors each return an existing reference, so each compares equal
   * unless its own value actually changed. The alternative fixes are
   * `createSelector` (memoised) or `useSelector(fn, shallowEqual)` - both
   * correct, both more machinery than simply not creating the object.
   *
   * INTERVIEW: "why does my component re-render on every action?" - a selector
   * returning a new object or array literal. Extremely common, and invisible
   * until you profile.
   */

  const signIn = useCallback(
    (nextUser: User, accessToken: string) => {
      // The token goes to the module store (so the non-React baseQuery can read
      // it) and the USER goes to Redux. Two homes, one deliberate reason each:
      // the token is needed synchronously outside React; the user drives UI.
      tokenStore.set(accessToken);
      dispatch(signedIn({ user: nextUser }));
    },
    [dispatch],
  );

  const signOut = useCallback(async () => {
    try {
      // Ask the server to revoke the refresh-token family and clear the cookie.
      // Skipping this leaves the cookie valid, so reopening the app silently
      // logs the user back in - a real problem on a shared machine.
      await authApi.logout();
    } catch {
      /**
       * DELIBERATELY IGNORED. If the network is down we still want the LOCAL
       * session gone. A logout that fails because the server is unreachable
       * must not leave the user logged in; the conservative choice is to clear
       * locally and let the server-side token expire on its own schedule.
       */
    } finally {
      tokenStore.clear();
      dispatch(signedOut());
    }
  }, [dispatch]);

  return { status, user, signIn, signOut };
}
