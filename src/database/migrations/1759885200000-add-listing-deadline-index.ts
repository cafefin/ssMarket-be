import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddListingDeadlineIndex1759885200000 implements MigrationInterface {
  name = 'AddListingDeadlineIndex1759885200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX "IDX_listings_open_deadline"
        ON "listings" ("order_deadline", "id")
        WHERE "status" = 'open' AND "order_deadline" IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_listings_open_deadline"`);
  }
}
