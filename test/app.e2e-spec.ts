import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { DataSource } from 'typeorm';
import type { GoogleIdentity } from '../src/modules/auth/auth.types.js';
import { REDIS_CLIENT } from '../src/redis/redis.constants.js';
import { createTestApp } from './utils/create-test-app.js';

const employee: GoogleIdentity = {
  googleId: 'google-1',
  email: 'an@example.com',
  emailVerified: true,
  hostedDomain: 'example.com',
  name: 'An Nguyen',
  avatarUrl: 'https://img.example.com/a.png',
};

function setCookies(response: request.Response): string[] {
  return (response.headers['set-cookie'] as unknown as string[]) ?? [];
}

function cookieValue(response: request.Response, name: string): string {
  const pair = setCookies(response)
    .map((cookie) => cookie.split(';')[0])
    .find((cookie) => cookie.startsWith(`${name}=`));
  if (pair === undefined) {
    throw new Error(`Cookie "${name}" was not set`);
  }
  return pair.slice(name.length + 1);
}

describe('ssMarket API', () => {
  const identity: { current: GoogleIdentity | null } = { current: employee };
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let redis: Redis;

  const server = () => app.getHttpServer();
  const countUsers = async (): Promise<number> => {
    const rows: Array<{ count: string }> = await dataSource.query(
      'SELECT COUNT(*) AS count FROM users',
    );
    return Number(rows[0].count);
  };

  beforeAll(async () => {
    app = await createTestApp(identity);
    dataSource = app.get(DataSource);
    redis = app.get<Redis>(REDIS_CLIENT);
  });

  beforeEach(async () => {
    identity.current = employee;
    await dataSource.query('TRUNCATE TABLE users');
    await redis.flushdb();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /health', () => {
    it('returns 200 when Postgres and Redis are reachable', async () => {
      const response = await request(server()).get('/health').expect(200);

      expect(response.body).toEqual({
        status: 'ok',
        checks: { database: 'up', redis: 'up' },
      });
    });
  });

  describe('GET /auth/google/callback', () => {
    it('creates the user, sets both cookies and redirects to the web app', async () => {
      const response = await request(server())
        .get('/auth/google/callback')
        .expect(302);

      expect(response.headers.location).toBe('http://localhost:3000/');
      expect(cookieValue(response, 'access_token')).not.toBe('');
      expect(cookieValue(response, 'refresh_token')).not.toBe('');
      expect(await countUsers()).toBe(1);
    });

    it('sets cookies as HttpOnly with SameSite=Lax', async () => {
      const response = await request(server()).get('/auth/google/callback');
      const cookies = setCookies(response);

      expect(cookies).toHaveLength(2);
      for (const cookie of cookies) {
        expect(cookie).toContain('HttpOnly');
        expect(cookie).toContain('SameSite=Lax');
        expect(cookie).toContain('Path=/');
        expect(cookie).not.toContain('Secure');
      }
    });

    it('rejects an email outside the company domain without creating a user', async () => {
      identity.current = {
        ...employee,
        email: 'someone@gmail.com',
        hostedDomain: null,
      };

      const response = await request(server())
        .get('/auth/google/callback')
        .expect(302);

      expect(response.headers.location).toBe(
        'http://localhost:3000/login?error=domain_not_allowed',
      );
      expect(setCookies(response)).toHaveLength(0);
      expect(await countUsers()).toBe(0);
    });

    it('redirects to the login page when Google sign-in failed', async () => {
      identity.current = null;

      const response = await request(server())
        .get('/auth/google/callback')
        .expect(302);

      expect(response.headers.location).toBe(
        'http://localhost:3000/login?error=login_failed',
      );
    });

    it('does not create a duplicate user on the second sign-in', async () => {
      await request(server()).get('/auth/google/callback').expect(302);
      identity.current = { ...employee, name: 'An Updated' };
      await request(server()).get('/auth/google/callback').expect(302);

      expect(await countUsers()).toBe(1);
      const rows: Array<{ name: string }> = await dataSource.query(
        'SELECT name FROM users',
      );
      expect(rows[0].name).toBe('An Updated');
    });
  });

  describe('GET /users/me', () => {
    it('returns 401 in the standard error shape without a session', async () => {
      const response = await request(server()).get('/users/me').expect(401);

      expect(response.body).toEqual({
        statusCode: 401,
        code: 'UNAUTHORIZED',
        message: 'Missing access token',
        timestamp: expect.any(String),
        path: '/users/me',
      });
    });

    it('returns the signed-in user', async () => {
      const agent = request.agent(server());
      await agent.get('/auth/google/callback').expect(302);

      const response = await agent.get('/users/me').expect(200);

      expect(response.body).toEqual({
        id: expect.any(String),
        email: 'an@example.com',
        name: 'An Nguyen',
        avatarUrl: 'https://img.example.com/a.png',
        role: 'user',
      });
    });
  });

  describe('POST /auth/refresh', () => {
    it('rotates the refresh token and rejects the old one', async () => {
      const agent = request.agent(server());
      const login = await agent.get('/auth/google/callback').expect(302);
      const oldRefreshToken = cookieValue(login, 'refresh_token');

      const refreshed = await agent.post('/auth/refresh').expect(204);

      expect(cookieValue(refreshed, 'refresh_token')).not.toBe(oldRefreshToken);
      await agent.get('/users/me').expect(200);
      await request(server())
        .post('/auth/refresh')
        .set('Cookie', [`refresh_token=${oldRefreshToken}`])
        .expect(401);
    });

    it('returns 401 and clears the cookies without a refresh token', async () => {
      const response = await request(server())
        .post('/auth/refresh')
        .expect(401);

      expect(cookieValue(response, 'access_token')).toBe('');
      expect(cookieValue(response, 'refresh_token')).toBe('');
    });
  });

  describe('POST /auth/logout', () => {
    it('revokes the refresh token so it cannot be used again', async () => {
      const agent = request.agent(server());
      const login = await agent.get('/auth/google/callback').expect(302);
      const refreshToken = cookieValue(login, 'refresh_token');

      await agent.post('/auth/logout').expect(204);

      await request(server())
        .post('/auth/refresh')
        .set('Cookie', [`refresh_token=${refreshToken}`])
        .expect(401);
      await agent.get('/users/me').expect(401);
    });
  });

  describe('GET /docs-json', () => {
    it('describes the API so the frontend can generate types', async () => {
      const response = await request(server()).get('/docs-json').expect(200);
      const document = response.body as {
        paths: Record<string, unknown>;
        components: { schemas: Record<string, unknown> };
      };

      expect(Object.keys(document.paths).sort()).toEqual([
        '/auth/logout',
        '/auth/refresh',
        '/health',
        '/users/me',
      ]);
      expect(document.components.schemas.UserResponseDto).toBeDefined();
    });
  });
});
