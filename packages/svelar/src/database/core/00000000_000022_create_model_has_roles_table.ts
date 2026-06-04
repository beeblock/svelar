import { Migration } from '../Migration.js';

export class CreateModelHasRolesTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('model_has_roles', (table) => {
      table.string('model_type');
      table.integer('model_id');
      table.integer('role_id');
      table.primary(['model_type', 'model_id', 'role_id']);
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('model_has_roles');
  }
}
