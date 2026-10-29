import { isRejectedWithValue, type Middleware } from '@reduxjs/toolkit';
import { toastAdded } from '@/features/ui/uiSlice';
import { isApiError, apiErrorMessages } from '@/types/api';

/**
 * =============================================================================
 * A GLOBAL ERROR HANDLER FOR MUTATIONS - and the best argument for middleware
 * =============================================================================
 * Every failed mutation raises a toast, from one place, without a single
 * try/catch at a call site.
 *
 * WHY MIDDLEWARE AND NOT A HOOK: middleware sits in the dispatch pipeline, so
 * it sees EVERY action - including ones dispatched from outside React entirely.
 * A hook cannot do that, and neither can Context. This is the capability that
 * makes Redux more than "Context with extra steps", and it is worth being able
 * to name in an interview.
 *
 * ANGULAR BRIDGE: an `HttpInterceptor` that catches errors and pushes to a
 * notification service. Same position in the pipeline, same job.
 *
 * -----------------------------------------------------------------------------
 * WHY MUTATIONS ONLY, AND NOT QUERIES
 * -----------------------------------------------------------------------------
 * This is the design decision in the file, not the plumbing.
 *
 *   A FAILED MUTATION is a user action that did not happen. They pressed Save
 *   and nothing was saved. They MUST be told, and the component often has
 *   nowhere sensible to put the message - so a toast is right.
 *
 *   A FAILED QUERY has a natural home: the component that asked for the data
 *   renders `<ErrorState onRetry={...}>` in place of the content. That is
 *   better than a toast, because it is where the user is looking and it can
 *   offer a retry.
 *
 * Toasting query failures too would double up - an error panel AND a toast for
 * the same event - and a background refetch failing while the user reads cached
 * data would interrupt them over something that does not affect what is on
 * screen.
 * =============================================================================
 */
export const errorToastMiddleware: Middleware = (store) => (next) => (action) => {
  /**
   * `isRejectedWithValue` is RTK's own type guard. It narrows to actions from a
   * thunk that rejected with a VALUE - which is what RTK Query does when the
   * server responds with an error status.
   *
   * The distinction matters: a thunk that THREW (a network failure, a bug in
   * our code) rejects WITHOUT a value. Those are genuine exceptions and belong
   * in an error tracker, not in a toast that says "400".
   */
  if (isRejectedWithValue(action)) {
    const meta: unknown = action.meta;

    /**
     * NARROWING `meta` PROPERLY rather than casting.
     *
     * RTK Query stamps mutations with `meta.arg.type === 'mutation'`. That is
     * an internal shape, so it is checked defensively - if the library changes
     * it, this quietly stops toasting rather than throwing inside middleware,
     * which is the worst possible place for an exception.
     */
    const isMutation =
      typeof meta === 'object' &&
      meta !== null &&
      'arg' in meta &&
      typeof meta.arg === 'object' &&
      meta.arg !== null &&
      'type' in meta.arg &&
      meta.arg.type === 'mutation';

    if (isMutation) {
      const payload: unknown = action.payload;

      /**
       * RTK Query wraps the response as `{ status, data }`, where `data` is the
       * backend's body - our standard `ApiError`. Reusing `isApiError` and
       * `apiErrorMessages` means the SAME parser handles errors whether they
       * arrive through `httpClient` or RTK Query.
       *
       * One error contract, one parser. That is the payoff for the backend
       * standardising its error shape (Phase 1).
       */
      const body: unknown =
        typeof payload === 'object' && payload !== null && 'data' in payload
          ? payload.data
          : payload;

      const message = isApiError(body)
        ? apiErrorMessages(body).join(', ')
        : 'Something went wrong. Please try again.';

      /**
       * `store.dispatch` from inside middleware. This action re-enters the
       * pipeline at the top, so other middleware sees it too.
       *
       * NO INFINITE LOOP: `toastAdded` is a plain slice action, not a rejected
       * thunk, so the guard above does not match it. Worth checking whenever
       * middleware dispatches - a middleware that reacts to its own output is
       * a stack overflow.
       */
      store.dispatch(toastAdded(message, 'error'));
    }
  }

  return next(action);
};
