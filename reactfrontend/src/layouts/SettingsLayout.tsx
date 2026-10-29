import { Box, Stack, Tab, Tabs, Typography } from '@mui/material';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { paths } from '@/routes/paths';

/**
 * =============================================================================
 * SettingsLayout - a NESTED layout route, two levels deep
 * =============================================================================
 * Route shape:
 *
 *     AppLayout                        header, nav, theme toggle
 *      └── SettingsLayout              this file: heading + tabs
 *           ├── /settings/profile      ProfilePage
 *           └── /settings/security     SecurityPage
 *
 * TWO OUTLETS ARE ACTIVE AT ONCE. AppLayout's outlet holds SettingsLayout, and
 * SettingsLayout's outlet holds the profile or security page. That composition
 * is the entire point of nested routing, and it is what makes "shared chrome
 * for a section" a structural fact rather than a convention.
 *
 * WHY IT BEATS PUTTING THE TABS IN EACH PAGE:
 *   - The tab bar MOUNTS ONCE. Switching tabs does not re-create it, so it
 *     keeps scroll position and any state it holds.
 *   - Adding a third settings page means one route entry, not a copy-pasted
 *     tab bar that will drift out of sync with the other two.
 *   - In Phase 11 an auth guard goes on the PARENT and every child inherits it
 *     by construction. A guard you have to remember to add to each page is a
 *     guard that will eventually be forgotten - and forgetting it is a security
 *     bug, not a cosmetic one.
 *
 * ANGULAR BRIDGE: identical to a `children` array in an Angular route config
 * with its own `<router-outlet>`, and the guard-on-the-parent point is the same
 * argument for `canActivateChild`.
 * =============================================================================
 */

const TABS = [
  { to: paths.settingsProfile, label: 'Profile' },
  { to: paths.settingsSecurity, label: 'Security' },
] as const;

export function SettingsLayout() {
  /**
   * `useLocation` rather than `useParams`, because the active tab is determined
   * by the PATH, not by a parameter.
   *
   * `NavLink` would give an `isActive` flag for free and is the usual choice
   * for nav links. MUI's `Tabs` needs a single `value` naming the active tab,
   * so reading the pathname once here is simpler than threading NavLink's
   * render-prop through a Tab.
   */
  const { pathname } = useLocation();

  /**
   * A DEFENSIVE FALLBACK. If `pathname` matches no tab - which happens for one
   * render during a redirect from /settings to /settings/profile - MUI logs a
   * console error about an out-of-range value and renders no indicator.
   *
   * Falling back to the first tab keeps that transient state visually sane.
   * Small, but this is exactly the class of bug that only appears in production
   * as "a console error nobody can reproduce".
   */
  const activeTab = TABS.find((tab) => tab.to === pathname)?.to ?? TABS[0].to;

  return (
    <Stack spacing={3}>
      <Typography variant="h4" component="h2">
        Settings
      </Typography>

      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        {/*
          `aria-label` on the tab list. MUI renders role="tablist", and a
          screen reader announcing "tab list" with no name gives the user no
          idea what these tabs control - especially on a page with more than
          one set.
        */}
        <Tabs value={activeTab} aria-label="Settings sections">
          {TABS.map((tab) => (
            /*
              `component={Link}` again - the polymorphic pattern from Phase 2.
              These render as real anchors, so middle-click and "open in new
              tab" work, and the router handles the click without a page reload.

              A Tab with onClick={() => navigate(...)} would look identical and
              silently break both.
            */
            <Tab key={tab.to} value={tab.to} label={tab.label} component={Link} to={tab.to} />
          ))}
        </Tabs>
      </Box>

      <Outlet />
    </Stack>
  );
}
