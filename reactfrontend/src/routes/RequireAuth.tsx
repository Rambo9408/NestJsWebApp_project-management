import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useSession } from '@/features/auth/useSession';
import { LoadingState } from '@/components/feedback/LoadingState';
import { paths } from './paths';

/**
 * =============================================================================
 * RequireAuth - a route guard, which in React is just a component
 * =============================================================================
 * ANGULAR BRIDGE: this is `canActivate`. The difference is that Angular's guard
 * is a framework hook returning a boolean or UrlTree, resolved by the router
 * before activation. Here a guard is an ordinary component that decides what to
 * render - which means it can use hooks, read Context, and be composed like
 * anything else. Less framework, more composition.
 *
 * IT WRAPS AN `<Outlet />` RATHER THAN CHILDREN, so it can be dropped in as a
 * layout route and protect an entire branch:
 *
 *     { element: <RequireAuth />, children: [ ...every protected route ] }
 *
 * WHY THAT SHAPE MATTERS: a new protected page is added as a child and is
 * guarded by construction. A guard that has to be remembered per page is a
 * guard that will eventually be forgotten - and forgetting it is a security
 * bug, not a cosmetic one.
 *
 * -----------------------------------------------------------------------------
 * !! THE FRONTEND IS NOT THE SECURITY BOUNDARY !!
 * -----------------------------------------------------------------------------
 * This component hides UI. It does not protect data. Anyone can:
 *   - delete this component in DevTools
 *   - call the API directly with curl
 *   - edit the bundle
 *
 * The NestJS `JwtAuthGuard` (registered globally via APP_GUARD) is what
 * actually protects anything. Verified in Phase 1: `GET /api/v1/tasks` with no
 * token returns 401 regardless of what the client believes.
 *
 * This exists for UX - so a logged-out user sees a login form instead of a page
 * full of failed requests. That distinction is a guaranteed interview question
 * and the answer must be unambiguous.
 * =============================================================================
 */
export function RequireAuth() {
  const { status } = useSession();
  const location = useLocation();

  /**
   * THE `restoring` BRANCH IS THE ONE PEOPLE FORGET, and omitting it produces a
   * bug that looks random.
   *
   * On boot the provider is asking /auth/refresh whether the httpOnly cookie is
   * still good. Treating "not yet authenticated" as "anonymous" would redirect
   * a perfectly logged-in user to /login on every single reload, before the
   * answer arrives - and they would land back on the dashboard a moment later
   * once it did. The symptom is a login page that flashes on refresh, which is
   * hard to reproduce because it depends on network timing.
   *
   * This is precisely why AuthState is a three-case union rather than
   * `user | null` plus a loading flag.
   */
  if (status === 'restoring') {
    return <LoadingState variant="spinner" label="Restoring your session..." />;
  }

  if (status === 'anonymous') {
    /**
     * `state={{ from: location }}` CAPTURES WHERE THEY WERE GOING.
     *
     * A user opens a link to /tasks/abc123 from Slack, is not signed in, logs
     * in, and lands on... the dashboard. Then has to find the task again. The
     * location travels through the redirect so LoginPage can send them where
     * they actually wanted.
     *
     * `replace` so the protected URL does not stay in history - otherwise Back
     * from the login page bounces off the guard and returns to login, trapping
     * the user in a loop.
     *
     * React Router's `location.state` is held in the history entry, not the
     * URL, so it survives the navigation without appearing as a query param.
     */
    return <Navigate to={paths.login} replace state={{ from: location }} />;
  }

  return <Outlet />;
}
