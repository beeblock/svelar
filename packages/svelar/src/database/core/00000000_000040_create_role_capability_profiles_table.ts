import { Migration } from '../Migration.js';

export class CreateRoleCapabilityProfilesTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('role_capability_profiles', (table) => {
      table.integer('role_id').unsigned().primary().references('id', 'roles').onDelete('CASCADE');
      table.string('kind', 16);
      table.string('system_profile').nullable();
      table.text('capabilities');
      table.text('exclusions');
      table.text('inclusions');
    });
  }
  async down(): Promise<void> { await this.schema.dropTableIfExists('role_capability_profiles'); }
}
