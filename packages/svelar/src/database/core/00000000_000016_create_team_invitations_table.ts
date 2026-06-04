import { Migration } from '../Migration.js';

export class CreateTeamInvitationsTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('team_invitations', (table) => {
      table.string('id').primary();
      table.string('team_id');
      table.string('email');
      table.string('role');
      table.string('token').unique();
      table.timestamp('expires_at');
      table.timestamp('accepted_at').nullable();
      table.timestamp('created_at');
      table.index('team_id');
      table.index('email');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('team_invitations');
  }
}
