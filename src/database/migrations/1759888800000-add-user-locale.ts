import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserLocale1759888800000 implements MigrationInterface {
  name = 'AddUserLocale1759888800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "locale" varchar(2) NOT NULL DEFAULT 'vi',
        ADD CONSTRAINT "CK_users_locale" CHECK ("locale" IN ('vi', 'en'))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP CONSTRAINT "CK_users_locale",
        DROP COLUMN "locale"
    `);
  }
}
