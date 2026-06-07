import { Migration } from '@beeblock/svelar/database';

export default class CreateSubscriptionPlansTable extends Migration {
  async up() {
    await this.schema.createTable('subscription_plans', (table) => {
      table.increments('id');
      table.string('name');
      table.string('stripe_price_id').unique();
      table.string('stripe_product_id');
      table.integer('price').default(0);
      table.string('currency').default('usd');
      table.string('interval').default('month');
      table.integer('interval_count').default(1);
      table.integer('trial_days').default(0);
      table.text('features').default('[]');
      table.integer('sort_order').default(0);
      table.boolean('active').default(true);
      table.timestamps();
    });
  }

  async down() {
    await this.schema.dropTable('subscription_plans');
  }
}
