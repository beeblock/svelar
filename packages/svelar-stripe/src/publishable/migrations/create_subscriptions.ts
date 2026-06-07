import { Migration } from '@beeblock/svelar/database';

export default class CreateSubscriptionsTable extends Migration {
  async up() {
    await this.schema.createTable('subscriptions', (table) => {
      table.increments('id');
      table.string('billable_type');
      table.integer('billable_id');
      table.string('name').default('default');
      table.string('stripe_subscription_id').unique();
      table.string('stripe_customer_id');
      table.string('stripe_price_id');
      table.string('status').default('active');
      table.string('current_period_start').nullable();
      table.string('current_period_end').nullable();
      table.string('trial_ends_at').nullable();
      table.boolean('cancel_at_period_end').default(false);
      table.string('canceled_at').nullable();
      table.timestamps();
    });
  }

  async down() {
    await this.schema.dropTable('subscriptions');
  }
}
