import { Migration } from '../Migration.js';

export class CreatePermissionsTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('permissions', (table) => {
      table.increments('id');
      table.string('name');
      table.string('guard');
      table.text('description').nullable();
      table.timestamp('created_at').nullable();
      table.timestamp('updated_at').nullable();
      table.uniqueIndex(['name', 'guard']);
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('permissions');
  }
}
