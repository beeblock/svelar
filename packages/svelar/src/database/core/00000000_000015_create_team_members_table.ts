import { Migration } from '../Migration.js';

export class CreateTeamMembersTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('team_members', (table) => {
      table.string('id').primary();
      table.string('team_id');
      table.string('user_id');
      table.string('role');
      table.timestamp('joined_at');
      table.uniqueIndex(['team_id', 'user_id']);
      table.index('user_id');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('team_members');
  }
}
