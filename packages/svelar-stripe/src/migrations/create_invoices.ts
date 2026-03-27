/**
 * Create Invoices Table
 *
 * This migration creates the table for storing invoice information.
 * Copy this file to your migrations directory and run it with your migration tool.
 */

export const name = 'create_invoices';

export async function up(): Promise<void> {
  // This is a template. In your actual migration, you would use your database client
  // Example using a query builder:
  //
  // await db.schema.createTable('invoices', (table) => {
  //   table.increments('id').primary();
  //   table.integer('user_id').notNullable();
  //   table.integer('subscription_id').nullable();
  //   table.string('stripe_invoice_id').notNullable().unique();
  //   table.integer('amount_due').notNullable(); // in cents
  //   table.integer('amount_paid').notNullable(); // in cents
  //   table.string('currency', 3).notNullable().defaultTo('usd');
  //   table.enum('status', [
  //     'draft',
  //     'open',
  //     'paid',
  //     'void',
  //     'uncollectible',
  //   ]).notNullable().defaultTo('open');
  //   table.dateTime('paid_at').nullable();
  //   table.dateTime('due_date').nullable();
  //   table.string('invoice_pdf').nullable();
  //   table.timestamps();
  //   table.foreign('user_id').references('id').on('users').onDelete('cascade');
  //   table.foreign('subscription_id').references('id').on('subscriptions').onDelete('set null');
  //   table.index(['user_id']);
  //   table.index(['stripe_invoice_id']);
  //   table.index(['status']);
  //   table.index(['paid_at']);
  // });
}

export async function down(): Promise<void> {
  // Drop the table
  // await db.schema.dropTable('invoices');
}
