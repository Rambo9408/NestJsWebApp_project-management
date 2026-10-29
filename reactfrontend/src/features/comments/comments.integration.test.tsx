import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { HttpResponse, http } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { server } from '@/test/msw/server';
import { CommentList } from './CommentList';
import authReducer from '@/features/auth/authSlice';
import uiReducer from '@/features/ui/uiSlice';
import { apiSlice } from '@/services/apiSlice';
import { tokenStore } from '@/features/auth/tokenStore';
import { Role, type Comment, type User } from '@/types/api';

/**
 * =============================================================================
 * COMMENTS - a flow test over the real transport
 * =============================================================================
 * The third test layer: component + store + RTK Query + fetch, with MSW
 * answering the socket. What it catches that unit tests structurally cannot is
 * WIRING - a form that validates perfectly and never posts, a mutation that
 * fires and never refreshes the list.
 *
 * The most valuable test here is the last one, which encodes a REAL BACKEND
 * INCONSISTENCY found by calling the live API. See below.
 * =============================================================================
 */

const BASE = 'http://localhost:3000/api/v1';
const TASK_ID = 'task-1';

/**
 * EXPLICITLY TYPED AS `User`, not inferred.
 *
 * Without the annotation TypeScript infers `role: Role.MEMBER` as a LITERAL
 * type, so `{ ...ME, role: Role.ADMIN }` in the admin test is a compile error -
 * "admin is not assignable to member". Annotating widens it to `Role`.
 *
 * It also has to be a complete `User`: the auth slice stores `User | null`,
 * and a partial object makes `preloadedState` infer a narrower store shape,
 * which then rejects the api middleware. Both errors point at the same habit -
 * test fixtures should be typed as the real thing rather than as whatever shape
 * the test happens to need.
 */
const ME: User = {
  id: 'user-me',
  email: 'ram@example.com',
  name: 'Ram',
  role: Role.MEMBER,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'comment-1',
    body: 'First comment',
    taskId: TASK_ID,
    authorId: 'user-other',
    author: { id: 'user-other', name: 'Ada' },
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

/** Mutable per-test state so a POST can affect a later GET. */
let comments: Comment[] = [];

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
  comments = [makeComment()];
  tokenStore.set('test-access-token');
});

function commentHandlers() {
  return [
    /**
     * THE LIST POPULATES THE AUTHOR, exactly as `list()` does with
     * `.populate({ path: 'authorId', select: 'name' })`.
     *
     * This is the half that makes the mock faithful, and getting it wrong is
     * instructive: the first version simply returned the stored records, so a
     * comment created by the POST handler (which correctly returns
     * `author: null`) still had a null author when re-read.
     *
     * That is NOT how the real backend behaves. Mongo stores only `authorId`;
     * the author object does not exist in the document at all. It is produced
     * by a JOIN AT READ TIME - so every read populates it, regardless of what
     * the write returned.
     *
     * The distinction matters because it changes what the test proves. With the
     * naive version the test failed for the wrong reason - it looked like the
     * app had a bug, when the MOCK had one. A mock that is wrong in a
     * DIFFERENT way from the real server is worse than no mock, because the
     * failure is confidently misleading.
     */
    http.get(`${BASE}/tasks/:taskId/comments`, () =>
      HttpResponse.json({
        items: comments.map((comment) => ({
          ...comment,
          author:
            comment.authorId === ME.id
              ? { id: ME.id, name: ME.name }
              : { id: comment.authorId, name: 'Ada' },
        })),
        total: comments.length,
        page: 1,
        limit: 20,
        totalPages: 1,
      }),
    ),
    http.post(`${BASE}/tasks/:taskId/comments`, async ({ request }) => {
      const body = (await request.json()) as { body: string };
      const created = makeComment({
        id: `comment-${String(comments.length + 1)}`,
        body: body.body,
        authorId: ME.id,
        /**
         * `author: null` - MIRRORING THE REAL BACKEND, NOT AN OVERSIGHT.
         *
         * Verified against the running API: `create()` in
         * comments.repository.ts does not `.populate()` the author, while
         * `list()` does. Both are typed `CommentView`, and they return
         * different shapes.
         *
         * Encoding the real behaviour here is the whole point of a mock. A
         * handler that returns the CONVENIENT shape tests a backend that does
         * not exist - and would hide exactly the bug an optimistic update
         * would have introduced.
         */
        author: null,
      });
      comments = [...comments, created];
      return HttpResponse.json(created, { status: 201 });
    }),
    http.delete(`${BASE}/tasks/:taskId/comments/:commentId`, ({ params }) => {
      comments = comments.filter((c) => c.id !== params.commentId);
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}

function renderComments(projectRole: Role | null = null, user: User = ME) {
  server.use(...commentHandlers());

  const store = configureStore({
    reducer: { auth: authReducer, ui: uiReducer, [apiSlice.reducerPath]: apiSlice.reducer },
    middleware: (getDefault) => getDefault().concat(apiSlice.middleware),
    preloadedState: { auth: { status: 'authenticated' as const, user } },
  });

  return render(
    <Provider store={store}>
      <CommentList taskId={TASK_ID} projectRole={projectRole} />
    </Provider>,
  );
}

describe('CommentList', () => {
  it('loads and renders existing comments', async () => {
    renderComments();

    expect(await screen.findByText('First comment')).toBeVisible();
    expect(screen.getByText('Ada')).toBeVisible();
  });

  it('shows an empty state when there are none', async () => {
    comments = [];
    renderComments();

    expect(await screen.findByText(/no comments yet/i)).toBeVisible();
  });

  /**
   * The form must be reachable from the EMPTY state, or a task with no comments
   * has no way to get its first one. Structurally easy to get wrong by putting
   * the form inside the success branch.
   */
  it('offers the form even when the list is empty', async () => {
    comments = [];
    renderComments();

    await screen.findByText(/no comments yet/i);
    expect(screen.getByLabelText(/add a comment/i)).toBeVisible();
  });

  it('rejects an empty comment without calling the API', async () => {
    const user = userEvent.setup();
    renderComments();
    await screen.findByText('First comment');

    await user.click(screen.getByRole('button', { name: /post comment/i }));

    expect(await screen.findByText(/write something before posting/i)).toBeVisible();
    // Still one comment: nothing was posted.
    expect(comments).toHaveLength(1);
  });

  it('posts a comment and shows it in the list', async () => {
    const user = userEvent.setup();
    renderComments();
    await screen.findByText('First comment');

    await user.type(screen.getByLabelText(/add a comment/i), 'A second comment');
    await user.click(screen.getByRole('button', { name: /post comment/i }));

    expect(await screen.findByText('A second comment')).toBeVisible();
  });

  it('clears the input only after a successful post', async () => {
    const user = userEvent.setup();
    renderComments();
    await screen.findByText('First comment');

    const input = screen.getByLabelText(/add a comment/i);
    await user.type(input, 'Draft text');
    await user.click(screen.getByRole('button', { name: /post comment/i }));

    await waitFor(() => {
      expect(input).toHaveValue('');
    });
  });

  /**
   * THE FAILURE CASE, and the reason `.unwrap()` is in the submit handler.
   *
   * Without `.unwrap()` the mutation promise RESOLVES with `{ error }`, so the
   * `try` block continues to `form.reset()` and destroys what the user typed —
   * on a failed request, which is precisely when they most need it back.
   *
   * VERIFIED LOAD-BEARING: removing `.unwrap()` from CommentList's onSubmit
   * makes this fail (the field is cleared despite the 500).
   */
  it('keeps the typed text when the post fails', async () => {
    const user = userEvent.setup();
    renderComments();
    await screen.findByText('First comment');

    server.use(
      http.post(`${BASE}/tasks/:taskId/comments`, () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 }),
      ),
    );

    const input = screen.getByLabelText(/add a comment/i);
    await user.type(input, 'Please do not lose this');
    await user.click(screen.getByRole('button', { name: /post comment/i }));

    // Wait for the request to settle, then assert the text survived.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /post comment/i })).toBeEnabled();
    });
    expect(input).toHaveValue('Please do not lose this');
  });

  describe('delete permissions - mirroring the backend rule', () => {
    /**
     * The backend allows the AUTHOR, a project MANAGER, or a global ADMIN.
     * These four cases pin each branch, because a UI rule that drifts from the
     * server's either hides a working action or shows one that always 403s.
     */
    it('offers delete on your own comment', async () => {
      comments = [makeComment({ authorId: ME.id, author: { id: ME.id, name: 'Ram' } })];
      renderComments();

      expect(await screen.findByRole('button', { name: /delete comment/i })).toBeVisible();
    });

    it('does NOT offer delete on someone else’s comment to a plain member', async () => {
      renderComments(Role.MEMBER);
      await screen.findByText('First comment');

      expect(screen.queryByRole('button', { name: /delete comment/i })).not.toBeInTheDocument();
    });

    it('offers delete to a project manager moderating another user', async () => {
      renderComments(Role.MANAGER);
      await screen.findByText('First comment');

      expect(screen.getByRole('button', { name: /delete comment/i })).toBeVisible();
    });

    it('offers delete to a global admin', async () => {
      renderComments(null, { ...ME, role: Role.ADMIN });
      await screen.findByText('First comment');

      expect(screen.getByRole('button', { name: /delete comment/i })).toBeVisible();
    });
  });

  /**
   * THE CONFIRMATION DIALOG - and the accessible-name assertion is the point.
   *
   * `getByRole('dialog')` only finds it if `role="dialog"` is present, and
   * `toHaveAccessibleName` only passes if `aria-labelledby` resolves to real
   * text. Together they verify the Modal's `useId` wiring end to end, which a
   * snapshot of the markup would not.
   */
  it('confirms before deleting, and names what is being deleted', async () => {
    const user = userEvent.setup();
    comments = [makeComment({ authorId: ME.id, author: { id: ME.id, name: 'Ram' } })];
    renderComments();

    await user.click(await screen.findByRole('button', { name: /delete comment/i }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('Delete comment');
    // The dialog quotes the comment, so nobody confirms deleting the wrong one.
    expect(dialog).toHaveTextContent('First comment');

    await user.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() => {
      expect(screen.queryByText('First comment')).not.toBeInTheDocument();
    });
  });

  it('cancelling the dialog deletes nothing', async () => {
    const user = userEvent.setup();
    comments = [makeComment({ authorId: ME.id, author: { id: ME.id, name: 'Ram' } })];
    renderComments();

    await user.click(await screen.findByRole('button', { name: /delete comment/i }));
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(screen.getByText('First comment')).toBeVisible();
    expect(comments).toHaveLength(1);
  });

  /**
   * =========================================================================
   * THE REGRESSION TEST FOR THE REAL BACKEND INCONSISTENCY
   * =========================================================================
   * `POST` returns `author: null`; `GET` returns the populated author. Both are
   * declared `CommentView`. Confirmed against the running API, root cause in
   * comments.repository.ts: `list()` populates, `create()` does not.
   *
   * The current design survives it because the mutation INVALIDATES rather than
   * writing its response into the cache — so what renders always came from the
   * list endpoint, which populates.
   *
   * This test pins that. If someone later "optimises" the mutation into an
   * optimistic update or an `updateQueryData` that inserts the POST response,
   * the new comment renders as "Unknown user" and this fails.
   *
   * WITHOUT THIS TEST that change looks obviously correct in review — it
   * removes a network round trip and makes the UI feel faster. The bug it
   * introduces is cosmetic, intermittent, and lives in a component nobody would
   * think to re-check.
   *
   * VERIFIED LOAD-BEARING: changing the MSW POST handler to return a populated
   * author makes this pass vacuously — which is why the handler comment says
   * not to.
   * =========================================================================
   */
  it('shows the author name for a just-posted comment, despite POST returning null', async () => {
    const user = userEvent.setup();
    renderComments();
    await screen.findByText('First comment');

    await user.type(screen.getByLabelText(/add a comment/i), 'Posted by me');
    await user.click(screen.getByRole('button', { name: /post comment/i }));

    const posted = await screen.findByText('Posted by me');
    expect(posted).toBeVisible();

    // 'Ada' is the seeded comment's author; the new one must show a real name
    // too — NOT the "Unknown user" fallback that POST's null would produce.
    expect(screen.queryByText('Unknown user')).not.toBeInTheDocument();
  });
});
