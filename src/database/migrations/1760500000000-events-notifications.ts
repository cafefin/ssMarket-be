import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 3a: the transactional outbox, in-app notifications and the Google
 * Chat channel (settings, message templates, delivery log). The default
 * templates are written out here on purpose: a migration must not change when
 * application code does.
 */
export class EventsNotifications1760500000000 implements MigrationInterface {
  name = 'EventsNotifications1760500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "outbox_events" (
        "id" uuid NOT NULL,
        "type" varchar(60) NOT NULL,
        "payload" jsonb NOT NULL,
        "occurred_at" timestamptz NOT NULL,
        "published_at" timestamptz,
        "attempts" smallint NOT NULL DEFAULT 0,
        CONSTRAINT "PK_outbox_events" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_outbox_unpublished" ON "outbox_events" ("occurred_at", "id")
        WHERE "published_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_outbox_published_at" ON "outbox_events" ("published_at")
        WHERE "published_at" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "notifications" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "recipient_id" uuid NOT NULL,
        "event_id" uuid NOT NULL,
        "type" varchar(60) NOT NULL,
        "params" jsonb NOT NULL,
        "order_id" uuid,
        "read_at" timestamptz,
        "created_at" timestamptz NOT NULL,
        CONSTRAINT "PK_notifications" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_notifications_event_recipient" UNIQUE ("event_id", "recipient_id"),
        CONSTRAINT "FK_notifications_recipient" FOREIGN KEY ("recipient_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_notifications_recipient_created"
        ON "notifications" ("recipient_id", "created_at" DESC, "id" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_notifications_unread"
        ON "notifications" ("recipient_id") WHERE "read_at" IS NULL
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_notifications_created_at" ON "notifications" ("created_at")`,
    );

    // updated_by has no foreign key on purpose, like chat_deliveries.seller_id:
    // a foreign key to users would let TRUNCATE users CASCADE empty these
    // seeded config tables, and the record of who changed a setting outlives
    // the person.
    await queryRunner.query(`
      CREATE TABLE "chat_channel_settings" (
        "id" smallint NOT NULL,
        "enabled" boolean NOT NULL DEFAULT false,
        "webhook_url" text,
        "max_per_hour" smallint DEFAULT 10,
        "seller_cooldown_minutes" smallint NOT NULL DEFAULT 30,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "updated_by" uuid,
        CONSTRAINT "PK_chat_channel_settings" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_chat_settings_single" CHECK ("id" = 1),
        CONSTRAINT "CHK_chat_settings_max" CHECK ("max_per_hour" IS NULL OR "max_per_hour" BETWEEN 1 AND 60),
        CONSTRAINT "CHK_chat_settings_cooldown" CHECK ("seller_cooldown_minutes" BETWEEN 0 AND 1440)
      )
    `);
    await queryRunner.query(
      `INSERT INTO "chat_channel_settings" ("id") VALUES (1)`,
    );

    await queryRunner.query(`
      CREATE TABLE "chat_templates" (
        "event_type" varchar(60) NOT NULL,
        "enabled" boolean NOT NULL,
        "template" varchar(1000) NOT NULL,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "updated_by" uuid,
        CONSTRAINT "PK_chat_templates" PRIMARY KEY ("event_type")
      )
    `);
    await queryRunner.query(
      `INSERT INTO "chat_templates" ("event_type", "enabled", "template")
       VALUES ($1, $2, $3), ($4, $5, $6), ($7, $8, $9), ($10, $11, $12)`,
      [
        'campaign.opened',
        true,
        '🛒 *{{sellerName}}* vừa mở đợt *{{campaignTitle}}* ({{itemCount}} món). Chốt {{deadline}}, giao {{deliveryDate}}. {{url}}',
        'campaign.reopened',
        true,
        '🔁 *{{sellerName}}* mở lại đợt *{{campaignTitle}}*. Chốt {{deadline}}, giao {{deliveryDate}}. {{url}}',
        'listing.published',
        false,
        '🆕 *{{sellerName}}* đăng *{{listingTitle}}*, giá {{price}}. {{url}}',
        'chat.digest',
        true,
        '📋 *Bảng tin giờ qua* ({{count}} tin chưa gửi):\n{{items}}',
      ],
    );

    await queryRunner.query(`
      CREATE TYPE "chat_outcome" AS ENUM
        ('sent', 'rate_limited_global', 'rate_limited_seller', 'failed', 'test', 'digest')
    `);
    // seller_id has no foreign key on purpose: the log outlives people.
    await queryRunner.query(`
      CREATE TABLE "chat_deliveries" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "event_id" uuid,
        "event_type" varchar(60) NOT NULL,
        "seller_id" uuid,
        "outcome" "chat_outcome" NOT NULL,
        "message" text,
        "error" text,
        "digested_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_chat_deliveries" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_chat_deliveries_event" ON "chat_deliveries" ("event_id")
        WHERE "event_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_chat_deliveries_held" ON "chat_deliveries" ("created_at")
        WHERE "outcome" IN ('rate_limited_global', 'rate_limited_seller') AND "digested_at" IS NULL
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_chat_deliveries_created" ON "chat_deliveries" ("created_at" DESC, "id" DESC)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "chat_deliveries"`);
    await queryRunner.query(`DROP TYPE "chat_outcome"`);
    await queryRunner.query(`DROP TABLE "chat_templates"`);
    await queryRunner.query(`DROP TABLE "chat_channel_settings"`);
    await queryRunner.query(`DROP TABLE "notifications"`);
    await queryRunner.query(`DROP TABLE "outbox_events"`);
  }
}
