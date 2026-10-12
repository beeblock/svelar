import { Migration } from '../Migration.js';

export class CreateTeamModelHasPermissionsTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('team_model_has_permissions', (table) => {
      table.string('team_id').references('id', 'teams').onDelete('CASCADE');
      table.string('model_type');
      table.integer('model_id');
      table.integer('permission_id').unsigned().references('id', 'permissions').onDelete('CASCADE');
      table.primary(['team_id', 'model_type', 'model_id', 'permission_id']);
      table.index('permission_id');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('team_model_has_permissions');
  }
}
