import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserProfile1759708800000 implements MigrationInterface {
  name = 'AddUserProfile1759708800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "delivery_location" varchar(120),
        ADD COLUMN "bank_bin" varchar(6),
        ADD COLUMN "bank_account_number" varchar(24),
        ADD COLUMN "bank_account_name" varchar(120),
        ADD CONSTRAINT "CK_users_bank_all_or_none" CHECK (
          ("bank_bin" IS NULL AND "bank_account_number" IS NULL AND "bank_account_name" IS NULL)
          OR
          ("bank_bin" IS NOT NULL AND "bank_account_number" IS NOT NULL AND "bank_account_name" IS NOT NULL)
        )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP CONSTRAINT "CK_users_bank_all_or_none",
        DROP COLUMN "bank_account_name",
        DROP COLUMN "bank_account_number",
        DROP COLUMN "bank_bin",
        DROP COLUMN "delivery_location"
    `);
  }
}
