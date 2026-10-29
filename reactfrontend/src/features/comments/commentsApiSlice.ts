import { apiSlice } from '@/services/apiSlice';
import type { Comment, Paginated } from '@/types/api';
import type { CreateCommentRequest } from '@/types/requests';

/**
 * =============================================================================
 * COMMENT ENDPOINTS - nested under their task, as the backend defines them
 * =============================================================================
 * SOURCE OF TRUTH: nestbackend/src/tasks/tasks.controller.ts
 *
 *   GET    /tasks/:id/comments               -> Paginated<CommentView>
 *   POST   /tasks/:id/comments               -> CommentView
 *   DELETE /tasks/:id/comments/:commentId    -> 204 No Content
 *
 * -----------------------------------------------------------------------------
 * WHY THE ROUTES ARE NESTED, which is a design decision and not decoration
 * -----------------------------------------------------------------------------
 * There is also a deprecated standalone `DELETE /comments/:id`, and the reason
 * it is deprecated is an AUTHORIZATION problem worth understanding.
 *
 * A bare comment id gives the server no route to the project that owns the
 * membership rule - it has to load the comment, then the task, then the
 * project, before it can decide anything. Nesting the route means
 * `TaskAccessGuard` establishes project membership from `:id` BEFORE the
 * handler runs.
 *
 * That is the split the backend documents explicitly: a GUARD answers "may you
 * touch this resource at all?", and the SERVICE answers "may you do this
 * particular thing to it?" - here, author-or-manager-or-admin, which needs the
 * comment itself.
 *
 * The frontend uses the nested route only. Calling the deprecated one would
 * work today and enforce a NARROWER rule (author-or-admin), so a project
 * manager moderating someone else's comment would get a 403 for no visible
 * reason. Two endpoints for one operation with different rules is exactly the
 * kind of drift that produces "it works for me" bug reports.
 *
 * -----------------------------------------------------------------------------
 * A REAL BACKEND BUG THIS BINDING EXPOSED
 * -----------------------------------------------------------------------------
 * `listComments` is declared as `@Query() query: ListTasksQuery` - the TASK
 * filter DTO. So the generated OpenAPI document says `GET /tasks/{id}/comments`
 * accepts `status`, `priority`, `overdue` and `assigneeId`, none of which mean
 * anything for a comment.
 *
 * It is harmless (the extra fields are ignored) and it is still wrong: the
 * published contract describes filters that do nothing, and `ListTasksQuery`
 * caps `limit` using task-shaped rules. Only `page` and `limit` are sent from
 * here, and the mismatch is logged in ROADMAP.md rather than worked around
 * silently.
 *
 * WORTH NOTICING HOW IT WAS FOUND: by reading the generated contract while
 * writing the client, not by reading the controller. Generated artefacts make
 * this class of copy-paste error visible in a way that source review does not.
 * =============================================================================
 */

export interface ListCommentsArg {
  taskId: string;
  page?: number;
  limit?: number;
}

export const commentsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getComments: builder.query<Paginated<Comment>, ListCommentsArg>({
      /**
       * `taskId` goes in the PATH; everything else goes in `params`.
       *
       * Destructuring it out is what keeps it from being serialised into the
       * query string as well - `?taskId=...` would be ignored by the server and
       * would sit in the URL implying a filter that does not exist.
       */
      query: ({ taskId, ...params }) => ({ url: `/tasks/${taskId}/comments`, params }),

      /**
       * THE LIST TAG IS SCOPED TO THE TASK: `id: 'LIST-<taskId>'`.
       *
       * A single shared `id: 'LIST'` would mean posting a comment on task A
       * invalidates the comment list of every task the user has open. That is
       * invisible while you test one task at a time and obvious the moment two
       * detail views are cached - which is exactly the kind of bug that reaches
       * production.
       *
       * The per-item tags exist so a single deletion can invalidate one comment
       * without refetching the whole page.
       */
      providesTags: (result, _error, { taskId }) =>
        result
          ? [
              ...result.items.map(({ id }) => ({ type: 'Comment' as const, id })),
              { type: 'Comment' as const, id: `LIST-${taskId}` },
            ]
          : [{ type: 'Comment' as const, id: `LIST-${taskId}` }],
    }),

    addComment: builder.mutation<Comment, { taskId: string; body: CreateCommentRequest }>({
      query: ({ taskId, body }) => ({
        url: `/tasks/${taskId}/comments`,
        method: 'POST',
        body,
      }),
      /**
       * INVALIDATION, NOT AN OPTIMISTIC UPDATE - and this is the deliberate
       * counterpart to the optimistic status toggle in tasksApiSlice.
       *
       * The Phase 9 rule for choosing: optimistic updates suit changes you can
       * PREDICT EXACTLY. Toggling a status to `done` produces a value the
       * client already knows.
       *
       * A new comment does not. The server assigns `id`, `createdAt`, and
       * resolves the `author` join. Faking those means either rendering a
       * placeholder that visibly changes a moment later, or inventing an id
       * that the delete button would then send to a server which has never
       * seen it.
       *
       * There is also a UX argument that matters more than the technical one:
       * posting a comment is a deliberate act where users EXPECT a brief wait
       * and want confirmation it was recorded. Optimism buys nothing and risks
       * showing a comment that silently failed to save.
       *
       * INTERVIEW: "when is an optimistic update wrong?" - when the server
       * computes part of the result, when failure is expensive to explain, or
       * when the user is waiting for confirmation anyway.
       *
       * -----------------------------------------------------------------------
       * AND THE LIVE API PROVED THE POINT, in a way worth recording
       * -----------------------------------------------------------------------
       * Verified against the running backend: this endpoint's response and the
       * LIST endpoint's items are BOTH declared `CommentView`, and they are not
       * the same shape.
       *
       *   POST /tasks/:id/comments  ->  "author": null
       *   GET  /tasks/:id/comments  ->  "author": { "id": "...", "name": "ram" }
       *
       * The cause is in comments.repository.ts: `list()` calls
       * `.populate({ path: 'authorId', select: 'name' })` and `create()` does
       * not, so the shared mapper hits its `isPopulated ? ... : null` branch and
       * returns a null author for a user who plainly exists.
       *
       * WHY IT DOES NOT AFFECT THIS APP: the mutation invalidates rather than
       * writing its result into the cache, so what the list renders always came
       * from the list endpoint. Had this been an optimistic update - or a
       * `updateQueryData` that pushed the POST response into the cached array -
       * every newly posted comment would render as "Unknown user" until
       * something else triggered a refetch. Intermittent, cosmetic, and
       * extremely annoying to track down.
       *
       * THE REAL LESSON, and it is the argument for generated contracts:
       * TypeScript said these two responses were identical because the BACKEND
       * said so. The OpenAPI document could not contradict it, because it
       * carries no response schemas. Nothing in either codebase could have
       * caught this - it took calling both endpoints and diffing the JSON.
       *
       * Logged in ROADMAP.md as a backend inconsistency to fix at the source.
       */
      invalidatesTags: (_result, _error, { taskId }) => [
        { type: 'Comment', id: `LIST-${taskId}` },
      ],
    }),

    deleteComment: builder.mutation<void, { taskId: string; commentId: string }>({
      query: ({ taskId, commentId }) => ({
        url: `/tasks/${taskId}/comments/${commentId}`,
        method: 'DELETE',
      }),
      /**
       * Invalidates BOTH the list and the individual comment.
       *
       * The list tag is what refetches. The item tag matters because any other
       * cache entry that provided this comment - a future "recent activity"
       * panel, a search result - is stale too, and tagging by id is what makes
       * that automatic rather than something a person has to remember.
       */
      invalidatesTags: (_result, _error, { taskId, commentId }) => [
        { type: 'Comment', id: `LIST-${taskId}` },
        { type: 'Comment', id: commentId },
      ],
    }),
  }),
});

export const { useGetCommentsQuery, useAddCommentMutation, useDeleteCommentMutation } =
  commentsApiSlice;
