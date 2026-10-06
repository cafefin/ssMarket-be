import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Redis } from 'ioredis';
import { DataSource } from 'typeorm';
import type { GoogleIdentity } from '../src/modules/auth/auth.types.js';
import { REDIS_CLIENT } from '../src/redis/redis.constants.js';
import { signIn, type TestAgent } from './utils/auth.js';
import { createTestApp } from './utils/create-test-app.js';

describe('Users API', () => {
  const identity: { current: GoogleIdentity | null } = { current: null };
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let redis: Redis;
  let seller: TestAgent;
  let buyer: TestAgent;

  beforeAll(async () => {
    app = await createTestApp(identity);
    dataSource = app.get(DataSource);
    redis = app.get<Redis>(REDIS_CLIENT);
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE users CASCADE');
    await redis.flushdb();
    seller = await signIn(app, identity, 'seller');
    buyer = await signIn(app, identity, 'buyer');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /users/:id', () => {
    it('shows another person only their public profile', async () => {
      await seller
        .patch('/users/me')
        .send({
          deliveryLocation: 'Tầng 7',
          bankBin: '970436',
          bankAccountNumber: '0123456789',
          bankAccountName: 'Nguyen Van An',
        })
        .expect(200);
      const sellerId = (await seller.get('/users/me').expect(200)).body.id;

      const response = await buyer.get(`/users/${sellerId}`).expect(200);

      expect(response.body).toEqual({
        id: sellerId,
        name: 'seller',
        avatarUrl: null,
        deliveryLocation: 'Tầng 7',
      });
    });

    it('answers 404 for nobody and 400 for a malformed id', async () => {
      await buyer.get('/users/0b0f6f3e-3a55-4d0c-9f0a-0d3d0f9c1a11').expect(404);
      await buyer.get('/users/abc').expect(400);
    });

    it('requires a session', async () => {
      const { default: request } = await import('supertest');
      await request(app.getHttpServer())
        .get('/users/0b0f6f3e-3a55-4d0c-9f0a-0d3d0f9c1a11')
        .expect(401);
    });

    it('does not shadow /users/me', async () => {
      expect((await buyer.get('/users/me').expect(200)).body.email).toBe(
        'buyer@example.com',
      );
    });
  });
});
