import { Migration } from '../Migration.js';

export class CreateSvelarUploadsTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('svelar_uploads', (table) => {
      table.string('id').primary();
      table.string('user_id').nullable();
      table.text('original_name');
      table.text('stored_name');
      table.text('path');
      table.string('disk');
      table.string('mime_type');
      table.integer('size');
      table.text('public_url').nullable();
      table.text('metadata').nullable();
      table.integer('created_at');
      table.index('user_id');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('svelar_uploads');
  }
}
