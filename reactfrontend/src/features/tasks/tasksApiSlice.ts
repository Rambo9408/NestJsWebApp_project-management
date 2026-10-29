import { apiSlice } from '@/services/apiSlice';
import type { ListTasksQuery, Paginated, Task } from '@/types/api';
import type {
  AssignTaskRequest,
  ChangeTaskStatusRequest,
  CreateTaskRequest,
  UpdateTaskRequest,
} from '@/types/requests';


/**
 * =============================================================================
 * TASK ENDPOINTS - injected into the shared api slice
 * =============================================================================
 * WHAT `useGetTasksQuery(query)` ACTUALLY DOES, since this is the interview
 * question:
 *
 *   1. SERIALISES the argument into a cache key ("getTasks({page:1,...})").
 *      Note it serialises by VALUE, so an inline object literal is SAFE here -
 *      unlike `useAsyncData`, where a fresh object on every render caused an infinite
 *      refetch loop. That difference alone removes a whole class of bug.
 *   2. LOOKS UP that key in the cache.
 *        - hit and fresh  -> returns it, NO request
 *        - hit and stale  -> returns it immediately, refetches in background
 *        - miss           -> starts a request, returns { isLoading: true }
 *   3. SUBSCRIBES this component to the entry. Another component asking with
 *      the same argument joins the SAME subscription - one request, two
 *      consumers.
 *   4. On unmount, decrements the reference count. At zero, the entry is
 *      evicted after `keepUnusedDataFor`.
 *
 * All of that is the ~100 lines `useAsyncData` did not have.
 * =============================================================================
 */
/**
 * The list endpoint returns `TaskWithAssignee`, not a bare `Task` - the backend
 * joins the assignee so a task list does not fire one user request per row.
 * (The N+1 problem, avoided at the only layer that can avoid it.)
 *
 * DECLARED HERE, next to the endpoint that returns it, rather than in
 * `types/api.ts`. It is shaped by what THIS endpoint sends, not by the domain
 * model - and keeping endpoint-specific response shapes beside their endpoint
 * is what stops `api.ts` becoming a dumping ground of near-identical Task
 * variants.
 *
 * `assignee` is NULLABLE because `assigneeId` is: an unassigned task is a real
 * state, not missing data.
 */
export interface TaskWithAssignee extends Task {
  assignee: { id: string; name: string; email: string } | null;
}

export const tasksApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    /**
     * `builder.query<ResultType, ArgType>` - both generics matter. The first
     * types `data` at every call site; the second types the hook's argument, so
     * `useGetTasksQuery({ pge: 1 })` is a compile error.
     */
    getTasks: builder.query<Paginated<TaskWithAssignee>, ListTasksQuery>({
      query: (params) => ({ url: '/tasks', params }),

      /**
       * =====================================================================
       * providesTags - the LIST + ITEMS pattern
       * =====================================================================
       * Returning both is what makes invalidation precise instead of blunt:
       *
       *   { type: 'Task', id: 'LIST' }   this list, as a collection
       *   { type: 'Task', id: <taskId> } each individual task in it
       *
       * So:
       *   CREATE invalidates only 'LIST'   -> the list refetches; a task detail
       *                                       page open in another tab does not
       *   UPDATE invalidates only that id  -> the detail refetches; the list
       *                                       does NOT (see the note on
       *                                       updateTask below)
       *   DELETE invalidates both
       *
       * Without the per-id tags, every mutation would have to invalidate the
       * whole list and you would refetch 50 rows to reflect one title change.
       *
       * THE `result ? ... : ...` GUARD: on a failed query `result` is
       * undefined, and mapping over it would throw INSIDE RTK Query's internals
       * - producing an error that points at the library rather than at this
       * line. Easy to miss, and it only fires when the request fails.
       */
      providesTags: (result) =>
        result
          ? [
              ...result.items.map((task) => ({ type: 'Task' as const, id: task.id })),
              { type: 'Task' as const, id: 'LIST' },
            ]
          : [{ type: 'Task' as const, id: 'LIST' }],
    }),

    getTask: builder.query<Task, string>({
      query: (id) => `/tasks/${id}`,
      providesTags: (_result, _error, id) => [{ type: 'Task', id }],
    }),

    createTask: builder.mutation<Task, CreateTaskRequest>({
      query: (body) => ({ url: '/tasks', method: 'POST', body }),
      /**
       * ONLY 'LIST'. A brand-new task has no id worth invalidating, and
       * invalidating every Task id would refetch every open detail page for no
       * reason.
       */
      invalidatesTags: [{ type: 'Task', id: 'LIST' }],
    }),

    updateTask: builder.mutation<Task, { id: string; body: UpdateTaskRequest }>({
      query: ({ id, body }) => ({ url: `/tasks/${id}`, method: 'PATCH', body }),
      /**
       * BOTH the item AND the list, and the list is the part worth explaining.
       *
       * Editing a title changes what the LIST renders too, so invalidating only
       * the item would leave the list showing the old title until something
       * else happened to refetch it. That is the classic "I saved it but the
       * table still shows the old value" bug.
       *
       * The cost is one extra request. The alternative - patching the list
       * cache by hand with `updateQueryData` - is faster and more code; it is
       * the right trade only once you have measured that the refetch hurts.
       */
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Task', id },
        { type: 'Task', id: 'LIST' },
      ],
    }),

    /**
     * =========================================================================
     * changeTaskStatus - WITH AN OPTIMISTIC UPDATE
     * =========================================================================
     * Dragging a card between columns must feel instant. Waiting ~200ms for a
     * round-trip before the card moves makes a board feel broken.
     *
     * `onQueryStarted` runs when the mutation fires. We patch the cache
     * IMMEDIATELY, then wait for the server. If it fails, `patchResult.undo()`
     * puts it back.
     *
     * WHEN TO USE OPTIMISTIC UPDATES:
     *   - the action almost always succeeds (a status change, a like, a
     *     reorder)
     *   - the change is small and easy to reverse
     *   - the user would notice the latency
     *
     * WHEN NOT TO:
     *   - payments, deletions, anything irreversible
     *   - anything whose server result you cannot predict (a generated id, a
     *     computed total)
     *   - anything that frequently fails - the flicker of applying and undoing
     *     is worse than a spinner
     *
     * INTERVIEW: "how do you implement optimistic updates?" - patch the cache,
     * keep the undo handle, revert on failure. Then volunteer the rollback
     * case, because that is the half people forget.
     * =========================================================================
     */
    changeTaskStatus: builder.mutation<Task, { id: string; body: ChangeTaskStatusRequest }>({
      query: ({ id, body }) => ({ url: `/tasks/${id}/status`, method: 'PATCH', body }),

      /**
       * AN ARROW FUNCTION, not a method shorthand.
       *
       * `@typescript-eslint/unbound-method` flags the shorthand form: a method
       * detached from its object can lose `this`. RTK Query never calls this
       * with a meaningful `this`, so the arrow is both correct and clearer
       * about that - it has no `this` to lose.
       */
      onQueryStarted: async ({ id, body }, api) => {
        // NOTE `api` is NOT destructured for `getState`. Pulling a method off its
        // object unbinds it - `@typescript-eslint/unbound-method` flags exactly
        // that, and it is right to: RTK Query's `getState` is a bound accessor,
        // and detaching methods is a real class of bug even when this
        // particular one happens to survive it.
        const { dispatch, queryFulfilled } = api;
        /**
         * PATCHING EVERY CACHED `getTasks` ENTRY, not just one.
         *
         * The user may have several filter combinations cached - the URL-driven
         * filters mean each is its own cache key. Patching only the "current"
         * one leaves the others stale, so going back to a previous filter shows
         * the old status.
         *
         * `selectInvalidatedBy` asks RTK Query which cached entries carry this
         * task's tag, which is exactly the set that needs patching.
         */
        const entries = tasksApiSlice.util.selectInvalidatedBy(api.getState(), [
          { type: 'Task', id },
        ]);

        const patches = entries
          .filter((entry) => entry.endpointName === 'getTasks')
          .map((entry) =>
            dispatch(
              tasksApiSlice.util.updateQueryData(
                'getTasks',
                entry.originalArgs as ListTasksQuery,
                (draft) => {
                  /**
                   * IMMER AGAIN. `draft` is a proxy; this "mutation" produces a
                   * new cache value. Same mechanism as a slice reducer.
                   */
                  const task = draft.items.find((item) => item.id === id);
                  if (task) task.status = body.to;
                },
              ),
            ),
          );

        try {
          await queryFulfilled;
        } catch {
          /**
           * ROLLBACK. The server rejected it - most likely the backend's
           * optimistic-concurrency check: `{from, to}` means the request states
           * the status it EXPECTED to find, and if someone else moved the task
           * first, `from` no longer matches and the server refuses rather than
           * silently overwriting their change.
           *
           * That is exactly the case where undoing matters: the user's screen
           * must go back to reality, not keep showing a move that never
           * happened.
           */
          patches.forEach((patch) => {
            patch.undo();
          });
        }
      },

      /**
       * NO `invalidatesTags` HERE, deliberately.
       *
       * The optimistic patch already wrote the new status into every cache
       * entry. Invalidating would refetch the whole list a moment later to
       * learn what we just wrote - a wasted round-trip and a visible flicker as
       * the list re-renders.
       *
       * Optimistic update OR invalidation, not both.
       */
    }),

    assignTask: builder.mutation<Task, { id: string; body: AssignTaskRequest }>({
      query: ({ id, body }) => ({ url: `/tasks/${id}/assignee`, method: 'PATCH', body }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Task', id },
        { type: 'Task', id: 'LIST' },
      ],
    }),

    deleteTask: builder.mutation<{ deletedComments: number }, string>({
      query: (id) => ({ url: `/tasks/${id}`, method: 'DELETE' }),
      /**
       * Deleting a task CASCADES to its comments on the backend - it returns
       * `{ deletedComments }`. So the Comment tag is invalidated too, or a
       * comment list cached elsewhere would keep showing comments whose task no
       * longer exists.
       *
       * This is the kind of cross-entity invalidation that only works because
       * there is ONE api slice with a shared tag namespace.
       */
      invalidatesTags: (_result, _error, id) => [
        { type: 'Task', id },
        { type: 'Task', id: 'LIST' },
        { type: 'Comment', id: 'LIST' },
      ],
    }),
  }),
});

/**
 * THE HOOKS ARE GENERATED. `getTasks` becomes `useGetTasksQuery`,
 * `createTask` becomes `useCreateTaskMutation` - the naming is mechanical, and
 * the types flow from the endpoint definitions with nothing written by hand.
 *
 * That is the payoff for defining endpoints declaratively: no hand-written
 * hook, no hand-written loading flag, no hand-written cache key.
 */
export const {
  useGetTasksQuery,
  useGetTaskQuery,
  useCreateTaskMutation,
  useUpdateTaskMutation,
  useChangeTaskStatusMutation,
  useAssignTaskMutation,
  useDeleteTaskMutation,
} = tasksApiSlice;
