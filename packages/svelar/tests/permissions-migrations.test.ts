import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NewCommandTemplates } from '../src/cli/commands/NewCommandTemplates.js';
import { Connection, type DatabaseDriver } from '../src/database/Connection.js';
import { svelarCoreMigrations } from '../src/database/CoreMigrations.js';
import { Migrator } from '../src/database/Migration.js';
import { Schema } from '../src/database/SchemaBuilder.js';
import { QueryBuilder } from '../src/orm/QueryBuilder.js';
import { Permissions } from '../src/permissions/index.js';
import { Teams } from '../src/teams/index.js';

const teamMigrations = () => svelarCoreMigrations().filter((file) => file.name >= '00000000_000031');
const legacyMigrations = () => svelarCoreMigrations().filter((file) => file.name < '00000000_000031');

describe.sequential('Permission migration upgrades', () => {
  beforeEach(async () => {
    await Connection.disconnect();
    Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: ':memory:' } } });
    Teams.configure({ driver: 'database', maxTeamsPerUser: undefined });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    Teams.configure({ driver: 'memory' });
    await Connection.disconnect();
  });

  it('upgrades legacy apps without promoting global grants into teams and rolls back cleanly', async () => {
    const migrator = new Migrator();
    await migrator.run(legacyMigrations());
    const team = await Teams.create({ name: 'Legacy team', ownerId: 1 });
    const role = await Permissions.createRole({ name: 'admin' });
    const permission = await Permissions.createPermission({ name: 'admin.manage' });
    await Permissions.assignRole('User', 1, role.id);
    await Permissions.giveRolePermission(role.id, permission.id);
    await Permissions.giveModelPermission('User', 1, permission.id);
    const existing = await new QueryBuilder('model_has_roles').get();
    const direct = await new QueryBuilder('model_has_permissions').get();
    const roleGrants = await new QueryBuilder('role_has_permissions').get();

    expect(await migrator.run(svelarCoreMigrations())).toEqual(teamMigrations().map((file) => file.name));
    expect(await migrator.run(svelarCoreMigrations())).toEqual([]);
    expect(await new QueryBuilder('model_has_roles').get()).toEqual(existing);
    expect(await new QueryBuilder('model_has_permissions').get()).toEqual(direct);
    expect(await new QueryBuilder('role_has_permissions').get()).toEqual(roleGrants);
    const scope = Permissions.forTeam(team.id);
    expect(await scope.modelHasRole('User', 1, 'admin')).toBe(false);
    expect(await scope.modelHasPermission('User', 1, 'admin.manage')).toBe(false);
    expect(await Permissions.modelHasPermission('User', 1, 'admin.manage')).toBe(true);

    await scope.assignRole('User', 1, role.id);
    await scope.giveRolePermission(role.id, permission.id);
    await scope.giveModelPermission('User', 1, permission.id);
    expect(await scope.modelHasPermission('User', 1, 'admin.manage')).toBe(true);
    expect(await migrator.rollback(svelarCoreMigrations())).toEqual(teamMigrations().map((file) => file.name).reverse());
    expect(await new Schema().hasTable('team_model_has_roles')).toBe(false);
    expect(await Permissions.modelHasPermission('User', 1, 'admin.manage')).toBe(true);
    await migrator.run(svelarCoreMigrations());
    expect(await scope.getModelAllPermissions('User', 1)).toEqual([]);
    expect(await Permissions.getModelAllPermissions('User', 1)).toEqual([permission]);
  });

  it('includes one exported scaffold wrapper per team permission migration', () => {
    const templates = NewCommandTemplates.svelarCoreMigrations();
    for (const file of teamMigrations()) {
      const template = templates.find((entry) => entry.path.endsWith(`${file.name}.ts`));
      expect(template).toBeDefined();
      expect(template?.content).toContain(`import { ${file.migration.constructor.name} as Svelar${file.migration.constructor.name} } from '@beeblock/svelar/database'`);
      expect(template?.content).toContain(`export default class ${file.migration.constructor.name} extends Svelar${file.migration.constructor.name} {}`);
    }
  });

  it.each<DatabaseDriver>(['sqlite', 'postgres', 'mysql'])('renders additive, indexed team grant SQL for %s', async (driver) => {
    await Connection.disconnect();
    Connection.configure({ default: driver, connections: { [driver]: { driver, database: 'sql_contract', filename: ':memory:' } } });
    const statements: string[] = [];
    vi.spyOn(Connection, 'raw').mockImplementation(async (sql) => { statements.push(sql); return []; });
    for (const file of teamMigrations()) await file.migration.up();
    const quote = (name: string) => driver === 'mysql' ? `\`${name}\`` : `"${name}"`;
    const sql = statements.join('\n');
    expect(statements.filter((statement) => statement.startsWith('CREATE TABLE'))).toHaveLength(3);
    expect(sql).not.toMatch(/ALTER TABLE|INSERT INTO|UPDATE |DELETE FROM/);
    for (const table of ['team_role_has_permissions', 'team_model_has_roles', 'team_model_has_permissions']) {
      const create = statements.find((statement) => statement.startsWith(`CREATE TABLE ${quote(table)}`))!;
      expect(create).toContain(`${quote('team_id')} VARCHAR(255) NOT NULL`);
      expect(create).toContain(`PRIMARY KEY (${quote('team_id')}, `);
      expect(create).toContain(`FOREIGN KEY (${quote('team_id')}) REFERENCES ${quote('teams')}(${quote('id')}) ON DELETE CASCADE`);
      if (table.includes('roles') || table.includes('role_has')) {
        expect(create).toContain(`${quote('role_id')} INTEGER${driver === 'mysql' ? ' UNSIGNED' : ''} NOT NULL`);
        expect(create).toContain(`REFERENCES ${quote('roles')}(${quote('id')}) ON DELETE CASCADE`);
      }
      if (table.includes('permissions')) {
        expect(create).toContain(`${quote('permission_id')} INTEGER${driver === 'mysql' ? ' UNSIGNED' : ''} NOT NULL`);
        expect(create).toContain(`REFERENCES ${quote('permissions')}(${quote('id')}) ON DELETE CASCADE`);
      }
    }
    expect(statements.filter((statement) => statement.startsWith('CREATE INDEX'))).toHaveLength(4);
    statements.length = 0;
    for (const file of teamMigrations().reverse()) await file.migration.down();
    expect(statements).toHaveLength(3);
    expect(statements.every((statement) => statement.startsWith('DROP TABLE IF EXISTS'))).toBe(true);
  });
});
