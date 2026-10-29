import {
  AppBar,
  Box,
  Button,
  Container,
  IconButton,
  Stack,
  Toolbar,
  Typography,
} from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { useEffect, useMemo, useRef } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { paths } from '@/routes/paths';
import { useThemeMode } from '@/app/providers/themeModeContext';
import { useSession } from '@/features/auth/useSession';
import { usePermissions } from '@/features/auth/usePermissions';
import type { Capability } from '@/features/auth/permissions';
import { Toaster } from '@/features/ui/Toaster';
import { NotificationBell } from '@/features/notifications/NotificationBell';

/**
 * =============================================================================
 * ROOT LAYOUT - a "layout route"
 * =============================================================================
 * The chrome that stays put while the page changes: header, nav, footer.
 *
 * `<Outlet />` IS THE KEY IDEA. It marks the hole where the matched CHILD route
 * renders. React Router matches nested routes and nests their elements to
 * match, so the layout renders once and only the outlet content swaps.
 *
 * ANGULAR BRIDGE: `<Outlet />` is `<router-outlet>`. Genuinely the same concept
 * - a placeholder the router fills. The difference is configuration: Angular
 * declares routes in a module-level array processed by the framework, while
 * here routes are ordinary React elements in an ordinary tree. That means a
 * route can be composed, wrapped and conditionally rendered with plain
 * JavaScript, which is how our Phase 11 authorization wrapper will work.
 *
 * WHY A LAYOUT ROUTE AND NOT `<Header />` IN EVERY PAGE:
 *   Repeating the header in each page component re-mounts it on every
 *   navigation, throwing away its state - a search box would clear, an open
 *   dropdown would close. A layout route mounts it ONCE. Same reason Angular
 *   pushes shared chrome into a parent route rather than each component.
 * =============================================================================
 */
/**
 * Nav links as DATA at module scope - and now the reason that mattered.
 *
 * Phase 2 said "this array gains a `capability` field and is filtered per user,
 * which is the whole reason it is data rather than hand-written JSX". This is
 * that change, and it is one line per link rather than a rewrite.
 *
 * `capability?: Capability` - OPTIONAL, because most links need no permission.
 * Making it required would force `capability: undefined` on four of five
 * entries, which is noise that trains people to stop reading the field.
 */
const NAV_LINKS: { to: string; label: string; capability?: Capability }[] = [
  { to: paths.dashboard, label: 'Dashboard' },
  { to: paths.projects, label: 'Projects' },
  { to: paths.tasks, label: 'Tasks' },
  { to: paths.settingsProfile, label: 'Settings' },
  { to: paths.labComponents, label: 'Labs' },
  { to: paths.labPerformance, label: 'Perf' },
  /**
   * ONLY RENDERED FOR GLOBAL ADMINS.
   *
   * HIDING rather than disabling is right here: a member cannot become an admin
   * by clicking, so a disabled link would be permanent clutter - and it would
   * advertise an admin area to everyone.
   *
   * The link disappearing is NOT what protects /admin/users. `RequireRole`
   * stops the page rendering if the URL is typed directly, and the backend's
   * class-level `@Roles(Role.ADMIN)` stops the data being served at all. Three
   * layers, one of which is actually the boundary.
   */
  { to: paths.adminUsers, label: 'Users', capability: 'users:read' },
  /**
   * The audit view, gated by the capability that had existed since Phase 11
   * with no page behind it.
   *
   * `activity-logs:read` was defined in permissions.ts and unit-tested (only
   * admins hold it) while nothing in the application ever asked for it. A
   * correctly-guarded route to nowhere - which is why the capability list is
   * now checked against the router in router.test.tsx.
   */
  { to: paths.adminActivity, label: 'Activity', capability: 'activity-logs:read' },
];

/**
 * The nav, filtered by permission.
 *
 * ITS OWN COMPONENT for the same reason as ThemeModeToggle and SessionControls:
 * it reads from the store, so the smallest component that reads it is the
 * smallest thing that re-renders. Filtering inside `RootLayout` would re-render
 * the entire layout whenever the session changed.
 */
function MainNav() {
  const { can } = usePermissions();

  /**
   * `useMemo` because this produces a NEW ARRAY. Without it the array identity
   * changes on every render - harmless today, since nothing downstream is
   * memoised, and a trap the moment somebody wraps a nav item in `React.memo`.
   *
   * `can` is stable while the user is unchanged (it is `useCallback`'d in
   * `usePermissions`), which is what makes this memo actually hold. An unstable
   * `can` would recompute every render and the memo would be pure overhead -
   * the Phase 3 point about memoising at a hook boundary, paying off here.
   */
  const visible = useMemo(
    () => NAV_LINKS.filter((link) => !link.capability || can(link.capability)),
    [can],
  );

  return (
    <Stack component="nav" direction="row" spacing={2} aria-label="Main">
      {visible.map((link) => (
        <Typography
          key={link.to}
          component={Link}
          to={link.to}
          sx={{ color: 'inherit', textDecoration: 'none' }}
        >
          {link.label}
        </Typography>
      ))}
    </Stack>
  );
}

/**
 * A context consumer with NO PROPS.
 *
 * It is a separate component rather than inline JSX for a reason worth naming:
 * a component re-renders when the context it reads changes, and the smallest
 * component that reads it is the smallest thing that re-renders. Calling
 * `useThemeMode()` inside `RootLayout` would re-render the entire layout - nav,
 * header, Outlet wrapper - on every toggle.
 *
 * THIS IS THE STANDARD FIX for Context re-render cost, and it costs nothing:
 * push the consumption DOWN to the leaf that actually needs it. Reach for
 * splitting the context or memoising consumers only after this is not enough.
 */
function ThemeModeToggle() {
  const { mode, toggleMode } = useThemeMode();

  return (
    <IconButton
      onClick={toggleMode}
      color="inherit"
      /*
        An icon-only button MUST have an accessible name. Without aria-label a
        screen reader announces "button" and nothing else. The label also states
        what the button DOES, not what the current state is - "Switch to dark
        mode" rather than "Light mode", which is ambiguous about whether it is a
        label or a status.
      */
      aria-label={`Switch to ${mode === 'light' ? 'dark' : 'light'} mode`}
    >
      <Typography aria-hidden>{mode === 'light' ? '☾' : '☀'}</Typography>
    </IconButton>
  );
}

/**
 * Another leaf-level context consumer, for the same reason as ThemeModeToggle:
 * the smallest component that reads the auth context is the smallest thing that
 * re-renders when the session changes.
 */
function SignedIn({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  return status === 'authenticated' ? children : null;
}

function SessionControls() {
  const { status, user, signOut } = useSession();

  /**
   * Renders nothing while the boot-time refresh is still deciding.
   *
   * Showing "Sign in" during `restoring` would flash on every page reload for
   * an already-logged-in user - the same three-state problem RequireAuth
   * solves, and the reason AuthState is a union rather than `user | null`.
   */
  if (status !== 'authenticated' || !user) return null;

  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Typography variant="body2">{user.name}</Typography>
      {/*
        `void signOut()` - signOut is async and the handler must return void.
        Without `void`, `no-misused-promises` flags it: a promise returned to an
        event handler is never awaited, so a rejection becomes an unhandled
        rejection nobody sees.
      */}
      <Button
        color="inherit"
        size="small"
        onClick={() => {
          void signOut();
        }}
      >
        Sign out
      </Button>
    </Stack>
  );
}

/**
 * =============================================================================
 * MAIN_CONTENT_ID - the target of both the skip link and the focus reset
 * =============================================================================
 * One constant rather than the string '#main-content' written in three places,
 * because a typo in any one of them produces a skip link that silently does
 * nothing. It still works, still looks fine, and simply never moves focus.
 * =============================================================================
 */
const MAIN_CONTENT_ID = 'main-content';

/**
 * =============================================================================
 * Human-readable page names, for the route announcer below
 * =============================================================================
 * Derived from the path rather than stored in state, so there is no second
 * source of truth to keep in sync and no `useEffect` writing state on
 * navigation (which `react-hooks/set-state-in-effect` correctly rejects).
 */
function pageNameFor(pathname: string): string {
  const match = NAV_LINKS.find((item) => pathname.startsWith(item.to));
  if (match) return match.label;
  if (pathname === paths.root) return 'Dashboard';
  // A generic fallback beats announcing nothing: "Page changed" at least tells
  // the user the navigation happened.
  return 'Page';
}

/**
 * =============================================================================
 * THE TWO ACCESSIBILITY FIXES AXE COULD NOT HAVE FOUND
 * =============================================================================
 * The Phase 18-19 axe pass found four violations in components and all four
 * are fixed. It found NOTHING here - and this is where the two worst problems
 * in the whole application were.
 *
 * That is the single most useful thing to understand about automated
 * accessibility testing, so it is written where the fix is:
 *
 * -----------------------------------------------------------------------------
 * PROBLEM 1: EVERY PAGE STARTED WITH SIX TAB STOPS OF CHROME
 * -----------------------------------------------------------------------------
 * Header, three nav links, notification bell, session menu, theme toggle - a
 * keyboard user traversed all of it before reaching the content, ON EVERY
 * PAGE, forever. WCAG 2.4.1 "Bypass Blocks", Level A.
 *
 * WHY AXE PASSED IT: axe's `bypass` rule is satisfied by ANY of a skip link, a
 * landmark, or a heading - and this layout has `<main>` and an `<h1>`. So the
 * rule was green while the experience it exists to protect was not. The rule
 * checks that bypassing is POSSIBLE for a screen-reader user navigating by
 * landmark; it cannot check that it is possible for a SIGHTED KEYBOARD USER,
 * who has no landmark navigation and can only press Tab.
 *
 * -----------------------------------------------------------------------------
 * PROBLEM 2: NAVIGATION WAS COMPLETELY SILENT
 * -----------------------------------------------------------------------------
 * This is THE canonical single-page-application accessibility failure, and it
 * is invisible to every automated tool ever written.
 *
 * A real page load moves focus to the top of the new document and the screen
 * reader begins reading it. `history.pushState` does none of that. React swaps
 * the subtree, the URL changes, the visual page is entirely different - and for
 * a screen reader user, NOTHING HAPPENED. Focus is still on the link they
 * activated, which may no longer exist. No announcement. No new context.
 *
 * They have to work out, by exploring, that the page changed at all.
 *
 * Every framework has this, and it is why "we use a router" is not an
 * accessibility answer. The router gives you `pushState`; restoring what a
 * browser navigation used to do for free is YOUR job.
 *
 * THE FIX, both halves of it:
 *   - move focus to `<main>` on navigation, which is what makes the screen
 *     reader start reading the new content and what puts a keyboard user's
 *     next Tab in the right place
 *   - announce the page name in a live region, because focus alone tells the
 *     user WHERE they are but not THAT they moved
 *
 * INTERVIEW - this is a genuinely strong answer to "what's hard about
 * accessibility in an SPA?", because it is specific, it is universal, and most
 * candidates have never thought about it. The tell that someone has actually
 * done the work is mentioning `tabIndex={-1}`: without it, `.focus()` on a
 * `<main>` element does nothing at all, because non-interactive elements are
 * not focusable by default.
 * =============================================================================
 */
function RouteAnnouncer() {
  const location = useLocation();
  const isFirstRender = useRef(true);

  useEffect(() => {
    /**
     * SKIP THE INITIAL MOUNT. On first load the browser has already done the
     * right thing - focus is at the top of the document and the screen reader
     * is reading. Stealing focus here would INTERRUPT that, which is worse than
     * doing nothing.
     *
     * A ref, not state: flipping state here would re-render for no visual
     * reason, and `react-hooks/set-state-in-effect` would reject it. A ref is
     * the correct tool for "remember something across renders that is not
     * rendered".
     */
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    const main = document.getElementById(MAIN_CONTENT_ID);
    /**
     * `preventScroll` because focusing an element scrolls it into view by
     * default - and `<main>` is already at the top after a navigation, so the
     * scroll is either a no-op or a visible jump. Nothing is gained by it.
     */
    main?.focus({ preventScroll: true });
    /**
     * KEYED ON `pathname`, NOT ON `location`.
     *
     * `location` is a NEW OBJECT on every navigation including a change of
     * search params or hash - so typing in a URL-synced filter box (which Phase
     * 5 deliberately does) would rip focus out of the input on every keystroke.
     * A genuinely terrible bug, and one that would look like the search box
     * being "broken" rather than like an accessibility feature misfiring.
     *
     * This is the same reference-equality reasoning that runs through the whole
     * project: depend on the primitive you actually care about.
     */
  }, [location.pathname]);

  /**
   * DERIVED DURING RENDER, no state. When the pathname changes, this text node
   * changes, and a polite live region announces the new value. That IS the
   * announcement - there is nothing to store.
   *
   * `role="status"` implies `aria-live="polite"`, which waits for the screen
   * reader to finish its current utterance instead of cutting it off. `assertive`
   * here would interrupt the user mid-sentence on every navigation.
   */
  return (
    <Box component="p" role="status" sx={visuallyHidden}>
      {pageNameFor(location.pathname)}
    </Box>
  );
}

/**
 * THE SKIP LINK.
 *
 * VISUALLY HIDDEN UNTIL FOCUSED - and that combination is the whole trick.
 * `display: none` or `visibility: hidden` would remove it from the tab order
 * entirely, so the link could never be reached and would help nobody. The
 * `visuallyHidden` clip technique keeps it focusable while taking no space.
 *
 * On focus it becomes visible, because the user it serves most - a sighted
 * keyboard user - needs to SEE where the first Tab landed. A skip link that
 * stays invisible works for screen readers and silently fails for everyone
 * navigating by keyboard with working eyes.
 *
 * IT MUST BE THE FIRST FOCUSABLE ELEMENT IN THE DOM. A skip link that is second
 * has already failed at its one job.
 */
function SkipLink() {
  return (
    <Box
      component="a"
      href={`#${MAIN_CONTENT_ID}`}
      sx={{
        ...visuallyHidden,
        '&:focus': {
          // Undo every part of the clip, or it stays invisible while focused.
          clip: 'auto',
          clipPath: 'none',
          width: 'auto',
          height: 'auto',
          overflow: 'visible',
          // Above the AppBar, which MUI gives a z-index of 1100.
          zIndex: 1200,
          top: 8,
          left: 8,
          m: 0,
          px: 2,
          py: 1,
          borderRadius: 1,
          bgcolor: 'background.paper',
          color: 'text.primary',
          border: 2,
          borderColor: 'primary.main',
          textDecoration: 'none',
        },
      }}
    >
      Skip to main content
    </Box>
  );
}

export function RootLayout() {
  return (
    // `minHeight: 100dvh` not 100vh. `dvh` accounts for mobile browser chrome
    // that shows and hides on scroll; `100vh` is the reason so many mobile
    // layouts have a bar of dead space under the fold.
    <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      {/* First in the DOM, deliberately - see SkipLink. */}
      <SkipLink />
      <RouteAnnouncer />
      <AppBar position="static" component="header">
        <Toolbar>
          <Typography variant="h6" component="h1" sx={{ flexGrow: 1 }}>
            TaskFlow
          </Typography>
          {/*
            `<Link>`, never `<a href>`. An anchor triggers a FULL PAGE LOAD:
            the bundle re-downloads, every store resets, and the app boots from
            scratch. `<Link>` calls history.pushState and lets the router swap
            the matched element - the whole point of a single-page app.

            It still RENDERS a real `<a>` with a real href, which is what keeps
            middle-click, "open in new tab" and screen readers working.
            Attaching onClick to a `<div>` breaks all three, and that is the
            most common accessibility failure in React navigation.

            ANGULAR BRIDGE: this is `routerLink`.
          */}
          {/*
            NAV LINKS RENDERED FROM AN ARRAY, not copy-pasted three times.

            The array lives at module scope (below) rather than inline, so it
            is not rebuilt on every render. With three links that is
            immaterial; the habit matters because this list becomes
            permission-filtered in Phase 11, and filtering a fresh array on
            every render is how you end up debugging a re-render loop.

            `key` is the path - genuinely unique and stable, unlike the index.
          */}
          <MainNav />

          {/*
            THE CONTEXT CONSUMER. This button is four levels below the provider
            and receives no props - that is precisely the prop drilling Context
            exists to remove. Without it, `mode` and `toggleMode` would have to
            be threaded through AppProviders -> RouterProvider -> RootLayout ->
            Toolbar, none of which care about the theme.
          */}
          {/*
            MOUNTED ONCE, in the layout. The SSE hook lives inside it, so
            mounting this twice would open two streams and burn two of the
            browser six connections per origin.

            It renders only for a signed-in user - the stream hook bails out
            when unauthenticated, but rendering a bell on the login page would
            still be nonsense.
          */}
          <SignedIn>
            <NotificationBell />
          </SignedIn>
          <SessionControls />
          <ThemeModeToggle />
        </Toolbar>
      </AppBar>

      <Container
        component="main"
        id={MAIN_CONTENT_ID}
        /**
         * `tabIndex={-1}` IS WHAT MAKES BOTH FIXES WORK, and leaving it off is
         * the reason most attempts at this silently do nothing.
         *
         * `<main>` is not focusable. Without this, `main.focus()` is a no-op
         * and `href="#main-content"` moves the SCROLL position but not the
         * FOCUS - so the user's next Tab goes right back to the second nav
         * link. The page looks like it jumped and the keyboard says otherwise.
         *
         * `-1` and not `0`: it must be focusable PROGRAMMATICALLY but must not
         * become a tab stop of its own. `tabIndex={0}` would add a stop on
         * every page that does nothing when activated - the exact anti-pattern
         * TaskCard was fixed for.
         */
        tabIndex={-1}
        // A focus ring on a whole page region is visual noise; the announcement
        // and the moved caret are the feedback. Removing an outline is normally
        // wrong - here the element is a scroll container, not a control.
        sx={{ flexGrow: 1, py: 4, outline: 'none' }}
      >
        <Outlet />
      </Container>

      {/*
        MOUNTED ONCE, at the layout level. Any component anywhere - and any
        middleware, which cannot use hooks at all - raises a toast by
        dispatching an action. No props, no callbacks, no shared ancestor.
      */}
      <Toaster />
    </Box>
  );
}
