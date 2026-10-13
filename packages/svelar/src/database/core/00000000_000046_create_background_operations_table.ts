import { Migration } from '../Migration.js';

export class CreateBackgroundOperationsTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('background_operations', (table) => {
      table.string('id', 36).primary();
      table.string('name', 128);
      table.string('label');
      table.string('state', 16);
      table.string('tenant_id').nullable();
      table.string('actor_id');
      table.string('return_url', 2048).nullable();
      table.string('queue');
      table.longText('payload');
      table.longText('context');
      table.longText('result').nullable();
      table.text('error').nullable();
      table.integer('progress').default(0);
      table.integer('total').nullable();
      table.integer('attempts').default(0);
      table.boolean('cancel_requested').default(false);
      table.boolean('notification_pending').default(false);
      table.string('lock_owner', 36).nullable();
      table.bigInteger('locked_until').nullable();
      table.bigInteger('available_at');
      table.bigInteger('created_at');
      table.bigInteger('updated_at');
      table.index(['tenant_id', 'actor_id', 'created_at'], 'idx_background_operations_owner');
      table.index(['state', 'available_at'], 'idx_background_operations_pending');
    });
  }
  async down(): Promise<void> { await this.schema.dropTableIfExists('background_operations'); }
}
