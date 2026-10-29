import { apiSlice } from '@/services/apiSlice';
import type { Notification, Paginated, PaginationQuery } from '@/types/api';

/**
 * =============================================================================
 * NOTIFICATION ENDPOINTS
 * =============================================================================
 * Every route here is scoped to the caller by the backend - each handler takes
 * `@CurrentUser('id')` and the repository puts `userId` in the query filter.
 * Confirmed during the authorization audit, which is why notifications were one
 * of the few list endpoints that did NOT leak.
 * =============================================================================
 */

export interface ListNotificationsQuery extends PaginationQuery {
  /**
   * The backend reads this as `@Query('unread') unread?: string` and compares
   * it to the STRING 'true' - it is not a parsed boolean.
   *
   * So the client must send `unread=true`, not `unread=1`. Typing it as
   * `boolean` here and letting the query serialiser stringify it happens to
   * produce the right thing, and this comment is why that is not luck.
   */
  unread?: boolean;
}

export const notificationsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getNotifications: builder.query<Paginated<Notification>, ListNotificationsQuery>({
      query: (params) => ({ url: '/notifications', params }),
      providesTags: (result) =>
        result
          ? [
              ...result.items.map((n) => ({ type: 'Notification' as const, id: n.id })),
              { type: 'Notification' as const, id: 'LIST' },
            ]
          : [{ type: 'Notification' as const, id: 'LIST' }],
    }),

    getUnreadCount: builder.query<{ unread: number }, void>({
      query: () => '/notifications/unread-count',
      /**
       * PROVIDES THE SAME 'LIST' TAG as the list itself.
       *
       * That is what makes the badge and the dropdown move together: marking
       * one notification read invalidates 'LIST', and BOTH refetch. Without the
       * shared tag the badge would keep showing 3 after the user had read all
       * three - a small inconsistency that makes an app feel broken.
       */
      providesTags: [{ type: 'Notification', id: 'LIST' }],
    }),

    markRead: builder.mutation<{ updated: boolean }, string>({
      query: (id) => ({ url: `/notifications/${id}/read`, method: 'PATCH' }),

      /**
       * OPTIMISTIC, because marking as read is the textbook case: it almost
       * never fails, it is trivially reversible, and the user would notice a
       * 200ms delay on something that feels like a local action.
       *
       * TWO CACHES ARE PATCHED. The list holds the notification; the badge
       * holds a count. Patching only the list leaves the badge stale until the
       * next refetch - and the badge is the more visible of the two.
       */
      async onQueryStarted(id, api) {
        const { dispatch, queryFulfilled } = api;

        const patches = [
          dispatch(
            notificationsApiSlice.util.updateQueryData(
              'getNotifications',
              { limit: 20 },
              (draft) => {
                const item = draft.items.find((n) => n.id === id);
                // Only patch if it is genuinely unread - marking an already-read
                // notification must not decrement the count twice.
                if (item && item.readAt === null) item.readAt = new Date().toISOString();
              },
            ),
          ),
          dispatch(
            notificationsApiSlice.util.updateQueryData('getUnreadCount', undefined, (draft) => {
              // `Math.max(0, ...)` because a double-fire would otherwise show
              // "-1 unread", which looks like a bug even when the data is fine.
              draft.unread = Math.max(0, draft.unread - 1);
            }),
          ),
        ];

        try {
          await queryFulfilled;
        } catch {
          patches.forEach((patch) => {
            patch.undo();
          });
        }
      },
    }),

    markAllRead: builder.mutation<{ updated: number }, void>({
      query: () => ({ url: '/notifications/read-all', method: 'POST' }),
      /**
       * NOT optimistic, deliberately. The server returns HOW MANY it updated,
       * and that number is not predictable from the client - the list is
       * paginated, so there may be unread notifications we have never fetched.
       *
       * Guessing at a cache patch here would be guessing at data we do not
       * have. Invalidate and refetch: correct, and one round-trip for an action
       * the user takes rarely.
       */
      invalidatesTags: [{ type: 'Notification', id: 'LIST' }],
    }),
  }),
});

export const {
  useGetNotificationsQuery,
  useGetUnreadCountQuery,
  useMarkReadMutation,
  useMarkAllReadMutation,
} = notificationsApiSlice;
