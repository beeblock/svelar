import { Migration } from '../Migration.js';

export class CreateSessionsTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('sessions', (table) => {
      table.string('id').primary();
      table.text('payload');
      table.timestamp('expires_at');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('sessions');
  }
}
