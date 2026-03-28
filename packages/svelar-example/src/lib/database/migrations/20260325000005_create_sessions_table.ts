import { Migration } from 'svelar/database';

export default class CreateSessionsTable extends Migration {
  async up() {
    await this.schema.createTable('sessions', (table) => {
      table.string('id').primary();
      table.text('payload');
      table.string('expires_at');
    });
  }

  async down() {
    await this.schema.dropTable('sessions');
  }
}
