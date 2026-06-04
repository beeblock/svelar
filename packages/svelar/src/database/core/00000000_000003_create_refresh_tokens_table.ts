import { Migration } from '../Migration.js';

export class CreateRefreshTokensTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('refresh_tokens', (table) => {
      table.string('user_id');
      table.string('token').unique();
      table.timestamp('expires_at');
      table.timestamp('created_at');
      table.timestamp('revoked_at').nullable();
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('refresh_tokens');
  }
}
