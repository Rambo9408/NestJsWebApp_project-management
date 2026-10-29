import { Outlet } from 'react-router-dom';
import { Button, Stack, Typography } from '@mui/material';
import { Link } from 'react-router-dom';
import { useAppSelector } from '@/app/hooks';
import { selectAuthStatus, selectCurrentUser } from '@/features/auth/authSlice';
import { LoadingState } from '@/components/feedback/LoadingState';
import type { Role } from '@/types/api';
import { paths } from './paths';

/**
 * =============================================================================
 * RequireRole - a route guard for GLOBAL role, layered under RequireAuth
 * =============================================================================
 * Route shape:
 *
 *     RequireAuth              are you signed in?      -> /login if not
 *      └── RequireRole(ADMIN)  are you an admin?       -> 403 page if not
 *           └── /admin/*
 *
 * TWO GUARDS, TWO QUESTIONS, and stacking them is the point. `RequireAuth`
 * answers authentication and redirects; this answers authorization and does
 * NOT redirect. Merging them into one "RequireAdmin" would force a single
 * failure response for two very different situations.
 *
 * -----------------------------------------------------------------------------
 * WHY THIS DOES NOT REDIRECT, and it is the decision worth defending
 * -----------------------------------------------------------------------------
 * Sending a signed-in non-admin to /login is actively wrong: they ARE logged
 * in, so the login form either bounces them straight back (a loop) or invites
 * them to re-enter credentials that will not help. The message "you need to be
 * an admin" is the truth, and the user can act on it.
 *
 * Redirect for MISSING IDENTITY. Explain for INSUFFICIENT PERMISSION. HTTP
 * makes the same distinction with 401 versus 403, and for the same reason.
 *
 * -----------------------------------------------------------------------------
 * !! AND AGAIN: THIS IS NOT SECURITY !!
 * -----------------------------------------------------------------------------
 * It hides a page. The data behind it is protected by `@Roles(Role.ADMIN)` on
 * the NestJS controller - verified: a member calling GET /users gets 403
 * regardless of what the client renders.
 *
 * If this component were deleted, a member could open /admin/users and see an
 * error state where the table should be. That is the correct failure: ugly,
 * and empty.
 * =============================================================================
 */
export function RequireRole({ role }: { role: Role }) {
  const status = useAppSelector(selectAuthStatus);
  const user = useAppSelector(selectCurrentUser);

  /**
   * THE `restoring` BRANCH, for the same reason RequireAuth has one: during the
   * boot refresh we do not yet know who this is. Treating unknown as "not an
   * admin" would flash a 403 at every admin on every reload.
   */
  if (status === 'restoring') {
    return <LoadingState variant="spinner" label="Checking permissions..." />;
  }

  if (user?.role !== role) {
    return (
      <Stack spacing={2} sx={{ alignItems: 'flex-start', py: 6 }} role="alert">
        <Typography variant="h4" component="h2">
          You do not have access to this page
        </Typography>
        <Typography color="text.secondary">
          {/*
            Says WHAT IS REQUIRED, not merely that access was denied. "Access
            denied" leaves the user with no next step; naming the role tells
            them who to ask.

            It leaks that an admin area exists - which is acceptable here,
            because the user is authenticated and the existence of an admin
            role is not a secret. For genuinely sensitive areas, a 404-style
            "page not found" is the stronger choice, exactly as the backend
            guards return 404 rather than 403 to non-members.
          */}
          This area requires the <strong>{role}</strong> role. Ask an administrator if you
          need access.
        </Typography>
        <Button component={Link} to={paths.dashboard} variant="contained">
          Back to dashboard
        </Button>
      </Stack>
    );
  }

  return <Outlet />;
}
