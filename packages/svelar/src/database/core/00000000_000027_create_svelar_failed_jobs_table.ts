import { Migration } from '../Migration.js';

export class CreateSvelarFailedJobsTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('svelar_failed_jobs', (table) => {
      table.string('id').primary();
      table.string('queue');
      table.string('job_class');
      table.text('payload');
      table.text('exception');
      table.integer('failed_at');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('svelar_failed_jobs');
  }
}
