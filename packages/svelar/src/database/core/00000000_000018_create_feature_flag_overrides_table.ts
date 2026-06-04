import { Migration } from '../Migration.js';

export class CreateFeatureFlagOverridesTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('feature_flag_overrides', (table) => {
      table.string('id').primary();
      table.string('flag_name');
      table.string('scope_type');
      table.string('scope_id');
      table.boolean('enabled');
      table.timestamp('created_at');
      table.uniqueIndex(['flag_name', 'scope_type', 'scope_id']);
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('feature_flag_overrides');
  }
}
