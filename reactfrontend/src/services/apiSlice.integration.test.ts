import { configureStore } from '@reduxjs/toolkit';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HttpResponse, http } from 'msw';
import { server } from '@/test/msw/server';
import { authState, callCounts } from '@/test/msw/handlers';
import { apiSlice } from './apiSlice';
import { tasksApiSlice } from '@/features/tasks/tasksApiSlice';
import { tokenStore } from '@/features/auth/tokenStore';
import { __resetRefreshState } from './refreshClient';

/**
 * =============================================================================
 * THE RTK QUERY TRANSPORT - the SECOND reauth implementation
 * =============================================================================
 * WHY THIS FILE EXISTS: coverage showed `apiSlice.ts` at 22%, and that number
 * was hiding something specific rather than merely being low.
 *
 * There are TWO transports in this app:
 *
 *   httpClient          hand-rolled fetch wrapper. Auth calls, and anything
 *                       outside the RTK Query cache.
 *   apiSlice baseQuery  everything RTK Query fetches.
 *
 * Both attach the bearer token, both attach the CSRF header, and BOTH retry on
 * 401. The retry logic is written twice, in two files, in two different styles.
 * `httpClient.integration.test.ts` covers one of them; nothing covered the
 * other.
 *
 * THE RISK THAT CREATES: they share `refreshAccessToken` (deliberately - one
 * single-flight promise across both), but nothing else. A change to one is
 * invisible to the other's tests, and the failure mode is the nasty one -
 * concurrent refreshes tripping the backend's token-reuse detection and
 * revoking the session family.
 *
 * A duplicated mechanism needs duplicated tests, or the second copy rots.
 * =============================================================================
 */

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

beforeEach(() => {
  tokenStore.clear();
  __resetRefreshState();
  callCounts.reset();
  authState.reset();
  document.cookie = 'taskflow_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
});

/**
 * A FRESH STORE PER TEST.
 *
 * RTK Query's cache lives in the store, so a shared one would let a cached
 * result from test A satisfy test B - and B would pass without making a
 * request at all. Order-dependent green is worse than red.
 */
function makeStore() {
  return configureStore({
    reducer: { [apiSlice.reducerPath]: apiSlice.reducer },
    middleware: (getDefault) => getDefault().concat(apiSlice.middleware),
  });
}

describe('apiSlice baseQuery (integration)', () => {
  it('attaches the bearer token and the CSRF header via prepareHeaders', async () => {
    tokenStore.set('access-token-1');
    document.cookie = 'taskflow_csrf=csrf-rtk-1; path=/';

    let authHeader: string | null = null;
    let csrfHeader: string | null = null;
    server.use(
      http.get('/api/v1/tasks', ({ request }) => {
        authHeader = request.headers.get('authorization');
        csrfHeader = request.headers.get('x-csrf-token');
        return HttpResponse.json({ items: [], total: 0, page: 1, limit: 20, totalPages: 0 });
      }),
    );

    const store = makeStore();
    await store.dispatch(tasksApiSlice.endpoints.getTasks.initiate({ limit: 20 }));

    expect(authHeader).toBe('Bearer access-token-1');
    // `prepareHeaders` reads the cookie independently of httpClient. Two
    // implementations, so two assertions - the whole point of this file.
    expect(csrfHeader).toBe('csrf-rtk-1');
  });

  it('refreshes on 401 and RETRIES WITH THE NEW TOKEN', async () => {
    /**
     * The MSW handler rejects `access-token-1` permanently once invalidated, so
     * this can only pass if the replayed request carries `access-token-2`.
     *
     * That matters more here than in httpClient: RTK Query's retry re-invokes
     * `baseQuery`, which re-runs `prepareHeaders`, which re-reads `tokenStore`.
     * It works because the refresh writes the new token to the store BEFORE the
     * replay - an ordering dependency that is invisible in the code and would
     * break silently if someone reordered those two lines.
     */
    tokenStore.set('access-token-1');
    authState.accessTokenValid = false;

    const store = makeStore();
    const result = await store.dispatch(
      tasksApiSlice.endpoints.getTasks.initiate({ limit: 20 }),
    );

    expect(callCounts.refresh).toBe(1);
    expect(result.data?.items).toHaveLength(1);
    expect(tokenStore.get()).toBe('access-token-2');
  });

  it('shares ONE refresh with httpClient rather than starting its own', async () => {
    /**
     * =========================================================================
     * THE TEST THAT JUSTIFIES SHARING `refreshAccessToken`
     * =========================================================================
     * Six RTK Query calls all 401 at once - the shape of any real dashboard.
     *
     * If `apiSlice` had its own single-flight guard instead of reusing the one
     * in `refreshClient`, this would still pass. What would NOT pass is a mixed
     * workload, because two independent guards are not single-flight at all.
     *
     * The backend rotates refresh tokens and treats reuse as theft: two
     * concurrent refreshes present the same token twice and the session family
     * is revoked. The user is logged out, apparently at random, whenever a
     * token happens to expire while several requests are in flight.
     * =========================================================================
     */
    tokenStore.set('access-token-1');
    authState.accessTokenValid = false;

    const store = makeStore();

    // Six DISTINCT cache keys, so RTK Query's own deduplication cannot be what
    // collapses them - if the count is 1, it is the shared refresh promise.
    await Promise.all([
      store.dispatch(tasksApiSlice.endpoints.getTasks.initiate({ limit: 1 })),
      store.dispatch(tasksApiSlice.endpoints.getTasks.initiate({ limit: 2 })),
      store.dispatch(tasksApiSlice.endpoints.getTasks.initiate({ limit: 3 })),
      store.dispatch(tasksApiSlice.endpoints.getTasks.initiate({ limit: 4 })),
      store.dispatch(tasksApiSlice.endpoints.getTasks.initiate({ limit: 5 })),
      store.dispatch(tasksApiSlice.endpoints.getTasks.initiate({ limit: 6 })),
    ]);

    expect(callCounts.refresh).toBe(1);
  });

  it('does NOT refresh when there was no token', async () => {
    // A 401 with no token means logged out, not expired. Refreshing would fire
    // a pointless request on every anonymous page load.
    const store = makeStore();
    const result = await store.dispatch(
      tasksApiSlice.endpoints.getTasks.initiate({ limit: 20 }),
    );

    expect(result.error).toBeDefined();
    expect(callCounts.refresh).toBe(0);
  });

  it('returns the original error when the refresh fails, and ends the session', async () => {
    tokenStore.set('access-token-1');
    authState.accessTokenValid = false;
    authState.refreshSucceeds = false;

    const store = makeStore();
    const result = await store.dispatch(
      tasksApiSlice.endpoints.getTasks.initiate({ limit: 20 }),
    );

    expect(result.error).toBeDefined();
    // `refreshAccessToken` called `tokenStore.expire()`, which SessionBootstrap
    // turns into a `sessionExpired` action and a redirect to /login.
    expect(tokenStore.get()).toBeNull();
  });

  it('surfaces the backend error body so ErrorState can render field messages', async () => {
    /**
     * RTK Query wraps failures as `{ status, data }`. `ErrorState` unwraps
     * `.data` and reuses the SAME `isApiError` parser the httpClient path uses -
     * one error contract, one parser, two transports.
     *
     * Without this the per-field validation messages the backend deliberately
     * preserves as an array would never reach the screen.
     */
    tokenStore.set('access-token-1');
    server.use(
      http.get('/api/v1/tasks', () =>
        HttpResponse.json(
          {
            success: false,
            statusCode: 400,
            message: ['status must be one of: todo, in_progress, in_review, done'],
            error: 'BadRequestException',
            path: '/api/v1/tasks',
            timestamp: '2026-08-20T00:00:00.000Z',
            requestId: 'req-rtk-1',
          },
          { status: 400 },
        ),
      ),
    );

    const store = makeStore();
    const result = await store.dispatch(
      tasksApiSlice.endpoints.getTasks.initiate({ limit: 20 }),
    );

    expect(result.error).toMatchObject({
      status: 400,
      data: { requestId: 'req-rtk-1' },
    });
  });
});
