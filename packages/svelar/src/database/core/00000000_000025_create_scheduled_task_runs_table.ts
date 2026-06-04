import { Migration } from '../Migration.js';

export class CreateScheduledTaskRunsTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('scheduled_task_runs', (table) => {
      table.increments('id');
      table.string('task');
      table.boolean('success');
      table.integer('duration');
      table.text('error').nullable();
      table.timestamp('ran_at');
      table.index('task');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('scheduled_task_runs');
  }
}
