import { Migration } from '../Migration.js';

export class CreateEmailVerificationsTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('email_verifications', (table) => {
      table.string('user_id');
      table.string('token');
      table.timestamp('expires_at');
      table.timestamp('created_at');
      table.index('user_id');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('email_verifications');
  }
}
