import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCategories1759712400000 implements MigrationInterface {
  name = 'CreateCategories1759712400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "categories" (
        "id" smallint NOT NULL,
        "slug" varchar(40) NOT NULL,
        "name" varchar(80) NOT NULL,
        "sort_order" smallint NOT NULL,
        CONSTRAINT "PK_categories_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_categories_slug" UNIQUE ("slug")
      )
    `);
    await queryRunner.query(`
      INSERT INTO "categories" ("id", "slug", "name", "sort_order") VALUES
        (1, 'do-cu', 'Đồ cũ', 1),
        (2, 'thuc-pham-tuoi', 'Thực phẩm tươi', 2),
        (3, 'do-an', 'Đồ ăn', 3),
        (4, 'dien-tu', 'Điện tử', 4),
        (5, 'gia-dung', 'Gia dụng', 5),
        (6, 'khac', 'Khác', 6)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "categories"`);
  }
}
