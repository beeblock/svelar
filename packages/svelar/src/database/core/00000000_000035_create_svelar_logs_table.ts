import { Migration } from '../Migration.js';

export class CreateSvelarLogsTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('svelar_logs', (table) => {
      table.increments('id');
      table.timestamp('recorded_at');
      table.string('level', 16);
      table.string('channel');
      table.text('message');
      table.text('context');
      table.string('correlation_id').nullable();
      table.string('tenant_id').nullable();
      table.index('recorded_at');
      table.index(['level', 'id']);
      table.index(['correlation_id', 'id']);
      table.index(['tenant_id', 'id']);
    });
  }
  async down(): Promise<void> { await this.schema.dropTableIfExists('svelar_logs'); }
}
