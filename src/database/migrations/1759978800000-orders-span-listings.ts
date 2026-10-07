import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 2f: one in-stock order from the cart can hold options of several
 * listings of the same seller. Each line now records its listing; the order
 * keeps listing_id only for pre-orders (one round, one listing).
 */
export class OrdersSpanListings1759978800000 implements MigrationInterface {
  name = 'OrdersSpanListings1759978800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_lines" ADD COLUMN "listing_id" uuid`,
    );
    await queryRunner.query(`
      UPDATE "order_lines" ol SET "listing_id" = o."listing_id"
        FROM "orders" o WHERE o."id" = ol."order_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "order_lines"
        ALTER COLUMN "listing_id" SET NOT NULL,
        ADD CONSTRAINT "FK_order_lines_listing" FOREIGN KEY ("listing_id")
          REFERENCES "listings" ("id")
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_order_lines_listing" ON "order_lines" ("listing_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ALTER COLUMN "listing_id" DROP NOT NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "orders" o SET "listing_id" = (
        SELECT ol."listing_id" FROM "order_lines" ol
         WHERE ol."order_id" = o."id" ORDER BY ol."sort_order" LIMIT 1
      ) WHERE o."listing_id" IS NULL
    `);
    await queryRunner.query(
      `ALTER TABLE "orders" ALTER COLUMN "listing_id" SET NOT NULL`,
    );
    await queryRunner.query(`DROP INDEX "IDX_order_lines_listing"`);
    await queryRunner.query(`
      ALTER TABLE "order_lines"
        DROP CONSTRAINT "FK_order_lines_listing",
        DROP COLUMN "listing_id"
    `);
  }
}
