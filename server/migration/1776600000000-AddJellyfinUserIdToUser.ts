import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddJellyfinUserIdToUser1776600000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" ADD COLUMN "jellyfinUserId" varchar`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "jellyfinUserId"`);
  }
}
