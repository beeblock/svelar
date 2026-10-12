import { Migration } from '../Migration.js';

export class CreateTeamModelHasRolesTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('team_model_has_roles', (table) => {
      table.string('team_id').references('id', 'teams').onDelete('CASCADE');
      table.string('model_type');
      table.integer('model_id');
      table.integer('role_id').unsigned().references('id', 'roles').onDelete('CASCADE');
      table.primary(['team_id', 'model_type', 'model_id', 'role_id']);
      table.index('role_id');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('team_model_has_roles');
  }
}
