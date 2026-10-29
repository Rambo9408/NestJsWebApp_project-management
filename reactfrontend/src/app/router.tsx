import { Suspense, lazy, type ReactNode } from 'react';
import { Navigate, createBrowserRouter, type RouteObject } from 'react-router-dom';
import { RootLayout } from '@/layouts/RootLayout';
import { AuthLayout } from '@/layouts/AuthLayout';
import { LoginPage } from '@/pages/LoginPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { RouteErrorPage } from '@/pages/RouteErrorPage';
import { LoadingState } from '@/components/feedback/LoadingState';
import { RequireAuth } from '@/routes/RequireAuth';
import { RequireRole } from '@/routes/RequireRole';
import { Role } from '@/types/api';
import { paths } from '@/routes/paths';

/**
 * =============================================================================
 * THE ROUTER
 * =============================================================================
 * `createBrowserRouter` - the DATA router API, not the older
 * `<BrowserRouter><Routes>` JSX form.
 *
 * WHY THIS ONE: the object form is what unlocks `errorElement`, and later
 * loaders/actions and deferred data. The JSX form still works and appears in
 * most material written before 2023; it simply cannot express route-level error
 * handling. Knowing which API you are using, and why, is a real interview
 * signal - "React Router" has meant four quite different things.
 *
 * A NOTE ON LOADERS, since it is the obvious question: React Router can fetch
 * per route, before rendering. We deliberately do NOT use loaders, because RTK
 * Query owns server state from Phase 20, and two caching layers that both think
 * they own the same data is an architecture mistake rather than a style one.
 * Pick one. We pick RTK Query, because it also handles mutations, invalidation
 * and deduplication, which loaders do not.
 *
 * ANGULAR BRIDGE: this array is the `Routes` array in an Angular routing module,
 * and `children` is `children`. Two differences worth naming:
 *   - `element` takes a rendered ELEMENT (<Page />), not a component class, so
 *     props can be passed at the route definition.
 *   - There is no `canActivate`. A guard in React is just a component that
 *     wraps the element and decides what to render (Phase 11) - which means a
 *     guard can use hooks like any other component.
 * =============================================================================
 */

/**
 * =============================================================================
 * CODE SPLITTING - `lazy()` + a dynamic import
 * =============================================================================
 * `import()` returns a promise, and Vite/Rollup turn each one into a SEPARATE
 * CHUNK, downloaded the first time the route is visited rather than on initial
 * page load.
 *
 * WHY THE LAB PAGES SPECIFICALLY: they are the largest, least-visited pages in
 * the app. Someone signing in to check their tasks should not pay to download
 * five pages of teaching demos they may never open. That is exactly the
 * calculus for a split point - SIZE times PROBABILITY OF NOT NEEDING IT.
 *
 * WHERE TO SPLIT, in order of value:
 *   1. Routes - the natural boundary; a user is on one at a time.
 *   2. Heavy dependencies behind an interaction (charts, rich text, PDF).
 *   3. Rarely-opened dialogs.
 *
 * WHERE NOT TO: tiny components. Each chunk is a separate network request, so
 * splitting a 2kB component turns one round-trip into two for no gain.
 *
 * THE TRADE-OFF, honestly: a lazy route has a DELAY on first visit - invisible
 * on fast connections, a visible flash of the fallback on 3G. The mitigation is
 * prefetching on hover/focus (call `import()` again on mouseenter, so the chunk
 * is warm before the click lands). Phase 35 measures it properly.
 * =============================================================================
 */
const StateLabPage = lazy(() =>
  /**
   * `.then(m => ({ default: m.X }))` is needed because `lazy` expects a module
   * with a DEFAULT export, and this project uses named exports throughout.
   *
   * Named exports are worth keeping: a symbol stays greppable, the editor can
   * auto-import it, and the same component cannot end up imported under three
   * different names in three files. Four characters of mapping is a fair price.
   */
  import('@/pages/StateLabPage').then((m) => ({ default: m.StateLabPage })),
);
const ComponentsLabPage = lazy(() =>
  import('@/pages/ComponentsLabPage').then((m) => ({ default: m.ComponentsLabPage })),
);
const HooksLabPage = lazy(() =>
  import('@/pages/HooksLabPage').then((m) => ({ default: m.HooksLabPage })),
);
const RenderingLabPage = lazy(() =>
  import('@/pages/RenderingLabPage').then((m) => ({ default: m.RenderingLabPage })),
);
const DashboardPage = lazy(() =>
  import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
const TasksPage = lazy(() =>
  import('@/pages/TasksPage').then((m) => ({ default: m.TasksPage })),
);
const ProjectsPage = lazy(() =>
  import('@/pages/ProjectsPage').then((m) => ({ default: m.ProjectsPage })),
);
const ProjectDetailPage = lazy(() =>
  import('@/pages/ProjectDetailPage').then((m) => ({ default: m.ProjectDetailPage })),
);
const TaskDetailPage = lazy(() =>
  import('@/pages/TaskDetailPage').then((m) => ({ default: m.TaskDetailPage })),
);
const ActivityLogPage = lazy(() =>
  import('@/pages/admin/ActivityLogPage').then((m) => ({ default: m.ActivityLogPage })),
);
const ProfilePage = lazy(() =>
  import('@/pages/settings/ProfilePage').then((m) => ({ default: m.ProfilePage })),
);
const SecurityPage = lazy(() =>
  import('@/pages/settings/SecurityPage').then((m) => ({ default: m.SecurityPage })),
);
const AdminUsersPage = lazy(() =>
  import('@/pages/admin/AdminUsersPage').then((m) => ({ default: m.AdminUsersPage })),
);
const SettingsLayout = lazy(() =>
  import('@/layouts/SettingsLayout').then((m) => ({ default: m.SettingsLayout })),
);
const PerformanceLabPage = lazy(() =>
  import('@/pages/PerformanceLabPage').then((m) => ({ default: m.PerformanceLabPage })),
);
const ConnectivityPage = lazy(() =>
  import('@/pages/ConnectivityPage').then((m) => ({ default: m.ConnectivityPage })),
);

/**
 * SUSPENSE IS MANDATORY AROUND A LAZY COMPONENT. Without a boundary above it,
 * React throws "A component suspended while responding to synchronous input."
 *
 * THE FALLBACK IS NOT A DETAIL. Rendering `null` makes a slow connection look
 * like a broken link - the user clicks and nothing happens. A skeleton roughly
 * matching the page shape also avoids the layout shift when real content lands.
 *
 * ONE BOUNDARY PER ROUTE, not one around the whole router: a boundary replaces
 * everything inside it, so a single top-level one would blank the entire app
 * chrome - nav included - on every lazy navigation.
 */
function lazyRoute(element: ReactNode) {
  return <Suspense fallback={<LoadingState variant="skeleton" rows={3} />}>{element}</Suspense>;
}

/**
 * THE ROUTE TREE, EXPORTED SEPARATELY FROM THE ROUTER.
 *
 * It used to be an array literal passed straight into createBrowserRouter, and
 * that made it untestable: `createBrowserRouter` builds a router bound to the
 * browser history, so a test could not inspect the route table without
 * rendering the whole application.
 *
 * Splitting the DATA from the thing that consumes it is a small change with a
 * disproportionate payoff - router.test.tsx can now assert that every declared
 * path resolves to a real route, which is the check that would have caught
 * `paths.taskDetail` matching nothing for several phases.
 *
 * The general habit: when something is hard to test, look for a configuration
 * object trapped inside a constructor call.
 */
export const routes: RouteObject[] = [
  /**
   * BRANCH 1 - unauthenticated. No app chrome (see AuthLayout).
   *
   * A SEPARATE TOP-LEVEL BRANCH rather than children of the app layout, because
   * in Phase 11 the app branch gets an auth guard and this one must not have
   * it. Expressing that as tree STRUCTURE means the guard cannot accidentally
   * be applied to the login page - which would be an infinite redirect loop,
   * and a genuinely confusing one to debug.
   *
   * NOTE this route object has no `path`. A PATHLESS LAYOUT ROUTE contributes
   * a component but no URL segment, so its children keep top-level paths -
   * `/login`, not `/auth/login`. That is the tool for "share a layout without
   * sharing a URL prefix".
   */
  {
    element: <AuthLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { path: paths.login, element: <LoginPage /> },
      { path: paths.register, element: <RegisterPage /> },
    ],
  },

  /**
   * BRANCH 2 - the application. Full chrome, and in Phase 11 an auth guard on
   * this node that every descendant inherits by construction.
   */
  {
    path: paths.root,
    element: <RootLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      /**
       * `index: true` renders when the parent path matches EXACTLY.
       *
       * `<Navigate replace>` rather than rendering the dashboard here, so there
       * is ONE canonical URL for it instead of two that render the same thing.
       * `replace` matters: without it, Back from /dashboard lands on '/', which
       * immediately redirects forward again - trapping the user.
       */
      { index: true, element: <Navigate to={paths.dashboard} replace /> },

      /**
       * =====================================================================
       * THE PROTECTED BRANCH
       * =====================================================================
       * A PATHLESS layout route whose element is the guard. Every child is
       * protected BY CONSTRUCTION - adding a page means adding it here, and it
       * is guarded because of where it sits, not because someone remembered.
       *
       * That is the whole argument for guarding a branch rather than a page: a
       * guard you have to remember is a guard that will eventually be
       * forgotten, and forgetting this one exposes a page rather than
       * misaligning a margin.
       *
       * ANGULAR BRIDGE: `canActivateChild` on a parent route. Same idea, same
       * reasoning.
       * =====================================================================
       */
      {
        element: <RequireAuth />,
        children: [
          { path: paths.dashboard, element: lazyRoute(<DashboardPage />) },
          { path: paths.tasks, element: lazyRoute(<TasksPage />) },
          /**
           * `/tasks/:taskId` - THE ROUTE THAT WAS MISSING.
           *
           * `paths.taskDetail` had been declared since Phase 5 and matched no
           * route, so every link to a task detail hit the `path: '*'` fallback
           * and rendered a plausible-looking 404.
           *
           * Nothing in the toolchain could see it: the constant typechecks, the
           * object is used so no lint rule fires, and the catch-all route turns
           * the failure into a legitimate page rather than an error. It is the
           * same shape as the never-applied `@Throttle` decorator found in
           * Phase 18-19 - a declaration that reads as an implementation.
           *
           * The durable fix is router.test.tsx, which asserts that every entry
           * in `paths` resolves to something other than the 404. A dead
           * constant is now a failing test.
           *
           * NOTE THE ORDER: this sits after `paths.tasks`, and both are static
           * prefixes with one dynamic segment, so React Router's ranking - which
           * scores static segments above dynamic ones - resolves `/tasks`
           * correctly regardless. Relying on declaration order for route
           * matching is a v5 habit that no longer applies.
           */
          { path: paths.taskDetail, element: lazyRoute(<TaskDetailPage />) },
          { path: paths.projects, element: lazyRoute(<ProjectsPage />) },
          { path: paths.projectDetail, element: lazyRoute(<ProjectDetailPage />) },
          {
            path: paths.settings,
            element: lazyRoute(<SettingsLayout />),
            children: [
              { index: true, element: <Navigate to={paths.settingsProfile} replace /> },
              { path: paths.settingsProfile, element: lazyRoute(<ProfilePage />) },
              { path: paths.settingsSecurity, element: lazyRoute(<SecurityPage />) },
            ],
          },

          /**
           * THE ADMIN AREA - a SECOND guard nested inside the first.
           *
           * RequireAuth has already established that somebody is signed in.
           * RequireRole then asks whether they are a GLOBAL admin. Two
           * questions, two guards, and deliberately two different failure
           * responses: redirect for missing identity, explain for insufficient
           * permission - the same distinction HTTP makes with 401 vs 403.
           *
           * Nesting means the admin branch cannot be reached without passing
           * both, structurally rather than by anyone remembering to add a
           * check.
           *
           * NEITHER GUARD IS SECURITY. `UsersController` carries
           * `@Roles(Role.ADMIN)` at class level, so the API refuses a member
           * regardless of what the client renders - verified in the audit.
           */
          {
            /**
             * `path: paths.admin` ON THE GUARD ROUTE — and this was the SECOND
             * dead constant, found by router.test.tsx on its first run.
             *
             * The guard used to be a PATHLESS route wrapping two absolute
             * children. That works for `/admin/users`, and it means bare
             * `/admin` matches nothing and falls through to the 404 — so a user
             * who types the obvious parent URL, or deletes a path segment from
             * the address bar, gets "not found" for a section that exists.
             *
             * `paths.admin` was declared and referenced nowhere. Same shape as
             * `paths.taskDetail`, in the same file, found in the same minute by
             * the same test. Which is the argument for the test: one dead
             * constant is a slip, two is a category.
             *
             * Giving the guard a path also expresses the hierarchy honestly —
             * everything under /admin requires the admin role — instead of
             * leaving it implicit in which children happen to be nested here.
             */
            path: paths.admin,
            element: <RequireRole role={Role.ADMIN} />,
            children: [
              /**
               * `index: true` — the route that renders when the parent path
               * matches exactly. Redirecting rather than rendering a landing
               * page, for the same reason `/settings` does: a section with one
               * obvious first page should not make the user choose.
               *
               * `replace` so the redirect does not enter history. Without it,
               * Back from /admin/users returns to /admin, which immediately
               * redirects forward again — the user is trapped.
               */
              { index: true, element: <Navigate to={paths.adminUsers} replace /> },
              { path: paths.adminUsers, element: lazyRoute(<AdminUsersPage />) },
              /**
               * The audit view sits behind the SAME admin guard as user
               * management, and for a stronger reason.
               *
               * An activity log aggregates who did what across every project.
               * Each individual event might be visible to a member anyway; the
               * COLLECTION reveals who works on what, when people are active,
               * and which accounts changed. An aggregate can leak more than the
               * sum of its records - which is why "they could have gathered
               * this themselves" is a weak argument in a security review.
               *
               * The backend enforces it with a class-level `@Roles(Role.ADMIN)`
               * on ActivityLogsController. This guard only decides what
               * renders.
               */
              { path: paths.adminActivity, element: lazyRoute(<ActivityLogPage />) },
            ],
          },
        ],
      },

      /**
       * LEARNING MATERIAL - deliberately OUTSIDE the guard.
       *
       * These pages contain no user data; they are teaching demos with local
       * fixtures. Requiring a login to read them would be security theatre -
       * it protects nothing and makes the material harder to reach.
       *
       * The judgement worth taking from this: guard what exposes DATA, not
       * what merely exists. Over-guarding is not "safer by default"; it trains
       * people to see the guard as friction rather than as a boundary that
       * means something.
       *
       * Lazily loaded, so they cost nothing until visited.
       */
      { path: paths.labConnectivity, element: lazyRoute(<ConnectivityPage />) },
      { path: paths.labComponents, element: lazyRoute(<ComponentsLabPage />) },
      { path: paths.labState, element: lazyRoute(<StateLabPage />) },
      { path: paths.labHooks, element: lazyRoute(<HooksLabPage />) },
      { path: paths.labRendering, element: lazyRoute(<RenderingLabPage />) },
      { path: paths.labPerformance, element: lazyRoute(<PerformanceLabPage />) },

      /**
       * THE CATCH-ALL. '*' matches anything no other route claimed.
       *
       * It renders INSIDE RootLayout deliberately, so a mistyped URL keeps the
       * nav and the user can click their way out. A full-page 404 that replaces
       * the chrome is a dead end.
       *
       * NOTE the SPA caveat: the dev server returns HTTP 200 for every path and
       * lets the router decide. In production nginx needs
       * `try_files $uri $uri/ /index.html;`, or a hard refresh on /tasks/abc
       * returns a real 404 from disk. Phase 46.
       */
      { path: '*', element: <RouteErrorPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
