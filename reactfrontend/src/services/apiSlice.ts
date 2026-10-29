import {
  createApi,
  fetchBaseQuery,
  type BaseQueryFn,
  type FetchArgs,
  type FetchBaseQueryError,
} from '@reduxjs/toolkit/query/react';
import { API_BASE_URL } from '@/config/env';
import { tokenStore } from '@/features/auth/tokenStore';
import { refreshAccessToken } from './refreshClient';

/**
 * =============================================================================
 * THE RTK QUERY API SLICE
 * =============================================================================
 * WHAT `useAsyncData` (Phase 7) COULD NOT DO, and this can:
 *
 *   CACHING              two components asking for the same data share one
 *                        cache entry. Navigate away and back inside the cache
 *                        window and there is no request at all.
 *   DEDUPLICATION        five components mounting at once with the same query
 *                        produce ONE network request.
 *   INVALIDATION         create a task and the list refetches itself, because
 *                        the mutation declares which tags it invalidates. No
 *                        manual `refetch()` scattered across call sites.
 *   BACKGROUND REFETCH   refetch on window focus / reconnect, so a tab left
 *                        open overnight is not showing yesterday's data.
 *   REFERENCE COUNTING   when the last component using a query unmounts, the
 *                        entry is kept for `keepUnusedDataFor` seconds and then
 *                        dropped. Memory does not grow without bound.
 *
 * Each of those is a hundred-odd lines to build properly, and invalidation
 * across a real app is genuinely hard to get right.
 *
 * -----------------------------------------------------------------------------
 * ONE API SLICE, MANY FILES
 * -----------------------------------------------------------------------------
 * This file defines an EMPTY api and features add endpoints with
 * `injectEndpoints`. That is not ceremony:
 *   - one slice means one cache and one middleware, so tags work ACROSS
 *     features (a project mutation can invalidate a task list)
 *   - injection keeps endpoint definitions next to the feature that owns them,
 *     which is the same feature-folder boundary the whole project follows
 *   - it is what makes code-splitting an endpoint possible at all
 *
 * ANGULAR BRIDGE: closest to a service + an NgRx entity cache + effects,
 * collapsed into one declaration. There is no direct Angular equivalent - RTK
 * Query's nearest neighbour in that ecosystem is Apollo or TanStack Query.
 * =============================================================================
 */

/**
 * The standard base query, extended with two concerns.
 */
const baseQuery = fetchBaseQuery({
  /**
   * RESOLVED TO AN ABSOLUTE URL, matching what `httpClient` already did.
   *
   * `API_BASE_URL` is the relative `/api/v1` by default (see config/env.ts -
   * one relative path, correct in dev behind the Vite proxy and in prod behind
   * nginx). A browser resolves that against the current origin without being
   * asked.
   *
   * NODE DOES NOT. undici's `Request` constructor throws
   * `Failed to parse URL from /api/v1/tasks` on a relative string - which meant
   * every RTK Query call failed instantly under Vitest, and the failure was
   * invisible because nothing tested this transport until now.
   *
   * THE INCONSISTENCY THIS FIXES: `httpClient` always did
   * `new URL(path, window.location.origin)`. `fetchBaseQuery` did not. Two
   * transports in the same app resolving URLs differently is the kind of
   * divergence that produces "works in the app, fails in tests" - and here it
   * also meant one of them could not be integration-tested at all.
   *
   * `new URL(absolute, base)` returns the absolute one unchanged, so the
   * `VITE_API_BASE_URL` override (pointing a local frontend at staging) still
   * works exactly as before.
   */
  baseUrl: new URL(API_BASE_URL, window.location.origin).toString(),

  /**
   * `credentials: 'include'` - the httpOnly refresh cookie and the CSRF cookie
   * ride along. Same requirement as `httpClient`, same consequence if omitted:
   * every refresh 401s and it looks like broken auth.
   */
  credentials: 'include',

  /**
   * `prepareHeaders` IS RTK QUERY'S REQUEST INTERCEPTOR.
   *
   * It runs before every request and can read `getState()` - which is why the
   * store is the right home for anything the transport needs.
   *
   * NOTE it reads `tokenStore`, not the Redux state, for the ACCESS TOKEN. The
   * token deliberately lives outside Redux: putting a credential in the store
   * would put it in the devtools log and in any state-persistence layer added
   * later. The USER goes in Redux (it drives UI); the TOKEN stays in a module
   * variable (it drives requests).
   */
  prepareHeaders: (headers) => {
    const token = tokenStore.get();
    if (token) headers.set('Authorization', `Bearer ${token}`);

    /**
     * THE CSRF DOUBLE-SUBMIT HEADER, same as httpClient.
     *
     * The backend's CsrfGuard compares this header against the non-httpOnly
     * `taskflow_csrf` cookie with `timingSafeEqual`. An attacker's page can
     * make the browser SEND our cookies but cannot READ them, so it cannot set
     * this header - which is the entire mechanism.
     */
    const csrf = document.cookie
      .split('; ')
      .find((row) => row.startsWith('taskflow_csrf='))
      ?.split('=')[1];
    if (csrf) headers.set('x-csrf-token', csrf);

    return headers;
  },
});

/**
 * =============================================================================
 * baseQueryWithReauth - the 401 interceptor
 * =============================================================================
 * IT REUSES `refreshAccessToken` FROM PHASE 7, and that reuse is the point.
 *
 * The single-flight promise lives in `refreshClient`, so BOTH transports -
 * `httpClient` and RTK Query - share one in-flight refresh. Six RTK Query
 * queries and one httpClient call all 401ing at once still produce exactly ONE
 * refresh request.
 *
 * Implementing the refresh separately inside this file would give two
 * independent single-flight guards, which is not single-flight at all: two
 * concurrent refreshes, the second presenting a token the first just spent,
 * and the backend revoking the session family for suspected token theft.
 *
 * That is a genuinely subtle bug, and it is avoided here by putting the
 * mechanism in a layer BELOW both callers rather than inside either.
 * =============================================================================
 */
const baseQueryWithReauth: BaseQueryFn<
  string | FetchArgs,
  unknown,
  FetchBaseQueryError
> = async (args, api, extraOptions) => {
  let result = await baseQuery(args, api, extraOptions);

  /**
   * TWO CONDITIONS, each preventing a specific bug:
   *
   *   401 only       a 403 means "authenticated but not allowed" - refreshing
   *                  gives the same user the same denial.
   *   had a token    a 401 on a request that carried none means the user is
   *                  simply logged out. Refreshing would fire a pointless
   *                  request on every anonymous page load.
   *
   * And ONE retry, never a loop. If the replayed request 401s again, that
   * result is returned as-is.
   */
  if (result.error?.status === 401 && tokenStore.get() !== null) {
    try {
      await refreshAccessToken();
      // Replay. `prepareHeaders` runs again and picks up the new token from
      // tokenStore, so there is nothing to thread through by hand.
      result = await baseQuery(args, api, extraOptions);
    } catch {
      /**
       * The refresh failed - the session is genuinely over.
       *
       * `refreshAccessToken` already called `tokenStore.expire()`, which
       * `SessionBootstrap` turns into a `sessionExpired` action, which flips
       * the store to anonymous and lets RequireAuth redirect.
       *
       * We swallow the refresh error and return the ORIGINAL 401 - the more
       * useful result for the caller: "this request was unauthorised", not
       * "a refresh you never asked for failed".
       */
    }
  }

  return result;
};

export const apiSlice = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithReauth,

  /**
   * ===========================================================================
   * TAG TYPES - the whole cache-invalidation model in one array
   * ===========================================================================
   * A tag is a label. Queries PROVIDE tags; mutations INVALIDATE them. When a
   * mutation invalidates a tag, every cached query providing it is refetched.
   *
   *     useGetTasksQuery       provides  [{type:'Task', id:'LIST'}, ...ids]
   *     useCreateTaskMutation  invalidates [{type:'Task', id:'LIST'}]
   *                            -> the list refetches, automatically
   *
   * WHY THIS BEATS MANUAL REFETCHING: with `useAsyncData` the create form has
   * to know that the list exists and call its `refetch`. That coupling
   * multiplies - a task created from a modal, a board, a keyboard shortcut and
   * a bulk import all need to remember. Tags invert it: the LIST declares what
   * it depends on, and mutations declare what they change. Neither knows about
   * the other.
   *
   * DECLARING TAG TYPES HERE, centrally, is what lets a project mutation
   * invalidate a task list - cross-feature invalidation that would be
   * impossible with one api slice per feature.
   * ===========================================================================
   */
  tagTypes: ['Task', 'Project', 'User', 'Comment', 'Notification'],

  /**
   * 60 seconds (default). After the last component using an entry unmounts,
   * RTK Query keeps it this long before evicting - so navigating away and
   * straight back is instant and makes no request.
   *
   * Tune it per data shape: a dashboard stat can live longer, a live queue
   * shorter. Setting it to 0 turns off caching entirely and is almost never
   * what you want.
   */
  keepUnusedDataFor: 60,

  /**
   * `endpoints: () => ({})` - INTENTIONALLY EMPTY. Features inject their own
   * with `apiSlice.injectEndpoints`, keeping definitions in the feature folder
   * while sharing one cache, one middleware and one tag namespace.
   */
  endpoints: () => ({}),
});
