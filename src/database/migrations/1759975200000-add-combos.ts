import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 2f: combo prices ("100 pieces for 900,000 đ") on listing options,
 * and the combos and retail total an order line was priced with.
 */
export class AddCombos1759975200000 implements MigrationInterface {
  name = 'AddCombos1759975200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "listing_item_combos" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "listing_item_id" uuid NOT NULL,
        "quantity" numeric(10,3) NOT NULL,
        "price" integer NOT NULL,
        CONSTRAINT "PK_listing_item_combos" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_listing_item_combos_size" UNIQUE ("listing_item_id", "quantity"),
        CONSTRAINT "FK_listing_item_combos_item" FOREIGN KEY ("listing_item_id")
          REFERENCES "listing_items" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "order_lines"
        ADD COLUMN "combos" jsonb NOT NULL DEFAULT '[]',
        ADD COLUMN "list_total" bigint
    `);
    await queryRunner.query(
      `UPDATE "order_lines" SET "list_total" = "line_total"`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_lines" ALTER COLUMN "list_total" SET NOT NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "order_lines"
        DROP COLUMN "list_total",
        DROP COLUMN "combos"
    `);
    await queryRunner.query(`DROP TABLE "listing_item_combos"`);
  }
}
