import { Migration } from '../Migration.js';

export class CreateWebhookInboxEntriesTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('webhook_inbox_entries', (table) => {
      table.string('id').primary();
      table.string('source');
      table.string('event').nullable();
      table.string('tenant_id').nullable();
      table.string('actor_id').nullable();
      table.string('idempotency_key');
      table.string('digest');
      table.string('status');
      table.text('headers');
      table.text('raw_body');
      table.text('payload').nullable();
      table.text('metadata').nullable();
      table.integer('attempts');
      table.bigInteger('available_at').nullable();
      table.bigInteger('processed_at').nullable();
      table.text('error').nullable();
      table.bigInteger('created_at');
      table.bigInteger('updated_at');
      table.uniqueIndex(['source', 'idempotency_key'], 'idx_webhook_inbox_source_idempotency');
      table.index('source');
      table.index('status');
      table.index('created_at');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('webhook_inbox_entries');
  }
}
