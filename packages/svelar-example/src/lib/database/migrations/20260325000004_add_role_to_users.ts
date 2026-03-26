import { Migration } from 'svelar/database';

/**
 * Adds a simple role column to users table as a fallback.
 * The full permissions system uses the roles/permissions tables,
 * but this column provides a quick check for admin status.
 */
export default class AddRoleToUsers extends Migration {
  async up() {
    await this.schema.addColumn('users', (table) => {
      table.string('role').default('user');
    });
  }

  async down() {
    await this.schema.dropColumn('users', 'role');
  }
}
