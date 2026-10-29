import { API_BASE_URL } from '@/config/env';
import { tokenStore } from '@/features/auth/tokenStore';

/**
 * =============================================================================
 * SINGLE-FLIGHT TOKEN REFRESH
 * =============================================================================
 * THE PROBLEM, and it is not hypothetical - it happens on the first render of
 * any dashboard:
 *
 *   The access token expires. The page fires six requests at once (tasks,
 *   projects, notifications, unread count, the current user, stats). ALL SIX
 *   come back 401. A naive interceptor calls /auth/refresh six times.
 *
 * WHY THAT IS WORSE THAN MERELY WASTEFUL, and this is the part people miss:
 * THE BACKEND ROTATES REFRESH TOKENS AND DETECTS REUSE. Each refresh
 * invalidates the previous token and issues a new one. Six concurrent refreshes
 * present the SAME token six times - which is exactly the signature of a stolen
 * token being replayed.
 *
 * The backend's own comment on the endpoint: "Reuse of a spent token revokes
 * the entire session family." So the naive implementation logs the user out. On
 * every token expiry. And it looks like a random, unreproducible bug, because
 * it only fires when several requests are in flight together.
 *
 * -----------------------------------------------------------------------------
 * THE FIX: one promise, shared.
 * -----------------------------------------------------------------------------
 * The first 401 starts a refresh and stores the PROMISE. Concurrent 401s find
 * that promise and await it instead of starting their own. One network call,
 * one rotation, everybody gets the new token.
 *
 * ANGULAR BRIDGE: this is the well-known refresh-token interceptor pattern
 * built from `shareReplay(1)` and a `BehaviorSubject`. Identical problem,
 * identical solution; RxJS expresses the sharing as an operator, here it is a
 * module-level promise. If you have written that interceptor, you have written
 * this - which is worth saying in an interview, because it is a genuinely
 * transferable piece of experience.
 *
 * INTERVIEW ("your refresh flow creates an infinite loop / logs users out
 * randomly - what is wrong?"): almost always missing single-flight, or a
 * refresh call that itself goes through the interceptor and re-enters on its
 * own 401. Both are handled here.
 * =============================================================================
 */

/**
 * `null` when idle; a promise while a refresh is in flight.
 *
 * MODULE SCOPE IS LOAD-BEARING. A ref or state inside a component would be
 * per-instance, and the whole point is that every caller in the application
 * shares one. There is one session per page, so one variable is correct.
 */
let refreshInFlight: Promise<string> | null = null;

/**
 * Performs the refresh with RAW `fetch`, NOT with our own `http` helper.
 *
 * THIS IS THE SECOND HALF OF THE FIX AND IT IS EASY TO MISS. If the refresh
 * call went through `http`, and the refresh itself returned 401 (expired or
 * revoked cookie), the interceptor would catch that 401 and trigger... another
 * refresh. Which 401s. Which triggers another.
 *
 * That is the infinite refresh loop, and bypassing the interceptor for this one
 * call is what prevents it structurally rather than with a flag somebody can
 * forget to check.
 */
async function performRefresh(): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: 'POST',
    /**
     * NO BODY, and `credentials: 'include'` is what makes this work at all.
     *
     * The refresh token travels as the httpOnly cookie the browser attaches
     * automatically. The endpoint also accepts a body token for non-browser
     * clients - we deliberately never use that path, because putting the
     * refresh token anywhere JavaScript can read it defeats the reason it is
     * httpOnly.
     */
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    // The refresh token is expired, revoked, or the family was killed by a
    // reuse detection. There is no recovering from here - the session is over.
    throw new Error('Session expired');
  }

  const data = (await response.json()) as { accessToken: string };
  return data.accessToken;
}

/**
 * Returns a fresh access token, sharing one in-flight request across all
 * concurrent callers.
 */
export function refreshAccessToken(): Promise<string> {
  /**
   * THE SINGLE-FLIGHT CHECK. Anyone arriving while a refresh is running gets
   * the SAME promise - so they await the same network call rather than starting
   * a rival one.
   */
  refreshInFlight ??= performRefresh()
    .then((token) => {
      tokenStore.set(token);
      return token;
    })
    .catch((error: unknown) => {
      // Notifies the AuthProvider, which flips to logged-out and lets the
      // router redirect. Rethrown so the awaiting request also fails rather
      // than retrying with a token that does not exist.
      tokenStore.expire();
      throw error;
    })
    .finally(() => {
      /**
       * CLEARING THE SLOT IS MANDATORY, and `finally` is the only correct
       * place for it.
       *
       * Clear it only on success and a FAILED refresh would leave a permanently
       * rejected promise cached - every subsequent request would await that
       * same rejection and the user could never recover without a hard reload.
       *
       * `finally` runs on both paths, so the next 401 after a failure starts a
       * genuinely new attempt.
       */
      refreshInFlight = null;
    });

  return refreshInFlight;
}

/** Test seam - resets module state between cases. */
export function __resetRefreshState(): void {
  refreshInFlight = null;
}
