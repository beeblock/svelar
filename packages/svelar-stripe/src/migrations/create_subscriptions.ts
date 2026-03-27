/**
 * Create Subscriptions Table
 *
 * This migration creates the table for storing user subscription information.
 * Copy this file to your migrations directory and run it with your migration tool.
 */

export const name = 'create_subscriptions';

export async function up(): Promise<void> {
  // This is a template. In your actual migration, you would use your database client
  // Example using a query builder:
  //
  // await db.schema.createTable('subscriptions', (table) => {
  //   table.increments('id').primary();
  //   table.integer('user_id').notNullable();
  //   table.string('stripe_subscription_id').notNullable().unique();
  //   table.string('stripe_customer_id').notNullable();
  //   table.integer('plan_id').notNullable();
  //   table.enum('status', [
  //     'active',
  //     'past_due',
  //     'canceled',
  //     'trialing',
  //     'incomplete',
  //     'paused',
  //   ]).notNullable().defaultTo('active');
  //   table.dateTime('current_period_start').notNullable();
  //   table.dateTime('current_period_end').notNullable();
  //   table.boolean('cancel_at_period_end').notNullable().defaultTo(false);
  //   table.dateTime('trial_ends_at').nullable();
  //   table.dateTime('canceled_at').nullable();
  //   table.timestamps();
  //   table.foreign('user_id').references('id').on('users').onDelete('cascade');
  //   table.foreign('plan_id').references('id').on('subscription_plans').onDelete('restrict');
  //   table.index(['user_id']);
  //   table.index(['stripe_subscription_id']);
  //   table.index(['stripe_customer_id']);
  //   table.index(['status']);
  // });
}

export async function down(): Promise<void> {
  // Drop the table
  // await db.schema.dropTable('subscriptions');
}
