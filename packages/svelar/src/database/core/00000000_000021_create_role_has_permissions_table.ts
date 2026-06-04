import { Migration } from '../Migration.js';

export class CreateRoleHasPermissionsTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('role_has_permissions', (table) => {
      table.integer('role_id');
      table.integer('permission_id');
      table.primary(['role_id', 'permission_id']);
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('role_has_permissions');
  }
}
