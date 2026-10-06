import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Redis } from 'ioredis';
import { DataSource } from 'typeorm';
import type { GoogleIdentity } from '../src/modules/auth/auth.types.js';
import { REDIS_CLIENT } from '../src/redis/redis.constants.js';
import { signIn, type TestAgent } from './utils/auth.js';
import { createTestApp } from './utils/create-test-app.js';

describe('Admin categories API', () => {
  const identity: { current: GoogleIdentity | null } = { current: null };
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let redis: Redis;
  let admin: TestAgent;
  let user: TestAgent;

  const draft = (categoryId: number) => ({
    mode: 'in_stock',
    title: 'Sách cũ',
    categoryId,
    description: 'Còn tốt',
    acceptsPrepaidQr: false,
    acceptsPayOnDelivery: true,
    items: [
      { name: 'Clean Code', unit: 'cái', unitPrice: 150000, stockQuantity: '1' },
    ],
  });

  beforeAll(async () => {
    app = await createTestApp(identity);
    dataSource = app.get(DataSource);
    redis = app.get<Redis>(REDIS_CLIENT);
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE users CASCADE');
    await dataSource.query('DELETE FROM categories WHERE id > 6');
    await dataSource.query('UPDATE categories SET is_active = true');
    await redis.flushdb();
    admin = await signIn(app, identity, 'admin');
    user = await signIn(app, identity, 'buyer');
  });

  afterAll(async () => {
    await dataSource.query('DELETE FROM categories WHERE id > 6');
    await dataSource.query('UPDATE categories SET is_active = true');
    await app.close();
  });

  it('is closed to people who are not admins', async () => {
    const { default: request } = await import('supertest');
    await request(app.getHttpServer()).get('/admin/categories').expect(401);
    await user.get('/admin/categories').expect(403);
    const denied = await user
      .post('/admin/categories')
      .send({ name: 'Sách', nameEn: 'Books' })
      .expect(403);
    expect(denied.body.code).toBe('FORBIDDEN');
  });

  it('lets an admin add a category that everyone then sees', async () => {
    const created = await admin
      .post('/admin/categories')
      .send({ name: 'Sách', nameEn: 'Books' })
      .expect(201);

    expect(created.body).toMatchObject({
      slug: 'sach',
      name: 'Sách',
      nameEn: 'Books',
      sortOrder: 7,
      isActive: true,
    });
    const listed = await user.get('/categories').expect(200);
    expect(listed.body.at(-1)).toEqual({
      id: created.body.id,
      slug: 'sach',
      name: 'Sách',
      nameEn: 'Books',
    });
  });

  it('refuses a duplicate name', async () => {
    const response = await admin
      .post('/admin/categories')
      .send({ name: 'Đồ ăn', nameEn: 'Food again' })
      .expect(409);
    expect(response.body.code).toBe('CATEGORY_EXISTS');
  });

  it('validates the body', async () => {
    await admin
      .post('/admin/categories')
      .send({ name: '', nameEn: 'X' })
      .expect(400);
    await admin.patch('/admin/categories/999').send({ name: 'X' }).expect(404);
  });

  it('renames a category and the cached listing follows', async () => {
    const id = (await user.post('/listings').send(draft(4)).expect(201)).body
      .id;
    await user.post(`/listings/${id}/publish`).expect(200);
    await admin.get('/listings').expect(200); // fills the cache

    await admin
      .patch('/admin/categories/4')
      .send({ name: 'Đồ công nghệ', nameEn: 'Tech' })
      .expect(200);

    const page = await admin.get('/listings').expect(200);
    expect(page.body.items[0].category).toEqual({
      id: 4,
      slug: 'dien-tu',
      name: 'Đồ công nghệ',
      nameEn: 'Tech',
    });
    await admin
      .patch('/admin/categories/4')
      .send({ name: 'Điện tử', nameEn: 'Electronics' })
      .expect(200);
  });

  it('hides a category from lists and from new listings, but keeps old ones', async () => {
    const id = (await user.post('/listings').send(draft(4)).expect(201)).body
      .id;
    await user.post(`/listings/${id}/publish`).expect(200);

    await admin
      .patch('/admin/categories/4')
      .send({ isActive: false })
      .expect(200);

    const visible = await user.get('/categories').expect(200);
    expect(visible.body.map((c: { id: number }) => c.id)).not.toContain(4);
    const all = await admin.get('/admin/categories').expect(200);
    expect(all.body.find((c: { id: number }) => c.id === 4).isActive).toBe(
      false,
    );

    const refused = await user.post('/listings').send(draft(4)).expect(400);
    expect(refused.body.code).toBe('CATEGORY_INACTIVE');

    const stillThere = await user.get('/listings?category=dien-tu').expect(200);
    expect(stillThere.body.items).toHaveLength(1);
    await user
      .patch(`/listings/${id}`)
      .send({ ...draft(4), title: 'Sách cũ, giá mới' })
      .expect(200);
  });
});
