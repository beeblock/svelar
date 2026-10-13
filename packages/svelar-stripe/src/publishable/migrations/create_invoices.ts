import { Migration } from '@beeblock/svelar/database';

export default class CreateInvoicesTable extends Migration {
  async up() {
    await this.schema.createTable('invoices', (table) => {
      table.increments('id');
      table.string('billable_type');
      table.string('billable_id', 255);
      table.integer('subscription_id').unsigned().nullable().references('id', 'subscriptions');
      table.string('stripe_invoice_id').unique();
      table.integer('amount_due').default(0);
      table.integer('amount_paid').default(0);
      table.string('currency').default('usd');
      table.string('status').default('draft');
      table.string('paid_at').nullable();
      table.string('due_date').nullable();
      table.string('invoice_pdf').nullable();
      table.timestamps();
    });
  }

  async down() {
    await this.schema.dropTable('invoices');
  }
}
