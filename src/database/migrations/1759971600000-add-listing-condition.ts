import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 2f: second-hand goods carry a condition level, and categories say
 * whether their goods are perishable (food has no condition).
 */
export class AddListingCondition1759971600000 implements MigrationInterface {
  name = 'AddListingCondition1759971600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "listings_condition_enum" AS ENUM
        ('new', 'like_new', 'excellent', 'good', 'fair', 'worn')
    `);
    await queryRunner.query(`
      ALTER TABLE "listings"
        ADD COLUMN "condition" "listings_condition_enum",
        ADD COLUMN "condition_percent" smallint
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_listings_condition_percent" ON "listings" ("condition_percent")`,
    );
    await queryRunner.query(`
      ALTER TABLE "categories"
        ADD COLUMN "is_perishable" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      UPDATE "categories" SET "is_perishable" = true
       WHERE "slug" IN ('thuc-pham-tuoi', 'do-an')
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "categories" DROP COLUMN "is_perishable"`,
    );
    await queryRunner.query(`DROP INDEX "IDX_listings_condition_percent"`);
    await queryRunner.query(`
      ALTER TABLE "listings"
        DROP COLUMN "condition_percent",
        DROP COLUMN "condition"
    `);
    await queryRunner.query(`DROP TYPE "listings_condition_enum"`);
  }
}
