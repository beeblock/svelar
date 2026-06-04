/**
 * Svelar Schema Builder
 *
 * Laravel-like schema builder that generates raw SQL for migrations.
 * Database-agnostic: produces the right SQL for SQLite, PostgreSQL, or MySQL.
 */

import { assertSqlIdentifier, Connection, type DatabaseDriver } from './Connection.js';

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

type ForeignKeyAction = 'cascade' | 'set null' | 'restrict' | 'no action' | 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';

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

  onDelete(action: ForeignKeyAction): ForeignKeyBuilder {
    this.column.references!.onDelete = action.toUpperCase();
    return this;
  }

  onUpdate(action: ForeignKeyAction): ForeignKeyBuilder {
    this.column.references!.onUpdate = action.toUpperCase();
    return this;
  }
}

// ── Table Builder ──────────────────────────────────────────

export class TableBuilder {
  private columns: ColumnDefinition[] = [];
  private droppedColumns: string[] = [];
  private renamedColumns: { from: string; to: string }[] = [];
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

  id(name: string = 'id'): ColumnBuilder {
    return this.bigIncrements(name);
  }

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

  foreignId(name: string): ColumnBuilder {
    return this.bigInteger(name).unsigned();
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

  dropColumn(name: string): void {
    this.droppedColumns.push(name);
  }

  renameColumn(from: string, to: string): void {
    this.renamedColumns.push({ from, to });
  }

  // ── SQL Generation ──

  /** @internal */
  toSQL(tableName: string, driver: DatabaseDriver): string[] {
    const table = this.quoteIdentifier(tableName, driver);
    const statements: string[] = [];
    const columnDefs: string[] = [];

    for (const col of this.columns) {
      columnDefs.push(this.columnToSQL(col, driver));
    }

    if (this.compositePrimary) {
      columnDefs.push(`PRIMARY KEY (${this.compositePrimary.map((column) => this.quoteIdentifier(column, driver)).join(', ')})`);
    }

    // Add foreign key constraints
    for (const col of this.columns) {
      if (col.references) {
        const column = this.quoteIdentifier(col.name, driver);
        const referencedTable = this.quoteIdentifier(col.references.table, driver);
        const referencedColumn = this.quoteIdentifier(col.references.column, driver);
        let fk = `FOREIGN KEY (${column}) REFERENCES ${referencedTable}(${referencedColumn})`;
        if (col.references.onDelete) fk += ` ON DELETE ${col.references.onDelete}`;
        if (col.references.onUpdate) fk += ` ON UPDATE ${col.references.onUpdate}`;
        columnDefs.push(fk);
      }
    }

    statements.push(`CREATE TABLE ${table} (\n  ${columnDefs.join(',\n  ')}\n)`);

    // Create indices
    for (const idx of this.indices) {
      const idxName = idx.name ?? `idx_${tableName}_${idx.columns.join('_')}`;
      const uniqueStr = idx.unique ? 'UNIQUE ' : '';
      statements.push(
        `CREATE ${uniqueStr}INDEX ${this.quoteIdentifier(idxName, driver)} ON ${table} (${idx.columns.map((column) => this.quoteIdentifier(column, driver)).join(', ')})`
      );
    }

    return statements;
  }

  /** @internal */
  columnToSQL(col: ColumnDefinition, driver: DatabaseDriver): string {
    let sql = this.quoteIdentifier(col.name, driver);

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
      sql += ` DEFAULT ${this.defaultToSQL(col.defaultValue)}`;
    }

    return sql;
  }

  /** @internal */
  getColumns(): ColumnDefinition[] {
    return [...this.columns];
  }

  /** @internal */
  getDroppedColumns(): string[] {
    return [...this.droppedColumns];
  }

  /** @internal */
  getRenamedColumns(): { from: string; to: string }[] {
    return [...this.renamedColumns];
  }

  private quoteIdentifier(identifier: string, driver: DatabaseDriver): string {
    const clean = assertSqlIdentifier(identifier);
    return driver === 'mysql' ? `\`${clean}\`` : `"${clean}"`;
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

  private defaultToSQL(value: any): string {
    if (value === null) return 'NULL';
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if (typeof value === 'number' || typeof value === 'bigint') return String(value);

    if (typeof value === 'string') {
      const normalized = value.trim().toUpperCase();
      if (['CURRENT_TIMESTAMP', 'CURRENT_DATE', 'CURRENT_TIME'].includes(normalized)) {
        return normalized;
      }

      return `'${value.replaceAll("'", "''")}'`;
    }

    return String(value);
  }
}

// ── Schema Facade ──────────────────────────────────────────

export class Schema {
  constructor(private connectionName?: string) {}

  async createTable(name: string, callback: (table: TableBuilder) => void): Promise<void> {
    name = assertSqlIdentifier(name, 'Table name');
    const builder = new TableBuilder();
    callback(builder);

    const driver = Connection.getDriver(this.connectionName);
    const statements = builder.toSQL(name, driver);

    for (const sql of statements) {
      await Connection.raw(sql, [], this.connectionName);
    }
  }

  async dropTable(name: string): Promise<void> {
    await Connection.raw(`DROP TABLE IF EXISTS ${this.quoteIdentifier(name, 'Table name')}`, [], this.connectionName);
  }

  async dropTableIfExists(name: string): Promise<void> {
    await Connection.raw(`DROP TABLE IF EXISTS ${this.quoteIdentifier(name, 'Table name')}`, [], this.connectionName);
  }

  async renameTable(from: string, to: string): Promise<void> {
    const driver = Connection.getDriver(this.connectionName);
    if (driver === 'mysql') {
      await Connection.raw(`RENAME TABLE ${this.quoteIdentifier(from, 'Source table name')} TO ${this.quoteIdentifier(to, 'Target table name')}`, [], this.connectionName);
    } else {
      await Connection.raw(`ALTER TABLE ${this.quoteIdentifier(from, 'Source table name')} RENAME TO ${this.quoteIdentifier(to, 'Target table name')}`, [], this.connectionName);
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

  async table(name: string, callback: (table: TableBuilder) => void): Promise<void> {
    const builder = new TableBuilder();
    callback(builder);

    const driver = Connection.getDriver(this.connectionName);
    const tableName = this.quoteIdentifier(name, 'Table name');

    for (const col of builder.getColumns()) {
      const colSQL = builder.columnToSQL(col, driver);
      await Connection.raw(
        `ALTER TABLE ${tableName} ADD COLUMN ${colSQL}`,
        [],
        this.connectionName
      );
    }

    for (const rename of builder.getRenamedColumns()) {
      await Connection.raw(
        `ALTER TABLE ${tableName} RENAME COLUMN ${this.quoteIdentifier(rename.from, 'Column name')} TO ${this.quoteIdentifier(rename.to, 'Column name')}`,
        [],
        this.connectionName
      );
    }

    for (const column of builder.getDroppedColumns()) {
      await Connection.raw(
        `ALTER TABLE ${tableName} DROP COLUMN ${this.quoteIdentifier(column, 'Column name')}`,
        [],
        this.connectionName
      );
    }
  }

  async addColumn(table: string, callback: (tb: TableBuilder) => void): Promise<void> {
    await this.table(table, callback);
  }

  async dropColumn(table: string, column: string): Promise<void> {
    await this.table(table, (tb) => tb.dropColumn(column));
  }

  private quoteIdentifier(identifier: string, label: string = 'SQL identifier'): string {
    const driver = Connection.getDriver(this.connectionName);
    const clean = assertSqlIdentifier(identifier, label);
    return driver === 'mysql' ? `\`${clean}\`` : `"${clean}"`;
  }
}

import { singleton } from '../support/singleton.js';

/** Default schema instance */
export const schema = singleton('svelar.schema', () => new Schema());
