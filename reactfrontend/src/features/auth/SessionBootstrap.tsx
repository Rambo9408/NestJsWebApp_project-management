import { useEffect, type ReactNode } from 'react';
import { useAppDispatch } from '@/app/hooks';
import { tokenStore } from './tokenStore';
import { authApi } from './authApi';
import { restoreFailed, sessionExpired, sessionRestored } from './authSlice';

/**
 * =============================================================================
 * SessionBootstrap - what is left of AuthProvider after the Redux migration
 * =============================================================================
 * It no longer PROVIDES anything. The store does that. What remains is the two
 * genuine side effects that have to live somewhere in the React tree:
 *
 *   1. Ask /auth/refresh on boot whether the httpOnly cookie is still valid.
 *   2. Subscribe to `tokenStore.expire()` so a mid-session refresh failure
 *      becomes Redux state.
 *
 * WHY IT IS STILL A COMPONENT AND NOT A THUNK DISPATCHED FROM main.tsx: the
 * subscription in (2) needs CLEANUP, and cleanup needs a lifecycle. A thunk
 * fires once and has no unmount. Effects are React's answer to "this needs
 * setting up and tearing down".
 *
 * It renders `children` untouched - no wrapper element, no layout impact. A
 * component that exists purely for its effects is a legitimate pattern, and
 * naming it for what it does keeps that honest.
 * =============================================================================
 */
export function SessionBootstrap({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch();

  useEffect(() => {
    /**
     * THE `cancelled` GUARD IS LOAD-BEARING, and the reason is specific to this
     * backend.
     *
     * StrictMode runs this effect twice in development. Without the guard, two
     * refresh calls race - and because the backend ROTATES refresh tokens, the
     * second presents a token the first just spent. That is precisely the
     * reuse-detection trigger, and the backend's response is to revoke the
     * entire session family.
     *
     * So the naive version logs you out on every page load in development, and
     * it looks like a backend bug. It is not: it is StrictMode correctly
     * exposing a missing cleanup, exactly as designed.
     *
     * (The single-flight promise in refreshClient covers the same ground for
     * concurrent 401s. This guard covers the double-mount case, which happens
     * before any 401 exists.)
     */
    let cancelled = false;

    async function restore() {
      try {
        const { accessToken, user } = await authApi.refresh();
        if (cancelled) return;

        tokenStore.set(accessToken);
        dispatch(sessionRestored({ user }));
      } catch {
        // A 401 here is the NORMAL case for a logged-out visitor, not an error.
        // No cookie, or an expired one. Logging it would fill the console on
        // every anonymous page load.
        if (!cancelled) dispatch(restoreFailed());
      }
    }

    void restore();

    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  /**
   * THE INVERTED DEPENDENCY. `refreshClient` is a plain module - it cannot
   * dispatch, and importing the store into it would make the token layer depend
   * on Redux. So it calls `tokenStore.expire()`, and this subscription turns
   * that into an action.
   *
   * WHAT IT LOOKS LIKE TO THE USER: a tab left open overnight, the refresh
   * token expires, their next click 401s, the refresh fails - and the app
   * transitions to logged-out and redirects to /login, rather than showing a
   * page full of failed requests.
   *
   * NOTE the effect returns `tokenStore.onExpire(...)` DIRECTLY - it returns an
   * unsubscribe function, which is exactly what an effect cleanup must be. A
   * neat fit rather than a coincidence: that API was designed to be used this
   * way.
   */
  useEffect(() => tokenStore.onExpire(() => dispatch(sessionExpired())), [dispatch]);

  return children;
}
