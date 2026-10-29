import { INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { sharedUri } from '../../test/shared-mongo';

/**
 * =============================================================================
 * Notifications end to end: persistence, the REST history, and the SSE stream
 * =============================================================================
 * The SSE assertions are the interesting ones. Supertest cannot easily hold a
 * streaming response open, so the stream is driven through Node's raw `http`
 * against a real listening server - which is also a more honest test, because
 * it exercises the actual `text/event-stream` framing rather than a mock.
 * =============================================================================
 */
describe('Notifications (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;

  const base = '/api/v1';
  const http = () => app.getHttpServer() as Parameters<typeof request>[0];

  let manager: { token: string; id: string };
  let member: { token: string; id: string; email: string };
  let projectId: string;

  const register = async (email: string, name: string) => {
    const response = await request(http())
      .post(`${base}/auth/register`)
      .send({ email, name, password: 'Password123' })
      .expect(201);

    return {
      token: response.body.accessToken as string,
      id: response.body.user.id as string,
      email,
    };
  };

  beforeAll(async () => {
    process.env.MONGODB_URI = sharedUri('taskflow_notifications_test');

    const { AppModule } = await import('../app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

    // A REAL listening socket, so the SSE test can open a genuine streaming
    // connection rather than relying on supertest's request/response model.
    await app.listen(0);
    baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');

    manager = await register('notif-manager@example.com', 'Manager');
    member = await register('notif-member@example.com', 'Member');

    const project = await request(http())
      .post(`${base}/projects`)
      .set('Authorization', `Bearer ${manager.token}`)
      .send({ key: 'NOTIF', name: 'Notification Demo' })
      .expect(201);

    projectId = project.body.id as string;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
  }, 60_000);

  it('PERSISTS a notification when a member is added', async () => {
    await request(http())
      .post(`${base}/projects/${projectId}/members`)
      .set('Authorization', `Bearer ${manager.token}`)
      .send({ userId: member.id, role: 'member' })
      .expect(200);

    const list = await request(http())
      .get(`${base}/notifications`)
      .set('Authorization', `Bearer ${member.token}`)
      .expect(200);

    expect(list.body.total).toBe(1);
    expect(list.body.items[0]).toMatchObject({
      type: 'project_member_added',
      title: 'Added to project NOTIF',
      readAt: null,
    });
  });

  it('scopes notifications to their OWNER', async () => {
    // The manager triggered it; the member received it. A notification is not
    // visible to the person who caused it.
    const list = await request(http())
      .get(`${base}/notifications`)
      .set('Authorization', `Bearer ${manager.token}`)
      .expect(200);

    expect(list.body.total).toBe(0);
  });

  it('counts unread, and marking read is scoped to the caller', async () => {
    const before = await request(http())
      .get(`${base}/notifications/unread-count`)
      .set('Authorization', `Bearer ${member.token}`)
      .expect(200);

    expect(before.body.unread).toBe(1);

    const list = await request(http())
      .get(`${base}/notifications`)
      .set('Authorization', `Bearer ${member.token}`)
      .expect(200);

    const notificationId = list.body.items[0].id as string;

    /**
     * ANOTHER USER cannot mark it read. The repository puts `userId` in the
     * QUERY FILTER rather than checking afterwards - so this is a no-op, not an
     * error, and it reveals nothing about whether the id exists.
     *
     * This is IDOR defence, and doing it in the filter is the version that
     * cannot be forgotten by a later refactor.
     */
    await request(http())
      .patch(`${base}/notifications/${notificationId}/read`)
      .set('Authorization', `Bearer ${manager.token}`)
      .expect(204);

    const stillUnread = await request(http())
      .get(`${base}/notifications/unread-count`)
      .set('Authorization', `Bearer ${member.token}`)
      .expect(200);

    expect(stillUnread.body.unread).toBe(1);

    // The owner can.
    await request(http())
      .patch(`${base}/notifications/${notificationId}/read`)
      .set('Authorization', `Bearer ${member.token}`)
      .expect(204);

    const after = await request(http())
      .get(`${base}/notifications/unread-count`)
      .set('Authorization', `Bearer ${member.token}`)
      .expect(200);

    expect(after.body.unread).toBe(0);
  });

  describe('SSE stream', () => {
    it('requires authentication and accepts a QUERY-PARAMETER token', async () => {
      /**
       * EventSource cannot set headers, so an SSE endpoint has to accept the
       * token another way. See the long warning in `jwt.strategy.ts` for why a
       * query parameter is a real security downgrade and what makes it
       * acceptable here (a 15-minute token, one endpoint, log exclusion).
       */
      const unauthenticated = await fetch(`${baseUrl}${base}/notifications/stream`);
      expect(unauthenticated.status).toBe(401);
      await unauthenticated.body?.cancel();
    });

    it('DELIVERS a notification over the open stream', async () => {
      const controller = new AbortController();

      const response = await fetch(
        `${baseUrl}${base}/notifications/stream?access_token=${member.token}`,
        { signal: controller.signal, headers: { Accept: 'text/event-stream' } },
      );

      expect(response.status).toBe(200);
      // The framing that makes it SSE rather than a slow JSON response.
      expect(response.headers.get('content-type')).toContain('text/event-stream');

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();

      // Trigger a notification for the connected user while the stream is open.
      const created = await request(http())
        .post(`${base}/tasks`)
        .set('Authorization', `Bearer ${manager.token}`)
        .send({ title: 'Assigned over SSE', projectId, assigneeId: member.id })
        .expect(201);

      expect(created.body.reference).toBe('NOTIF-1');

      /**
       * Read until the notification frame arrives.
       *
       * The loop is bounded: a stream test that waits forever is a suite that
       * hangs in CI, which is far worse than one that fails.
       */
      let received = '';
      const deadline = Date.now() + 10_000;

      while (Date.now() < deadline && !received.includes('event: notification')) {
        const { value, done } = await reader.read();
        if (done) break;
        received += decoder.decode(value, { stream: true });
      }

      controller.abort();

      // The full SSE wire format: id, event name, and a JSON data line.
      expect(received).toContain('event: notification');
      expect(received).toContain('Assigned over SSE');
      expect(received).toMatch(/^id: [0-9a-f]{24}$/m);
    }, 30_000);
  });
});
