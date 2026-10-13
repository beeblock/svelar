import { Migration } from '../Migration.js';

export class CreateTeamRoleCapabilityProfilesTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('team_role_capability_profiles', (table) => {
      table.string('team_id').references('id', 'teams').onDelete('CASCADE');
      table.integer('role_id').unsigned().references('id', 'roles').onDelete('CASCADE');
      table.string('kind', 16);
      table.string('system_profile').nullable();
      table.text('capabilities');
      table.text('exclusions');
      table.text('inclusions');
      table.primary(['team_id', 'role_id']);
      table.index('role_id');
    });
  }
  async down(): Promise<void> { await this.schema.dropTableIfExists('team_role_capability_profiles'); }
}
