import { Button, Stack, Typography } from '@mui/material';
import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { paths } from '@/routes/paths';

/**
 * =============================================================================
 * RouteErrorPage - the router's `errorElement`
 * =============================================================================
 * Rendered when a route throws while rendering, or when no route matches.
 *
 * PREVIOUSLY this project pointed `errorElement` at `NotFoundPage`, which was a
 * shortcut worth correcting: a 404 and a crash are different events and deserve
 * different copy. Telling a user "page not found" when the page was found and
 * then exploded sends them looking for a typo that does not exist.
 *
 * THREE ERROR LAYERS, and knowing which catches what is a real interview
 * question:
 *
 *   ErrorBoundary (main.tsx)  outermost net. Catches render errors anywhere,
 *                             including in the providers ABOVE the router.
 *   errorElement (this file)  route-scoped. The app chrome survives, so the
 *                             user can navigate away instead of being stranded.
 *   ErrorState (component)    API failures. NOT errors in the React sense -
 *                             a rejected promise never reaches either of the
 *                             above. Failed requests are DATA.
 * =============================================================================
 */
export function RouteErrorPage() {
  /**
   * `useRouteError` returns `unknown` - the honest type, for the same reason
   * `ErrorState` takes `unknown`. A thrown value can be anything.
   */
  const error = useRouteError();

  /**
   * `isRouteErrorResponse` is React Router's own TYPE GUARD. It narrows to the
   * router's `ErrorResponse` shape - the object thrown for a 404 (no matching
   * route) or by a loader that threw a Response.
   *
   * This is the same narrowing discipline as `isApiError`: check the most
   * specific shape first, fall back progressively, never cast.
   */
  const is404 = isRouteErrorResponse(error) && error.status === 404;

  const message = isRouteErrorResponse(error)
    ? error.statusText || `HTTP ${String(error.status)}`
    : error instanceof Error
      ? error.message
      : 'An unexpected error occurred.';

  return (
    <Stack spacing={2} sx={{ alignItems: 'flex-start', py: 6 }}>
      <Typography variant="h4" component="h2">
        {is404 ? 'Page not found' : 'Something went wrong'}
      </Typography>

      <Typography color="text.secondary">
        {is404
          ? 'That route does not exist. It may have moved, or the link may be wrong.'
          : 'This page failed to render. The rest of the app should still work.'}
      </Typography>

      {/*
        THE MESSAGE IS SHOWN because this is a learning project and you are the
        only user. IN PRODUCTION, render a generic string and send the detail to
        an error tracker: an exception message can leak an internal path, a
        query, or another user's data onto a shared screen. The backend applies
        exactly this rule in all-exceptions.filter.ts - known errors keep their
        message, unexpected ones become a flat "Internal server error".
      */}
      {!is404 && (
        <Typography variant="body2" component="pre" sx={{ color: 'error.main', m: 0 }}>
          {message}
        </Typography>
      )}

      <Button component={Link} to={paths.dashboard} variant="contained">
        Back to dashboard
      </Button>
    </Stack>
  );
}
