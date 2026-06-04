import { Migration } from '../Migration.js';

export class CreateWebhooksTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('webhooks', (table) => {
      table.string('id').primary();
      table.string('user_id').nullable();
      table.text('url');
      table.text('events');
      table.string('secret');
      table.boolean('active');
      table.text('metadata').nullable();
      table.integer('created_at');
      table.index('user_id');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('webhooks');
  }
}
