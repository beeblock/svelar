/**
 * Add Stripe Fields to Users Table
 *
 * This migration adds the stripe_customer_id column to the users table
 * to track which Stripe customer each user is associated with.
 * Copy this file to your migrations directory and run it with your migration tool.
 */

export const name = 'add_stripe_to_users';

export async function up(): Promise<void> {
  // This is a template. In your actual migration, you would use your database client
  // Example using a query builder:
  //
  // await db.schema.alterTable('users', (table) => {
  //   table.string('stripe_customer_id').nullable().after('id');
  //   table.index(['stripe_customer_id']);
  // });
}

export async function down(): Promise<void> {
  // Remove the columns
  // await db.schema.alterTable('users', (table) => {
  //   table.dropColumn('stripe_customer_id');
  // });
}
