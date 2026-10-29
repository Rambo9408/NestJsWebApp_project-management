import { Box, Button, Divider, Stack, TextField, Typography } from '@mui/material';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';

import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';
import { Modal } from '@/components/modals/Modal';
import { useSession } from '@/features/auth/useSession';
import { Role, type Comment } from '@/types/api';
import {
  useAddCommentMutation,
  useDeleteCommentMutation,
  useGetCommentsQuery,
} from './commentsApiSlice';

/**
 * =============================================================================
 * CommentList - the four-state rule, applied end to end
 * =============================================================================
 * Every API-driven feature in this project handles loading, error, empty and
 * success. This one adds the fifth that lists with writes always need: the
 * SUBMITTING state of the form, which is separate from the list's loading
 * state and must not blank the list while it runs.
 *
 * That distinction is the reason `isLoading` and `isFetching` are different
 * properties in RTK Query, and it is worth being able to explain:
 *
 *   isLoading   there is NO cached data yet - this is the first load
 *   isFetching  a request is in flight, cached data MAY still be shown
 *
 * Rendering a spinner on `isFetching` makes the list flash empty every time a
 * comment is posted. Rendering on `isLoading` keeps the existing comments
 * visible while the refetch happens underneath. The second is what users
 * expect and the first is the default mistake.
 * =============================================================================
 */

/**
 * MIRRORS `CreateCommentDto` in the backend: `@IsString() @Length(1, 5000)`.
 *
 * The duplication is deliberate and worth defending in an interview. This
 * schema exists for FEEDBACK SPEED - the user learns their comment is empty
 * without a round trip. It is emphatically not a security control: the server
 * validates the same rules because anything here can be bypassed with one
 * `curl`.
 *
 * The risk of duplication is drift - the backend raising the limit to 10,000
 * while this still rejects at 5,000. Two mitigations are in place: the limits
 * are stated in one place each with the source named, and the generated
 * `CreateCommentRequest` type would fail to compile if the FIELD changed. What
 * generation cannot catch is a changed CONSTRAINT, because OpenAPI records
 * `maxLength` and TypeScript has no way to express it. Saying that out loud is
 * the difference between "we generate our types" and understanding what
 * generation buys.
 */
const commentSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Write something before posting')
    .max(5000, 'Comments are limited to 5000 characters'),
});

type CommentFormValues = z.infer<typeof commentSchema>;

interface CommentListProps {
  taskId: string;
  /**
   * The viewer's role IN THIS PROJECT, resolved by the parent.
   *
   * Passed down rather than looked up here for the same reason `TaskCard` takes
   * `assigneeName`: the detail page already knows it, and a component that
   * fetched its own would turn one request into one-per-comment-list.
   *
   * `null` means "not a member" - which for a page the user can see means they
   * are a global admin viewing someone else's project.
   */
  projectRole: Role | null;
}

export function CommentList({ taskId, projectRole }: CommentListProps) {
  const { data, isLoading, isError, error, refetch } = useGetCommentsQuery({ taskId });
  const [addComment, addState] = useAddCommentMutation();
  const [deleteComment, deleteState] = useDeleteCommentMutation();
  const { user } = useSession();

  /**
   * The comment awaiting delete confirmation, or null.
   *
   * STORING THE OBJECT, not a boolean plus a separate id. Two pieces of state
   * that must agree ("is the dialog open" and "which comment") can disagree -
   * open with no id, or an id with the dialog closed. One nullable value makes
   * both impossible states unrepresentable, which is the same union-over-flags
   * argument as the auth `status` field.
   */
  const [pendingDelete, setPendingDelete] = useState<Comment | null>(null);

  const form = useForm<CommentFormValues>({
    resolver: zodResolver(commentSchema),
    defaultValues: { body: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      /**
       * `.unwrap()` makes the mutation THROW on failure.
       *
       * Without it the promise resolves with `{ error }` and this `try` never
       * fires - so `reset()` runs and the user's text is destroyed by a failed
       * request. That is a genuinely infuriating bug and it is invisible until
       * the network fails.
       */
      await addComment({ taskId, body: { body: values.body } }).unwrap();
      // Only after a CONFIRMED write.
      form.reset();
    } catch {
      /**
       * Swallowed on purpose: the global `errorToastMiddleware` already
       * surfaces API failures as a toast. Catching a second time here would
       * show two messages for one failure.
       *
       * The `try/catch` still earns its place - it is what stops `reset()`
       * running, and an unhandled rejection would otherwise appear in the
       * console for a case that is fully handled.
       */
    }
  });

  async function confirmDelete() {
    if (!pendingDelete) return;
    try {
      await deleteComment({ taskId, commentId: pendingDelete.id }).unwrap();
      setPendingDelete(null);
    } catch {
      // Toasted globally. The dialog STAYS OPEN so the user can retry - closing
      // it on failure would leave them unsure whether the delete happened.
    }
  }

  /**
   * WHO MAY DELETE A COMMENT - mirroring the backend's rule, not inventing one.
   *
   * The service allows: the AUTHOR, a project MANAGER, or a global ADMIN.
   * Reimplementing it here is a UI courtesy so the button does not appear where
   * it would 403.
   *
   * THE RULE MUST MATCH OR THE UI LIES. If this were stricter, a manager would
   * be unable to moderate through the UI while the API allowed it. If it were
   * looser, users would see a button that always fails. Both are worse than no
   * button.
   *
   * And the constant reminder: this is NOT the security boundary. Deleting the
   * check here changes nothing about what the server permits.
   */
  function canDelete(comment: Comment): boolean {
    if (!user) return false;
    if (comment.authorId === user.id) return true;
    if (user.role === Role.ADMIN) return true;
    return projectRole === Role.MANAGER;
  }

  return (
    <Stack spacing={2}>
      <Typography variant="h6" component="h3">
        Comments{data ? ` (${String(data.total)})` : ''}
      </Typography>

      {/*
        THE FORM IS ABOVE THE LIST AND OUTSIDE ITS STATE BRANCHES.

        Deliberate: a task with no comments still needs somewhere to write the
        first one. Putting the form inside the success branch would mean the
        empty state has no way out of itself - a small structural mistake that
        makes a feature feel broken.
      */}
      <Box component="form" onSubmit={(e) => void onSubmit(e)} noValidate>
        <Stack spacing={1}>
          <TextField
            {...form.register('body')}
            label="Add a comment"
            multiline
            minRows={2}
            fullWidth
            error={Boolean(form.formState.errors.body)}
            /*
              `helperText` renders into an element MUI links with
              `aria-describedby`, so the error is ANNOUNCED with the field
              rather than being visual-only. A `<span>` under the input looks
              identical and tells a screen reader nothing.
            */
            helperText={form.formState.errors.body?.message ?? ' '}
            disabled={addState.isLoading}
          />
          <Box>
            <Button type="submit" variant="contained" disabled={addState.isLoading}>
              {addState.isLoading ? 'Posting...' : 'Post comment'}
            </Button>
          </Box>
        </Stack>
      </Box>

      <Divider />

      {/*
        BRANCH ORDER IS LOAD-BEARING: error, then loading, then empty.

        The same ordering as DataTable, and for the same reason. A failed
        request leaves `data` undefined, so an empty check placed first reports
        "no comments yet" for what is actually a server error - telling the user
        something false and hiding a problem they could retry.
      */}
      {isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <LoadingState variant="skeleton" rows={3} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState title="No comments yet" description="Be the first to add one." />
      ) : (
        /*
          `<ul>`, not a stack of divs.

          A list element makes a screen reader announce "list, 4 items" and
          enables list navigation. It costs the two lines of CSS below and it is
          the cheapest accessibility win available on any page that renders a
          collection.
        */
        <Stack component="ul" spacing={2} sx={{ listStyle: 'none', p: 0, m: 0 }}>
          {data.items.map((comment) => (
            <Box component="li" key={comment.id}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
                <Typography variant="subtitle2">
                  {/*
                    `author` is the resolved join and CAN be null when the
                    account was deleted. `authorId` always exists, so the
                    comment is never orphaned - but the name may be gone, and
                    rendering nothing there looks like a bug rather than
                    history.
                  */}
                  {comment.author?.name ?? 'Unknown user'}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1 }}>
                  {/*
                    `<time dateTime>` gives the machine-readable value while the
                    text stays human. `toLocaleString(undefined, ...)` uses the
                    VIEWER's locale - hardcoding 'en-US' shows 3/4/2026 to
                    someone who reads it as 4 March.
                  */}
                  <Box component="time" dateTime={comment.createdAt}>
                    {new Date(comment.createdAt).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </Box>
                </Typography>
                {canDelete(comment) && (
                  <Button
                    size="small"
                    color="error"
                    onClick={() => {
                      setPendingDelete(comment);
                    }}
                    /*
                      The accessible name says WHICH comment. Six buttons all
                      announcing "Delete" is useless to anyone navigating by
                      control - they have to leave the list, find context, and
                      come back.
                    */
                    aria-label={`Delete comment by ${comment.author?.name ?? 'unknown user'}`}
                  >
                    Delete
                  </Button>
                )}
              </Stack>
              {/*
                `whiteSpace: pre-wrap` preserves the line breaks the user typed.
                Without it a multi-paragraph comment collapses into one block -
                and the fix people reach for instead is
                `dangerouslySetInnerHTML` with `<br>`, which turns a formatting
                problem into an XSS one.
              */}
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', mt: 0.5 }}>
                {comment.body}
              </Typography>
            </Box>
          ))}
        </Stack>
      )}

      {/*
        =====================================================================
        DESTRUCTIVE ACTION -> CONFIRMATION, and why it is a modal
        =====================================================================
        Deletion here is not undoable: there is no soft delete and no trash.
        The two honest options are an undo affordance (better UX, needs backend
        support) or a confirmation step (worse UX, works today). Choosing the
        second and SAYING it is a compromise is the accurate framing.

        The dialog names the author and quotes the text, because "Are you sure?"
        with no subject is how people confirm deleting the wrong thing.
        =====================================================================
      */}
      <Modal
        open={pendingDelete !== null}
        onClose={() => {
          setPendingDelete(null);
        }}
        title="Delete comment"
      >
        <Modal.Body>
          <Typography variant="body2">
            Delete this comment by{' '}
            <strong>{pendingDelete?.author?.name ?? 'unknown user'}</strong>? This cannot be undone.
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 1, fontStyle: 'italic', whiteSpace: 'pre-wrap' }}
          >
            {pendingDelete?.body}
          </Typography>
        </Modal.Body>
        <Modal.Footer>
          <Button
            onClick={() => {
              setPendingDelete(null);
            }}
          >
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => void confirmDelete()}
            disabled={deleteState.isLoading}
          >
            {deleteState.isLoading ? 'Deleting...' : 'Delete'}
          </Button>
        </Modal.Footer>
      </Modal>
    </Stack>
  );
}
