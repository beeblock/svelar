import { Migration } from '../Migration.js';

export class CreateSearchOutboxTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('svelar_search_outbox', (table) => {
      table.increments('id');
      table.string('document_key', 64);
      table.text('operation');
      table.text('context');
      table.string('status', 16).default('pending');
      table.integer('attempts').default(0);
      table.timestamp('available_at');
      table.timestamp('created_at');
      table.string('owner', 64).nullable();
      table.timestamp('locked_until').nullable();
      table.text('error').nullable();
      table.timestamp('processed_at').nullable();
      table.index(['status', 'available_at']);
      table.index(['document_key', 'id']);
    });
  }
  async down(): Promise<void> { await this.schema.dropTableIfExists('svelar_search_outbox'); }
}
