import type { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { createTestApp } from './utils/create-test-app.js';

const TABLES = [
  'outbox_events',
  'notifications',
  'chat_channel_settings',
  'chat_templates',
  'chat_deliveries',
];

describe('Events and notifications migration', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;

  const exists = async (table: string): Promise<boolean> => {
    const rows = await dataSource.query(
      `SELECT to_regclass('public.${table}') AS t`,
    );
    return rows[0].t !== null;
  };

  beforeAll(async () => {
    app = await createTestApp({ current: null });
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates the five tables', async () => {
    for (const table of TABLES) {
      expect(await exists(table), table).toBe(true);
    }
  });

  it('seeds one settings row with the defaults', async () => {
    const rows = await dataSource.query('SELECT * FROM chat_channel_settings');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 1,
      enabled: false,
      webhook_url: null,
      max_per_hour: 10,
      seller_cooldown_minutes: 30,
    });
  });

  it('seeds the four default templates', async () => {
    const rows = await dataSource.query(
      'SELECT event_type, enabled, template FROM chat_templates ORDER BY event_type',
    );
    expect(
      rows.map((r: { event_type: string; enabled: boolean }) => [
        r.event_type,
        r.enabled,
      ]),
    ).toEqual([
      ['campaign.opened', true],
      ['campaign.reopened', true],
      ['chat.digest', true],
      ['listing.published', false],
    ]);
    const digest = rows.find(
      (r: { event_type: string }) => r.event_type === 'chat.digest',
    );
    expect(digest.template).toBe(
      '📋 *Bảng tin giờ qua* ({{count}} tin chưa gửi):\n{{items}}',
    );
  });

  // Keep last: it reverts the migration, then applies it again.
  it('reverts and re-applies cleanly', async () => {
    await dataSource.undoLastMigration();
    try {
      for (const table of TABLES) {
        expect(await exists(table), table).toBe(false);
      }
      const types = await dataSource.query(
        `SELECT 1 FROM pg_type WHERE typname = 'chat_outcome'`,
      );
      expect(types).toHaveLength(0);
    } finally {
      await dataSource.runMigrations();
    }
    for (const table of TABLES) {
      expect(await exists(table), table).toBe(true);
    }
  });
});
