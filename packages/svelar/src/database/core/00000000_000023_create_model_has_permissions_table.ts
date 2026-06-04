import { Migration } from '../Migration.js';

export class CreateModelHasPermissionsTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('model_has_permissions', (table) => {
      table.string('model_type');
      table.integer('model_id');
      table.integer('permission_id');
      table.primary(['model_type', 'model_id', 'permission_id']);
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('model_has_permissions');
  }
}
