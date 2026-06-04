import { Migration } from '../Migration.js';

export class CreateTeamsTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('teams', (table) => {
      table.string('id').primary();
      table.string('name');
      table.string('slug').unique();
      table.string('owner_id');
      table.boolean('personal_team');
      table.text('metadata').nullable();
      table.timestamp('created_at');
      table.timestamp('updated_at');
      table.index('owner_id');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('teams');
  }
}
