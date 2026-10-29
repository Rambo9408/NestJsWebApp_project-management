import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HttpResponse, http } from 'msw';
import { server } from '@/test/msw/server';
import { authState, callCounts } from '@/test/msw/handlers';
import { http as client, HttpError } from './httpClient';
import { tokenStore } from '@/features/auth/tokenStore';
import { __resetRefreshState } from './refreshClient';
import type { Paginated } from '@/types/api';

/**
 * =============================================================================
 * INTEGRATION TESTS - the transport, exercised for real
 * =============================================================================
 * THE GAP THESE FILL. Every test written before this one either stubbed `fetch`
 * or injected a fake function. Both are correct for a UNIT test and both share
 * a blind spot: `httpClient` could be completely broken and the suite would
 * stay green.
 *
 * What was untested until now:
 *   - the URL it builds (base path, version prefix, query params)
 *   - the `Authorization` header
 *   - the CSRF double-submit header
 *   - `credentials: 'include'`
 *   - the 401 -> refresh -> RETRY WITH THE NEW TOKEN path
 *   - single-flight across concurrent 401s
 *   - error normalisation into `HttpError`
 *   - the 204 branch that must not call `.json()`
 *
 * That list is most of the interesting behaviour in the file.
 *
 * MSW answers the socket, so all of it genuinely runs. These are INTEGRATION
 * tests in the useful sense: several real units, one fake boundary - and the
 * boundary is the one we do not own.
 * =============================================================================
 */

beforeAll(() => {
  /**
   * `onUnhandledRequest: 'error'` - and this is the setting worth arguing for.
   *
   * The default warns and lets the request through to the real network. In CI
   * that means a test can silently depend on an actual server, pass locally,
   * and fail mysteriously in the pipeline - or worse, pass in the pipeline
   * because something WAS listening.
   *
   * Failing loudly on an unhandled request turns "I forgot a handler" into an
   * immediate, named error. It also catches the case where a refactor changes a
   * URL: the request no longer matches, and the test says so.
   */
  server.listen({ onUnhandledRequest: 'error' });
});

// Handlers added inside a test (`server.use`) are removed here, so one test
// cannot leak an override into the next - a classic source of order-dependent
// failures that only appear when someone runs the suite with `--shuffle`.
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
  // jsdom shares `document.cookie` across tests in a file.
  document.cookie = 'taskflow_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
});

describe('httpClient (integration)', () => {
  it('builds the versioned URL and serialises query params', async () => {
    tokenStore.set('access-token-1');

    let seenUrl = '';
    server.use(
      http.get('/api/v1/tasks', ({ request }) => {
        seenUrl = request.url;
        return HttpResponse.json({ items: [], total: 0, page: 1, limit: 20, totalPages: 0 });
      }),
    );

    await client.get<Paginated<unknown>>('/tasks', {
      params: { page: 2, status: 'todo', search: undefined, priority: null },
    });

    expect(seenUrl).toContain('/api/v1/tasks');
    expect(seenUrl).toContain('page=2');
    expect(seenUrl).toContain('status=todo');
    /**
     * THE UNDEFINED/NULL DROP, asserted on the real wire.
     *
     * `String(undefined)` is the literal "undefined", and the backend's
     * ValidationPipe would reject `?search=undefined` as an invalid value -
     * turning an absent filter into a 400. A unit test on the params object
     * could not catch this; the URL is where it becomes visible.
     */
    expect(seenUrl).not.toContain('search=');
    expect(seenUrl).not.toContain('priority=');
  });

  it('attaches the bearer token and the CSRF header', async () => {
    tokenStore.set('access-token-1');
    document.cookie = 'taskflow_csrf=csrf-value-1; path=/';

    let authHeader: string | null = null;
    let csrfHeader: string | null = null;
    server.use(
      http.post('/api/v1/tasks', ({ request }) => {
        authHeader = request.headers.get('authorization');
        csrfHeader = request.headers.get('x-csrf-token');
        return HttpResponse.json({ id: 'task-1' }, { status: 201 });
      }),
    );

    await client.post('/tasks', { title: 'A task' });

    expect(authHeader).toBe('Bearer access-token-1');
    /**
     * THE DOUBLE-SUBMIT COOKIE PATTERN, end to end. The client reads the
     * non-httpOnly cookie and echoes it in a header; the backend compares them
     * with `timingSafeEqual`.
     *
     * Nothing before this asserted that the cookie is actually read - the CSRF
     * code could have been deleted and every earlier test would still pass.
     */
    expect(csrfHeader).toBe('csrf-value-1');
  });

  it('sends NO Authorization header when there is no token', async () => {
    // `Bearer null` is worse than nothing - some servers reject a malformed
    // header outright rather than treating it as absent.
    let authHeader: string | null = 'not-checked';
    server.use(
      http.get('/api/v1/tasks', ({ request }) => {
        authHeader = request.headers.get('authorization');
        return HttpResponse.json({ items: [], total: 0, page: 1, limit: 20, totalPages: 0 });
      }),
    );

    await client.get('/tasks');

    expect(authHeader).toBeNull();
  });

  it('returns undefined for 204 rather than throwing on an empty body', async () => {
    tokenStore.set('access-token-1');

    // `.json()` on an empty response throws a SyntaxError. The 204 branch is a
    // contract requirement, not defensive padding - logout and delete use it.
    await expect(client.post<void>('/auth/logout')).resolves.toBeUndefined();
  });

  it('normalises an error body into an HttpError with the parsed payload', async () => {
    server.use(
      http.post('/api/v1/auth/register', () =>
        HttpResponse.json(
          {
            success: false,
            statusCode: 400,
            message: ['email must be a valid email address', 'name must be longer'],
            error: 'BadRequestException',
            path: '/api/v1/auth/register',
            timestamp: '2026-08-20T00:00:00.000Z',
            requestId: 'req-9',
          },
          { status: 400 },
        ),
      ),
    );

    await expect(client.post('/auth/register', {})).rejects.toThrow(HttpError);

    try {
      await client.post('/auth/register', {});
      expect.unreachable('should have thrown');
    } catch (error) {
      // The parsed body must survive, because `applyServerErrors` maps the
      // per-field `message` array onto form fields.
      expect(error).toBeInstanceOf(HttpError);
      const httpError = error as HttpError;
      expect(httpError.status).toBe(400);
      expect(httpError.body?.message).toHaveLength(2);
      expect(httpError.body?.requestId).toBe('req-9');
    }
  });

  describe('401 handling', () => {
    it('refreshes and RETRIES WITH THE NEW TOKEN', async () => {
      /**
       * =====================================================================
       * THE MOST VALUABLE TEST IN THIS FILE
       * =====================================================================
       * The MSW handler for /tasks 401s any request carrying the stale token.
       * So this only passes if the client:
       *   1. notices the 401
       *   2. calls /auth/refresh
       *   3. REBUILDS the request with the NEW token
       *
       * Step 3 is the one that is easy to get wrong - a retry that re-reads a
       * stale variable, or replays the original Request object, fails here and
       * would have passed against a stubbed fetch.
       * =====================================================================
       */
      tokenStore.set('access-token-1');
      authState.accessTokenValid = false;

      const result = await client.get<Paginated<unknown>>('/tasks');

      expect(callCounts.refresh).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(tokenStore.get()).toBe('access-token-2');
    });

    it('makes ONE refresh for six concurrent 401s', async () => {
      /**
       * SINGLE-FLIGHT, THROUGH THE REAL TRANSPORT.
       *
       * `refreshClient.test.ts` already covers this with a stubbed fetch. This
       * covers it end to end, which matters because the two mechanisms are in
       * different files: the promise cache lives in `refreshClient`, the retry
       * decision in `httpClient`. Either could break the other.
       *
       * WHY IT MATTERS: the backend ROTATES refresh tokens and treats reuse as
       * theft. Six concurrent refreshes present the same token six times, and
       * the backend revokes the whole session family in response - logging the
       * user out on every token expiry.
       */
      tokenStore.set('access-token-1');
      authState.accessTokenValid = false;

      const results = await Promise.all([
        client.get<Paginated<unknown>>('/tasks'),
        client.get<Paginated<unknown>>('/tasks'),
        client.get<Paginated<unknown>>('/tasks'),
        client.get<Paginated<unknown>>('/tasks'),
        client.get<Paginated<unknown>>('/tasks'),
        client.get<Paginated<unknown>>('/tasks'),
      ]);

      expect(callCounts.refresh).toBe(1);
      expect(results).toHaveLength(6);
      results.forEach((result) => {
        expect(result.items).toHaveLength(1);
      });
    });

    it('does NOT refresh when there was no token to begin with', async () => {
      /**
       * A 401 on a request that carried no token means the user is simply
       * logged out. Refreshing would fire a pointless request on every
       * anonymous page load - and, because the refresh cookie is absent too, it
       * would fail and expire a session that never existed.
       */
      await expect(client.get('/tasks')).rejects.toThrow(HttpError);
      expect(callCounts.refresh).toBe(0);
    });

    it('does NOT retry the auth endpoints themselves', async () => {
      /**
       * A failed LOGIN 401s because the password is wrong, not because a token
       * expired. Retrying would double every wrong-password attempt - and,
       * without `skipAuthRetry`, a 401 from the refresh endpoint would trigger
       * another refresh, which 401s, which triggers another. That is the
       * infinite loop.
       */
      tokenStore.set('access-token-1');

      await expect(
        client.post('/auth/login', { email: 'ada@example.com', password: 'wrong' }, { skipAuthRetry: true }),
      ).rejects.toThrow(HttpError);

      expect(callCounts.refresh).toBe(0);
    });

    it('surfaces the ORIGINAL 401 when the refresh fails', async () => {
      /**
       * The caller asked for tasks. Telling them "the refresh you never
       * requested failed" is less useful than "this request was unauthorised".
       *
       * And the session must end: `refreshAccessToken` calls
       * `tokenStore.expire()`, which the provider turns into a logout.
       */
      tokenStore.set('access-token-1');
      authState.accessTokenValid = false;
      authState.refreshSucceeds = false;

      await expect(client.get('/tasks')).rejects.toMatchObject({ status: 401 });
      expect(tokenStore.get()).toBeNull();
    });
  });
});
