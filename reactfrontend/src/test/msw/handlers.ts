import { HttpResponse, http } from 'msw';
import { NotificationType, ProjectStatus, Role } from '@/types/api';

/**
 * =============================================================================
 * MSW HANDLERS - a stand-in for the NestJS API
 * =============================================================================
 * WHY MSW AND NOT `vi.mock` OR A STUBBED `fetch`:
 *
 * The tests written so far stub `fetch` (ConnectivityPage) or inject a fake
 * function (`onLogin` in LoginForm). Both are correct for UNIT tests - they
 * isolate the component - and both share one blind spot:
 *
 *     THEY NEVER EXERCISE THE TRANSPORT.
 *
 * `httpClient` builds a URL, attaches an `Authorization` header, reads the CSRF
 * cookie, sets `credentials: 'include'`, retries on 401 and normalises errors.
 * A stubbed `fetch` skips all of it, so every one of those could be broken and
 * the suite would stay green.
 *
 * MSW intercepts at the NETWORK layer instead. The code under test makes a real
 * `fetch` call; MSW answers it. So the URL, the headers, the retry and the error
 * parsing are all genuinely executed - which is precisely the half that was
 * untested.
 *
 * ANGULAR BRIDGE: this replaces `HttpClientTestingModule` + `HttpTestingController`.
 * The philosophy differs in a way that matters: Angular's swaps the HttpClient
 * IMPLEMENTATION, so your interceptors may or may not run depending on how you
 * wired the test. MSW leaves the entire stack intact and answers the socket, so
 * there is no "does my interceptor run in tests?" question at all.
 *
 * -----------------------------------------------------------------------------
 * THE HANDLERS BELOW MIRROR REAL RESPONSES, INCLUDING THE AWKWARD BITS
 * -----------------------------------------------------------------------------
 * Every shape here was verified against the running backend in earlier phases:
 *   - login returns `{ user, accessToken, expiresIn }` and NO refreshToken
 *   - errors are `{ success: false, statusCode, message, error, path, ... }`
 *   - `message` is `string | string[]`
 *   - the SSE notification frame omits `readAt`
 *
 * A mock that returns a shape the server never sends is worse than no mock: it
 * makes a suite that passes against fiction.
 * =============================================================================
 */

const BASE = '/api/v1';

export const user = {
  id: 'user-1',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  role: Role.MEMBER,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

/**
 * A COUNTER THE TESTS CAN READ.
 *
 * The single-flight refresh test asserts that six concurrent 401s cause exactly
 * ONE call to /auth/refresh. Counting here - inside the handler, on the far side
 * of the real network call - is the only place that number is trustworthy.
 */
export const callCounts = {
  refresh: 0,
  tasks: 0,
  reset() {
    this.refresh = 0;
    this.tasks = 0;
  },
};

/** Flipped by tests to make the next protected request 401 once. */
export const authState = {
  accessTokenValid: true,
  refreshSucceeds: true,
  reset() {
    this.accessTokenValid = true;
    this.refreshSucceeds = true;
  },
};

/** The backend's error envelope, exactly - see all-exceptions.filter.ts. */
function apiError(status: number, message: string | string[], path: string) {
  return HttpResponse.json(
    {
      success: false,
      statusCode: status,
      message,
      error: status === 401 ? 'Unauthorized' : 'Bad Request',
      path,
      timestamp: new Date().toISOString(),
      requestId: 'req-test-1',
    },
    { status },
  );
}

export const handlers = [
  /* --- auth ------------------------------------------------------------- */

  http.post(`${BASE}/auth/login`, async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string };

    // Mirrors the backend: one indistinguishable error for both failure modes,
    // so the response cannot be used to enumerate accounts.
    if (body.password !== 'Str0ngPassword') {
      return apiError(401, 'Invalid email or password', `${BASE}/auth/login`);
    }

    // NO refreshToken in the body - it is an httpOnly cookie. Verified live in
    // Phase 1, and the reason `AuthResponse` has only three fields.
    return HttpResponse.json({ user, accessToken: 'access-token-1', expiresIn: 900 });
  }),

  http.post(`${BASE}/auth/register`, async ({ request }) => {
    const body = (await request.json()) as { email: string; name: string; password: string };

    // The real ValidationPipe returns ONE MESSAGE PER FAILED FIELD, as an
    // array. That array is what `applyServerErrors` maps onto form fields, so a
    // mock that flattens it would make the mapping untestable.
    const messages: string[] = [];
    if (!body.email.includes('@')) messages.push('email must be a valid email address');
    if (body.name.length < 2) {
      messages.push('name must be longer than or equal to 2 characters');
    }
    if (messages.length > 0) return apiError(400, messages, `${BASE}/auth/register`);

    return HttpResponse.json(
      { user: { ...user, email: body.email, name: body.name }, accessToken: 'access-token-1', expiresIn: 900 },
      { status: 201 },
    );
  }),

  http.post(`${BASE}/auth/refresh`, () => {
    callCounts.refresh += 1;

    if (!authState.refreshSucceeds) {
      return apiError(401, 'Unauthorized', `${BASE}/auth/refresh`);
    }

    /**
     * NOTE WHAT IS DELIBERATELY *NOT* HERE: `authState.accessTokenValid = true`.
     *
     * The first draft reset the flag on refresh, which meant the OLD token
     * started working again - so the "retries with the NEW token" test passed
     * even when the client replayed the stale one. The test was VACUOUS, and I
     * only found out by deliberately breaking the client and watching the suite
     * stay green.
     *
     * Once invalidated, `access-token-1` stays invalid forever. The only way
     * past the /tasks handler is to present `access-token-2`, which is exactly
     * the behaviour under test.
     *
     * THE LESSON, and it applies to every mock: a mock that is too permissive
     * makes a test that cannot fail. Writing the assertion is only half the
     * job - the other half is proving it fails when the code is wrong.
     */
    return HttpResponse.json({ user, accessToken: 'access-token-2', expiresIn: 900 });
  }),

  // 204 No Content - `httpClient` must return early rather than calling
  // `.json()` on an empty body, which would throw a SyntaxError.
  http.post(`${BASE}/auth/logout`, () => new HttpResponse(null, { status: 204 })),

  /* --- tasks ------------------------------------------------------------ */

  http.get(`${BASE}/tasks`, ({ request }) => {
    callCounts.tasks += 1;

    /**
     * THE HANDLER CHECKS THE `Authorization` HEADER.
     *
     * That is what makes the refresh tests meaningful: if `httpClient` failed to
     * attach the header, or failed to attach the NEW one after a refresh, this
     * returns 401 and the test fails. A handler that ignores auth would pass
     * either way.
     */
    const auth = request.headers.get('authorization');
    if (!auth?.startsWith('Bearer ')) {
      return apiError(401, 'Unauthorized', `${BASE}/tasks`);
    }
    if (!authState.accessTokenValid && auth === 'Bearer access-token-1') {
      return apiError(401, 'Unauthorized', `${BASE}/tasks`);
    }

    const url = new URL(request.url);
    const status = url.searchParams.get('status');

    const items = [
      {
        id: 'task-1',
        reference: 'AP-1',
        title: 'Wire the API slice',
        description: 'Replace the hand-rolled fetch.',
        projectId: 'project-1',
        createdById: user.id,
        assigneeId: user.id,
        status: 'todo',
        priority: 'high',
        dueDate: null,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
        assignee: { id: user.id, name: user.name, email: user.email },
      },
    ].filter((task) => !status || task.status === status);

    return HttpResponse.json({
      items,
      total: items.length,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
  }),

  /* --- projects / notifications (thin, for completeness) ---------------- */

  http.get(`${BASE}/projects`, () =>
    HttpResponse.json({
      items: [
        {
          id: 'project-1',
          key: 'AP',
          name: 'A Project',
          description: 'Test fixture',
          ownerId: user.id,
          members: [{ userId: user.id, role: Role.MANAGER, joinedAt: '2026-08-01T00:00:00.000Z' }],
          status: ProjectStatus.ACTIVE,
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    }),
  ),

  http.get(`${BASE}/notifications/unread-count`, () => HttpResponse.json({ unread: 2 })),

  http.get(`${BASE}/notifications`, () =>
    HttpResponse.json({
      items: [
        {
          id: 'notif-1',
          userId: user.id,
          type: NotificationType.TASK_ASSIGNED,
          title: 'AP-1 assigned to you',
          body: 'Have a look.',
          meta: {},
          readAt: null,
          createdAt: '2026-08-01T00:00:00.000Z',
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    }),
  ),
];
