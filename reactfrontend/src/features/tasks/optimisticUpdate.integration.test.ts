import { configureStore } from '@reduxjs/toolkit';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HttpResponse, http } from 'msw';
import { server } from '@/test/msw/server';
import { authState, callCounts } from '@/test/msw/handlers';
import { apiSlice } from '@/services/apiSlice';
import { tasksApiSlice } from './tasksApiSlice';
import { tokenStore } from '@/features/auth/tokenStore';
import { __resetRefreshState } from '@/services/refreshClient';
import { TaskStatus } from '@/types/api';

/**
 * =============================================================================
 * OPTIMISTIC UPDATES - and the rollback everyone forgets
 * =============================================================================
 * Coverage put `tasksApiSlice` at 21%, and the uncovered part was the most
 * intricate logic in the file: `onQueryStarted` on `changeTaskStatus`, which
 * patches every cached list, awaits the server, and undoes the patch on
 * failure.
 *
 * THE HAPPY PATH IS THE EASY HALF. Writing the patch is obvious; writing the
 * `catch` that undoes it is the part that gets skipped, and its absence is
 * invisible until a mutation fails in production - at which point the UI shows
 * a change that never happened, permanently, until the user reloads.
 *
 * AND THE FAILURE IS NOT HYPOTHETICAL HERE. The backend's status endpoint takes
 * `{ from, to }` as an optimistic-concurrency check and returns 409 if someone
 * else moved the task first - verified live in Phase 9:
 *
 *     409  Task PN-1 is in "in_progress", not "todo" - someone changed it first
 *
 * So the rollback path runs whenever two people touch the same task, which on a
 * shared board is routine rather than exceptional.
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
  tokenStore.set('access-token-1');
  __resetRefreshState();
  callCounts.reset();
  authState.reset();
});

function makeStore() {
  return configureStore({
    reducer: { [apiSlice.reducerPath]: apiSlice.reducer },
    middleware: (getDefault) => getDefault().concat(apiSlice.middleware),
  });
}

/** Reads the cached status for `task-1` in a given list query. */
function cachedStatus(store: ReturnType<typeof makeStore>, args: { limit: number }) {
  const entry = tasksApiSlice.endpoints.getTasks.select(args)(store.getState());
  return entry.data?.items.find((task) => task.id === 'task-1')?.status;
}

describe('changeTaskStatus optimistic update', () => {
  it('patches the cache BEFORE the server responds', async () => {
    /**
     * THE WHOLE POINT OF AN OPTIMISTIC UPDATE: the UI moves immediately.
     *
     * The handler below never resolves during the assertion window, so if the
     * cache already shows `in_progress` the patch must have been applied
     * without waiting for the network.
     *
     * A test that awaited the mutation first would pass even with no optimistic
     * update at all - it would just be testing the refetch.
     */
    const store = makeStore();
    await store.dispatch(tasksApiSlice.endpoints.getTasks.initiate({ limit: 20 }));
    expect(cachedStatus(store, { limit: 20 })).toBe(TaskStatus.TODO);

    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });

    server.use(
      http.patch('/api/v1/tasks/task-1/status', async () => {
        await blocked;
        return HttpResponse.json({ id: 'task-1', status: 'in_progress' });
      }),
    );

    const pending = store.dispatch(
      tasksApiSlice.endpoints.changeTaskStatus.initiate({
        id: 'task-1',
        body: { from: TaskStatus.TODO, to: TaskStatus.IN_PROGRESS },
      }),
    );

    // The request is still in flight, and the cache has ALREADY moved.
    expect(cachedStatus(store, { limit: 20 })).toBe(TaskStatus.IN_PROGRESS);

    release?.();
    await pending;

    expect(cachedStatus(store, { limit: 20 })).toBe(TaskStatus.IN_PROGRESS);
  });

  it('ROLLS BACK when the server rejects the transition', async () => {
    /**
     * =========================================================================
     * THE HALF PEOPLE FORGET
     * =========================================================================
     * A 409 means someone else moved the task first. Without `patch.undo()` the
     * board keeps showing a move that never happened - and it keeps showing it
     * until a reload, because nothing else invalidates that entry.
     *
     * The error message is copied from a real backend response captured in
     * Phase 9, so this exercises the shape the client will actually meet.
     * =========================================================================
     */
    const store = makeStore();
    await store.dispatch(tasksApiSlice.endpoints.getTasks.initiate({ limit: 20 }));

    server.use(
      http.patch('/api/v1/tasks/task-1/status', () =>
        HttpResponse.json(
          {
            success: false,
            statusCode: 409,
            message: 'Task AP-1 is in "in_progress", not "todo" - someone changed it first',
            error: 'ConflictException',
            path: '/api/v1/tasks/task-1/status',
            timestamp: '2026-08-20T00:00:00.000Z',
            requestId: 'req-409',
          },
          { status: 409 },
        ),
      ),
    );

    await store.dispatch(
      tasksApiSlice.endpoints.changeTaskStatus.initiate({
        id: 'task-1',
        body: { from: TaskStatus.TODO, to: TaskStatus.DONE },
      }),
    );

    // Back to reality, not to the move the user attempted.
    expect(cachedStatus(store, { limit: 20 })).toBe(TaskStatus.TODO);
  });

  it('patches EVERY cached list, not just the current one', async () => {
    /**
     * URL-driven filters mean each filter combination is its own cache key. A
     * user who has viewed "all tasks" and "todo only" has two entries holding
     * the same task.
     *
     * Patching only the active one leaves the other stale, so going back to a
     * previous filter shows the OLD status - a bug that looks like the app
     * randomly forgetting changes, and only reproduces after the user has
     * browsed a bit.
     *
     * `selectInvalidatedBy` is what finds the full set, and this is the test
     * that justifies using it over a single hard-coded query argument.
     */
    const store = makeStore();
    await store.dispatch(tasksApiSlice.endpoints.getTasks.initiate({ limit: 20 }));
    await store.dispatch(tasksApiSlice.endpoints.getTasks.initiate({ limit: 5 }));

    expect(cachedStatus(store, { limit: 20 })).toBe(TaskStatus.TODO);
    expect(cachedStatus(store, { limit: 5 })).toBe(TaskStatus.TODO);

    server.use(
      http.patch('/api/v1/tasks/task-1/status', () =>
        HttpResponse.json({ id: 'task-1', status: 'in_progress' }),
      ),
    );

    await store.dispatch(
      tasksApiSlice.endpoints.changeTaskStatus.initiate({
        id: 'task-1',
        body: { from: TaskStatus.TODO, to: TaskStatus.IN_PROGRESS },
      }),
    );

    expect(cachedStatus(store, { limit: 20 })).toBe(TaskStatus.IN_PROGRESS);
    expect(cachedStatus(store, { limit: 5 })).toBe(TaskStatus.IN_PROGRESS);
  });

  it('does NOT refetch the list after an optimistic update', async () => {
    /**
     * `changeTaskStatus` deliberately declares no `invalidatesTags`.
     *
     * The patch already wrote the new status into every cache entry;
     * invalidating would refetch the whole list a moment later to learn what we
     * just wrote - a wasted round-trip and a visible flicker as the list
     * re-renders.
     *
     * OPTIMISTIC UPDATE **OR** INVALIDATION, NOT BOTH. This asserts the
     * decision rather than leaving it to be re-litigated by whoever next adds a
     * mutation and copies the pattern from a neighbouring endpoint.
     */
    const store = makeStore();
    await store.dispatch(tasksApiSlice.endpoints.getTasks.initiate({ limit: 20 }));

    const fetchesAfterInitialLoad = callCounts.tasks;

    server.use(
      http.patch('/api/v1/tasks/task-1/status', () =>
        HttpResponse.json({ id: 'task-1', status: 'in_progress' }),
      ),
    );

    await store.dispatch(
      tasksApiSlice.endpoints.changeTaskStatus.initiate({
        id: 'task-1',
        body: { from: TaskStatus.TODO, to: TaskStatus.IN_PROGRESS },
      }),
    );

    /**
     * WAITING IS LOAD-BEARING, and the first draft of this test did not.
     *
     * An invalidation-triggered refetch is dispatched AFTER the mutation
     * promise resolves. Asserting immediately measured a moment before the
     * refetch could possibly have happened - so the test passed even with
     * `invalidatesTags` present, which is exactly the thing it claims to
     * forbid.
     *
     * I only found that by adding `invalidatesTags` back and watching the suite
     * stay green. The assertion was real; the timing made it meaningless.
     *
     * THE GENERAL LESSON: "assert that something did NOT happen" is the most
     * fragile shape of test there is, because it passes by default. It has to
     * be paired with enough waiting for the thing to have happened, and it has
     * to be verified by making it fail.
     */
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(callCounts.tasks).toBe(fetchesAfterInitialLoad);
  });
});
