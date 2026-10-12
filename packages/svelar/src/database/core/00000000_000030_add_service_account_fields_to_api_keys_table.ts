import { Migration } from '../Migration.js';

export class AddServiceAccountFieldsToApiKeysTable extends Migration {
  async up(): Promise<void> {
    await this.schema.table('api_keys', (table) => {
      table.string('team_id').nullable();
      table.string('actor_type').nullable();
      table.string('actor_id').nullable();
      table.string('service_account_id').nullable();
      table.string('last_used_ip').nullable();
      table.text('allowed_ips').nullable();
      table.text('rate_limit').nullable();
      table.bigInteger('disabled_at').nullable();
    });
  }

  async down(): Promise<void> {
    await this.schema.table('api_keys', (table) => {
      table.dropColumn('disabled_at');
      table.dropColumn('rate_limit');
      table.dropColumn('allowed_ips');
      table.dropColumn('last_used_ip');
      table.dropColumn('service_account_id');
      table.dropColumn('actor_id');
      table.dropColumn('actor_type');
      table.dropColumn('team_id');
    });
  }
}
