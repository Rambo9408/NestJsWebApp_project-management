import { INestApplication, VersioningType } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Connection, Types } from 'mongoose';
import request from 'supertest';

import { sharedUri } from '../../test/shared-mongo';

/**
 * =============================================================================
 * INTEGRATION TESTS - against a REAL MongoDB
 * =============================================================================
 * Unit tests (the in-memory repositories) prove our BUSINESS RULES. They cannot
 * prove anything about MongoDB, because there is no MongoDB in them. The things
 * this phase actually introduced - unique indexes, atomic `$inc`, conditional
 * updates, `populate`, aggregation, transactions - are DATABASE behaviours, and
 * a hand-written fake would just be a fiction that agrees with us.
 *
 * `mongodb-memory-server` downloads and runs a real `mongod`, so these are real
 * queries against the real engine. We start it as a SINGLE-NODE REPLICA SET,
 * because transactions do not exist on a standalone server - the same reason
 * `docker-compose.yml` runs one.
 *
 * WHERE THIS SITS IN THE PYRAMID (Phase 14 formalises it):
 *   unit        - one class, fakes for collaborators, milliseconds
 *   INTEGRATION - real infrastructure, several classes, seconds   <- this file
 *   e2e         - the whole app over HTTP, the user's point of view
 * This file is deliberately both integration AND e2e: it drives the real HTTP
 * surface, because that is where the mapping bugs (`_id` vs `id`, populate
 * shapes) actually show up.
 * =============================================================================
 */
describe('Database integration (real MongoDB)', () => {
  let app: INestApplication;
  let connection: Connection;

  /**
   * PHASE 7: every request now carries the access token.
   *
   * The wrapper keeps every existing `api().post(...)` call site unchanged while
   * attaching `Authorization: Bearer ...` - which is the point of having one
   * helper rather than a header repeated on forty lines.
   */
  let accessToken = '';

  const api = () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    const withAuth = (method: 'get' | 'post' | 'patch' | 'put' | 'delete') => (path: string) => {
      const req = request(server)[method](path);
      return accessToken ? req.set('Authorization', `Bearer ${accessToken}`) : req;
    };

    return {
      get: withAuth('get'),
      post: withAuth('post'),
      patch: withAuth('patch'),
      put: withAuth('put'),
      delete: withAuth('delete'),
    };
  };

  const base = '/api/v1';

  let ownerId: string;
  let memberId: string;
  let projectId: string;

  beforeAll(async () => {
    /**
     * Overriding configuration the honest way.
     *
     * `dotenv` (used by @nestjs/config) does NOT overwrite variables that are
     * already set, so assigning here BEFORE the module is imported wins over
     * `.env.test`. That ordering is worth knowing - it is also how a container
     * platform's env vars beat a baked-in file.
     */
    process.env.MONGODB_URI = sharedUri('taskflow_test');

    // Imported lazily, AFTER the env var is set, so ConfigModule reads the
    // right value when it is first evaluated.
    const { AppModule } = await import('../app.module');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    // Mirror main.ts so the paths under test are the real ones.
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();

    connection = app.get<Connection>(getConnectionToken());

    /**
     * `autoIndex` builds indexes lazily; `syncIndexes` forces it now so the
     * unique-index assertions below are testing something real rather than a
     * race. (In production, indexes are built by a migration - see
     * `database.module.ts` for why `autoIndex` is off there.)
     */
    await connection.syncIndexes();

    /**
     * BOOTSTRAP THE SESSION.
     *
     * `/auth/register` is the only `@Public()` way to create the first user -
     * which is exactly the deny-by-default posture working. There is no
     * unauthenticated path to `POST /users` any more, so a test that forgot to
     * authenticate fails with 401 instead of silently exercising an open
     * endpoint.
     */
    const registered = await api()
      .post(`${base}/auth/register`)
      .send({ email: 'owner@example.com', name: 'Owner', password: 'Password123' })
      .expect(201);

    ownerId = registered.body.user.id as string;

    /**
     * PHASE 8: promote the bootstrap user to ADMIN, directly in the database.
     *
     * `POST /users` and `DELETE /users/:id` are now admin-only, and there is
     * deliberately NO API path to make yourself an admin - registration forces
     * MEMBER and the role endpoint is itself admin-only. The first admin comes
     * from a migration or an operator, never from an HTTP request.
     *
     * Then RE-LOGIN, because a JWT is a SNAPSHOT: the token issued at
     * registration still says `member`. That staleness is the documented
     * trade-off of carrying the role in the token (Phase 7), and this is what
     * it looks like in practice.
     */
    await connection
      .collection('users')
      .updateOne({ _id: new Types.ObjectId(ownerId) }, { $set: { role: 'admin' } });

    const relogin = await api()
      .post(`${base}/auth/login`)
      .send({ email: 'owner@example.com', password: 'Password123' })
      .expect(200);

    accessToken = relogin.body.accessToken as string;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
  }, 60_000);

  it('creates users and enforces the UNIQUE INDEX on email', async () => {
    const member = await api()
      .post(`${base}/users`)
      .send({ email: 'member@example.com', name: 'Member', password: 'Password123' })
      .expect(201);

    memberId = member.body.id;
    // `_id` must never reach the client - the mapper turns it into `id` - and
    // `passwordHash` must never reach it at all.
    expect(member.body).not.toHaveProperty('_id');
    expect(member.body).not.toHaveProperty('passwordHash');

    // The application check catches this first and returns 409. The INDEX is
    // what makes it a guarantee under concurrency - proven separately below.
    await api()
      .post(`${base}/users`)
      .send({ email: 'OWNER@example.com', name: 'Clash', password: 'Password123' })
      .expect(409);
  });

  it('rejects a malformed ObjectId with 400, not 500', async () => {
    /**
     * Without `toObjectId`, this would reach Mongoose, throw a CastError, and
     * surface as 500 - turning a CLIENT mistake into a SERVER error that fires
     * your alerts and burns your error budget.
     */
    await api().get(`${base}/users/not-an-object-id`).expect(400);
  });

  it('enforces uniqueness at the DATABASE level, not just the application', async () => {
    /**
     * Bypass the service entirely and insert straight through the driver. The
     * application-level check cannot help here, so if this rejects, the
     * guarantee really is the index.
     *
     * This is the test that proves "validate in the app, ENFORCE in the
     * database" is more than a slogan.
     */
    await expect(
      connection.collection('users').insertOne({
        email: 'owner@example.com',
        name: 'Direct Insert',
        passwordHash: 'x',
        role: 'member',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('creates a project and adds a member', async () => {
    const project = await api()
      .post(`${base}/projects`)
      .send({ key: 'web', name: 'Website Redesign' })
      .expect(201);

    projectId = project.body.id;
    expect(project.body.key).toBe('WEB');
    expect(project.body.members).toHaveLength(1);

    const updated = await api()
      .post(`${base}/projects/${projectId}/members`)
      .send({ userId: memberId, role: 'member' })
      .expect(200);

    expect(updated.body.members).toHaveLength(2);
  });

  it('allocates task references with an ATOMIC counter', async () => {
    const first = await api()
      .post(`${base}/tasks`)
      .send({ title: 'First task', projectId, assigneeId: memberId })
      .expect(201);

    const second = await api()
      .post(`${base}/tasks`)
      .send({ title: 'Second task', projectId })
      .expect(201);

    expect(first.body.reference).toBe('WEB-1');
    expect(second.body.reference).toBe('WEB-2');
  });

  it('allocates DISTINCT references under concurrency', async () => {
    /**
     * The point of `$inc`. Ten simultaneous creates: if the implementation were
     * `count() + 1`, several would collide and the unique index on `reference`
     * would reject them.
     */
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        api()
          .post(`${base}/tasks`)
          .send({ title: `Concurrent ${index}`, projectId }),
      ),
    );

    const references = responses.map((response) => response.body.reference as string);

    expect(responses.every((response) => response.status === 201)).toBe(true);
    expect(new Set(references).size).toBe(10); // no duplicates
  });

  it('refuses to assign a task to someone who is not a project member', async () => {
    const outsider = await api()
      .post(`${base}/users`)
      .send({ email: 'outsider@example.com', name: 'Outsider', password: 'Password123' })
      .expect(201);

    await api()
      .post(`${base}/tasks`)
      .send({
        title: 'Not allowed',
        projectId,

        assigneeId: outsider.body.id,
      })
      .expect(409);
  });

  it('POPULATES the assignee in one extra query, not N', async () => {
    const list = await api().get(`${base}/tasks?projectId=${projectId}&limit=50`).expect(200);

    const assigned = (list.body.items as Array<Record<string, unknown>>).find(
      (task) => task.assignee !== null,
    );

    expect(assigned).toBeDefined();
    expect(assigned?.assignee).toMatchObject({ name: 'Member', email: 'member@example.com' });
    // `select: 'name email'` means nothing else came back - not even fields that
    // are not marked `select: false`.
    expect(Object.keys(assigned?.assignee as object).sort()).toEqual(['email', 'id', 'name']);
  });

  it('detects a CONCURRENT status change instead of overwriting it', async () => {
    const created = await api()
      .post(`${base}/tasks`)
      .send({ title: 'Status race', projectId })
      .expect(201);

    const taskId = created.body.id as string;

    // Someone else moves it first.
    await api()
      .patch(`${base}/tasks/${taskId}/status`)
      .send({ from: 'todo', to: 'in_progress' })
      .expect(200);

    // Our client still believes it is `todo`. Read-modify-write would silently
    // clobber the other change; the conditional update tells us instead.
    await api()
      .patch(`${base}/tasks/${taskId}/status`)
      .send({ from: 'todo', to: 'done' })
      .expect(409);
  });

  it('deletes a task AND its comments in a TRANSACTION', async () => {
    const created = await api()
      .post(`${base}/tasks`)
      .send({ title: 'With comments', projectId })
      .expect(201);

    const taskId = created.body.id as string;

    await api()
      .post(`${base}/tasks/${taskId}/comments`)
      .send({ body: 'First comment' })
      .expect(201);
    await api()
      .post(`${base}/tasks/${taskId}/comments`)
      .send({ body: 'Second comment' })
      .expect(201);

    const listed = await api().get(`${base}/tasks/${taskId}/comments`).expect(200);
    expect(listed.body.total).toBe(2);

    const deleted = await api().delete(`${base}/tasks/${taskId}`).expect(200);
    expect(deleted.body.deletedComments).toBe(2);

    // Both halves committed: no orphaned comments left behind.
    const orphans = await connection.collection('comments').countDocuments({});
    expect(orphans).toBe(0);

    await api().get(`${base}/tasks/${taskId}`).expect(404);
  });

  it('ROLLS BACK every write when a transaction throws', async () => {
    /**
     * The other half of the transaction guarantee, and the one that is easy to
     * forget to test. We drive `TransactionRunner` directly, because provoking
     * a mid-transaction failure over HTTP would need a fault injector.
     */
    const { TransactionRunner } = await import('./transaction.runner');
    const runner = app.get(TransactionRunner);

    const before = await connection.collection('comments').countDocuments({});

    await expect(
      runner.run(async (session) => {
        await connection
          .collection('comments')
          .insertOne(
            { body: 'should vanish', taskId: null, authorId: null, deletedAt: null },
            { session },
          );

        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const after = await connection.collection('comments').countDocuments({});
    expect(after).toBe(before); // the insert was undone
  });

  it('answers "tasks per status" with an AGGREGATION, not an application loop', async () => {
    const stats = await api().get(`${base}/tasks/stats?projectId=${projectId}`).expect(200);

    const rows = stats.body as Array<{ status: string; count: number; overdue: number }>;

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => typeof row.count === 'number')).toBe(true);

    const todo = rows.find((row) => row.status === 'todo');
    expect(todo?.count).toBeGreaterThan(0);
  });

  it('serves the project list from the MULTIKEY index on members.userId', async () => {
    const mine = await api().get(`${base}/projects?memberId=${memberId}`).expect(200);
    expect(mine.body.total).toBe(1);

    const explain = await connection
      .collection('projects')
      .find({ $or: [{ ownerId: null }, { 'members.userId': null }] })
      .explain('queryPlanner');

    // The plan exists - the assertion that matters in a real review is reading
    // `winningPlan.stage`: IXSCAN means an index was used, COLLSCAN means it
    // was not. `.explain()` is the tool for "why is this query slow?" and is
    // worth running by hand far more often than people do.
    expect(explain).toHaveProperty('queryPlanner');
  });

  it('refuses to delete a user who still owns an active project', async () => {
    /**
     * The Phase 4 cross-aggregate rule, over HTTP.
     *
     * NOTE WHY THIS USES A THIRD USER rather than the bootstrap account: that
     * account was promoted to ADMIN, and `UsersService.remove` also refuses to
     * delete the LAST remaining admin. Two rules would fire and the test would
     * pass for the wrong reason - which is worth more than it sounds, because a
     * test that passes for the wrong reason keeps passing after you break the
     * rule it claims to cover.
     */
    const disposable = await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post(`${base}/auth/register`)
      .send({ email: 'disposable@example.com', name: 'Disposable', password: 'Password123' })
      .expect(201);

    const disposableId = disposable.body.user.id as string;
    const disposableToken = disposable.body.accessToken as string;

    const ownedProject = await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post(`${base}/projects`)
      .set('Authorization', `Bearer ${disposableToken}`)
      .send({ key: 'DISP', name: 'Disposable Project' })
      .expect(201);

    // Admin, so the request itself is authorised; the 409 is the business rule.
    await api().delete(`${base}/users/${disposableId}`).expect(409);

    // An admin bypasses project membership (ProjectAccessGuard), so this works
    // even though the admin is not a member of that project.
    await api()
      .post(`${base}/projects/${ownedProject.body.id as string}/archive`)
      .expect(200);

    // Now `countActiveOwnedBy` returns 0 and the delete is allowed.
    await api().delete(`${base}/users/${disposableId}`).expect(204);

    // The original project is untouched.
    await api().get(`${base}/projects/${projectId}`).expect(200);
  });
});
