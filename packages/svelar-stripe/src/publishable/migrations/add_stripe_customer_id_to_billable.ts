import { Migration } from '@beeblock/svelar/database';

// Polymorphic — run once per billable table.
// Rename this file or duplicate it for each billable model:
//   add_stripe_customer_id_to_users.ts
//   add_stripe_customer_id_to_teams.ts
//
// Change the table name below to match your billable model's table.

const BILLABLE_TABLE = 'users'; // <-- change to 'teams', 'companies', etc.

export default class AddStripeCustomerIdToBillable extends Migration {
  async up() {
    await this.schema.addColumn(BILLABLE_TABLE, (table) => {
      table.string('stripe_customer_id').nullable();
    });
  }

  async down() {
    await this.schema.dropColumn(BILLABLE_TABLE, 'stripe_customer_id');
  }
}
