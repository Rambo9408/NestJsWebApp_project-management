import { INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { sharedUri } from '../../test/shared-mongo';

/**
 * =============================================================================
 * The request pipeline, observed from outside
 * =============================================================================
 * Middleware, interceptors and filters are hard to reason about in the
 * abstract and easy to verify from the edge: make a request, look at what came
 * back. These assertions ARE the documentation for what the pipeline does.
 * =============================================================================
 */
describe('Request pipeline (e2e)', () => {
  let app: INestApplication;

  const base = '/api/v1';
  const http = () => app.getHttpServer() as Parameters<typeof request>[0];

  beforeAll(async () => {
    process.env.MONGODB_URI = sharedUri('taskflow_pipeline_test');

    const { AppModule } = await import('../app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
  }, 180_000);

  afterAll(async () => {
    await app?.close();
  }, 60_000);

  describe('CorrelationIdMiddleware', () => {
    it('generates a request id and echoes it back', async () => {
      const response = await request(http()).get(`${base}/ping`).expect(200);

      // The client can quote this in a bug report, turning an unreproducible
      // ticket into a log query.
      expect(response.headers['x-request-id']).toEqual(expect.any(String));
      expect(response.headers['x-request-id'].length).toBeGreaterThan(0);
    });

    it('PROPAGATES an incoming id instead of replacing it', async () => {
      /**
       * This is what makes a trace span services. Generating a fresh id here
       * would break the chain at our boundary - the caller's logs and ours
       * would no longer join.
       */
      const response = await request(http())
        .get(`${base}/ping`)
        .set('x-request-id', 'trace-from-the-gateway')
        .expect(200);

      expect(response.headers['x-request-id']).toBe('trace-from-the-gateway');
    });

    it('ignores an absurdly long client-supplied id', async () => {
      // A client-supplied header is untrusted input. Without the length cap,
      // an attacker can write megabytes into every log line - a cheap denial
      // of service against your log bill.
      const response = await request(http())
        .get(`${base}/ping`)
        .set('x-request-id', 'x'.repeat(5000))
        .expect(200);

      expect(response.headers['x-request-id']).not.toHaveLength(5000);
    });

    it('applies the FUNCTIONAL middleware too', async () => {
      const response = await request(http()).get(`${base}/ping`).expect(200);
      expect(response.headers['cache-control']).toBe('no-store');
    });
  });

  describe('AllExceptionsFilter', () => {
    it('gives every error ONE shape', async () => {
      const response = await request(http()).get(`${base}/users`).expect(401);

      expect(response.body).toMatchObject({
        success: false,
        statusCode: 401,
        error: expect.any(String),
        path: '/api/v1/users',
      });
      expect(response.body.timestamp).toEqual(expect.any(String));

      // The correlation id is in the BODY as well as the header, so a user can
      // paste the error and support can find the request.
      expect(response.body.requestId).toEqual(expect.any(String));
      expect(response.body.requestId).toBe(response.headers['x-request-id']);
    });

    it('preserves the validation ARRAY so a form can show one message per field', async () => {
      const response = await request(http())
        .post(`${base}/auth/register`)
        .send({ email: 'not-an-email', name: 'x', password: 'weak' })
        .expect(400);

      expect(Array.isArray(response.body.message)).toBe(true);
      expect((response.body.message as string[]).length).toBeGreaterThanOrEqual(3);
    });

    it('reports a 404 with the same envelope', async () => {
      const response = await request(http()).get(`${base}/definitely-not-a-route`).expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.statusCode).toBe(404);
    });
  });

  describe('TransformResponseInterceptor (opt-in, on AppController only)', () => {
    it('wraps the enveloped controller', async () => {
      const response = await request(http()).get(`${base}/ping`).expect(200);

      expect(response.body).toMatchObject({
        success: true,
        statusCode: 200,
        data: { status: 'ok' },
      });
      // Read INSIDE the map, after @HttpCode has been applied.
      expect(response.body.requestId).toBe(response.headers['x-request-id']);
    });

    it('leaves every OTHER controller returning a plain resource', async () => {
      /**
       * The deliberate asymmetry. Success responses stay REST-correct so
       * generated clients and OpenAPI tooling work; errors are standardised
       * everywhere, because that is where clients actually have to branch.
       */
      const registered = await request(http())
        .post(`${base}/auth/register`)
        .send({ email: 'pipeline@example.com', name: 'Pipeline', password: 'Password123' })
        .expect(201);

      expect(registered.body).not.toHaveProperty('data');
      expect(registered.body.user.email).toBe('pipeline@example.com');
    });
  });
});
