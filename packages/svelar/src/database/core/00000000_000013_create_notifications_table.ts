import { Migration } from '../Migration.js';

export class CreateNotificationsTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('notifications', (table) => {
      table.string('id').primary();
      table.string('notifiable_id');
      table.string('type');
      table.text('data');
      table.timestamp('read_at').nullable();
      table.timestamp('created_at');
      table.index('notifiable_id');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('notifications');
  }
}
