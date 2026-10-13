import { Migration } from '../Migration.js';

export class AddQueueJobLeases extends Migration {
  async up(): Promise<void> {
    await this.schema.table('svelar_jobs', table => {
      table.string('queue_connection', 128).nullable();
      table.string('reservation_token', 64).nullable();
      table.bigInteger('lease_expires_at').nullable();
      table.bigInteger('completed_at').nullable();
      table.string('replay_id').nullable();
      for (const field of ['metadata_tenant', 'metadata_account', 'metadata_resource', 'metadata_correlation']) {
        table.string(field, 64).nullable();
        table.index(['queue_connection', 'queue', field, 'created_at'], `idx_jobs_${field}`);
      }
      table.index(['queue_connection', 'queue', 'lease_expires_at'], 'idx_jobs_lease');
    });
  }
  async down(): Promise<void> {
    await this.schema.table('svelar_jobs', table => {
      for (const field of ['metadata_tenant', 'metadata_account', 'metadata_resource', 'metadata_correlation']) table.dropIndex(`idx_jobs_${field}`);
      table.dropIndex('idx_jobs_lease');
      for (const field of ['queue_connection', 'reservation_token', 'lease_expires_at', 'completed_at', 'replay_id', 'metadata_tenant', 'metadata_account', 'metadata_resource', 'metadata_correlation']) table.dropColumn(field);
    });
  }
}
