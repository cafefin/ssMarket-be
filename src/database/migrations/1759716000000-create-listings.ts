import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateListings1759716000000 implements MigrationInterface {
  name = 'CreateListings1759716000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "listings_mode_enum" AS ENUM ('in_stock', 'preorder')`,
    );
    await queryRunner.query(
      `CREATE TYPE "listings_status_enum" AS ENUM ('draft', 'open', 'closed')`,
    );
    await queryRunner.query(`
      CREATE TABLE "listings" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "seller_id" uuid NOT NULL,
        "category_id" smallint NOT NULL,
        "title" varchar(120) NOT NULL,
        "description" text NOT NULL DEFAULT '',
        "mode" "listings_mode_enum" NOT NULL,
        "status" "listings_status_enum" NOT NULL DEFAULT 'draft',
        "accepts_prepaid_qr" boolean NOT NULL,
        "accepts_pay_on_delivery" boolean NOT NULL,
        "order_deadline" timestamptz,
        "delivery_date" date,
        "reopened_from_id" uuid,
        "search_text" text NOT NULL DEFAULT '',
        "search_vector" tsvector GENERATED ALWAYS AS (to_tsvector('simple', "search_text")) STORED,
        "published_at" timestamptz,
        "closed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_listings_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_listings_seller" FOREIGN KEY ("seller_id") REFERENCES "users" ("id"),
        CONSTRAINT "FK_listings_category" FOREIGN KEY ("category_id") REFERENCES "categories" ("id"),
        CONSTRAINT "FK_listings_reopened_from" FOREIGN KEY ("reopened_from_id") REFERENCES "listings" ("id") ON DELETE SET NULL,
        CONSTRAINT "CK_listings_mode_dates" CHECK (
          ("mode" = 'in_stock' AND "order_deadline" IS NULL AND "delivery_date" IS NULL)
          OR
          ("mode" = 'preorder' AND "order_deadline" IS NOT NULL AND "delivery_date" IS NOT NULL)
        ),
        CONSTRAINT "CK_listings_payment_method" CHECK ("accepts_prepaid_qr" OR "accepts_pay_on_delivery")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_listings_search" ON "listings" USING GIN ("search_vector")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_listings_status_published" ON "listings" ("status", "published_at" DESC, "id" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_listings_seller_status" ON "listings" ("seller_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_listings_category" ON "listings" ("category_id")`,
    );
    await queryRunner.query(`
      CREATE TABLE "listing_items" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "listing_id" uuid NOT NULL,
        "name" varchar(120) NOT NULL,
        "unit" varchar(16) NOT NULL,
        "unit_price" integer NOT NULL,
        "stock_quantity" numeric(10,3),
        "sort_order" smallint NOT NULL,
        CONSTRAINT "PK_listing_items_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_listing_items_listing" FOREIGN KEY ("listing_id") REFERENCES "listings" ("id") ON DELETE CASCADE,
        CONSTRAINT "CK_listing_items_unit" CHECK ("unit" IN ('cái', 'kg', 'hộp', 'túi', 'chai', 'bó', 'combo')),
        CONSTRAINT "CK_listing_items_price" CHECK ("unit_price" > 0),
        CONSTRAINT "CK_listing_items_stock" CHECK ("stock_quantity" IS NULL OR "stock_quantity" >= 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_listing_items_listing" ON "listing_items" ("listing_id", "sort_order")`,
    );
    await queryRunner.query(`
      CREATE TABLE "listing_images" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "listing_id" uuid NOT NULL,
        "storage_key" varchar(255) NOT NULL,
        "sort_order" smallint NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_listing_images_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_listing_images_listing" FOREIGN KEY ("listing_id") REFERENCES "listings" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_listing_images_listing" ON "listing_images" ("listing_id", "sort_order")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "listing_images"`);
    await queryRunner.query(`DROP TABLE "listing_items"`);
    await queryRunner.query(`DROP TABLE "listings"`);
    await queryRunner.query(`DROP TYPE "listings_status_enum"`);
    await queryRunner.query(`DROP TYPE "listings_mode_enum"`);
  }
}
