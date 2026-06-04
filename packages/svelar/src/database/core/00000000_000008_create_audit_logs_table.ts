import { Migration } from '../Migration.js';

export class CreateAuditLogsTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('audit_logs', (table) => {
      table.string('id').primary();
      table.string('user_id').nullable();
      table.string('action');
      table.string('model_type');
      table.string('model_id');
      table.text('old_values').nullable();
      table.text('new_values').nullable();
      table.text('metadata').nullable();
      table.string('ip_address').nullable();
      table.string('user_agent').nullable();
      table.bigInteger('timestamp');
      table.index(['model_type', 'model_id']);
      table.index('user_id');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('audit_logs');
  }
}
