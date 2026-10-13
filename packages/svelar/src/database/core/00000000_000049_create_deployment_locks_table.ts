import { Migration } from '../Migration.js';

export class CreateDeploymentLocksTable extends Migration {
  async up(): Promise<void> {
    await this.schema.createTable('svelar_deployment_locks', table => {
      table.string('name', 128).primary();
      table.string('owner', 64).nullable();
      table.bigInteger('acquired_at').nullable();
    });
  }
  async down(): Promise<void> { await this.schema.dropTableIfExists('svelar_deployment_locks'); }
}
