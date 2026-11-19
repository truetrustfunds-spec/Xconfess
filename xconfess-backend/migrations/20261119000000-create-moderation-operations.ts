import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateModerationOperations20261119000000
  implements MigrationInterface
{
  name = 'CreateModerationOperations20261119000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('moderation_operations')) return;

    await queryRunner.createTable(
      new Table({
        name: 'moderation_operations',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'type', type: 'varchar', length: '32' },
          { name: 'actor_id', type: 'varchar', length: '64' },
          { name: 'subject_id', type: 'varchar', length: '64', isNullable: true },
          { name: 'scope', type: 'varchar', length: '64', isNullable: true },
          { name: 'status', type: 'varchar', length: '24', default: "'active'" },
          {
            name: 'expires_at',
            type: 'timestamptz',
            isNullable: true,
          },
          { name: 'payload', type: 'jsonb', default: "'{}'::jsonb" },
          {
            name: 'created_at',
            type: 'timestamptz',
            default: 'now()',
          },
          {
            name: 'updated_at',
            type: 'timestamptz',
            default: 'now()',
          },
        ],
      }),
    );
    await queryRunner.createIndex(
      'moderation_operations',
      new TableIndex({
        name: 'IDX_moderation_operations_type_status_created',
        columnNames: ['type', 'status', 'created_at'],
      }),
    );
    await queryRunner.createIndex(
      'moderation_operations',
      new TableIndex({
        name: 'IDX_moderation_operations_subject_scope_expiry',
        columnNames: ['subject_id', 'scope', 'expires_at'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('moderation_operations')) {
      await queryRunner.dropTable('moderation_operations');
    }
  }
}
