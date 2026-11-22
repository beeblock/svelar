import { Migration } from '../Migration.js';

export class AddLogIdempotency extends Migration {
  async up(): Promise<void> {
    await this.schema.table('svelar_logs', (table) => {
      table.string('idempotency_key', 64).nullable();
      table.uniqueIndex('idempotency_key', 'uq_svelar_logs_idempotency_key');
    });
  }

  async down(): Promise<void> {
    await this.schema.table('svelar_logs', (table) => {
      table.dropUnique('uq_svelar_logs_idempotency_key');
      table.dropColumn('idempotency_key');
    });
  }
}
