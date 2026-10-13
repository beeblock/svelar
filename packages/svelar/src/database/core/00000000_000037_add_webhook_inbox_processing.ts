import { Migration } from '../Migration.js';
import { Connection } from '../Connection.js';

export class AddWebhookInboxProcessing extends Migration {
  async up(): Promise<void> {
    await this.schema.table('webhook_inbox_entries', (table) => {
      table.boolean('managed').default(false);
      table.string('ordering_key', 64).nullable();
      table.bigInteger('event_version').nullable();
      table.string('lock_owner', 64).nullable();
      table.bigInteger('locked_until').nullable();
      table.string('raw_body_encoding', 16).default('utf8');
      table.index(['ordering_key', 'created_at', 'id'], 'idx_webhook_inbox_processing_order');
      table.index(['managed', 'source', 'status'], 'idx_webhook_inbox_processing_status');
      if (Connection.getDriver() === 'mysql') {
        table.longText('raw_body').notNullable().dropDefault().change({ replaceDefinition: true });
        table.longText('payload').nullable().dropDefault().change({ replaceDefinition: true });
      }
    });
  }
  async down(): Promise<void> {
    await this.schema.table('webhook_inbox_entries', (table) => {
      table.dropIndex('idx_webhook_inbox_processing_order');
      table.dropIndex('idx_webhook_inbox_processing_status');
      for (const column of ['managed', 'ordering_key', 'event_version', 'lock_owner', 'locked_until', 'raw_body_encoding']) table.dropColumn(column);
    });
  }
}
