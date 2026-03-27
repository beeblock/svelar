/**
 * Svelar Schema Builder
 *
 * Laravel-like schema builder that generates raw SQL for migrations.
 * Database-agnostic: produces the right SQL for SQLite, PostgreSQL, or MySQL.
 */

import { Connection, type DatabaseDriver } from './Connection.js';

// ── Column Definition ──────────────────────────────────────

export interface ColumnDefinition {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: any;
  primaryKey: boolean;
  autoIncrement: boolean;
  unique: boolean;
  unsigned: boolean;
  references?: { table: string; column: string; onDelete?: string; onUpdate?: string };
  check?: string;
}

export class ColumnBuilder {
  constructor(private column: ColumnDefinition) {}

  nullable(): ColumnBuilder {
    this.column.nullable = true;
    return this;
  }

  notNullable(): ColumnBuilder {
    this.column.nullable = false;
    return this;
  }

  default(value: any): ColumnBuilder {
    this.column.defaultValue = value;
    return this;
  }

  primary(): ColumnBuilder {
    this.column.primaryKey = true;
    return this;
  }

  unique(): ColumnBuilder {
    this.column.unique = true;
    return this;
  }

  unsigned(): ColumnBuilder {
    this.column.unsigned = true;
    return this;
  }

  references(column: string, table: string): ForeignKeyBuilder {
    this.column.references = { table, column };
    return new ForeignKeyBuilder(this.column);
  }

  /** @internal */
  build(): ColumnDefinition {
    return this.column;
  }
}

export class ForeignKeyBuilder {
  constructor(private column: ColumnDefinition) {}

  onDelete(action: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION'): ForeignKeyBuilder {
    this.column.references!.onDelete = action;
    return this;
  }

  onUpdate(action: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION'): ForeignKeyBuilder {
    this.column.references!.onUpdate = action;
    return this;
  }
}

// ── Table Builder ──────────────────────────────────────────

export class TableBuilder {
  private columns: ColumnDefinition[] = [];
  private indices: { columns: string[]; unique: boolean; name?: string }[] = [];
  private compositePrimary: string[] | null = null;

  private addColumn(name: string, type: string): ColumnBuilder {
    const col: ColumnDefinition = {
      name,
      type,
      nullable: false,
      primaryKey: false,
      autoIncrement: false,
      unique: false,
      unsigned: false,
    };
    this.columns.push(col);
    return new ColumnBuilder(col);
  }

  // ── Column Types ──

  increments(name: string = 'id'): ColumnBuilder {
    const col: ColumnDefinition = {
      name,
      type: 'INTEGER',
      nullable: false,
      primaryKey: true,
      autoIncrement: true,
      unique: false,
      unsigned: true,
    };
    this.columns.push(col);
    return new ColumnBuilder(col);
  }

  bigIncrements(name: string = 'id'): ColumnBuilder {
    const col: ColumnDefinition = {
      name,
      type: 'BIGINT',
      nullable: false,
      primaryKey: true,
      autoIncrement: true,
      unique: false,
      unsigned: true,
    };
    this.columns.push(col);
    return new ColumnBuilder(col);
  }

  string(name: string, length: number = 255): ColumnBuilder {
    return this.addColumn(name, `VARCHAR(${length})`);
  }

  text(name: string): ColumnBuilder {
    return this.addColumn(name, 'TEXT');
  }

  integer(name: string): ColumnBuilder {
    return this.addColumn(name, 'INTEGER');
  }

  bigInteger(name: string): ColumnBuilder {
    return this.addColumn(name, 'BIGINT');
  }

  float(name: string): ColumnBuilder {
    return this.addColumn(name, 'FLOAT');
  }

  decimal(name: string, precision: number = 8, scale: number = 2): ColumnBuilder {
    return this.addColumn(name, `DECIMAL(${precision},${scale})`);
  }

  boolean(name: string): ColumnBuilder {
    return this.addColumn(name, 'BOOLEAN');
  }

  date(name: string): ColumnBuilder {
    return this.addColumn(name, 'DATE');
  }

  datetime(name: string): ColumnBuilder {
    return this.addColumn(name, 'DATETIME');
  }

  timestamp(name: string): ColumnBuilder {
    return this.addColumn(name, 'TIMESTAMP');
  }

  timestamps(): void {
    this.timestamp('created_at').nullable();
    this.timestamp('updated_at').nullable();
  }

  json(name: string): ColumnBuilder {
    return this.addColumn(name, 'JSON');
  }

  blob(name: string): ColumnBuilder {
    return this.addColumn(name, 'BLOB');
  }

  enum(name: string, values: string[]): ColumnBuilder {
    return this.addColumn(name, `ENUM(${values.map(v => `'${v}'`).join(',')})`);
  }

  uuid(name: string = 'id'): ColumnBuilder {
    return this.addColumn(name, 'UUID');
  }

  ulid(name: string = 'id'): ColumnBuilder {
    return this.addColumn(name, 'ULID');
  }

  jsonb(name: string): ColumnBuilder {
    return this.addColumn(name, 'JSONB');
  }

  // ── Constraints ──

  primary(columns: string[]): void {
    this.compositePrimary = columns;
  }

  index(columns: string | string[], name?: string): void {
    const cols = Array.isArray(columns) ? columns : [columns];
    this.indices.push({ columns: cols, unique: false, name });
  }

  uniqueIndex(columns: string | string[], name?: string): void {
    const cols = Array.isArray(columns) ? columns : [columns];
    this.indices.push({ columns: cols, unique: true, name });
  }

  foreign(column: string): ColumnBuilder {
    // Find existing column and return its builder for chaining .references()
    const existing = this.columns.find(c => c.name === column);
    if (!existing) {
      throw new Error(`Column "${column}" must be defined before adding a foreign key.`);
    }
    return new ColumnBuilder(existing);
  }

  // ── SQL Generation ──

  /** @internal */
  toSQL(tableName: string, driver: DatabaseDriver): string[] {
    const statements: string[] = [];
    const columnDefs: string[] = [];

    for (const col of this.columns) {
      columnDefs.push(this.columnToSQL(col, driver));
    }

    if (this.compositePrimary) {
      columnDefs.push(`PRIMARY KEY (${this.compositePrimary.join(', ')})`);
    }

    // Add foreign key constraints
    for (const col of this.columns) {
      if (col.references) {
        let fk = `FOREIGN KEY (${col.name}) REFERENCES ${col.references.table}(${col.references.column})`;
        if (col.references.onDelete) fk += ` ON DELETE ${col.references.onDelete}`;
        if (col.references.onUpdate) fk += ` ON UPDATE ${col.references.onUpdate}`;
        columnDefs.push(fk);
      }
    }

    statements.push(`CREATE TABLE ${tableName} (\n  ${columnDefs.join(',\n  ')}\n)`);

    // Create indices
    for (const idx of this.indices) {
      const idxName = idx.name ?? `idx_${tableName}_${idx.columns.join('_')}`;
      const uniqueStr = idx.unique ? 'UNIQUE ' : '';
      statements.push(
        `CREATE ${uniqueStr}INDEX ${idxName} ON ${tableName} (${idx.columns.join(', ')})`
      );
    }

    return statements;
  }

  private columnToSQL(col: ColumnDefinition, driver: DatabaseDriver): string {
    let sql = col.name;

    // Map types per driver
    let type = col.type;
    if (driver === 'sqlite') {
      type = this.mapSQLiteType(type, col);
    } else if (driver === 'postgres') {
      type = this.mapPostgresType(type, col);
    } else if (driver === 'mysql') {
      type = this.mapMySQLType(type, col);
    }

    sql += ` ${type}`;

    if (col.primaryKey && !this.compositePrimary) {
      sql += ' PRIMARY KEY';
      if (col.autoIncrement) {
        if (driver === 'sqlite') {
          sql += ' AUTOINCREMENT';
        } else if (driver === 'postgres') {
          // SERIAL type handles this — we swap the type above
        } else if (driver === 'mysql') {
          sql += ' AUTO_INCREMENT';
        }
      }
    }

    if (!col.nullable && !col.primaryKey) {
      sql += ' NOT NULL';
    }

    if (col.unique && !col.primaryKey) {
      sql += ' UNIQUE';
    }

    if (col.defaultValue !== undefined) {
      const val =
        typeof col.defaultValue === 'string'
          ? `'${col.defaultValue}'`
          : col.defaultValue === null
            ? 'NULL'
            : col.defaultValue;
      sql += ` DEFAULT ${val}`;
    }

    return sql;
  }

  private mapSQLiteType(type: string, col: ColumnDefinition): string {
    if (type === 'BOOLEAN') return 'INTEGER';
    if (type === 'UUID' || type === 'ULID') return 'TEXT';
    if (type.startsWith('ENUM')) return 'TEXT';
    if (type === 'JSON' || type === 'JSONB') return 'TEXT';
    if (type === 'BIGINT' && col.autoIncrement) return 'INTEGER';
    return type;
  }

  private mapPostgresType(type: string, col: ColumnDefinition): string {
    if (col.autoIncrement && type === 'INTEGER') return 'SERIAL';
    if (col.autoIncrement && type === 'BIGINT') return 'BIGSERIAL';
    if (type === 'DATETIME') return 'TIMESTAMP';
    if (type === 'BLOB') return 'BYTEA';
    if (type.startsWith('ENUM')) return 'TEXT'; // Use CHECK constraint or create custom type
    if (type === 'UUID') return 'UUID';
    if (type === 'ULID') return 'VARCHAR(26)';
    if (type === 'JSON') return 'JSONB';
    if (type === 'JSONB') return 'JSONB';
    return type;
  }

  private mapMySQLType(type: string, col: ColumnDefinition): string {
    if (type === 'BOOLEAN') return 'TINYINT(1)';
    if (type === 'UUID') return 'CHAR(36)';
    if (type === 'ULID') return 'CHAR(26)';
    if (type === 'JSONB') return 'JSON'; // MySQL has no JSONB, uses JSON
    if (type === 'TIMESTAMP') return 'DATETIME';
    if (col.unsigned && !type.startsWith('DECIMAL')) return `${type} UNSIGNED`;
    return type;
  }
}

// ── Schema Facade ──────────────────────────────────────────

export class Schema {
  constructor(private connectionName?: string) {}

  async createTable(name: string, callback: (table: TableBuilder) => void): Promise<void> {
    const builder = new TableBuilder();
    callback(builder);

    const driver = Connection.getDriver(this.connectionName);
    const statements = builder.toSQL(name, driver);

    for (const sql of statements) {
      await Connection.raw(sql, [], this.connectionName);
    }
  }

  async dropTable(name: string): Promise<void> {
    await Connection.raw(`DROP TABLE IF EXISTS ${name}`, [], this.connectionName);
  }

  async dropTableIfExists(name: string): Promise<void> {
    await Connection.raw(`DROP TABLE IF EXISTS ${name}`, [], this.connectionName);
  }

  async renameTable(from: string, to: string): Promise<void> {
    const driver = Connection.getDriver(this.connectionName);
    if (driver === 'mysql') {
      await Connection.raw(`RENAME TABLE ${from} TO ${to}`, [], this.connectionName);
    } else {
      await Connection.raw(`ALTER TABLE ${from} RENAME TO ${to}`, [], this.connectionName);
    }
  }

  async hasTable(name: string): Promise<boolean> {
    const driver = Connection.getDriver(this.connectionName);
    let rows: any[];

    switch (driver) {
      case 'sqlite':
        rows = await Connection.raw(
          `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
          [name],
          this.connectionName
        );
        break;
      case 'postgres':
        rows = await Connection.raw(
          `SELECT tablename FROM pg_tables WHERE tablename = $1`,
          [name],
          this.connectionName
        );
        break;
      case 'mysql':
        rows = await Connection.raw(
          `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_NAME = ?`,
          [name],
          this.connectionName
        );
        break;
      default:
        throw new Error(`Unsupported driver: ${driver}`);
    }

    return rows.length > 0;
  }

  async addColumn(table: string, callback: (tb: TableBuilder) => void): Promise<void> {
    const builder = new TableBuilder();
    callback(builder);

    const driver = Connection.getDriver(this.connectionName);
    // We'll use the builder's internal columns via toSQL hack
    // For ALTER TABLE, we generate ADD COLUMN statements
    const cols = (builder as any).columns as ColumnDefinition[];

    for (const col of cols) {
      const colSQL = (builder as any).columnToSQL(col, driver);
      await Connection.raw(
        `ALTER TABLE ${table} ADD COLUMN ${colSQL}`,
        [],
        this.connectionName
      );
    }
  }

  async dropColumn(table: string, column: string): Promise<void> {
    await Connection.raw(
      `ALTER TABLE ${table} DROP COLUMN ${column}`,
      [],
      this.connectionName
    );
  }
}

import { singleton } from '../support/singleton.js';

/** Default schema instance */
export const schema = singleton('svelar.schema', () => new Schema());
