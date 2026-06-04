import { Migration } from '../Migration.js';

export class CreateApiKeysTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('api_keys', (table) => {
      table.string('id').primary();
      table.string('user_id');
      table.string('name');
      table.string('key').unique();
      table.string('prefix');
      table.bigInteger('last_used_at').nullable();
      table.bigInteger('expires_at').nullable();
      table.text('permissions').nullable();
      table.text('metadata').nullable();
      table.bigInteger('created_at');
      table.bigInteger('revoked_at').nullable();
      table.index('user_id');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('api_keys');
  }
}
