import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Phase 2f: a server-side cart, so it follows the person between devices. */
export class CreateCart1759982400000 implements MigrationInterface {
  name = 'CreateCart1759982400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "cart_lines" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "listing_item_id" uuid NOT NULL,
        "quantity" numeric(10,3) NOT NULL,
        "added_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_cart_lines" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_cart_lines_user_item" UNIQUE ("user_id", "listing_item_id"),
        CONSTRAINT "FK_cart_lines_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_cart_lines_item" FOREIGN KEY ("listing_item_id")
          REFERENCES "listing_items" ("id") ON DELETE CASCADE
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "cart_lines"`);
  }
}
