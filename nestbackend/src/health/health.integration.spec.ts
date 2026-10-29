import { INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { sharedUri } from '../../test/shared-mongo';
import { Role } from 'src/common/enums/role.enum';
import { User } from 'src/users/schemas/user.schema';

/**
 * =============================================================================
 * Testing the probes
 * =============================================================================
 * WHY THIS IS WORTH A TEST AT ALL - it looks like the most trivial endpoint in
 * the app. Three reasons, and all three are things that break silently:
 *
 *   1. THE PATHS. `/health/live` is referenced by the Dockerfile's HEALTHCHECK
 *      and would be referenced by a Kubernetes manifest. Those files are not
 *      type-checked against the app. If someone later removes the `exclude` in
 *      main.ts, the route becomes `/api/v1/health/live` and every container is
 *      declared unhealthy - **during a deploy, at which point the rollout stalls
 *      or the platform kills every instance.** A test that asserts the exact
 *      path is the only thing standing between that config and a bad night.
 *
 *   2. THE SEPARATION. The whole value of liveness vs readiness is that
 *      liveness does NOT check dependencies. That property is invisible in code
 *      review the moment someone adds "just one" indicator, so it is pinned
 *      below by asserting the EXACT set of indicators liveness reports.
 *
 *   3. AUTHENTICATION. The global JwtAuthGuard denies by default (Phase 8). A
 *      probe that starts returning 401 is indistinguishable, to the platform,
 *      from a probe that is failing.
 * =============================================================================
 */
describe('Health probes (e2e)', () => {
  let app: INestApplication;
  const http = () => app.getHttpServer() as Parameters<typeof request>[0];
  let adminToken: string;

  beforeAll(async () => {
    process.env.MONGODB_URI = sharedUri('taskflow_health_test');

    const { AppModule } = await import('../app.module');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();

    // EXACTLY as in main.ts - otherwise the paths under test are not the paths
    // that ship, which would make the whole suite a fiction.
    app.setGlobalPrefix('api', { exclude: ['health/live', 'health/ready', 'health/detail'] });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

    await app.init();

    /**
     * /health/detail IS NOW ADMIN-ONLY (it reports internal topology, which is
     * reconnaissance value). This suite therefore needs a real admin token.
     *
     * The user is PROMOTED DIRECTLY IN THE DATABASE, because there is
     * deliberately no API path to make yourself an admin - registration forces
     * MEMBER and PUT /users/:id/role is itself admin-only. Same technique the
     * authorization suite uses.
     */
    const userModel = app.get<Model<User>>(getModelToken(User.name));

    const registered = await request(http())
      .post('/api/v1/auth/register')
      .send({ email: 'health-admin@example.com', name: 'Health Admin', password: 'Password123' })
      .expect(201);

    adminToken = registered.body.accessToken as string;

    await userModel.updateOne(
      { _id: registered.body.user.id as string },
      { $set: { role: Role.ADMIN } },
    );

    // Re-login so the new role is inside the JWT claims - the old token still
    // says MEMBER, and the guard reads the token, not the database.
    const reauth = await request(http())
      .post('/api/v1/auth/login')
      .send({ email: 'health-admin@example.com', password: 'Password123' })
      .expect(200);

    adminToken = reauth.body.accessToken as string;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
  }, 60_000);

  describe('paths are stable and unauthenticated', () => {
    it('serves liveness at /health/live - no prefix, no version', async () => {
      const response = await request(http()).get('/health/live').expect(200);

      expect(response.body.status).toBe('ok');
    });

    it('does NOT serve it under the prefixed, versioned path', async () => {
      // If this ever returns 200, the `exclude` or VERSION_NEUTRAL was removed
      // and the Dockerfile HEALTHCHECK is about to start failing.
      await request(http()).get('/api/v1/health/live').expect(404);
    });

    it('serves readiness at /health/ready', async () => {
      const response = await request(http()).get('/health/ready').expect(200);

      expect(response.body.status).toBe('ok');
      expect(response.body.details.mongodb.status).toBe('up');
    });

    it('requires no token, despite the global auth guard', async () => {
      // The PROBES need no token: @Public() is what makes that work, and this
      // is the assertion that notices if it is removed.
      //
      // /health/detail is the exception - it is @Roles(ADMIN) now, because it
      // reports internal topology. Probes and diagnostics have different
      // audiences and therefore different answers about authentication.
      await request(http()).get('/health/live').expect(200);
    });
  });

  describe('liveness does not depend on anything', () => {
    it('reports only process-level indicators', async () => {
      const response = await request(http()).get('/health/live').expect(200);

      /**
       * THE LOAD-BEARING ASSERTION OF THE WHOLE FILE.
       *
       * `mongodb` must not appear. If someone adds a database check to
       * liveness, this fails - and the comment explains why that matters:
       * failing liveness means the orchestrator RESTARTS the container, so a
       * database blip would restart every healthy instance at once and turn a
       * 30-second degradation into an outage.
       *
       * Note this also pins that liveness carries NO THRESHOLD check. A memory
       * threshold here would make the probe flaky under any process it shares -
       * which is exactly how it was discovered (see process.health.ts).
       */
      expect(Object.keys(response.body.details)).toEqual(['process']);
      expect(response.body.details.mongodb).toBeUndefined();
      expect(response.body.details.redis).toBeUndefined();
    });
  });

  describe('readiness reflects only REQUIRED dependencies', () => {
    it('does not include Redis, because Redis is optional here', async () => {
      const response = await request(http()).get('/health/ready').expect(200);

      /**
       * Phase 10 made every Redis path degrade rather than fail, so an instance
       * without Redis is slower, not wrong. Gating readiness on it would remove
       * every instance from the load balancer over a cache outage - converting a
       * performance problem into a total one.
       */
      expect(response.body.details.redis).toBeUndefined();
    });
  });

  describe('/health/detail makes degradation visible', () => {
    it('reports Redis, and returns 503 when it is unreachable', async () => {
      /**
       * NOTE THIS TEST ACCEPTS BOTH OUTCOMES, and that is deliberate rather than
       * lazy: this suite runs both with and without a local Redis. What is being
       * asserted is that Redis is REPORTED either way - because the failure mode
       * this endpoint exists to prevent is a cache that has been down for three
       * weeks and nobody noticing.
       *
       * A degraded-but-serving instance returning 503 HERE while readiness
       * returns 200 is exactly the intended split: humans and alerting see the
       * problem; the load balancer does not act on it.
       */
      const response = await request(http())
        .get('/health/detail')
        .set('Authorization', `Bearer ${adminToken}`);

      expect([200, 503]).toContain(response.status);

      const body: {
        status: string;
        info?: Record<string, { status: string }>;
        error?: Record<string, { status: string }>;
        details: Record<string, { status: string }>;
      } = response.body;

      expect(body.details.redis).toBeDefined();
      expect(['up', 'down']).toContain(body.details.redis.status);

      // MongoDB is up in this suite either way, so the detail endpoint must not
      // be reporting a blanket failure.
      expect(body.details.mongodb.status).toBe('up');
    }, 15_000);
  });
});
