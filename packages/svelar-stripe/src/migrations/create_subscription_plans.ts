/**
 * Create Subscription Plans Table
 *
 * This migration creates the table for storing subscription plan information.
 * Copy this file to your migrations directory and run it with your migration tool.
 */

export const name = 'create_subscription_plans';

export async function up(): Promise<void> {
  // This is a template. In your actual migration, you would use your database client
  // Example using a query builder:
  //
  // await db.schema.createTable('subscription_plans', (table) => {
  //   table.increments('id').primary();
  //   table.string('name').notNullable();
  //   table.string('stripe_price_id').notNullable().unique();
  //   table.string('stripe_product_id').notNullable();
  //   table.integer('price').notNullable(); // in cents
  //   table.string('currency', 3).notNullable().defaultTo('usd');
  //   table.enum('interval', ['month', 'year']).notNullable().defaultTo('month');
  //   table.integer('interval_count').notNullable().defaultTo(1);
  //   table.integer('trial_days').notNullable().defaultTo(0);
  //   table.json('features').notNullable().defaultTo('[]');
  //   table.integer('sort_order').notNullable().defaultTo(0);
  //   table.boolean('active').notNullable().defaultTo(true);
  //   table.timestamps();
  //   table.index(['stripe_price_id']);
  //   table.index(['stripe_product_id']);
  //   table.index(['active']);
  // });
}

export async function down(): Promise<void> {
  // Drop the table
  // await db.schema.dropTable('subscription_plans');
}
