import type { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { migrations } from '../src/database/migrations/index.js';
import { EventsNotifications1760500000000 } from '../src/database/migrations/1760500000000-events-notifications.js';
import { createTestApp } from './utils/create-test-app.js';

const TABLES = [
  'outbox_events',
  'notifications',
  'chat_channel_settings',
  'chat_templates',
  'chat_deliveries',
];

const TEMPLATES: Array<[string, boolean, string]> = [
  [
    'campaign.opened',
    true,
    '🛒 *{{sellerName}}* vừa mở đợt *{{campaignTitle}}* ({{itemCount}} món). Chốt {{deadline}}, giao {{deliveryDate}}. {{url}}',
  ],
  [
    'campaign.reopened',
    true,
    '🔁 *{{sellerName}}* mở lại đợt *{{campaignTitle}}*. Chốt {{deadline}}, giao {{deliveryDate}}. {{url}}',
  ],
  [
    'chat.digest',
    true,
    '📋 *Bảng tin giờ qua* ({{count}} tin chưa gửi):\n{{items}}',
  ],
  [
    'listing.published',
    false,
    '🆕 *{{sellerName}}* đăng *{{listingTitle}}*, giá {{price}}. {{url}}',
  ],
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

  // Keep last: it reverts the migration, then applies it again.
  // Seeded rows are asserted after our own undo + re-run, so they are fresh
  // and not whatever earlier suites left behind (they truncate users).
  it('reverts and re-applies cleanly', async () => {
    expect(migrations.at(-1)).toBe(EventsNotifications1760500000000);
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

    const settings = await dataSource.query(
      'SELECT * FROM chat_channel_settings',
    );
    expect(settings).toHaveLength(1);
    expect(settings[0]).toMatchObject({
      id: 1,
      enabled: false,
      webhook_url: null,
      max_per_hour: 10,
      seller_cooldown_minutes: 30,
    });

    const rows = await dataSource.query(
      'SELECT event_type, enabled, template FROM chat_templates ORDER BY event_type',
    );
    expect(
      rows.map(
        (r: { event_type: string; enabled: boolean; template: string }) => [
          r.event_type,
          r.enabled,
          r.template,
        ],
      ),
    ).toEqual(TEMPLATES);

    const fks = await dataSource.query(
      `SELECT conname FROM pg_constraint WHERE conname LIKE 'FK_chat_%'`,
    );
    expect(fks).toHaveLength(0);
  });
});
