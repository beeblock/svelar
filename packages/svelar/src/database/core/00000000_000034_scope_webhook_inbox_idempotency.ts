import { QueryBuilder } from '../../orm/QueryBuilder.js';
import { webhookInboxDeduplicationKey } from '../../webhooks/InboxIdentity.js';
import { Connection } from '../Connection.js';
import { Migration } from '../Migration.js';

const tableName = 'webhook_inbox_entries';
const legacyIndex = 'idx_webhook_inbox_source_idempotency';
const scopedIndex = 'idx_webhook_inbox_deduplication';

interface LegacyInboxScope {
  id: string;
  source: string;
  tenant_id: string | number | null;
  idempotency_key: string;
}

export class ScopeWebhookInboxIdempotency extends Migration {
  async up(): Promise<void> {
    await this.withTransactionalDDL(async () => {
      await this.schema.table(tableName, (table) => {
        table.string('deduplication_key', 64).default('');
      });

      await new QueryBuilder<LegacyInboxScope>(tableName)
        .select('id', 'source', 'tenant_id', 'idempotency_key').chunkById(500, async (rows) => {
          for (const row of rows) {
            const key = webhookInboxDeduplicationKey(row.source, row.tenant_id, row.idempotency_key);
            await new QueryBuilder(tableName).where('id', row.id).update({ deduplication_key: key });
          }
        });

      // Keep the old constraint until the backfill and new arbitration index succeed.
      await this.schema.table(tableName, (table) => table.uniqueIndex('deduplication_key', scopedIndex));
      await this.schema.table(tableName, (table) => table.dropIndex(legacyIndex));
    });
  }

  async down(): Promise<void> {
    await this.withTransactionalDDL(async () => {
      const duplicate = await new QueryBuilder(tableName)
        .select('source', 'idempotency_key').groupBy('source', 'idempotency_key')
        .havingRaw('COUNT(*) > ?', [1]).first();
      if (duplicate) {
        throw new Error('Cannot roll back tenant-scoped webhook idempotency: multiple tenants share a source/key. Review retained entries before rollback; no entries were changed.');
      }
      await this.schema.table(tableName, (table) => table.uniqueIndex(['source', 'idempotency_key'], legacyIndex));
      await this.schema.table(tableName, (table) => table.dropIndex(scopedIndex));
      await this.schema.table(tableName, (table) => table.dropColumn('deduplication_key'));
    });
  }

  private async withTransactionalDDL(callback: () => Promise<void>): Promise<void> {
    // MySQL implicitly commits DDL; receivers must be quiesced for every driver.
    if (Connection.getDriver() === 'mysql') await callback();
    else await Connection.transaction(callback);
  }
}
