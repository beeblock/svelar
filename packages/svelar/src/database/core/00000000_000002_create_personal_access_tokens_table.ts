import { Migration } from '../Migration.js';

export class CreatePersonalAccessTokensTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('personal_access_tokens', (table) => {
      table.string('user_id');
      table.string('name');
      table.string('token');
      table.timestamp('created_at');
      table.index('token');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('personal_access_tokens');
  }
}
