import { Migration } from '../Migration.js';

export class AddFailedQueueReplay extends Migration {
  async up(): Promise<void> {
    await this.schema.table('svelar_failed_jobs', table => {
      table.string('queue_connection', 128).nullable();
      table.string('original_job_id').nullable();
      table.string('replay_token', 64).nullable();
      table.string('replay_job_id').nullable();
      table.bigInteger('replayed_at').nullable();
      for (const field of ['metadata_tenant', 'metadata_account', 'metadata_resource', 'metadata_correlation']) {
        table.string(field, 64).nullable();
        table.index(['queue_connection', 'queue', field, 'failed_at'], `idx_failed_${field}`);
      }
      table.index(['queue_connection', 'queue', 'replayed_at'], 'idx_failed_replay');
    });
  }
  async down(): Promise<void> {
    await this.schema.table('svelar_failed_jobs', table => {
      for (const field of ['metadata_tenant', 'metadata_account', 'metadata_resource', 'metadata_correlation']) table.dropIndex(`idx_failed_${field}`);
      table.dropIndex('idx_failed_replay');
      for (const field of ['queue_connection', 'original_job_id', 'replay_token', 'replay_job_id', 'replayed_at', 'metadata_tenant', 'metadata_account', 'metadata_resource', 'metadata_correlation']) table.dropColumn(field);
    });
  }
}
