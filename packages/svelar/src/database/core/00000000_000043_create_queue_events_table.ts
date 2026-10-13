import { Migration } from '../Migration.js';

export class CreateQueueEventsTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('svelar_queue_events', table => {
      table.string('id', 64).primary();
      table.string('queue_connection', 128);
      table.string('queue');
      table.string('job_id');
      table.string('source', 16);
      table.string('event', 32);
      table.bigInteger('occurred_at');
      table.text('data').nullable();
      table.index(['queue_connection', 'queue', 'source', 'job_id', 'occurred_at'], 'idx_queue_events_job');
      table.index(['queue_connection', 'queue', 'event', 'occurred_at'], 'idx_queue_events_metrics');
    });
  }
  async down(): Promise<void> { await this.schema.dropTableIfExists('svelar_queue_events'); }
}
