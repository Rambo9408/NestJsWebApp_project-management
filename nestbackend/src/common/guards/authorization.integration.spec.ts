import { INestApplication, VersioningType } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Model } from 'mongoose';
import request from 'supertest';

import { sharedUri } from '../../../test/shared-mongo';

import { Role } from 'src/common/enums/role.enum';
import { User } from 'src/users/schemas/user.schema';

/**
 * =============================================================================
 * Authorization, end to end
 * =============================================================================
 * Two layers, tested separately because they fail for different reasons:
 *
 *   RolesGuard          global role  -> "is this user an ADMIN?"
 *   ProjectAccessGuard  resource     -> "is this user a manager OF THIS project?"
 *
 * The second is the one most implementations hand-wave, and the one worth
 * having tests for.
 * =============================================================================
 */
describe('Authorization (e2e)', () => {
  let app: INestApplication;
  let userModel: Model<User>;

  const base = '/api/v1';
  const http = () => app.getHttpServer() as Parameters<typeof request>[0];

  /** Registers a user and returns their access token + id. */
  const register = async (email: string, name: string) => {
    const response = await request(http())
      .post(`${base}/auth/register`)
      .send({ email, name, password: 'Password123' })
      .expect(201);

    return { token: response.body.accessToken as string, id: response.body.user.id as string };
  };

  let manager: { token: string; id: string };
  let member: { token: string; id: string };
  let outsider: { token: string; id: string };
  let admin: { token: string; id: string };
  let projectId: string;

  beforeAll(async () => {
    process.env.MONGODB_URI = sharedUri('taskflow_authz_test');

    const { AppModule } = await import('../../app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();

    /**
     * THE `exclude` LIST MUST MATCH main.ts.
     *
     * Without it the health routes sit at `/api/health/live` here and
     * `/health/live` in production - so this suite would be testing a URL shape
     * that does not exist anywhere real.
     *
     * That drift was found by writing the health tests below: they 404'd
     * against a bootstrap that was subtly not the application. A test harness
     * that configures the app DIFFERENTLY from `main.ts` gives false confidence
     * in exactly the areas it appears to cover - and the divergence is invisible
     * until a test happens to touch the part that differs.
     *
     * The durable fix is a shared `configureApp(app)` function called by both
     * `main.ts` and every test. Worth doing; noted rather than done here,
     * because it touches every integration spec and belongs in its own change.
     */
    app.setGlobalPrefix('api', {
      exclude: ['health/live', 'health/ready', 'health/detail'],
    });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();

    userModel = app.get<Model<User>>(getModelToken(User.name));

    manager = await register('manager@example.com', 'Manager');
    member = await register('member@example.com', 'Member');
    outsider = await register('outsider@example.com', 'Outsider');
    admin = await register('admin@example.com', 'Admin');

    /**
     * PROMOTE THE ADMIN DIRECTLY IN THE DATABASE.
     *
     * There is deliberately NO API path to make yourself an admin - registration
     * forces MEMBER, and `PUT /users/:id/role` is itself admin-only. That is a
     * chicken-and-egg by design: the first admin is created by a migration, a
     * seed script or an operator, never by an HTTP request.
     *
     * A test that could promote itself over HTTP would be proving the wrong
     * thing.
     */
    await userModel.updateOne({ _id: admin.id }, { $set: { role: Role.ADMIN } }).exec();

    // Re-login so the new role is in the token: a JWT is a SNAPSHOT, and the
    // one issued at registration still says `member`. That staleness is the
    // documented trade-off of putting the role in the token (Phase 7).
    const relogin = await request(http())
      .post(`${base}/auth/login`)
      .send({ email: 'admin@example.com', password: 'Password123' })
      .expect(200);
    admin.token = relogin.body.accessToken as string;

    const project = await request(http())
      .post(`${base}/projects`)
      .set('Authorization', `Bearer ${manager.token}`)
      .send({ key: 'AUTHZ', name: 'Authorization Demo' })
      .expect(201);

    projectId = project.body.id as string;

    await request(http())
      .post(`${base}/projects/${projectId}/members`)
      .set('Authorization', `Bearer ${manager.token}`)
      .send({ userId: member.id, role: Role.MEMBER })
      .expect(200);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
  }, 60_000);

  describe('RolesGuard (global role)', () => {
    it('403s a MEMBER on an admin-only route', async () => {
      /**
       * 403, not 401. The caller IS authenticated - they are simply not allowed.
       * The distinction is behavioural: a client seeing 401 should refresh its
       * token and retry; a client seeing 403 must not, because nothing about
       * the request will change the answer.
       */
      await request(http())
        .get(`${base}/users`)
        .set('Authorization', `Bearer ${member.token}`)
        .expect(403);
    });

    it('allows an ADMIN', async () => {
      await request(http())
        .get(`${base}/users`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);
    });

    it('401s with no token at all, before any role check', async () => {
      // Guard order: JwtAuthGuard runs first, so "who are you?" is answered
      // before "may you?". Reversing them would 403 anonymous callers, which
      // tells them nothing useful.
      await request(http()).get(`${base}/users`).expect(401);
    });

    it('lets a MEMBER edit their own profile through the self-service route', async () => {
      /**
       * `PATCH /auth/me` takes no id - it comes from the token. An endpoint
       * that cannot express the unsafe case does not need a check for it.
       */
      const response = await request(http())
        .patch(`${base}/auth/me`)
        .set('Authorization', `Bearer ${member.token}`)
        .send({ name: 'Renamed Member' })
        .expect(200);

      expect(response.body.name).toBe('Renamed Member');
    });
  });

  describe('ProjectAccessGuard (resource-level)', () => {
    it('lets a project member READ the project', async () => {
      await request(http())
        .get(`${base}/projects/${projectId}`)
        .set('Authorization', `Bearer ${member.token}`)
        .expect(200);
    });

    it('404s a NON-MEMBER rather than 403', async () => {
      /**
       * Deliberate leak profile: 403 would confirm the project exists, which
       * turns the endpoint into an enumeration oracle. 404 says "nothing here
       * for you" and reveals nothing.
       */
      await request(http())
        .get(`${base}/projects/${projectId}`)
        .set('Authorization', `Bearer ${outsider.token}`)
        .expect(404);
    });

    it('403s a project MEMBER attempting a MANAGER action', async () => {
      // Here 403 IS right: the caller is a member, so their access to the
      // project is not a secret - only this particular action is denied.
      await request(http())
        .patch(`${base}/projects/${projectId}`)
        .set('Authorization', `Bearer ${member.token}`)
        .send({ name: 'Renamed by a member' })
        .expect(403);
    });

    it('allows the project MANAGER', async () => {
      await request(http())
        .patch(`${base}/projects/${projectId}`)
        .set('Authorization', `Bearer ${manager.token}`)
        .send({ name: 'Renamed by the manager' })
        .expect(200);
    });

    it('lets a GLOBAL ADMIN bypass project membership', async () => {
      /**
       * A deliberate product decision, stated in the guard: admins need to
       * support customers without mutating their data to gain access.
       *
       * The cost is that an admin token is a skeleton key - which is why admin
       * actions must be audited (Phase 13) and admin accounts need MFA.
       */
      await request(http())
        .get(`${base}/projects/${projectId}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);
    });

    it('reuses the SAME guard for tasks, reading projectId from the BODY', async () => {
      // Membership of the project is what grants access to its tasks. One
      // guard, three route shapes (params, body, query).
      await request(http())
        .post(`${base}/tasks`)
        .set('Authorization', `Bearer ${outsider.token}`)
        .send({ title: 'Not allowed', projectId })
        .expect(404);

      await request(http())
        .post(`${base}/tasks`)
        .set('Authorization', `Bearer ${member.token}`)
        .send({ title: 'Allowed for a member', projectId })
        .expect(201);
    });
  });

  /**
   * ===========================================================================
   * COLLECTION-LEVEL AUTHORIZATION - regression tests for a real vulnerability
   * ===========================================================================
   * THE BUG THESE PIN: `GET /tasks` and `GET /projects` ran with NO membership
   * constraint, so any authenticated user could enumerate every task and
   * project in the database. Item routes were guarded; the collections that
   * list them were not.
   *
   * That is BROKEN OBJECT-LEVEL AUTHORIZATION (OWASP API1), and the reason it
   * survived is instructive: every other test in this file exercises a route
   * with an `:id` in it. A guard cannot protect a list, because a list has no
   * id to check - collection authorization is a FILTER, not a yes/no decision.
   *
   * WHY THESE TESTS AND NOT JUST THE FIX: the failure is SILENT. The endpoint
   * returns 200 either way; only the row count differs. Nothing errors, nothing
   * logs, and a developer testing manually while a member of the project sees
   * exactly what they expect.
   * ===========================================================================
   */
  describe('Collection scoping (list endpoints)', () => {
    it('does NOT leak tasks to a user who is in no projects', async () => {
      const response = await request(http())
        .get(`${base}/tasks`)
        .set('Authorization', `Bearer ${outsider.token}`)
        .expect(200);

      expect(response.body.total).toBe(0);
      expect(response.body.items).toHaveLength(0);
    });

    it('does NOT leak projects to a non-member', async () => {
      const response = await request(http())
        .get(`${base}/projects`)
        .set('Authorization', `Bearer ${outsider.token}`)
        .expect(200);

      expect(response.body.total).toBe(0);
    });

    it('IGNORES a client-supplied memberId - the scope comes from the token', async () => {
      /**
       * THE BYPASS ATTEMPT. Before the fix, `memberId` was read straight from
       * the query string, so a caller could ask for anyone's projects.
       *
       * The expectation is 200-with-nothing rather than 403: silently scoping
       * to self reveals nothing, whereas rejecting would confirm that the
       * parameter exists and is being checked.
       */
      const response = await request(http())
        .get(`${base}/projects?memberId=${manager.id}`)
        .set('Authorization', `Bearer ${outsider.token}`)
        .expect(200);

      expect(response.body.total).toBe(0);
    });

    it('still shows members their OWN projects and tasks', async () => {
      /**
       * THE OTHER HALF OF THE FIX, and the half that is easy to break: a scope
       * that returns nothing to anybody would pass every test above while
       * making the product useless.
       *
       * Worth writing deliberately - "deny everything" is the classic
       * over-correction after a leak, and only a positive test catches it.
       */
      const projects = await request(http())
        .get(`${base}/projects`)
        .set('Authorization', `Bearer ${member.token}`)
        .expect(200);
      expect(projects.body.total).toBeGreaterThan(0);

      const tasks = await request(http())
        .get(`${base}/tasks`)
        .set('Authorization', `Bearer ${member.token}`)
        .expect(200);
      expect(tasks.body.total).toBeGreaterThan(0);
    });

    it('lets a GLOBAL ADMIN see everything', async () => {
      const response = await request(http())
        .get(`${base}/tasks`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);

      /**
       * The admin belongs to NO projects, so a non-zero result is only possible
       * through the unscoped branch - which is precisely the `undefined` case
       * in the controller. A scope of `[]` here would return 0 and fail.
       */
      expect(response.body.total).toBeGreaterThan(0);
    });
  });

  /**
   * ===========================================================================
   * OBJECT-LEVEL AUTHORIZATION ON TASKS - the worst of the audit findings
   * ===========================================================================
   * THE VULNERABILITY THESE PIN: `/tasks/:id` and its sub-routes carried NO
   * guard at all. An authenticated user with no relationship to a project could
   * read, rename, reassign and DELETE any task, and delete its comments.
   *
   * That is strictly worse than the collection leak fixed above: this is WRITE
   * access, and it is destructive. The audit reproduced it end to end - one
   * user's task and comment were destroyed by an unrelated account in a single
   * script.
   *
   * WHY IT SURVIVED: `POST /tasks` was guarded, because it carries a projectId
   * in the BODY for the guard to check. `/tasks/:id` carries a TASK id, and a
   * task does not hold membership - its PROJECT does. Nobody wrote the guard
   * that follows that indirection, and no test asked for it.
   *
   * THE ASSERTIONS ARE 404, NOT 403 - deliberately. Confirming that a resource
   * exists to someone who may not have it lets an attacker map real ids.
   * ===========================================================================
   */
  describe('Object-level authorization (tasks)', () => {
    let taskId: string;
    let commentId: string;

    beforeAll(async () => {
      const task = await request(http())
        .post(`${base}/tasks`)
        .set('Authorization', `Bearer ${manager.token}`)
        .send({ title: 'Manager private task', projectId })
        .expect(201);
      taskId = task.body.id as string;

      const comment = await request(http())
        .post(`${base}/tasks/${taskId}/comments`)
        .set('Authorization', `Bearer ${manager.token}`)
        .send({ body: 'Manager private comment' })
        .expect(201);
      commentId = comment.body.id as string;
    });

    it.each([
      ['GET    /tasks/:id', 'get', ''],
      ['GET    /tasks/:id/comments', 'get', '/comments'],
    ])('404s an outsider on %s', async (_label, _method, suffix) => {
      await request(http())
        .get(`${base}/tasks/${taskId}${suffix}`)
        .set('Authorization', `Bearer ${outsider.token}`)
        .expect(404);
    });

    it('404s an outsider PATCHing a task', async () => {
      await request(http())
        .patch(`${base}/tasks/${taskId}`)
        .set('Authorization', `Bearer ${outsider.token}`)
        .send({ title: 'PWNED' })
        .expect(404);
    });

    it('404s an outsider changing a task status', async () => {
      await request(http())
        .patch(`${base}/tasks/${taskId}/status`)
        .set('Authorization', `Bearer ${outsider.token}`)
        .send({ from: 'todo', to: 'done' })
        .expect(404);
    });

    it('404s an outsider DELETING a task', async () => {
      await request(http())
        .delete(`${base}/tasks/${taskId}`)
        .set('Authorization', `Bearer ${outsider.token}`)
        .expect(404);
    });

    it('404s an outsider reading project task stats', async () => {
      // `?projectId=` is in the QUERY, so this one is covered by
      // ProjectAccessGuard rather than TaskAccessGuard. Left unguarded it
      // leaked that a project exists and how much work is in it.
      await request(http())
        .get(`${base}/tasks/stats?projectId=${projectId}`)
        .set('Authorization', `Bearer ${outsider.token}`)
        .expect(404);
    });

    it('404s a NON-AUTHOR deleting a comment', async () => {
      /**
       * The comment rule is author-or-admin, enforced in CommentsService
       * rather than a guard - see the note there about the module cycle.
       *
       * `member` is a legitimate project member and STILL cannot delete
       * someone else's comment, which is the point: project membership grants
       * access to the task, not ownership of everything on it.
       */
      await request(http())
        .delete(`${base}/comments/${commentId}`)
        .set('Authorization', `Bearer ${member.token}`)
        .expect(404);
    });

    it('THE TASK AND COMMENT SURVIVED every attack above', async () => {
      /**
       * THE ASSERTION THAT MAKES THIS SUITE MEAN SOMETHING.
       *
       * Every test above checks a status code. A status code proves the
       * response, not the side effect - a route could 404 the caller and still
       * have written to the database first.
       *
       * This reads the data back as its legitimate owner and checks it is
       * untouched: original title, original status, comment still present.
       */
      const task = await request(http())
        .get(`${base}/tasks/${taskId}`)
        .set('Authorization', `Bearer ${manager.token}`)
        .expect(200);

      expect(task.body.title).toBe('Manager private task');
      expect(task.body.status).toBe('todo');

      const comments = await request(http())
        .get(`${base}/tasks/${taskId}/comments`)
        .set('Authorization', `Bearer ${manager.token}`)
        .expect(200);

      expect(comments.body.total).toBe(1);
    });

    it('still lets a project MEMBER read and edit the task', async () => {
      /**
       * THE OVER-CORRECTION GUARD. A guard that denies everybody would pass
       * every negative test above while breaking the product.
       *
       * `member` is in the project but did not create this task - and should
       * still be able to work on it, because that is what a shared project is.
       */
      await request(http())
        .get(`${base}/tasks/${taskId}`)
        .set('Authorization', `Bearer ${member.token}`)
        .expect(200);

      await request(http())
        .patch(`${base}/tasks/${taskId}`)
        .set('Authorization', `Bearer ${member.token}`)
        .send({ title: 'Edited by a teammate' })
        .expect(200);
    });

    it('lets a GLOBAL ADMIN through', async () => {
      await request(http())
        .get(`${base}/tasks/${taskId}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);
    });
  });

  /**
   * ===========================================================================
   * COMMENT MODERATION - author, project MANAGER, or global ADMIN
   * ===========================================================================
   * The audit closed the comment hole with an author-or-admin rule, and flagged
   * that project managers could not moderate. That gap is closed here.
   *
   * THE ROUTE MOVED to `DELETE /tasks/:id/comments/:commentId`, nested under the
   * task like create and list already were. A bare comment id gave no route to
   * the project that owns the membership rule, which is exactly why the old
   * endpoint could only ever enforce the narrower rule.
   *
   * NOTE THE TWO DIFFERENT DENIALS BELOW, and that the difference is deliberate:
   *
   *   outsider      -> 404   TaskAccessGuard fires first. Revealing nothing,
   *                          because they should not learn the task exists.
   *   member        -> 403   Past the guard - they legitimately see the task -
   *                          but not the author and not a manager. An
   *                          informative error is right here, because they are
   *                          entitled to know why.
   *
   * That is the guard/service split doing real work: a GUARD answers "may you
   * touch this resource at all?", a SERVICE answers "may you do this particular
   * thing to it?".
   * ===========================================================================
   */
  describe('Comment moderation', () => {
    let taskId: string;

    const addComment = async (token: string, body: string): Promise<string> => {
      const response = await request(http())
        .post(`${base}/tasks/${taskId}/comments`)
        .set('Authorization', `Bearer ${token}`)
        .send({ body })
        .expect(201);
      return response.body.id as string;
    };

    beforeAll(async () => {
      const task = await request(http())
        .post(`${base}/tasks`)
        .set('Authorization', `Bearer ${manager.token}`)
        .send({ title: 'Comment moderation target', projectId })
        .expect(201);
      taskId = task.body.id as string;
    });

    it('lets a project MANAGER delete another members comment', async () => {
      // The capability that was missing. A manager must be able to moderate
      // content in their own project without being a global admin.
      const commentId = await addComment(member.token, 'A member wrote this');

      await request(http())
        .delete(`${base}/tasks/${taskId}/comments/${commentId}`)
        .set('Authorization', `Bearer ${manager.token}`)
        .expect(204);
    });

    it('lets the AUTHOR delete their own comment', async () => {
      const commentId = await addComment(member.token, 'My own comment');

      await request(http())
        .delete(`${base}/tasks/${taskId}/comments/${commentId}`)
        .set('Authorization', `Bearer ${member.token}`)
        .expect(204);
    });

    it('403s a plain MEMBER deleting someone elses comment', async () => {
      // Project membership grants access to the TASK. It does not grant
      // ownership of everything on it - which is the whole point of having a
      // rule finer than the guard.
      const commentId = await addComment(manager.token, 'The managers comment');

      await request(http())
        .delete(`${base}/tasks/${taskId}/comments/${commentId}`)
        .set('Authorization', `Bearer ${member.token}`)
        .expect(403);
    });

    it('404s an OUTSIDER - the guard fires before the moderation rule', async () => {
      const commentId = await addComment(manager.token, 'Not for outsiders');

      await request(http())
        .delete(`${base}/tasks/${taskId}/comments/${commentId}`)
        .set('Authorization', `Bearer ${outsider.token}`)
        .expect(404);
    });

    it('404s a comment id that belongs to a DIFFERENT task', async () => {
      /**
       * THE NESTED-ROUTE IDOR, and it is easy to miss.
       *
       * The guard authorises the TASK in the URL. Nothing authorises the
       * COMMENT. Without checking that the two belong together, a member of
       * project A could delete a comment on project B's task by pairing a task
       * id they can see with a comment id they cannot.
       *
       * "Authorise one identifier, act on another" is a whole class of bug that
       * only appears on nested routes.
       */
      const otherTask = await request(http())
        .post(`${base}/tasks`)
        .set('Authorization', `Bearer ${manager.token}`)
        .send({ title: 'A different task entirely', projectId })
        .expect(201);

      const foreignComment = await request(http())
        .post(`${base}/tasks/${otherTask.body.id}/comments`)
        .set('Authorization', `Bearer ${manager.token}`)
        .send({ body: 'Belongs to the other task' })
        .expect(201);

      await request(http())
        .delete(`${base}/tasks/${taskId}/comments/${foreignComment.body.id}`)
        .set('Authorization', `Bearer ${manager.token}`)
        .expect(404);
    });
  });

  /**
   * ===========================================================================
   * HEALTH PROBES - two audiences, two answers about authentication
   * ===========================================================================
   * `/health/detail` reports internal topology: which dependencies exist, which
   * are failing, how slow they are. The code's own comment called that "genuine
   * reconnaissance value" and said it should be admin-gated - and then left it
   * `@Public()`. A documented gap is still a gap.
   *
   * `/live` and `/ready` MUST stay public. A liveness probe that needs a token
   * is useless to a load balancer or kubelet - they hold no credentials, and an
   * auth failure would read as an unhealthy instance and pull the service out
   * of rotation. These tests pin BOTH halves, because "secure the health
   * endpoints" applied bluntly would cause an outage.
   * ===========================================================================
   */
  describe('Health probe exposure', () => {
    it('keeps /health/live and /health/ready public', async () => {
      await request(http()).get('/health/live').expect(200);
      await request(http()).get('/health/ready').expect(200);
    });

    it('401s /health/detail for an anonymous caller', async () => {
      await request(http()).get('/health/detail').expect(401);
    });

    it('403s /health/detail for an authenticated NON-admin', async () => {
      await request(http())
        .get('/health/detail')
        .set('Authorization', `Bearer ${member.token}`)
        .expect(403);
    });
  });
});
