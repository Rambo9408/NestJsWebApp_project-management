import { render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { HttpResponse, http } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { server } from '@/test/msw/server';
import { routes } from './router';
import { ThemeModeProvider } from '@/app/providers/ThemeModeProvider';
import authReducer from '@/features/auth/authSlice';
import uiReducer from '@/features/ui/uiSlice';
import { apiSlice } from '@/services/apiSlice';
import { tokenStore } from '@/features/auth/tokenStore';
import { paths } from '@/routes/paths';
import { ProjectStatus, Role, TaskPriority, TaskStatus, type User } from '@/types/api';

/**
 * =============================================================================
 * ROUTE SMOKE TEST — "do all the pages actually work?"
 * =============================================================================
 * WHY THIS EXISTS. The question was asked directly, and the evidence available
 * at the time did not answer it. Every route returned 200 through nginx — but
 * that only proves the SPA fallback served `index.html`. `/total-nonsense`
 * returns 200 too. **No page had ever been rendered.**
 *
 * A route table that resolves (router.test.tsx) and a page that renders without
 * throwing are different claims. This file makes the second one.
 *
 * -----------------------------------------------------------------------------
 * WHAT THIS PROVES, precisely — the limits matter as much as the coverage
 * -----------------------------------------------------------------------------
 *   IT DOES PROVE   every route mounts, its data layer resolves, and the page
 *                   reaches meaningful content rather than an error state —
 *                   with no React error, no crash, and no console error.
 *
 *   IT DOES NOT     that the page is USABLE. No layout (jsdom has none), no
 *                   real backend, no interaction beyond first paint, and
 *                   nothing about visual correctness.
 *
 * So this is a floor: it catches the class of bug where a page throws on mount,
 * queries an endpoint that does not exist, or renders its error state forever —
 * all of which are invisible to a 200 from nginx.
 *
 * -----------------------------------------------------------------------------
 * `onUnhandledRequest: 'error'` IS THE SHARPEST PART OF THIS FILE
 * -----------------------------------------------------------------------------
 * With `'bypass'`, a page calling an endpoint nobody mocked would silently get
 * a network failure, render its error state, and — if the assertion were merely
 * "did not crash" — PASS. The test would report health while the page was
 * broken.
 *
 * With `'error'`, an unmocked call fails the test loudly and names the URL. It
 * turns "which endpoints does the app actually depend on?" from a question
 * requiring a code audit into something the suite answers.
 * =============================================================================
 */

const BASE = 'http://localhost:3000/api/v1';

const ADMIN: User = {
  id: 'user-admin',
  email: 'admin@example.com',
  name: 'Admin',
  role: Role.ADMIN,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const PROJECT_ID = 'project-1';
const TASK_ID = 'task-1';

const paginated = <T,>(items: T[]) => ({
  items,
  total: items.length,
  page: 1,
  limit: 20,
  totalPages: 1,
});

/**
 * A COMPLETE handler set, deliberately.
 *
 * The shared handlers in test/msw cover eight endpoints; the application needs
 * more. Rather than extend the shared set — which other tests depend on, and
 * where a change could quietly alter their meaning — this file owns its own.
 */
function allHandlers() {
  const task = {
    id: TASK_ID,
    reference: 'AP-1',
    title: 'Wire the API slice',
    description: 'A description.',
    projectId: PROJECT_ID,
    createdById: ADMIN.id,
    assigneeId: ADMIN.id,
    assignee: { id: ADMIN.id, name: ADMIN.name },
    status: TaskStatus.IN_PROGRESS,
    priority: TaskPriority.HIGH,
    dueDate: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };

  const project = {
    id: PROJECT_ID,
    key: 'APP',
    name: 'Apollo',
    description: 'A project.',
    ownerId: ADMIN.id,
    status: ProjectStatus.ACTIVE,
    members: [{ userId: ADMIN.id, role: Role.MANAGER }],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };

  return [
    http.get(`${BASE}/tasks`, () => HttpResponse.json(paginated([task]))),
    http.get(`${BASE}/tasks/:id`, () => HttpResponse.json(task)),
    http.get(`${BASE}/tasks/:id/comments`, () => HttpResponse.json(paginated([]))),
    http.get(`${BASE}/projects`, () => HttpResponse.json(paginated([project]))),
    http.get(`${BASE}/projects/:id`, () => HttpResponse.json(project)),
    http.get(`${BASE}/users`, () => HttpResponse.json(paginated([ADMIN]))),
    http.get(`${BASE}/activity-logs`, () =>
      HttpResponse.json(
        paginated([
          {
            id: 'log-1',
            event: 'user.registered',
            actorId: ADMIN.id,
            subjectId: ADMIN.id,
            payload: { email: 'a@b.test' },
            createdAt: '2026-08-01T00:00:00.000Z',
          },
        ]),
      ),
    ),
    http.get(`${BASE}/notifications`, () => HttpResponse.json(paginated([]))),
    http.get(`${BASE}/notifications/unread-count`, () => HttpResponse.json({ unread: 0 })),
    /**
     * NOT under `BASE`. The liveness probe is version-neutral and lives at
     * `/health/live`, outside the `/api/v1` prefix - so that infrastructure
     * has one stable path that survives every future version change.
     *
     * Found by this test: with `onUnhandledRequest: 'error'`, the connectivity
     * page failed and named the exact URL. That is the whole argument for
     * 'error' over 'bypass' - the page would otherwise have rendered its
     * offline state and passed a "did it render" assertion.
     */
    http.get("http://localhost:3000/health/live", () => HttpResponse.json({ status: "ok" })),
  ];
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });

  /**
   * `EventSource` DOES NOT EXIST IN JSDOM, and the notification bell mounts in
   * the layout on every authenticated page — so without this every single route
   * throws before rendering anything.
   *
   * A no-op stub rather than a mock with behaviour: this file is about whether
   * pages render, and the SSE hook has its own dedicated test. Stubbing to the
   * minimum keeps the failure surface of this test to the thing it measures.
   */
  vi.stubGlobal(
    'EventSource',
    class {
      close() {}
      addEventListener() {}
      removeEventListener() {}
    },
  );
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  tokenStore.set('test-access-token');
  server.use(...allHandlers());
});

function renderRoute(path: string) {
  const store = configureStore({
    reducer: { auth: authReducer, ui: uiReducer, [apiSlice.reducerPath]: apiSlice.reducer },
    middleware: (getDefault) => getDefault().concat(apiSlice.middleware),
    /**
     * Signed in AS AN ADMIN, so the admin-guarded routes are reachable.
     *
     * A member would be redirected by `RequireRole`, and the test would then
     * assert that the dashboard rendered while believing it had checked
     * /admin/users — passing for the wrong page. Worth stating because that is
     * the easy version of this test to write by accident.
     */
    preloadedState: { auth: { status: 'authenticated' as const, user: ADMIN } },
  });

  /**
   * THE REAL ROUTE TABLE, imported from router.tsx — not a copy.
   *
   * A test that redeclares its routes tests the copy. This mounts the exact
   * array the application ships, which is what makes it able to catch a broken
   * guard, a missing lazy import, or a bad nesting.
   */
  const router = createMemoryRouter(routes, { initialEntries: [path] });

  return render(
    <Provider store={store}>
      <ThemeModeProvider>
        <RouterProvider router={router} />
      </ThemeModeProvider>
    </Provider>,
  );
}

/**
 * Every route, with the HEADING that proves the page rendered and — where the
 * page is data-driven — a piece of CONTENT that proves its data layer resolved.
 *
 * BOTH ARE NEEDED, and splitting them was forced by a failure rather than
 * planned. Asserting only the heading passes for a list page whose request
 * failed and which is showing an error state under a correct title. Asserting
 * only content cannot tell the page apart from the app shell.
 *
 * The first version asserted neither properly — it used `getByText` on any text
 * anywhere, and six routes failed with "found multiple elements" because a
 * page's NAV LINK contains the same word as its heading. That ambiguity was the
 * test reporting that it had asked a sloppy question.
 *
 * `level` defaults to 2: the shell owns the single h1, each page owns an h2. The
 * settings sub-pages are h3, correctly — they nest under the settings layout's
 * own h2, and that hierarchy is what a screen reader uses to navigate.
 */
const ROUTES: {
  path: string;
  heading: RegExp;
  level?: number;
  content?: RegExp;
  name: string;
}[] = [
  { name: 'dashboard', path: paths.dashboard, heading: /dashboard/i },
  { name: 'tasks', path: paths.tasks, heading: /^tasks$/i, content: /wire the api slice/i },
  {
    name: 'task detail',
    path: paths.taskDetail.replace(':taskId', TASK_ID),
    heading: /wire the api slice/i,
    content: /comments/i,
  },
  { name: 'projects', path: paths.projects, heading: /^projects$/i, content: /apollo/i },
  {
    name: 'project detail',
    path: paths.projectDetail.replace(':projectId', PROJECT_ID),
    heading: /apollo/i,
  },
  { name: 'settings profile', path: paths.settingsProfile, heading: /profile/i, level: 3 },
  {
    name: 'settings security',
    path: paths.settingsSecurity,
    heading: /security|password/i,
    level: 3,
  },
  { name: 'admin users', path: paths.adminUsers, heading: /users/i },
  { name: 'admin activity', path: paths.adminActivity, heading: /activity log/i },
  { name: 'lab components', path: paths.labComponents, heading: /component/i },
  { name: 'lab state', path: paths.labState, heading: /state/i },
  { name: 'lab hooks', path: paths.labHooks, heading: /hook/i },
  { name: 'lab rendering', path: paths.labRendering, heading: /render/i },
  { name: 'lab performance', path: paths.labPerformance, heading: /performance/i },
  { name: 'lab connectivity', path: paths.labConnectivity, heading: /connectivity|api/i },
];

describe('every route renders', () => {
  it.each(ROUTES)('$name ($path)', async ({ path, heading, level, content }) => {
    /**
     * CONSOLE ERRORS FAIL THE TEST.
     *
     * React reports a great deal through `console.error` and nothing else:
     * invalid DOM nesting, a key warning, a state update on an unmounted
     * component, a failed prop type, and — importantly — an error caught by an
     * error boundary, which renders a fallback and otherwise looks like success.
     *
     * Without this the suite would pass on a page whose content had been
     * replaced by an error boundary's fallback UI.
     */
    const errors: unknown[][] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args);
    });

    try {
      renderRoute(path);

      /**
       * `getByRole('heading', { level: 2 })`, NOT `getByText`.
       *
       * The first version matched plain text and failed on six routes with
       * "found multiple elements" - because the NAV LINK for a page contains
       * the same word as its heading. '/dashboard' matched both the link in
       * the header and the page title.
       *
       * That ambiguity is not noise, it is the test telling you it was asking a
       * sloppy question. "Is this word anywhere on the page?" is true while the
       * shell renders and the content does not. Every page here follows the
       * convention that the shell owns the single h1 and the page owns an h2,
       * so the h2 IS the page - and asserting on it cannot be satisfied by
       * chrome.
       */
      await waitFor(
        () => {
          expect(screen.getByRole('heading', { level: level ?? 2, name: heading })).toBeTruthy();
        },
        { timeout: 4000 },
      );

      /**
       * The second half, for data-driven pages: real data must appear, not an
       * error state sitting under a correct heading.
       *
       * This is what makes the test able to fail when an endpoint is renamed or
       * a response shape changes — the heading renders regardless.
       */
      if (content) {
        await waitFor(
          () => {
            expect(screen.getByText(content)).toBeTruthy();
          },
          { timeout: 4000 },
        );
      }

      // The 404 page must not be what matched.
      expect(screen.queryByText(/page not found|404/i)).toBeNull();

      expect(
        errors,
        `console.error during render:\n${errors.map((e) => String(e[0])).join('\n')}`,
      ).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
});
