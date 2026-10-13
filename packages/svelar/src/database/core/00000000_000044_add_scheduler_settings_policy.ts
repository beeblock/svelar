import { QueryBuilder } from '../../orm/QueryBuilder.js';
import { Migration } from '../Migration.js';

export class AddSchedulerSettingsPolicy extends Migration {
  async up(): Promise<void> {
    await this.schema.table('scheduled_task_settings', (table) => {
      table.string('task_name').nullable();
      table.string('tenant_id').nullable();
      table.string('timezone').nullable();
      table.string('missed_run_policy').nullable();
      table.integer('catch_up_minutes').default(60);
      table.integer('max_catch_up_runs').default(10);
      table.index('tenant_id', 'idx_scheduled_settings_tenant');
    });
    await new QueryBuilder<{ task: string }>('scheduled_task_settings').select('task').chunkById(500, async (rows) => {
      for (const row of rows) await new QueryBuilder('scheduled_task_settings').where('task', row.task).update({ task_name: row.task });
    }, 'task');
  }

  async down(): Promise<void> {
    if (await new QueryBuilder('scheduled_task_settings').whereNotNull('tenant_id').first()) {
      throw new Error('Remove tenant scheduler settings before rolling back scoped scheduler policy.');
    }
    await this.schema.table('scheduled_task_settings', (table) => {
      table.dropIndex('idx_scheduled_settings_tenant');
      for (const field of ['max_catch_up_runs', 'catch_up_minutes', 'missed_run_policy', 'timezone', 'tenant_id', 'task_name']) table.dropColumn(field);
    });
  }
}
