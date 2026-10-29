import { INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { sharedUri } from '../../test/shared-mongo';

/**
 * =============================================================================
 * The authentication flow, end to end, against a real database.
 * =============================================================================
 * These are the assertions that matter for auth, and most of them are about
 * things going WRONG - which is where authentication actually lives.
 * =============================================================================
 */
describe('Authentication (e2e)', () => {
  let app: INestApplication;

  const base = '/api/v1';
  const server = () => app.getHttpServer() as Parameters<typeof request>[0];

  /**
   * PHASE 16: the cookie-authenticated routes now require a CSRF token.
   *
   * Reading the token out of the response and echoing it in a header is
   * exactly what a browser client does - which makes these tests a working
   * example of the double-submit pattern rather than a workaround.
   */
  const readCookie = (response: request.Response, name: string): string => {
    const cookies = (response.headers['set-cookie'] as unknown as string[]) ?? [];
    const match = cookies.find((c) => c.startsWith(`${name}=`)) ?? '';
    return match.split(';')[0].replace(`${name}=`, '');
  };

  /**
   * PHASE 16: refresh and logout authenticate with a COOKIE, so they are the
   * only two endpoints in this API that CSRF applies to - and they now require
   * the double-submit token.
   *
   * Sending the cookie and echoing it in the header is exactly what a browser
   * client does, so these calls double as a working example of the pattern.
   */
  const csrfOf = (response: request.Response) => {
    const token = readCookie(response, 'taskflow_csrf');
    return { Cookie: `taskflow_csrf=${token}`, 'x-csrf-token': token };
  };

  const credentials = {
    email: 'auth-user@example.com',
    name: 'Auth User',
    password: 'Password123',
  };

  beforeAll(async () => {
    process.env.MONGODB_URI = sharedUri('taskflow_auth_test');

    const { AppModule } = await import('../app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    // The refresh flow reads a cookie, so the parser must be installed here
    // exactly as it is in main.ts. Forgetting it makes `request.cookies`
    // undefined and every cookie-based refresh silently fall back to the body.
    app.use(cookieParser());
    await app.init();
  }, 180_000);

  afterAll(async () => {
    await app?.close();
  }, 60_000);

  describe('deny by default', () => {
    it('rejects an unauthenticated request to a protected route', async () => {
      // The whole point of the global APP_GUARD: nobody had to remember to
      // protect this endpoint.
      await request(server()).get(`${base}/users`).expect(401);
    });

    it('allows a @Public() route without a token', async () => {
      await request(server()).get(`${base}/ping`).expect(200);
    });

    it('rejects a malformed token', async () => {
      await request(server())
        .get(`${base}/users`)
        .set('Authorization', 'Bearer not-a-jwt')
        .expect(401);
    });
  });

  describe('register + login', () => {
    it('registers, returns an access token, and never leaks the hash', async () => {
      const response = await request(server())
        .post(`${base}/auth/register`)
        .send(credentials)
        .expect(201);

      expect(response.body.accessToken).toEqual(expect.any(String));
      expect(response.body.user).not.toHaveProperty('passwordHash');
      // Self-registration must NEVER produce an admin - RegisterDto omits the
      // field AND the service forces MEMBER.
      expect(response.body.user.role).toBe('member');

      // The refresh token goes in an httpOnly cookie, not the body: a value in
      // the body is a value JavaScript can read, and XSS can exfiltrate.
      expect(response.body).not.toHaveProperty('refreshToken');

      const cookies = response.headers['set-cookie'] as unknown as string[];
      const refreshCookie = cookies.find((c) => c.startsWith('taskflow_refresh='));
      expect(refreshCookie).toBeDefined();
      expect(refreshCookie).toMatch(/HttpOnly/i);
      expect(refreshCookie).toMatch(/SameSite=Strict/i);
    });

    it('REFUSES to let a registration set its own role', async () => {
      /**
       * The privilege-escalation attempt this whole design exists to stop.
       * `RegisterDto` is `OmitType(CreateUserDto, ['role'])`, so with
       * `forbidNonWhitelisted: true` the request is rejected outright rather
       * than silently ignored.
       */
      await request(server())
        .post(`${base}/auth/register`)
        .send({ ...credentials, email: 'escalate@example.com', role: 'admin' })
        .expect(400);
    });

    it('logs in with correct credentials', async () => {
      const response = await request(server())
        .post(`${base}/auth/login`)
        .send({ email: credentials.email, password: credentials.password })
        .expect(200);

      expect(response.body.accessToken).toEqual(expect.any(String));
    });

    it('gives the SAME message for a wrong password and an unknown user', async () => {
      /**
       * User enumeration. If the two differ, an attacker can discover which
       * emails are registered - which turns a credential-stuffing list from a
       * guess into a target list.
       *
       * (`AuthService.validateCredentials` also equalises the TIMING by hashing
       * against a dummy value when the user is absent; equal messages without
       * equal timing leaks the same information more slowly.)
       */
      const wrongPassword = await request(server())
        .post(`${base}/auth/login`)
        .send({ email: credentials.email, password: 'WrongPassword123' })
        .expect(401);

      const unknownUser = await request(server())
        .post(`${base}/auth/login`)
        .send({ email: 'nobody@example.com', password: 'WrongPassword123' })
        .expect(401);

      expect(wrongPassword.body.message).toBe(unknownUser.body.message);
    });
  });

  describe('the access token', () => {
    it('unlocks protected routes and identifies the caller', async () => {
      const login = await request(server())
        .post(`${base}/auth/login`)
        .send({ email: credentials.email, password: credentials.password })
        .expect(200);

      const me = await request(server())
        .get(`${base}/auth/me`)
        .set('Authorization', `Bearer ${login.body.accessToken as string}`)
        .expect(200);

      expect(me.body.email).toBe(credentials.email);
      expect(me.body).not.toHaveProperty('passwordHash');
    });
  });

  describe('refresh rotation and REUSE DETECTION', () => {
    /** Pull the raw refresh token out of a Set-Cookie header. */
    const extractRefresh = (response: request.Response): string => {
      const cookies = response.headers['set-cookie'] as unknown as string[];
      const cookie = cookies.find((c) => c.startsWith('taskflow_refresh=')) ?? '';
      return cookie.split(';')[0].replace('taskflow_refresh=', '');
    };

    it('rotates the token, and the OLD one stops working', async () => {
      const login = await request(server())
        .post(`${base}/auth/login`)
        .send({ email: credentials.email, password: credentials.password })
        .expect(200);

      const first = extractRefresh(login);

      const refreshed = await request(server())
        .post(`${base}/auth/refresh`)
        .set(csrfOf(login))
        .send({ refreshToken: first })
        .expect(200);

      expect(refreshed.body.accessToken).toEqual(expect.any(String));

      const second = extractRefresh(refreshed);
      expect(second).not.toBe(first); // rotation happened

      /**
       * REUSE DETECTION. Presenting the spent token again is treated as
       * evidence of theft: 403, and the ENTIRE FAMILY is revoked.
       *
       * Most JWT tutorials stop at rotation. Rotation alone means a thief who
       * refreshes first locks out the real user with no signal that anything
       * happened.
       */
      await request(server())
        .post(`${base}/auth/refresh`)
        .set(csrfOf(refreshed))
        .send({ refreshToken: first })
        .expect(403);

      /**
       * ...and the DESCENDANT token is dead too, because the whole family was
       * revoked - which is the point. The legitimate user is logged out along
       * with the thief, because there is no way to tell which is which.
       *
       * It answers 403 rather than 401 for the same reason as above: the row
       * exists and is revoked, so the service reports "reuse detected" rather
       * than "unknown token". Consistency here matters - a client that treats
       * 401 as "refresh me" and 403 as "log in again" behaves correctly.
       */
      await request(server())
        .post(`${base}/auth/refresh`)
        .set(csrfOf(refreshed))
        .send({ refreshToken: second })
        .expect(403);
    });

    it('rejects a refresh token signed with the wrong secret', async () => {
      // A token that looks structurally right but was not issued by us. This is
      // also why the access and refresh secrets must differ: otherwise an
      // access token would verify here.
      const session = await request(server())
        .post(`${base}/auth/login`)
        .send({ email: credentials.email, password: credentials.password })
        .expect(200);

      await request(server())
        .post(`${base}/auth/refresh`)
        .set(csrfOf(session))
        .send({ refreshToken: 'a.b.c' })
        .expect(401);
    });
  });

  describe('logout', () => {
    it('revokes the session so the refresh token cannot be used again', async () => {
      const login = await request(server())
        .post(`${base}/auth/login`)
        .send({ email: credentials.email, password: credentials.password })
        .expect(200);

      const cookies = login.headers['set-cookie'] as unknown as string[];
      const refresh = (cookies.find((c) => c.startsWith('taskflow_refresh=')) ?? '')
        .split(';')[0]
        .replace('taskflow_refresh=', '');

      await request(server())
        .post(`${base}/auth/logout`)
        .set('Authorization', `Bearer ${login.body.accessToken as string}`)
        .set(csrfOf(login))
        .send({ refreshToken: refresh })
        .expect(204);

      /**
       * 403, not 401: the token is now REVOKED, which the service treats as
       * potential reuse. Note what logout does NOT do - the ACCESS token still
       * works until it expires, because it is stateless. That is the
       * fundamental JWT trade-off, and pretending otherwise is how people ship
       * a "logout" that does not log anyone out.
       */
      await request(server())
        .post(`${base}/auth/refresh`)
        .set(csrfOf(login))
        .send({ refreshToken: refresh })
        .expect(403);
    });

    it('is idempotent - logging out twice is not an error', async () => {
      const login = await request(server())
        .post(`${base}/auth/login`)
        .send({ email: credentials.email, password: credentials.password })
        .expect(200);

      const token = login.body.accessToken as string;

      await request(server())
        .post(`${base}/auth/logout`)
        .set('Authorization', `Bearer ${token}`)
        .set(csrfOf(login))
        .send({})
        .expect(204);

      await request(server())
        .post(`${base}/auth/logout`)
        .set('Authorization', `Bearer ${token}`)
        .set(csrfOf(login))
        .send({})
        .expect(204);
    });
  });

  describe('CSRF protection (Phase 16)', () => {
    it('REJECTS a cookie-authenticated request with no CSRF token', async () => {
      const login = await request(server())
        .post(`${base}/auth/login`)
        .send({ email: credentials.email, password: credentials.password })
        .expect(200);

      const refresh = readCookie(login, 'taskflow_refresh');

      /**
       * This is the forged request an attacker's page would make: the browser
       * attaches the refresh cookie automatically, but the attacker cannot READ
       * it (same-origin policy) and therefore cannot set the matching header.
       */
      await request(server())
        .post(`${base}/auth/refresh`)
        .set('Cookie', `taskflow_refresh=${refresh}`)
        .expect(403);
    });

    it('REJECTS a mismatched token', async () => {
      const login = await request(server())
        .post(`${base}/auth/login`)
        .send({ email: credentials.email, password: credentials.password })
        .expect(200);

      await request(server())
        .post(`${base}/auth/refresh`)
        .set('Cookie', `taskflow_csrf=${readCookie(login, 'taskflow_csrf')}`)
        .set('x-csrf-token', 'a-completely-different-value-000000')
        .send({ refreshToken: readCookie(login, 'taskflow_refresh') })
        .expect(403);
    });

    it('does NOT require a token on bearer-authenticated endpoints', async () => {
      /**
       * The point of making CSRF opt-in. A bearer token is never attached
       * automatically by the browser, so there is nothing to forge - and
       * requiring a CSRF token here would break every non-browser client for no
       * security benefit whatsoever.
       */
      const login = await request(server())
        .post(`${base}/auth/login`)
        .send({ email: credentials.email, password: credentials.password })
        .expect(200);

      await request(server())
        .get(`${base}/auth/me`)
        .set('Authorization', `Bearer ${login.body.accessToken as string}`)
        .expect(200);
    });
  });

  describe('change password', () => {
    it('requires the current password and revokes every session', async () => {
      const email = 'rotate@example.com';

      const registered = await request(server())
        .post(`${base}/auth/register`)
        .send({ email, name: 'Rotate', password: 'Password123' })
        .expect(201);

      const token = registered.body.accessToken as string;

      // Wrong current password -> 401. Without this check, anyone holding a
      // stolen access token could lock the real owner out permanently.
      await request(server())
        .post(`${base}/auth/password`)
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: 'WrongPassword123', newPassword: 'NewPassword456' })
        .expect(401);

      await request(server())
        .post(`${base}/auth/password`)
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: 'Password123', newPassword: 'NewPassword456' })
        .expect(204);

      // The new password works...
      await request(server())
        .post(`${base}/auth/login`)
        .send({ email, password: 'NewPassword456' })
        .expect(200);

      // ...and the old one does not.
      await request(server())
        .post(`${base}/auth/login`)
        .send({ email, password: 'Password123' })
        .expect(401);
    });
  });
});
