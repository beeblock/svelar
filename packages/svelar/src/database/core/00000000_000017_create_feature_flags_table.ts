import { Migration } from '../Migration.js';

export class CreateFeatureFlagsTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('feature_flags', (table) => {
      table.string('id').primary();
      table.string('name').unique();
      table.text('description');
      table.boolean('enabled');
      table.integer('percentage').nullable();
      table.text('metadata').nullable();
      table.timestamp('created_at');
      table.timestamp('updated_at');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('feature_flags');
  }
}
