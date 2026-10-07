import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Redis } from 'ioredis';
import sharp from 'sharp';
import request from 'supertest';
import { DataSource } from 'typeorm';
import type { GoogleIdentity } from '../src/modules/auth/auth.types.js';
import { REDIS_CLIENT } from '../src/redis/redis.constants.js';
import { signIn, type TestAgent } from './utils/auth.js';
import { createTestApp } from './utils/create-test-app.js';

const listingBody = {
  mode: 'in_stock',
  condition: 'good',
  title: 'Loa bluetooth cũ',
  categoryId: 4,
  description: '',
  acceptsPrepaidQr: false,
  acceptsPayOnDelivery: true,
  items: [
    { name: 'Loa JBL', unit: 'cái', unitPrice: 500000, stockQuantity: '1' },
  ],
};

type Image = { id: string; url: string; thumbnailUrl: string };

/** `/api/media/x` is what the browser requests; the API itself serves `/media/x`. */
const apiPath = (browserUrl: string) => browserUrl.replace(/^\/api/, '');

describe('Listing images API', () => {
  const identity: { current: GoogleIdentity | null } = { current: null };
  const uploadDir = process.env.UPLOAD_DIR as string;
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let redis: Redis;
  let seller: TestAgent;
  let buyer: TestAgent;
  let photo: Buffer;
  let listingId: string;

  const upload = (agent: TestAgent, file: Buffer, name = 'photo.jpg') =>
    agent.post(`/listings/${listingId}/images`).attach('file', file, name);

  beforeAll(async () => {
    app = await createTestApp(identity);
    dataSource = app.get(DataSource);
    redis = app.get<Redis>(REDIS_CLIENT);
    photo = await sharp({
      create: { width: 800, height: 600, channels: 3, background: '#2b62b2' },
    })
      .jpeg()
      .withExif({ IFD0: { Make: 'PhoneMaker' } })
      .toBuffer();
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE users CASCADE');
    await redis.flushdb();
    await rm(uploadDir, { recursive: true, force: true });
    seller = await signIn(app, identity, 'seller');
    buyer = await signIn(app, identity, 'buyer');
    const created = await seller
      .post('/listings')
      .send(listingBody)
      .expect(201);
    listingId = (created.body as { id: string }).id;
  });

  afterAll(async () => {
    await rm(uploadDir, { recursive: true, force: true });
    await app.close();
  });

  it('stores an upload as WebP in two sizes and serves both', async () => {
    const response = await upload(seller, photo).expect(201);
    const image = response.body as Image;

    expect(image.url).toMatch(
      new RegExp(`^/api/media/listings/${listingId}/[0-9a-f-]{36}\\.webp$`),
    );
    expect(image.thumbnailUrl).toBe(image.url.replace('.webp', '_thumb.webp'));

    const full = await seller.get(apiPath(image.url)).buffer(true).expect(200);
    expect(full.headers['content-type']).toBe('image/webp');
    expect(full.headers['cache-control']).toBe(
      'private, max-age=31536000, immutable',
    );
    const fullMeta = await sharp(full.body as Buffer).metadata();
    expect(fullMeta).toMatchObject({ format: 'webp', width: 800, height: 600 });
    expect(fullMeta.exif).toBeUndefined();

    const thumb = await seller
      .get(apiPath(image.thumbnailUrl))
      .buffer(true)
      .expect(200);
    expect(await sharp(thumb.body as Buffer).metadata()).toMatchObject({
      width: 400,
      height: 300,
    });
  });

  it('shows images on the listing and the first thumbnail in search results', async () => {
    const first = (await upload(seller, photo).expect(201)).body as Image;
    const second = (await upload(seller, photo).expect(201)).body as Image;
    await seller.post(`/listings/${listingId}/publish`).expect(200);

    const detail = await buyer.get(`/listings/${listingId}`).expect(200);
    expect((detail.body as { images: Image[] }).images).toEqual([
      first,
      second,
    ]);

    const list = await buyer.get('/listings').expect(200);
    expect(
      (list.body as { items: Array<{ thumbnailUrl: string }> }).items[0]
        .thumbnailUrl,
    ).toBe(first.thumbnailUrl);
  });

  it('requires a session to read media', async () => {
    const image = (await upload(seller, photo).expect(201)).body as Image;

    await request(app.getHttpServer()).get(apiPath(image.url)).expect(401);
  });

  it('never serves files outside the upload directory', async () => {
    await upload(seller, photo).expect(201);

    for (const path of [
      '/media/..%2F..%2F.env',
      '/media/listings/..%2F..%2F..%2Fpackage.json',
      '/media/%2Fetc%2Fpasswd',
      '/media/listings/unknown/missing.webp',
    ]) {
      const response = await seller.get(path);
      expect([400, 404]).toContain(response.status);
    }
  });

  it('rejects a file that is not an image, whatever its name says', async () => {
    const response = await upload(
      seller,
      Buffer.from('<?php echo "hello"; ?>'),
      'photo.jpg',
    ).expect(422);

    expect(response.body).toMatchObject({ code: 'INVALID_IMAGE' });
  });

  it('rejects a request without a file', async () => {
    await seller.post(`/listings/${listingId}/images`).expect(400);
  });

  it('rejects an upload larger than 5 MB', async () => {
    const response = await upload(seller, Buffer.alloc(5 * 1024 * 1024 + 1));

    expect(response.status).toBe(413);
    expect(response.body).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });

  it('allows at most five images per listing', async () => {
    for (let i = 0; i < 5; i += 1) {
      await upload(seller, photo).expect(201);
    }

    const response = await upload(seller, photo).expect(409);

    expect(response.body).toMatchObject({ code: 'TOO_MANY_IMAGES' });
  });

  it('lets only the seller upload and delete', async () => {
    const image = (await upload(seller, photo).expect(201)).body as Image;

    await upload(buyer, photo).expect(403);
    await buyer.delete(`/listings/${listingId}/images/${image.id}`).expect(403);
  });

  it('deletes the image row and both files', async () => {
    const image = (await upload(seller, photo).expect(201)).body as Image;
    const fullPath = join(uploadDir, image.url.replace('/api/media/', ''));
    const thumbPath = fullPath.replace('.webp', '_thumb.webp');
    expect(existsSync(fullPath) && existsSync(thumbPath)).toBe(true);

    await seller
      .delete(`/listings/${listingId}/images/${image.id}`)
      .expect(204);

    expect(existsSync(fullPath) || existsSync(thumbPath)).toBe(false);
    const detail = await seller.get(`/listings/${listingId}`).expect(200);
    expect((detail.body as { images: Image[] }).images).toEqual([]);
    await seller.get(apiPath(image.url)).expect(404);
    await seller
      .delete(`/listings/${listingId}/images/${image.id}`)
      .expect(404);
  });
});
