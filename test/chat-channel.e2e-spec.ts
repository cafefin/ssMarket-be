import type { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import type { GoogleIdentity } from '../src/modules/auth/auth.types.js';
import {
  CHAT_TEMPLATE_TYPES,
  DEFAULT_TEMPLATES,
} from '../src/modules/chat-channel/chat-templates.js';
import { signIn, type TestAgent } from './utils/auth.js';
import { createTestApp } from './utils/create-test-app.js';
import { startFakeChat } from './utils/fake-chat.js';

const WEBHOOK =
  'https://chat.googleapis.com/v1/spaces/AAAA/messages?key=KEY&token=wxyz';
const BASE = '/admin/chat-channel';
const valid = {
  enabled: false,
  maxPerHour: 10,
  sellerCooldownMinutes: 30,
};

describe('Admin chat channel API', () => {
  const identity: { current: GoogleIdentity | null } = { current: null };
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let fake: Awaited<ReturnType<typeof startFakeChat>>;
  let admin: TestAgent;
  let user: TestAgent;

  beforeAll(async () => {
    fake = await startFakeChat();
    app = await createTestApp(identity, { chatFetch: fake.fetch });
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE users CASCADE');
    await dataSource.query(
      `UPDATE chat_channel_settings SET enabled = false, webhook_url = NULL,
         max_per_hour = 10, seller_cooldown_minutes = 30, updated_by = NULL WHERE id = 1`,
    );
    for (const type of CHAT_TEMPLATE_TYPES) {
      await dataSource.query(
        'UPDATE chat_templates SET enabled = $2, template = $3 WHERE event_type = $1',
        [type, type !== 'listing.published', DEFAULT_TEMPLATES[type]],
      );
    }
    await dataSource.query('DELETE FROM chat_deliveries');
    fake.received.length = 0;
    fake.respondWith(200);
    admin = await signIn(app, identity, 'admin');
    user = await signIn(app, identity, 'user');
  });

  afterAll(async () => {
    await app.close();
    await fake.close();
  });

  const webhookInDb = async (): Promise<string | null> =>
    (
      (await dataSource.query(
        'SELECT webhook_url FROM chat_channel_settings WHERE id = 1',
      )) as { webhook_url: string | null }[]
    )[0].webhook_url;

  it('answers 401 signed out and 403 for a non-admin on every route', async () => {
    const anonymous = (await import('supertest')).default(app.getHttpServer());
    const routes: [string, string][] = [
      ['get', BASE],
      ['put', BASE],
      ['put', `${BASE}/templates/campaign.opened`],
      ['post', `${BASE}/templates/campaign.opened/preview`],
      ['post', `${BASE}/templates/campaign.opened/test`],
      ['get', `${BASE}/deliveries`],
    ];
    for (const [method, path] of routes) {
      const call = (agent: { [k: string]: unknown }) =>
        (agent[method] as (p: string) => Promise<{ status: number }>)(path);
      expect((await call(anonymous as never)).status).toBe(401);
      expect((await call(user as never)).status).toBe(403);
    }
  });

  it('returns the defaults without any webhook', async () => {
    const response = await admin.get(BASE).expect(200);
    expect(response.body).toMatchObject({
      enabled: false,
      hasWebhook: false,
      webhookHint: null,
      maxPerHour: 10,
      sellerCooldownMinutes: 30,
    });
    expect(
      response.body.templates.map((t: { eventType: string }) => t.eventType),
    ).toEqual([...CHAT_TEMPLATE_TYPES]);
    expect(response.body.templates).toHaveLength(4);
    expect(JSON.stringify(response.body)).not.toContain('webhookUrl');
    expect(JSON.stringify(response.body)).not.toContain('googleapis');
  });

  it('stores, keeps and removes the webhook', async () => {
    const saved = await admin
      .put(BASE)
      .send({ ...valid, webhookUrl: WEBHOOK })
      .expect(200);
    expect(saved.body.hasWebhook).toBe(true);
    expect(saved.body.webhookHint).toBe('wxyz');
    expect(JSON.stringify(saved.body)).not.toContain('googleapis');
    expect(await webhookInDb()).toBe(WEBHOOK);

    await admin
      .put(BASE)
      .send({ ...valid, enabled: true })
      .expect(200);
    expect(await webhookInDb()).toBe(WEBHOOK);

    const removed = await admin
      .put(BASE)
      .send({ ...valid, webhookUrl: null })
      .expect(200);
    expect(removed.body.hasWebhook).toBe(false);
    expect(await webhookInDb()).toBeNull();
  });

  it('rejects invalid settings with 422 INVALID_CHAT_SETTINGS', async () => {
    const enabledWithout = await admin
      .put(BASE)
      .send({ ...valid, enabled: true, webhookUrl: null })
      .expect(422);
    expect(enabledWithout.body.code).toBe('INVALID_CHAT_SETTINGS');
    expect(enabledWithout.body.details.problems).toHaveLength(1);

    const noLimit = await admin
      .put(BASE)
      .send({ ...valid, maxPerHour: null })
      .expect(200);
    expect(noLimit.body.maxPerHour).toBeNull();

    await admin
      .put(BASE)
      .send({ ...valid, maxPerHour: 61 })
      .expect(422);
    await admin
      .put(BASE)
      .send({ ...valid, webhookUrl: 'http://chat.googleapis.com/v1/spaces/x' })
      .expect(422);
  });

  it('validates and saves templates', async () => {
    const bad = await admin
      .put(`${BASE}/templates/campaign.opened`)
      .send({ enabled: true, template: 'hi {{foo}}' })
      .expect(422);
    expect(bad.body.code).toBe('INVALID_CHAT_TEMPLATE');
    expect(bad.body.details.unknownVariables).toEqual(['foo']);

    const ok = await admin
      .put(`${BASE}/templates/campaign.opened`)
      .send({ enabled: false, template: 'mở {{campaignTitle}}' })
      .expect(200);
    expect(ok.body).toMatchObject({
      eventType: 'campaign.opened',
      enabled: false,
      template: 'mở {{campaignTitle}}',
    });

    await admin
      .put(`${BASE}/templates/nope`)
      .send({ enabled: true, template: 'x' })
      .expect(404);
  });

  it('previews a template with sample values', async () => {
    const response = await admin
      .post(`${BASE}/templates/campaign.opened/preview`)
      .send({ template: '{{sellerName}}: {{campaignTitle}}' })
      .expect(200);
    expect(response.body.message).toBe('Nguyễn Văn An: Bánh trung thu Kinh Đô');
    await admin
      .post(`${BASE}/templates/nope/preview`)
      .send({ template: 'x' })
      .expect(404);
    await admin
      .post(`${BASE}/templates/campaign.opened/preview`)
      .send({ template: '{{foo}}' })
      .expect(422);
  });

  describe('test message', () => {
    it('answers 409 without a webhook', async () => {
      const response = await admin
        .post(`${BASE}/templates/campaign.opened/test`)
        .send({})
        .expect(409);
      expect(response.body.code).toBe('CHAT_WEBHOOK_NOT_SET');
    });

    it('sends to the webhook and records a test row', async () => {
      await admin
        .put(BASE)
        .send({ ...valid, webhookUrl: WEBHOOK })
        .expect(200);
      const response = await admin
        .post(`${BASE}/templates/campaign.opened/test`)
        .send({ template: 'Chào {{sellerName}}' })
        .expect(200);
      expect(response.body.message).toBe('[Thử] Chào Nguyễn Văn An');
      expect(fake.received).toHaveLength(1);
      expect(fake.received[0].text).toBe('[Thử] Chào Nguyễn Văn An');
      expect(fake.received[0].path).toMatch(/^\/v1\/spaces\/AAAA\/messages/);
      const rows = (await dataSource.query(
        'SELECT outcome, event_id, seller_id FROM chat_deliveries',
      )) as {
        outcome: string;
        event_id: string | null;
        seller_id: string | null;
      }[];
      expect(rows).toEqual([
        { outcome: 'test', event_id: null, seller_id: null },
      ]);
    });

    it('answers 502 and records a failed row when Google refuses', async () => {
      await admin
        .put(BASE)
        .send({ ...valid, webhookUrl: WEBHOOK })
        .expect(200);
      fake.respondWith(400);
      const response = await admin
        .post(`${BASE}/templates/campaign.opened/test`)
        .send({})
        .expect(502);
      expect(response.body.code).toBe('CHAT_SEND_FAILED');
      expect(response.body.details.error).toContain('HTTP 400');
      expect(JSON.stringify(response.body)).not.toContain('token=wxyz');
      const rows = (await dataSource.query(
        'SELECT outcome, error FROM chat_deliveries',
      )) as { outcome: string; error: string }[];
      expect(rows).toHaveLength(1);
      expect(rows[0].outcome).toBe('failed');
      expect(rows[0].error).toContain('HTTP 400');
    });
  });

  it('pages deliveries 50 at a time, newest first', async () => {
    await dataSource.query(
      `INSERT INTO chat_deliveries (event_type, outcome, message, created_at)
       SELECT 'campaign.opened', 'sent', 'm' || g, now() - (g || ' seconds')::interval
       FROM generate_series(1, 55) g`,
    );
    const first = await admin.get(`${BASE}/deliveries`).expect(200);
    expect(first.body.items).toHaveLength(50);
    expect(first.body.items[0].message).toBe('m1');
    expect(first.body.items[0].digest).toBeNull();
    expect(first.body.nextCursor).not.toBeNull();
    const second = await admin
      .get(`${BASE}/deliveries`)
      .query({ cursor: first.body.nextCursor })
      .expect(200);
    expect(second.body.items).toHaveLength(5);
    expect(second.body.items[0].message).toBe('m51');
    expect(second.body.nextCursor).toBeNull();
  });

  it('returns every delivery exactly once when rows share a timestamp at a page boundary', async () => {
    await dataSource.query(
      `INSERT INTO chat_deliveries (event_type, outcome, message, created_at)
       SELECT 'campaign.opened', 'sent', 'm' || g,
              CASE WHEN g IN (50, 51) THEN '2026-01-01T00:00:00.123Z'::timestamptz
                   ELSE '2026-01-01T00:00:00.123Z'::timestamptz + ((100 - g) || ' seconds')::interval END
       FROM generate_series(1, 60) g`,
    );
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const res: {
        body: { items: { id: string }[]; nextCursor: string | null };
      } = await admin
        .get(`${BASE}/deliveries`)
        .query(cursor ? { cursor } : {})
        .expect(200);
      ids.push(...res.body.items.map((i: { id: string }) => i.id));
      cursor = res.body.nextCursor;
    } while (cursor);
    expect(ids).toHaveLength(60);
    expect(new Set(ids).size).toBe(60);
  });
});
