import { Migration } from 'svelar/database';

/**
 * Creates the roles, permissions, and pivot tables needed
 * for the Svelar permissions system (Spatie-like).
 */
export default class CreatePermissionsTables extends Migration {
  async up() {
    await this.schema.createTable('permissions', (table) => {
      table.increments('id');
      table.string('name');
      table.string('guard').default('web');
      table.text('description').nullable();
      table.timestamps();
    });

    await this.schema.createTable('roles', (table) => {
      table.increments('id');
      table.string('name');
      table.string('guard').default('web');
      table.text('description').nullable();
      table.timestamps();
    });

    await this.schema.createTable('role_has_permissions', (table) => {
      table.integer('role_id').references('id', 'roles');
      table.integer('permission_id').references('id', 'permissions');
    });

    await this.schema.createTable('model_has_roles', (table) => {
      table.string('model_type');
      table.integer('model_id');
      table.integer('role_id').references('id', 'roles');
    });

    await this.schema.createTable('model_has_permissions', (table) => {
      table.string('model_type');
      table.integer('model_id');
      table.integer('permission_id').references('id', 'permissions');
    });
  }

  async down() {
    await this.schema.dropTable('model_has_permissions');
    await this.schema.dropTable('model_has_roles');
    await this.schema.dropTable('role_has_permissions');
    await this.schema.dropTable('roles');
    await this.schema.dropTable('permissions');
  }
}
