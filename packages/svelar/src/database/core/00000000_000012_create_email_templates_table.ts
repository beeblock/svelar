import { Migration } from '../Migration.js';

export class CreateEmailTemplatesTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('email_templates', (table) => {
      table.string('id').primary();
      table.string('name').unique();
      table.text('subject');
      table.text('html');
      table.text('text').nullable();
      table.text('variables');
      table.string('category').nullable();
      table.boolean('active');
      table.bigInteger('created_at');
      table.bigInteger('updated_at');
      table.index('category');
    });
  }

  async down(): Promise<void> {
    await this.schema.dropTableIfExists('email_templates');
  }
}
