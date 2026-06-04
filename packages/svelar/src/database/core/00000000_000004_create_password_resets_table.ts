import { Migration } from '../Migration.js';

export class CreatePasswordResetsTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('password_resets', (table) => {
      table.string('email');
      table.string('token');
      table.timestamp('expires_at');
      table.timestamp('created_at');
      table.index('email');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('password_resets');
  }
}
