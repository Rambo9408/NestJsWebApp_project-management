import { act, renderHook, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { useNotificationStream } from './useNotificationStream';
import { notificationsApiSlice } from './notificationsApiSlice';
import { apiSlice } from '@/services/apiSlice';
import authReducer, { sessionRestored } from '@/features/auth/authSlice';
import uiReducer, { selectToasts } from '@/features/ui/uiSlice';
import { tokenStore } from '@/features/auth/tokenStore';
import { __resetRefreshState } from '@/services/refreshClient';
import { NotificationType, Role, type Notification, type User } from '@/types/api';

/**
 * =============================================================================
 * TESTING AN SSE HOOK
 * =============================================================================
 * jsdom HAS NO `EventSource`. Rather than a fragile partial mock, this
 * implements a tiny fake that records instances and exposes the handlers, so a
 * test can drive `open`, `message` and `error` deliberately.
 *
 * WHY A HAND-ROLLED FAKE RATHER THAN A LIBRARY: the behaviour under test is our
 * RECONNECT POLICY, not the browser's SSE implementation. A fake that lets us
 * fire `onerror` on demand tests exactly the logic we wrote; a real
 * EventSource-over-MSW would mostly test the browser.
 * =============================================================================
 */

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  url: string;
  withCredentials: boolean;
  closed = false;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>();

  constructor(url: string, init?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = init?.withCredentials ?? false;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: (event: MessageEvent<string>) => void) {
    const existing = this.listeners.get(type) ?? [];
    this.listeners.set(type, [...existing, handler]);
  }

  close() {
    this.closed = true;
  }

  /** Test helper - deliver a named SSE event. */
  emit(type: string, data: string) {
    for (const handler of this.listeners.get(type) ?? []) {
      handler({ data } as MessageEvent<string>);
    }
  }
}

const user: User = {
  id: 'user-1',
  email: 'ada@example.com',
  name: 'Ada',
  role: Role.MEMBER,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

function makeNotification(id: string): Notification {
  return {
    id,
    userId: user.id,
    type: NotificationType.TASK_ASSIGNED,
    title: `Task ${id} assigned to you`,
    body: 'Have a look when you get a chance.',
    meta: {},
    readAt: null,
    createdAt: '2026-08-20T10:00:00.000Z',
  };
}

async function setup({ authenticated = true } = {}) {
  const store = configureStore({
    reducer: {
      auth: authReducer,
      ui: uiReducer,
      [apiSlice.reducerPath]: apiSlice.reducer,
    },
    middleware: (getDefault) => getDefault().concat(apiSlice.middleware),
  });

  if (authenticated) {
    store.dispatch(sessionRestored({ user }));
    tokenStore.set('access-token-1');
  }

  /**
   * SEED THE CACHES THE HOOK PATCHES - and AWAIT them.
   *
   * `updateQueryData` against an entry that does not exist is a SILENT NO-OP.
   * That is correct behaviour, and it means every assertion below would pass
   * vacuously against an empty cache if the seeding had not landed.
   *
   * `upsertQueryData` is ASYNC, so dispatching without awaiting leaves a window
   * where the entry is not there yet. The first draft of this file fell into
   * exactly that window: two tests failed with "expected [] to have a length of
   * 1", which reads like a bug in the hook and was a bug in the setup.
   *
   * Worth keeping as a note: when a cache assertion fails, check the cache was
   * actually populated before blaming the code under test.
   */
  await store.dispatch(
    notificationsApiSlice.util.upsertQueryData('getNotifications', { limit: 20 }, {
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    }),
  );
  await store.dispatch(
    notificationsApiSlice.util.upsertQueryData('getUnreadCount', undefined, { unread: 0 }),
  );

  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );

  return { store, wrapper };
}

describe('useNotificationStream', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    __resetRefreshState();
    tokenStore.clear();
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('does NOT open a connection when signed out', async () => {
    /**
     * An anonymous stream 401s immediately and then retries forever - a request
     * every few seconds for nothing, on the login page, for every visitor.
     */
    const { wrapper } = await setup({ authenticated: false });
    const { result } = renderHook(() => useNotificationStream(), { wrapper });

    expect(FakeEventSource.instances).toHaveLength(0);
    expect(result.current.connected).toBe(false);
  });

  it('puts the access token in the query string, because EventSource cannot set headers', async () => {
    /**
     * THE DEFINING CONSTRAINT OF THIS HOOK. `EventSource` has no options
     * argument for headers, so `Authorization: Bearer` is unavailable and the
     * backend added `fromUrlQueryParameter('access_token')` specifically for it.
     *
     * Asserting the URL shape pins the client half of that contract.
     */
    const { wrapper } = await setup();
    renderHook(() => useNotificationStream(), { wrapper });

    const [source] = FakeEventSource.instances;
    expect(source?.url).toContain('/notifications/stream?access_token=access-token-1');
    expect(source?.withCredentials).toBe(true);
  });

  it('pushes an arriving notification into the cache without refetching', async () => {
    const { store, wrapper } = await setup();
    renderHook(() => useNotificationStream(), { wrapper });

    const [source] = FakeEventSource.instances;
    act(() => {
      source?.emit('notification', JSON.stringify(makeNotification('n1')));
    });

    await waitFor(() => {
      const cached = notificationsApiSlice.endpoints.getNotifications.select({ limit: 20 })(
        store.getState(),
      );
      expect(cached.data?.items).toHaveLength(1);
    });

    const count = notificationsApiSlice.endpoints.getUnreadCount.select(undefined)(
      store.getState(),
    );
    expect(count.data?.unread).toBe(1);

    // And a toast, so a notification arriving while the user is on another page
    // is not silently added to a badge they are not looking at.
    expect(selectToasts(store.getState())).toHaveLength(1);
  });

  it('normalises the SSE frame - readAt must be null, not undefined', async () => {
    /**
     * =========================================================================
     * A REAL BUG, CAUGHT BY CAPTURING AN ACTUAL FRAME
     * =========================================================================
     * The stream publishes `NotificationEvent`, which is NARROWER than the
     * `NotificationView` the REST endpoints return - it has NO `readAt`. A
     * just-published notification is unread by definition, so the server omits
     * the field.
     *
     * Parsing the frame directly as a `Notification` therefore yields
     * `readAt === undefined`. Every unread check in the app is `readAt ===
     * null`, so:
     *   - the item rendered as ALREADY READ (no bold, no tint)
     *   - clicking it did nothing, because the mark-read guard is also `=== null`
     *   - the badge counted it anyway
     *
     * Visibly inconsistent, and entirely caused by a client type claiming a
     * field the wire does not send.
     *
     * THE PAYLOAD BELOW IS DELIBERATELY MISSING `readAt` - copied from a real
     * captured frame. Reinstating the naive cast makes this test fail.
     * =========================================================================
     */
    const { store, wrapper } = await setup();
    renderHook(() => useNotificationStream(), { wrapper });

    const frameWithoutReadAt = {
      id: 'n-sse',
      userId: user.id,
      type: NotificationType.TASK_ASSIGNED,
      title: 'OPS-1 assigned to you',
      body: '"Assigned via SSE test" is now yours.',
      meta: { taskId: 't1', reference: 'OPS-1' },
      createdAt: '2026-08-20T11:30:39.163Z',
      // NO readAt - exactly as the backend sends it.
    };

    act(() => {
      FakeEventSource.instances[0]?.emit('notification', JSON.stringify(frameWithoutReadAt));
    });

    await waitFor(() => {
      const cached = notificationsApiSlice.endpoints.getNotifications.select({ limit: 20 })(
        store.getState(),
      );
      expect(cached.data?.items).toHaveLength(1);
    });

    const cached = notificationsApiSlice.endpoints.getNotifications.select({ limit: 20 })(
      store.getState(),
    );

    // `toBeNull`, NOT `toBeFalsy` - `undefined` is falsy too, and would pass a
    // looser assertion while leaving the bug in place.
    expect(cached.data?.items[0]?.readAt).toBeNull();
  });

  it('ignores a DUPLICATE notification id', async () => {
    /**
     * SSE has a `Last-Event-ID` replay mechanism, and a reconnect racing an
     * optimistic insert can deliver the same notification twice. A duplicate in
     * a notification list is very visible, so the hook dedupes by id.
     */
    const { store, wrapper } = await setup();
    renderHook(() => useNotificationStream(), { wrapper });

    const [source] = FakeEventSource.instances;
    const payload = JSON.stringify(makeNotification('n1'));

    act(() => {
      source?.emit('notification', payload);
      source?.emit('notification', payload);
    });

    await waitFor(() => {
      const cached = notificationsApiSlice.endpoints.getNotifications.select({ limit: 20 })(
        store.getState(),
      );
      expect(cached.data?.items).toHaveLength(1);
    });
  });

  it('survives a malformed frame instead of tearing down the stream', async () => {
    const { wrapper } = await setup();
    renderHook(() => useNotificationStream(), { wrapper });

    const [source] = FakeEventSource.instances;

    // A JSON.parse throw here would surface as an unhandled error and tell the
    // user nothing. The stream must keep running.
    expect(() => {
      act(() => {
        source?.emit('notification', 'not json at all');
      });
    }).not.toThrow();

    expect(source?.closed).toBe(false);
  });

  it('IGNORES the heartbeat without any special handling', async () => {
    /**
     * The backend sends a `ping` event every 30 seconds to stop intermediaries
     * closing an idle connection. Because the hook listens for the NAMED
     * `notification` event rather than `onmessage`, the heartbeat is filtered
     * for free - no parsing, no branch.
     *
     * That is why the backend bothers to name its events, and this asserts the
     * client half of the arrangement.
     */
    const { store, wrapper } = await setup();
    renderHook(() => useNotificationStream(), { wrapper });

    const [source] = FakeEventSource.instances;
    act(() => {
      source?.emit('ping', JSON.stringify({ t: Date.now() }));
    });

    expect(selectToasts(store.getState())).toHaveLength(0);
  });

  it('closes the connection on unmount', async () => {
    /**
     * Without cleanup, every navigation that unmounts this leaves a connection
     * open. Six of those and the browser refuses to load anything else from the
     * origin - which presents as "images stopped loading", not as an SSE bug.
     */
    const { wrapper } = await setup();
    const { unmount } = renderHook(() => useNotificationStream(), { wrapper });

    unmount();

    expect(FakeEventSource.instances[0]?.closed).toBe(true);
  });

  it('reconnects with a FRESH token after an error', async () => {
    /**
     * =========================================================================
     * THE TEST THIS WHOLE HOOK EXISTS FOR
     * =========================================================================
     * EventSource reconnects automatically - to the SAME URL, which still
     * carries the EXPIRED token. It 401s, reconnects, 401s, forever. The URL
     * was fixed at construction, so the built-in retry can never pick up a new
     * token.
     *
     * The bug only appears ~15 minutes into a session, long after anyone
     * testing manually has moved on. So: close, refresh, build a NEW
     * EventSource with a NEW url.
     * =========================================================================
     */
    vi.useFakeTimers();

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ accessToken: 'access-token-2' }),
    } as Response);

    const { wrapper } = await setup();
    renderHook(() => useNotificationStream(), { wrapper });

    const first = FakeEventSource.instances[0];
    expect(first?.url).toContain('access-token-1');

    await act(async () => {
      first?.onerror?.();
      // First backoff step is 1s. Advancing past it triggers the refresh.
      await vi.advanceTimersByTimeAsync(1100);
    });

    expect(first?.closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(2);
    // THE ASSERTION: the new connection carries the REFRESHED token.
    expect(FakeEventSource.instances[1]?.url).toContain('access-token-2');
  });

  it('backs off exponentially rather than hammering a downed server', async () => {
    /**
     * A fixed 1-second retry against a backend that is down is a self-inflicted
     * denial of service - every client in a loop against a server already
     * struggling.
     *
     * This asserts the SECOND failure waits longer than the first: no new
     * connection at 1.1s, one by 2.2s.
     */
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ accessToken: 'access-token-2' }),
    } as Response);

    const { wrapper } = await setup();
    renderHook(() => useNotificationStream(), { wrapper });

    await act(async () => {
      FakeEventSource.instances[0]?.onerror?.();
      await vi.advanceTimersByTimeAsync(1100);
    });
    expect(FakeEventSource.instances).toHaveLength(2);

    // Second failure: the delay doubles to 2s, so nothing new at 1.1s.
    await act(async () => {
      FakeEventSource.instances[1]?.onerror?.();
      await vi.advanceTimersByTimeAsync(1100);
    });
    expect(FakeEventSource.instances).toHaveLength(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    expect(FakeEventSource.instances).toHaveLength(3);
  });
});
