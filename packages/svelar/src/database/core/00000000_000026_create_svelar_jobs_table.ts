import { Migration } from '../Migration.js';

export class CreateSvelarJobsTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('svelar_jobs', (table) => {
      table.string('id').primary();
      table.string('queue');
      table.text('payload');
      table.integer('attempts');
      table.integer('max_attempts');
      table.integer('reserved_at').nullable();
      table.integer('available_at');
      table.integer('created_at');
      table.index('queue');
      table.index('reserved_at');
      table.index('available_at');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('svelar_jobs');
  }
}
