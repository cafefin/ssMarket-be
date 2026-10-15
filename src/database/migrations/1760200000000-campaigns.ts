import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 2h: a pre-order is a round ("campaign") of products with shared
 * terms. The deadline, delivery date and payment methods move from the
 * listing to `campaigns`; a pre-order listing becomes an item of a round, and
 * a pre-order belongs to the round rather than to one listing.
 *
 * Existing listings, orders and carts were test data and are deleted rather
 * than converted. Image files of deleted listings stay on disk until the
 * upload directory is cleared.
 */
export class Campaigns1760200000000 implements MigrationInterface {
  name = 'Campaigns1760200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Test data, deleted rather than converted (agreed with the project owner on 2026-10-12).
    await queryRunner.query(`
      TRUNCATE "cart_lines", "order_lines", "orders", "listing_images",
               "listing_combos", "listings"
    `);
    await queryRunner.query(
      `CREATE TYPE "campaigns_status_enum" AS ENUM ('draft', 'open', 'closed')`,
    );
    await queryRunner.query(`
      CREATE TABLE "campaigns" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "seller_id" uuid NOT NULL,
        "category_id" smallint NOT NULL,
        "title" varchar(120) NOT NULL,
        "description" text NOT NULL DEFAULT '',
        "order_deadline" timestamptz NOT NULL,
        "delivery_date" date NOT NULL,
        "accepts_prepaid_qr" boolean NOT NULL,
        "accepts_pay_on_delivery" boolean NOT NULL,
        "status" "campaigns_status_enum" NOT NULL DEFAULT 'draft',
        "reopened_from_id" uuid,
        "search_text" text NOT NULL DEFAULT '',
        "search_vector" tsvector GENERATED ALWAYS AS (to_tsvector('simple', "search_text")) STORED,
        "published_at" timestamptz,
        "closed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_campaigns_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_campaigns_seller" FOREIGN KEY ("seller_id") REFERENCES "users" ("id"),
        CONSTRAINT "FK_campaigns_category" FOREIGN KEY ("category_id") REFERENCES "categories" ("id"),
        CONSTRAINT "FK_campaigns_reopened_from" FOREIGN KEY ("reopened_from_id")
          REFERENCES "campaigns" ("id") ON DELETE SET NULL,
        CONSTRAINT "CK_campaigns_payment_method" CHECK ("accepts_prepaid_qr" OR "accepts_pay_on_delivery")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_campaigns_status_deadline" ON "campaigns" ("status", "order_deadline", "id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_campaigns_seller_created" ON "campaigns" ("seller_id", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_campaigns_category" ON "campaigns" ("category_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_campaigns_search" ON "campaigns" USING GIN ("search_vector")`,
    );

    await queryRunner.query(`DROP INDEX "IDX_listings_open_deadline"`);
    await queryRunner.query(`
      ALTER TABLE "listings"
        DROP CONSTRAINT "CK_listings_mode_dates",
        DROP CONSTRAINT "CK_listings_payment_method",
        DROP CONSTRAINT "FK_listings_reopened_from",
        DROP COLUMN "order_deadline",
        DROP COLUMN "delivery_date",
        DROP COLUMN "reopened_from_id",
        ALTER COLUMN "accepts_prepaid_qr" DROP NOT NULL,
        ALTER COLUMN "accepts_pay_on_delivery" DROP NOT NULL,
        ADD "campaign_id" uuid,
        ADD "sort_order" smallint NOT NULL DEFAULT 0,
        ADD CONSTRAINT "FK_listings_campaign" FOREIGN KEY ("campaign_id")
          REFERENCES "campaigns" ("id") ON DELETE CASCADE,
        ADD CONSTRAINT "CK_listings_mode_campaign"
          CHECK (("mode" = 'preorder') = ("campaign_id" IS NOT NULL)),
        ADD CONSTRAINT "CK_listings_payment_terms" CHECK (
          ("campaign_id" IS NULL AND "accepts_prepaid_qr" IS NOT NULL
             AND "accepts_pay_on_delivery" IS NOT NULL
             AND ("accepts_prepaid_qr" OR "accepts_pay_on_delivery"))
          OR
          ("campaign_id" IS NOT NULL AND "accepts_prepaid_qr" IS NULL
             AND "accepts_pay_on_delivery" IS NULL)
        )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_listings_campaign" ON "listings" ("campaign_id", "sort_order")`,
    );

    await queryRunner.query(`DROP INDEX "UQ_orders_one_active_preorder"`);
    await queryRunner.query(`DROP INDEX "IDX_orders_listing"`);
    await queryRunner.query(`
      ALTER TABLE "orders"
        DROP CONSTRAINT "FK_orders_listing",
        DROP COLUMN "listing_id",
        ADD "campaign_id" uuid,
        ADD CONSTRAINT "FK_orders_campaign" FOREIGN KEY ("campaign_id") REFERENCES "campaigns" ("id"),
        ADD CONSTRAINT "CK_orders_preorder_campaign"
          CHECK ("is_preorder" = ("campaign_id" IS NOT NULL))
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_orders_campaign" ON "orders" ("campaign_id")`,
    );
    // One live order per buyer per round, like one row per person in the
    // spreadsheet this replaces.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_orders_one_active_preorder"
        ON "orders" ("campaign_id", "buyer_id")
        WHERE "is_preorder" AND "fulfillment_status" <> 'cancelled'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Structure only: rows created under the campaign model are lost.
    await queryRunner.query(`
      TRUNCATE "cart_lines", "order_lines", "orders", "listing_images",
               "listing_combos", "listings"
    `);

    await queryRunner.query(`DROP INDEX "UQ_orders_one_active_preorder"`);
    await queryRunner.query(`DROP INDEX "IDX_orders_campaign"`);
    await queryRunner.query(`
      ALTER TABLE "orders"
        DROP CONSTRAINT "CK_orders_preorder_campaign",
        DROP CONSTRAINT "FK_orders_campaign",
        DROP COLUMN "campaign_id",
        ADD "listing_id" uuid,
        ADD CONSTRAINT "FK_orders_listing" FOREIGN KEY ("listing_id") REFERENCES "listings" ("id")
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_orders_listing" ON "orders" ("listing_id")`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_orders_one_active_preorder"
        ON "orders" ("listing_id", "buyer_id")
        WHERE "is_preorder" AND "fulfillment_status" <> 'cancelled'
    `);

    await queryRunner.query(`DROP INDEX "IDX_listings_campaign"`);
    await queryRunner.query(`
      ALTER TABLE "listings"
        DROP CONSTRAINT "CK_listings_payment_terms",
        DROP CONSTRAINT "CK_listings_mode_campaign",
        DROP CONSTRAINT "FK_listings_campaign",
        DROP COLUMN "sort_order",
        DROP COLUMN "campaign_id",
        ALTER COLUMN "accepts_prepaid_qr" SET NOT NULL,
        ALTER COLUMN "accepts_pay_on_delivery" SET NOT NULL,
        ADD "order_deadline" timestamptz,
        ADD "delivery_date" date,
        ADD "reopened_from_id" uuid,
        ADD CONSTRAINT "FK_listings_reopened_from" FOREIGN KEY ("reopened_from_id")
          REFERENCES "listings" ("id") ON DELETE SET NULL,
        ADD CONSTRAINT "CK_listings_mode_dates" CHECK (
          ("mode" = 'in_stock' AND "order_deadline" IS NULL AND "delivery_date" IS NULL)
          OR
          ("mode" = 'preorder' AND "order_deadline" IS NOT NULL AND "delivery_date" IS NOT NULL)
        ),
        ADD CONSTRAINT "CK_listings_payment_method" CHECK ("accepts_prepaid_qr" OR "accepts_pay_on_delivery")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_listings_open_deadline"
        ON "listings" ("order_deadline", "id")
        WHERE "status" = 'open' AND "order_deadline" IS NOT NULL
    `);

    await queryRunner.query(`DROP TABLE "campaigns"`);
    await queryRunner.query(`DROP TYPE "campaigns_status_enum"`);
  }
}
