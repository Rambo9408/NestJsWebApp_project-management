import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetRefreshState, refreshAccessToken } from './refreshClient';
import { tokenStore } from '@/features/auth/tokenStore';

/**
 * =============================================================================
 * THE MOST IMPORTANT TEST IN PHASE 7
 * =============================================================================
 * Without single-flight, six concurrent 401s cause six refreshes. Because the
 * backend ROTATES refresh tokens and treats reuse as theft, five of those six
 * present an already-spent token - and the backend revokes the entire session
 * family in response.
 *
 * The user is logged out. On every token expiry. And it looks random, because
 * it only fires when several requests are in flight together - which is to say,
 * on any real dashboard, and never in a single-request manual test.
 *
 * This test would fail loudly against the naive implementation, which is
 * exactly what makes it worth having.
 * =============================================================================
 */
describe('refreshAccessToken', () => {
  beforeEach(() => {
    __resetRefreshState();
    tokenStore.clear();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('makes ONE network call for many concurrent callers', async () => {
    /**
     * A DEFERRED PROMISE keeps the "request" in flight while all six callers
     * arrive. Resolving immediately would let each call complete before the
     * next started, so the test would pass even without single-flight - a
     * false green, and the reason this is set up the long way.
     */
    let resolveFetch: (value: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.mocked(fetch).mockReturnValue(pending);

    // Six callers, as a dashboard would produce.
    const calls = [
      refreshAccessToken(),
      refreshAccessToken(),
      refreshAccessToken(),
      refreshAccessToken(),
      refreshAccessToken(),
      refreshAccessToken(),
    ];

    resolveFetch({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ accessToken: 'fresh-token' }),
    } as Response);

    const results = await Promise.all(calls);

    // THE ASSERTION THAT MATTERS.
    expect(fetch).toHaveBeenCalledTimes(1);
    // Everybody got the same token, not five failures and one success.
    expect(results).toEqual(Array(6).fill('fresh-token'));
    expect(tokenStore.get()).toBe('fresh-token');
  });

  it('sends no body and includes credentials, so the httpOnly cookie is attached', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ accessToken: 'fresh-token' }),
    } as Response);

    await refreshAccessToken();

    const [, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    /**
     * `credentials: 'include'` is the whole mechanism. The refresh token is an
     * httpOnly cookie we cannot read; omitting this means it is never sent and
     * every refresh 401s - a bug that reads as "broken auth" and is one missing
     * option.
     */
    expect(init?.credentials).toBe('include');
    // No body: we deliberately never use the body-token path, because putting
    // the refresh token where JavaScript can read it defeats httpOnly.
    expect(init?.body).toBeUndefined();
  });

  it('starts a NEW attempt after a failure rather than caching the rejection', async () => {
    /**
     * THE `finally` TEST.
     *
     * Clearing the in-flight slot only on success would leave a permanently
     * rejected promise cached: every later request would await that same
     * rejection and the user could never recover without a hard reload.
     *
     * `finally` runs on both paths, so this second call must produce a real
     * second request.
     */
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 401 } as Response);

    await expect(refreshAccessToken()).rejects.toThrow(/session expired/i);
    expect(tokenStore.get()).toBeNull();

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ accessToken: 'second-chance' }),
    } as Response);

    await expect(refreshAccessToken()).resolves.toBe('second-chance');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('expires the session when the refresh token is rejected', async () => {
    const onExpire = vi.fn();
    const unsubscribe = tokenStore.onExpire(onExpire);
    tokenStore.set('stale-token');

    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 401 } as Response);

    await expect(refreshAccessToken()).rejects.toThrow();

    // The AuthProvider subscribes to this and flips to `anonymous`, which sends
    // the user to /login instead of leaving a page full of failed requests.
    expect(onExpire).toHaveBeenCalledOnce();
    expect(tokenStore.get()).toBeNull();

    unsubscribe();
  });
});
