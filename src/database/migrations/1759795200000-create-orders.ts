import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrders1759795200000 implements MigrationInterface {
  name = 'CreateOrders1759795200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "listing_items" ADD COLUMN "is_active" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `CREATE TYPE "orders_payment_method_enum" AS ENUM ('prepaid_qr', 'pay_on_delivery')`,
    );
    await queryRunner.query(
      `CREATE TYPE "orders_payment_status_enum" AS ENUM ('unpaid', 'reported', 'paid')`,
    );
    await queryRunner.query(
      `CREATE TYPE "orders_fulfillment_status_enum" AS ENUM ('pending', 'delivered', 'cancelled')`,
    );
    await queryRunner.query(
      `CREATE TYPE "orders_cancelled_by_enum" AS ENUM ('buyer', 'seller')`,
    );
    await queryRunner.query(`
      CREATE TABLE "orders" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "code" varchar(9) NOT NULL,
        "listing_id" uuid NOT NULL,
        "buyer_id" uuid NOT NULL,
        "seller_id" uuid NOT NULL,
        "is_preorder" boolean NOT NULL,
        "payment_method" "orders_payment_method_enum" NOT NULL,
        "payment_status" "orders_payment_status_enum" NOT NULL DEFAULT 'unpaid',
        "fulfillment_status" "orders_fulfillment_status_enum" NOT NULL DEFAULT 'pending',
        "total_amount" bigint NOT NULL,
        "delivery_location" varchar(120) NOT NULL,
        "note" varchar(500),
        "seller_bank_bin" varchar(6),
        "seller_bank_account_number" varchar(24),
        "seller_bank_account_name" varchar(120),
        "cancelled_by" "orders_cancelled_by_enum",
        "cancel_reason" varchar(300),
        "refund_needed" boolean NOT NULL DEFAULT false,
        "reported_at" timestamptz,
        "paid_at" timestamptz,
        "delivered_at" timestamptz,
        "cancelled_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_orders_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_orders_code" UNIQUE ("code"),
        CONSTRAINT "FK_orders_listing" FOREIGN KEY ("listing_id") REFERENCES "listings" ("id"),
        CONSTRAINT "FK_orders_buyer" FOREIGN KEY ("buyer_id") REFERENCES "users" ("id"),
        CONSTRAINT "FK_orders_seller" FOREIGN KEY ("seller_id") REFERENCES "users" ("id"),
        CONSTRAINT "CK_orders_total" CHECK ("total_amount" >= 0),
        CONSTRAINT "CK_orders_bank_snapshot" CHECK (
          ("seller_bank_bin" IS NULL AND "seller_bank_account_number" IS NULL AND "seller_bank_account_name" IS NULL)
          OR
          ("seller_bank_bin" IS NOT NULL AND "seller_bank_account_number" IS NOT NULL AND "seller_bank_account_name" IS NOT NULL)
        )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_orders_buyer_created" ON "orders" ("buyer_id", "created_at" DESC, "id" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_orders_seller_created" ON "orders" ("seller_id", "created_at" DESC, "id" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_orders_listing" ON "orders" ("listing_id")`,
    );
    // One live order per buyer per pre-order round, like one row per person
    // in the spreadsheet this replaces.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_orders_one_active_preorder"
        ON "orders" ("listing_id", "buyer_id")
        WHERE "is_preorder" AND "fulfillment_status" <> 'cancelled'
    `);
    await queryRunner.query(`
      CREATE TABLE "order_lines" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "order_id" uuid NOT NULL,
        "listing_item_id" uuid NOT NULL,
        "item_name" varchar(120) NOT NULL,
        "unit" varchar(16) NOT NULL,
        "unit_price" integer NOT NULL,
        "quantity" numeric(10,3) NOT NULL,
        "line_total" bigint NOT NULL,
        "sort_order" smallint NOT NULL,
        CONSTRAINT "PK_order_lines_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_order_lines_order" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_order_lines_item" FOREIGN KEY ("listing_item_id") REFERENCES "listing_items" ("id") ON DELETE RESTRICT,
        CONSTRAINT "CK_order_lines_quantity" CHECK ("quantity" > 0),
        CONSTRAINT "CK_order_lines_total" CHECK ("line_total" >= 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_order_lines_order" ON "order_lines" ("order_id", "sort_order")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_order_lines_item" ON "order_lines" ("listing_item_id")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "order_lines"`);
    await queryRunner.query(`DROP TABLE "orders"`);
    await queryRunner.query(`DROP TYPE "orders_cancelled_by_enum"`);
    await queryRunner.query(`DROP TYPE "orders_fulfillment_status_enum"`);
    await queryRunner.query(`DROP TYPE "orders_payment_status_enum"`);
    await queryRunner.query(`DROP TYPE "orders_payment_method_enum"`);
    await queryRunner.query(
      `ALTER TABLE "listing_items" DROP COLUMN "is_active"`,
    );
  }
}
