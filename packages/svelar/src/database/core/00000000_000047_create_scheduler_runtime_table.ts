import { Migration } from '../Migration.js';

export class CreateSchedulerRuntimeTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('scheduler_runtime', (table) => {
      table.string('runtime_key').primary();
      table.string('kind');
      table.string('task_name').nullable();
      table.string('tenant_id').nullable();
      table.string('state');
      table.string('owner').nullable();
      table.bigInteger('lease_until').nullable();
      table.bigInteger('heartbeat_at');
      table.bigInteger('started_at').nullable();
      table.bigInteger('last_checked_at').nullable();
      table.bigInteger('last_run_at').nullable();
      table.bigInteger('next_run_at').nullable();
      table.bigInteger('last_tick_at').nullable();
      table.bigInteger('last_success_at').nullable();
      table.bigInteger('last_error_at').nullable();
      table.integer('last_duration').nullable();
      table.text('last_error').nullable();
      table.integer('failures').default(0);
      table.index(['tenant_id', 'kind'], 'idx_scheduler_runtime_scope');
    });
  }

  async down(): Promise<void> { await this.schema.dropTableIfExists('scheduler_runtime'); }
}
