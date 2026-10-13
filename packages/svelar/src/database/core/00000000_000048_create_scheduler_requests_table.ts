import { QueryBuilder } from '../../orm/QueryBuilder.js';
import { Migration } from '../Migration.js';

export class CreateSchedulerRequestsTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('scheduler_requests', (table) => {
      table.string('id').primary();
      table.string('task_key');
      table.string('task_name');
      table.string('tenant_id').nullable();
      table.string('state');
      table.bigInteger('requested_at');
      table.string('requested_by').nullable();
      table.string('correlation_id').nullable();
      table.string('owner').nullable();
      table.bigInteger('lease_until').nullable();
      table.bigInteger('started_at').nullable();
      table.bigInteger('finished_at').nullable();
      table.integer('attempts').default(0);
      table.text('result').nullable();
      table.text('error').nullable();
      table.index(['task_key', 'state', 'requested_at'], 'idx_scheduler_requests_pending');
    });
  }

  async down(): Promise<void> {
    if (await new QueryBuilder('scheduler_requests').whereIn('state', ['pending', 'running']).first()) {
      throw new Error('Drain or cancel scheduler requests before removing their durable queue.');
    }
    await this.schema.dropTableIfExists('scheduler_requests');
  }
}
