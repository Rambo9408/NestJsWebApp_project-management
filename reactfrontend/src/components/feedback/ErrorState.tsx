import { Alert, AlertTitle, Button, Stack, Typography } from '@mui/material';
import { apiErrorMessages, isApiError } from '@/types/api';
import { HttpError } from '@/services/httpClient';

/**
 * =============================================================================
 * ErrorState - for API errors, NOT for render crashes
 * =============================================================================
 * The distinction matters and interviewers probe it:
 *
 *   ErrorBoundary  -> a BUG. Something threw while rendering. The component
 *                     tree is broken and unmountable.
 *   ErrorState     -> DATA. The request failed. The component is working
 *                     perfectly; it is displaying a failure.
 *
 * A rejected promise never reaches an ErrorBoundary, so wiring API failures to
 * one is not a style choice - it simply does not work. Failed requests are an
 * expected outcome and belong in normal render output.
 * =============================================================================
 */

interface ErrorStateProps {
  /**
   * `unknown`, not `Error`.
   *
   * This is the honest type for a caught value. `catch (e)` gives `unknown`,
   * RTK Query's `error` is a union, and a thrown value in JavaScript can be
   * literally anything - a string, `undefined`, a DOM exception. Typing this
   * `Error` would be a claim we cannot back up, and the first `error.message`
   * on a thrown string would be `undefined` on screen.
   *
   * Taking `unknown` forces the NARROWING to happen here, once, instead of at
   * every call site.
   */
  error: unknown;
  /** Omit to render an error with no recovery path - rarely the right call. */
  onRetry?: () => void;
  title?: string;
}

/**
 * Turns any thrown value into messages we can render.
 *
 * NOTE THE ORDER of the checks - it goes from most specific to least, which is
 * how every narrowing chain should be built.
 *
 * A module-scope helper, not a hook and not a method. It depends on nothing but
 * its argument, so it is trivially unit-testable and has no React involvement
 * at all. Reaching for a custom hook here would be abstraction with no
 * substance - a hook is for logic that needs React state or lifecycle.
 */
function describeError(error: unknown): { messages: string[]; requestId?: string } {
  // Our own transport error - richest case, it carries the parsed API body.
  if (error instanceof HttpError && error.body) {
    return { messages: apiErrorMessages(error.body), requestId: error.body.requestId };
  }

  /**
   * RTK QUERY'S ENVELOPE: `FetchBaseQueryError` is `{ status, data }`, where
   * `data` is the backend's body - our standard `ApiError`.
   *
   * Unwrapping it here means ONE error component handles both transports.
   * `httpClient` throws an `HttpError`; RTK Query returns `{status, data}`.
   * Without this branch, every RTK Query failure would fall through to the
   * generic "An unexpected error occurred" and the backend's per-field
   * validation messages - the ones it deliberately preserves as an array -
   * would never reach the screen.
   *
   * The check is defensive rather than a cast: `data` is typed `unknown` by
   * RTK Query precisely because a server can return anything, including an
   * nginx HTML page.
   */
  if (typeof error === 'object' && error !== null && 'data' in error) {
    const { data } = error;
    if (isApiError(data)) {
      return { messages: apiErrorMessages(data), requestId: data.requestId };
    }
  }

  // A raw API error object, e.g. a body already unwrapped by a caller.
  if (isApiError(error)) {
    return { messages: apiErrorMessages(error), requestId: error.requestId };
  }
  if (error instanceof Error) {
    return { messages: [error.message] };
  }
  // The genuinely unknown case. Never interpolate the raw value into the UI -
  // it could be an object that stringifies to "[object Object]", or something
  // containing data the user should not see.
  return { messages: ['An unexpected error occurred.'] };
}

export function ErrorState({ error, onRetry, title = 'Something went wrong' }: ErrorStateProps) {
  const { messages, requestId } = describeError(error);

  return (
    <Alert
      severity="error"
      /*
        `role="alert"` (which MUI sets for severity="error") makes assistive
        technology announce this IMMEDIATELY and interrupt what it was saying.
        That is correct for an error the user must know about, and it is why
        this role should never be used for routine status text.
      */
      action={
        onRetry && (
          <Button color="inherit" size="small" onClick={onRetry}>
            Retry
          </Button>
        )
      }
    >
      <AlertTitle>{title}</AlertTitle>

      {/*
        RENDERING A LIST - and the first appearance of `key` in this project.

        The backend sends one message PER FAILED FIELD (message: string[]), so
        a bad registration produces three entries. Rendering only messages[0]
        would show the user one problem, let them fix it, and then show the
        next - three round-trips for one form.

        WHY THE INDEX IS ACCEPTABLE AS A KEY HERE, when it usually is not:
        index-as-key is only safe when the list is STATIC - never reordered,
        never filtered, never inserted into - and the items have no state. This
        array is rendered once and replaced wholesale on the next error, so
        there is no identity to preserve.

        These strings have no id, so the alternative would be the string
        itself, which breaks on duplicates. Phase 4 covers reconciliation and
        exactly why index keys corrupt state in dynamic lists.
      */}
      <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: messages.length > 1 ? 2.5 : 0 }}>
        {messages.map((message, index) => (
          <Typography
            key={index}
            component="li"
            variant="body2"
            sx={{ listStyle: messages.length > 1 ? 'disc' : 'none' }}
          >
            {message}
          </Typography>
        ))}
      </Stack>

      {/*
        THE REQUEST ID IS THE MOST USEFUL THING ON THIS SCREEN.

        The backend stamps every response with one and logs it alongside the
        full stack trace. Showing it turns "it broke yesterday, I don't
        remember what I clicked" into a single log query. It costs one line and
        it is the difference between a debuggable production system and an
        undebuggable one.
      */}
      {requestId && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Reference: <code>{requestId}</code>
        </Typography>
      )}
    </Alert>
  );
}
