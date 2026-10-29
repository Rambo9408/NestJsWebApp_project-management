import { Box, Card, CardContent, Container, Stack, Typography } from '@mui/material';
import { Outlet } from 'react-router-dom';

/**
 * =============================================================================
 * AuthLayout - a SECOND layout route, and the reason layout routes exist
 * =============================================================================
 * Login and register deliberately do NOT get the app chrome: no nav, no theme
 * toggle, no links into the app. A logged-out user cannot use any of it, and
 * showing a nav bar full of links that all bounce back to /login is a worse
 * experience than showing none.
 *
 * THIS IS WHY LAYOUT ROUTES BEAT PUTTING <Header /> IN EVERY PAGE. With a
 * shared header component, "which pages get the nav?" is a decision repeated in
 * every page file, and the answer drifts. With layout routes it is expressed
 * ONCE, structurally, in the route tree:
 *
 *     AuthLayout      -> /login, /register          (no chrome)
 *     AppLayout       -> /dashboard, /tasks, ...    (full chrome)
 *
 * A new page under the wrong parent is visible in a five-line diff of the
 * router, rather than invisible in a page component nobody re-reads.
 *
 * ANGULAR BRIDGE: this is a component-less parent route with its own
 * `<router-outlet>` - the same pattern, and in Angular it is also where you
 * would hang `canActivate`. Phase 11 uses exactly that shape for auth guarding,
 * except the guard is a wrapper component rather than a framework hook.
 * =============================================================================
 */
export function AuthLayout() {
  return (
    <Box
      sx={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        // `bgcolor` from the theme, NOT a hardcoded colour. The dark-mode
        // toggle is unreachable from here, but the preference persists in
        // localStorage - so a user who chose dark mode must not be flashbanged
        // by a white login screen on their next visit.
        bgcolor: 'background.default',
        py: 4,
      }}
    >
      <Container maxWidth="sm">
        <Stack spacing={3}>
          <Stack spacing={0.5} sx={{ textAlign: 'center' }}>
            {/*
              `component="h1"` on the brand. Every page needs exactly one h1,
              and on an auth page the product name is it. Heading LEVEL is
              structure for screen readers; `variant` is only appearance. MUI
              separates them precisely so you can pick the right one of each -
              using variant="h4" as though it were an h4 element is one of the
              most common a11y mistakes in MUI codebases.
            */}
            <Typography variant="h4" component="h1">
              TaskFlow
            </Typography>
            <Typography color="text.secondary">Project management, the boring parts done well</Typography>
          </Stack>

          <Card variant="outlined">
            <CardContent sx={{ p: 4 }}>
              {/* The matched child route renders here: LoginPage or RegisterPage. */}
              <Outlet />
            </CardContent>
          </Card>
        </Stack>
      </Container>
    </Box>
  );
}
