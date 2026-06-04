import { Migration } from '../Migration.js';

export class CreateWebhookDeliveriesTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('webhook_deliveries', (table) => {
      table.string('id').primary();
      table.string('webhook_id');
      table.string('event');
      table.text('payload');
      table.string('status');
      table.integer('status_code').nullable();
      table.text('response').nullable();
      table.integer('attempts');
      table.integer('max_attempts');
      table.bigInteger('next_retry_at').nullable();
      table.bigInteger('delivered_at').nullable();
      table.bigInteger('created_at');
      table.index('webhook_id');
      table.index('status');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('webhook_deliveries');
  }
}
