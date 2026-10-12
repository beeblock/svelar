import { Migration } from '../Migration.js';

export class CreateScheduledTaskSettingsTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('scheduled_task_settings', (table) => {
      table.string('task').primary();
      table.boolean('enabled');
      table.timestamp('updated_at');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('scheduled_task_settings');
  }
}
