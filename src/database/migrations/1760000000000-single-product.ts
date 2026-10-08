import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 2g: every listing is one product. Price, unit, stock and combos move
 * from listing_items onto the listing, and the options tables go away.
 *
 * Existing listings, orders and carts were test data and are deleted rather
 * than converted (agreed with the project owner on 2026-10-08). Image files
 * of deleted listings stay on disk until the upload directory is cleared.
 */
export class SingleProduct1760000000000 implements MigrationInterface {
  name = 'SingleProduct1760000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      TRUNCATE "cart_lines", "order_lines", "orders", "listing_images",
               "listing_item_combos", "listing_items", "listings"
    `);

    await queryRunner.query(`
      ALTER TABLE "listings"
        ADD "unit" varchar(16) NOT NULL,
        ADD "unit_price" integer NOT NULL,
        ADD "stock_quantity" numeric(10,3)
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_listings_unit_price" ON "listings" ("unit_price")`,
    );
    await queryRunner.query(`
      CREATE TABLE "listing_combos" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "listing_id" uuid NOT NULL,
        "quantity" numeric(10,3) NOT NULL,
        "price" integer NOT NULL,
        CONSTRAINT "PK_listing_combos" PRIMARY KEY ("id"),
        CONSTRAINT "FK_listing_combos_listing" FOREIGN KEY ("listing_id")
          REFERENCES "listings" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_listing_combos_listing" ON "listing_combos" ("listing_id")`,
    );

    await queryRunner.query(`
      ALTER TABLE "order_lines"
        DROP COLUMN "listing_item_id",
        ALTER COLUMN "listing_id" SET NOT NULL
    `);
    await queryRunner.query(
      `ALTER TABLE "order_lines" RENAME COLUMN "item_name" TO "title"`,
    );

    await queryRunner.query(`
      ALTER TABLE "cart_lines"
        DROP COLUMN "listing_item_id",
        ADD "listing_id" uuid NOT NULL,
        ADD CONSTRAINT "UQ_cart_lines_user_listing" UNIQUE ("user_id", "listing_id"),
        ADD CONSTRAINT "FK_cart_lines_listing" FOREIGN KEY ("listing_id")
          REFERENCES "listings" ("id") ON DELETE CASCADE
    `);

    await queryRunner.query(`DROP TABLE "listing_item_combos"`);
    await queryRunner.query(`DROP TABLE "listing_items"`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Structure only: rows created under the single-product model are lost.
    await queryRunner.query(`
      TRUNCATE "cart_lines", "order_lines", "orders", "listing_images",
               "listing_combos", "listings"
    `);
    await queryRunner.query(`
      CREATE TABLE "listing_items" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "listing_id" uuid NOT NULL,
        "name" varchar(120) NOT NULL,
        "unit" varchar(16) NOT NULL,
        "unit_price" integer NOT NULL,
        "stock_quantity" numeric(10,3),
        "sort_order" smallint NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_listing_items" PRIMARY KEY ("id"),
        CONSTRAINT "FK_listing_items_listing" FOREIGN KEY ("listing_id")
          REFERENCES "listings" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "listing_item_combos" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "listing_item_id" uuid NOT NULL,
        "quantity" numeric(10,3) NOT NULL,
        "price" integer NOT NULL,
        CONSTRAINT "PK_listing_item_combos" PRIMARY KEY ("id"),
        CONSTRAINT "FK_listing_item_combos_item" FOREIGN KEY ("listing_item_id")
          REFERENCES "listing_items" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "cart_lines"
        DROP COLUMN "listing_id",
        ADD "listing_item_id" uuid NOT NULL,
        ADD CONSTRAINT "UQ_cart_lines_user_item" UNIQUE ("user_id", "listing_item_id"),
        ADD CONSTRAINT "FK_cart_lines_item" FOREIGN KEY ("listing_item_id")
          REFERENCES "listing_items" ("id") ON DELETE CASCADE
    `);
    await queryRunner.query(
      `ALTER TABLE "order_lines" RENAME COLUMN "title" TO "item_name"`,
    );
    await queryRunner.query(`
      ALTER TABLE "order_lines"
        ADD "listing_item_id" uuid NOT NULL,
        ADD CONSTRAINT "FK_order_lines_item" FOREIGN KEY ("listing_item_id")
          REFERENCES "listing_items" ("id") ON DELETE RESTRICT
    `);
    await queryRunner.query(`DROP TABLE "listing_combos"`);
    await queryRunner.query(`
      ALTER TABLE "listings"
        DROP COLUMN "unit", DROP COLUMN "unit_price", DROP COLUMN "stock_quantity"
    `);
  }
}
