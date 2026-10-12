import { Migration } from '../Migration.js';

export class CreateTeamRoleHasPermissionsTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('team_role_has_permissions', (table) => {
      table.string('team_id').references('id', 'teams').onDelete('CASCADE');
      table.integer('role_id').unsigned().references('id', 'roles').onDelete('CASCADE');
      table.integer('permission_id').unsigned().references('id', 'permissions').onDelete('CASCADE');
      table.primary(['team_id', 'role_id', 'permission_id']);
      table.index('role_id');
      table.index('permission_id');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('team_role_has_permissions');
  }
}
