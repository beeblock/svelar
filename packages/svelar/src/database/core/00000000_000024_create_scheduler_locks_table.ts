import { Migration } from '../Migration.js';

export class CreateSchedulerLocksTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('scheduler_locks', (table) => {
      table.string('task_key').primary();
      table.string('owner');
      table.timestamp('expires_at');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('scheduler_locks');
  }
}
