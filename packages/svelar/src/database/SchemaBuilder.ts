/**
 * Svelar Schema Builder
 *
 * Laravel-like schema builder that generates raw SQL for migrations.
 * Database-agnostic: produces the right SQL for SQLite, PostgreSQL, or MySQL.
 */

import { assertSqlIdentifier, Connection, type DatabaseDriver } from './Connection.js';
import { singleton } from '../support/singleton.js';

const trustedExpressions = singleton('svelar.schema.expressions', () => new WeakMap<object, string>());

/** Explicitly trusted migration SQL, never a request value or a value-binding template. */
export class SchemaExpression {
  declare private readonly schemaExpression: true;

  private constructor(sql: string) {
    if (typeof sql !== 'string' || !sql.trim() || sql.includes('\0')) throw new TypeError('A migration expression must contain trusted SQL.');
    trustedExpressions.set(this, sql);
    Object.freeze(this);
  }

  static trusted(sql: string): SchemaExpression { return new SchemaExpression(sql); }
}

function expressionSQL(expression: SchemaExpression): string {
  const sql = trustedExpressions.get(expression);
  if (sql === undefined) throw new TypeError('Use Schema.expression(...) for explicitly trusted migration SQL.');
  return sql;
}

export type SchemaDefault = string | number | bigint | boolean | Date | null | SchemaExpression;
export type IndexColumn = string | SchemaExpression;
export interface IndexOptions {
  where?: SchemaExpression;
  include?: readonly string[];
  concurrently?: boolean;
}
export interface DropIndexOptions { concurrently?: boolean; }
export interface ColumnChangeOptions {
  using?: SchemaExpression;
  /** MySQL MODIFY replaces the definition, including omitted attributes. This is an explicit opt-in. */
  replaceDefinition?: boolean;
}

// ── Column Definition ──────────────────────────────────────

export interface ColumnDefinition {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: SchemaDefault;
  primaryKey: boolean;
  autoIncrement: boolean;
  unique: boolean;
  unsigned: boolean;
  references?: { table: string; column: string; onDelete?: string; onUpdate?: string };
  check?: string;
  enumValues?: string[];
  change?: boolean;
  nullableChanged?: boolean;
  defaultChanged?: boolean;
  dropDefault?: boolean;
  changeOptions?: ColumnChangeOptions;
}

type ForeignKeyAction = 'cascade' | 'set null' | 'restrict' | 'no action' | 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';

function foreignKeyAction(action: string): string {
  if (typeof action !== 'string' || !['CASCADE', 'SET NULL', 'RESTRICT', 'NO ACTION'].includes(action.toUpperCase())) {
    throw new TypeError('Invalid foreign key action.');
  }
  return action.toUpperCase();
}

export class ColumnBuilder {
  constructor(private column: ColumnDefinition) {}

  nullable(value: boolean = true): ColumnBuilder {
    if (typeof value !== 'boolean') throw new TypeError('Column nullability must be boolean.');
    this.column.nullable = value;
    this.column.nullableChanged = true;
    return this;
  }

  notNullable(): ColumnBuilder {
    this.column.nullable = false;
    this.column.nullableChanged = true;
    return this;
  }

  default(value: SchemaDefault): ColumnBuilder {
    if (value === undefined) throw new TypeError('Use dropDefault() to remove a column default.');
    this.column.defaultValue = value;
    this.column.defaultChanged = true;
    this.column.dropDefault = false;
    return this;
  }

  dropDefault(): ColumnBuilder {
    this.column.defaultValue = undefined;
    this.column.defaultChanged = true;
    this.column.dropDefault = true;
    return this;
  }

  change(options: ColumnChangeOptions = {}): ColumnBuilder {
    for (const key of Object.keys(options)) {
      if (!['using', 'replaceDefinition'].includes(key)) throw new TypeError(`Unknown column change option "${key}".`);
    }
    if (options.using !== undefined) expressionSQL(options.using);
    if (options.replaceDefinition !== undefined && typeof options.replaceDefinition !== 'boolean') throw new TypeError('replaceDefinition must be boolean.');
    this.column.change = true;
    this.column.changeOptions = { ...options };
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
    this.column.references!.onDelete = foreignKeyAction(action);
    return this;
  }

  onUpdate(action: ForeignKeyAction): ForeignKeyBuilder {
    this.column.references!.onUpdate = foreignKeyAction(action);
    return this;
  }
}

// ── Table Builder ──────────────────────────────────────────

export class TableBuilder {
  private columns: ColumnDefinition[] = [];
  private droppedColumns: string[] = [];
  private renamedColumns: { from: string; to: string }[] = [];
  private indices: { columns: IndexColumn[]; unique: boolean; name?: string; options: IndexOptions }[] = [];
  private droppedIndices: { name: string; options: DropIndexOptions }[] = [];
  private checks: { name: string; expression: SchemaExpression }[] = [];
  private droppedChecks: string[] = [];
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
    if (!Number.isSafeInteger(length) || length < 1) throw new TypeError('String length must be a positive safe integer.');
    return this.addColumn(name, `VARCHAR(${length})`);
  }

  text(name: string): ColumnBuilder {
    return this.addColumn(name, 'TEXT');
  }

  longText(name: string): ColumnBuilder { return this.addColumn(name, 'LONGTEXT'); }

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
    if (!Number.isSafeInteger(precision) || precision < 1 || precision > 1000 || !Number.isSafeInteger(scale) || scale < 0 || scale > precision) {
      throw new TypeError('Invalid decimal precision or scale.');
    }
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

  softDeletes(column: string = 'deleted_at'): ColumnBuilder {
    return this.timestamp(column).nullable();
  }

  json(name: string): ColumnBuilder {
    return this.addColumn(name, 'JSON');
  }

  blob(name: string): ColumnBuilder {
    return this.addColumn(name, 'BLOB');
  }

  enum(name: string, values: string[]): ColumnBuilder {
    if (!Array.isArray(values) || !values.length || values.some((value) => typeof value !== 'string' || value.includes('\0'))) throw new TypeError('Enums require nonempty string values.');
    const builder = this.addColumn(name, 'ENUM');
    builder.build().enumValues = [...values];
    return builder;
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

  index(columns: IndexColumn | readonly IndexColumn[], name?: string, options: IndexOptions = {}): void {
    const cols = Array.isArray(columns) ? columns : [columns];
    this.indices.push({ columns: [...cols] as IndexColumn[], unique: false, name, options: this.indexOptions(options) });
  }

  uniqueIndex(columns: IndexColumn | readonly IndexColumn[], name?: string, options: IndexOptions = {}): void {
    const cols = Array.isArray(columns) ? columns : [columns];
    this.indices.push({ columns: [...cols] as IndexColumn[], unique: true, name, options: this.indexOptions(options) });
  }

  dropIndex(name: string, options: DropIndexOptions = {}): void {
    if (Object.keys(options).some((key) => key !== 'concurrently') ||
        options.concurrently !== undefined && typeof options.concurrently !== 'boolean') throw new TypeError('Invalid index drop options.');
    this.droppedIndices.push({ name: assertSqlIdentifier(name, 'Index name'), options: { ...options } });
  }

  dropUnique(name: string, options: DropIndexOptions = {}): void {
    this.dropIndex(name, options);
  }

  check(name: string, expression: SchemaExpression): void {
    name = assertSqlIdentifier(name, 'Check constraint name');
    expressionSQL(expression);
    this.checks.push({ name, expression });
  }

  dropCheck(name: string): void {
    this.droppedChecks.push(assertSqlIdentifier(name, 'Check constraint name'));
  }

  /** Alter only the explicitly requested modifiers, without supplying a replacement type. */
  alterColumn(name: string): ColumnBuilder {
    return this.addColumn(name, '').change();
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
    if (this.droppedIndices.length || this.droppedChecks.length || this.droppedColumns.length || this.renamedColumns.length || this.columns.some((column) => column.change)) {
      throw new Error('Schema alterations require Schema.table(), not createTable().');
    }
    const table = this.quoteIdentifier(tableName, driver);
    const statements: string[] = [];
    const columnDefs: string[] = [];

    for (const col of this.columns) {
      columnDefs.push(this.columnToSQL(col, driver));
    }
    for (const check of this.checks) columnDefs.push(this.checkToSQL(check, driver));

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
        if (col.references.onDelete) fk += ` ON DELETE ${foreignKeyAction(col.references.onDelete)}`;
        if (col.references.onUpdate) fk += ` ON UPDATE ${foreignKeyAction(col.references.onUpdate)}`;
        columnDefs.push(fk);
      }
    }

    statements.push(`CREATE TABLE ${table} (\n  ${columnDefs.join(',\n  ')}\n)`);

    statements.push(...this.toIndexSQL(tableName, driver));

    return statements;
  }

  /** @internal */
  toIndexSQL(tableName: string, driver: DatabaseDriver): string[] {
    const table = this.quoteIdentifier(tableName, driver);
    const statements: string[] = [];
    for (const idx of this.indices) {
      if (!idx.columns.length) throw new Error('An index must include at least one column.');
      const expressionIndex = idx.columns.some((column) => typeof column !== 'string');
      if (expressionIndex && !idx.name) throw new Error('Expression indexes require an explicit index name.');
      if (driver !== 'postgres' && (expressionIndex || idx.options.where !== undefined || idx.options.include !== undefined || idx.options.concurrently)) {
        throw new Error('Advanced index options require PostgreSQL.');
      }
      const idxName = idx.name ?? `idx_${tableName}_${idx.columns.join('_')}`;
      const uniqueStr = idx.unique ? 'UNIQUE ' : '';
      const columns = idx.columns.map((column) => typeof column === 'string' ? this.quoteIdentifier(column, driver) : `(${expressionSQL(column)})`);
      const include = idx.options.include ? ` INCLUDE (${idx.options.include.map((column) => this.quoteIdentifier(column, driver)).join(', ')})` : '';
      const predicate = idx.options.where ? ` WHERE (${expressionSQL(idx.options.where)})` : '';
      statements.push(
        `CREATE ${uniqueStr}INDEX ${idx.options.concurrently ? 'CONCURRENTLY ' : ''}${this.quoteIdentifier(idxName, driver)} ON ${table} (${columns.join(', ')})${include}${predicate}`
      );
    }

    return statements;
  }

  /** @internal */
  toDropIndexSQL(tableName: string, driver: DatabaseDriver): string[] {
    const table = this.quoteIdentifier(tableName, driver);
    return this.droppedIndices.map(({ name, options }) => {
      if (options.concurrently && driver !== 'postgres') throw new Error('Concurrent index removal requires PostgreSQL.');
      return `DROP INDEX ${options.concurrently ? 'CONCURRENTLY ' : ''}${this.quoteIdentifier(name, driver)}${driver === 'mysql' ? ` ON ${table}` : ''}`;
    });
  }

  /** @internal */
  hasConcurrentIndexes(): boolean {
    return this.indices.some((index) => index.options.concurrently) || this.droppedIndices.some((index) => index.options.concurrently);
  }

  /** @internal */
  toDropCheckSQL(tableName: string, driver: DatabaseDriver): string[] {
    if (this.droppedChecks.length && driver === 'sqlite') throw new Error('SQLite check removal requires an explicit table rebuild.');
    return this.droppedChecks.map((name) => `ALTER TABLE ${this.quoteIdentifier(tableName, driver)} DROP ${driver === 'mysql' ? 'CHECK' : 'CONSTRAINT'} ${this.quoteIdentifier(name, driver)}`);
  }

  /** @internal */
  toAddCheckSQL(tableName: string, driver: DatabaseDriver): string[] {
    if (this.checks.length && driver === 'sqlite') throw new Error('SQLite check alterations require an explicit table rebuild.');
    return this.checks.map((check) => `ALTER TABLE ${this.quoteIdentifier(tableName, driver)} ADD ${this.checkToSQL(check, driver)}`);
  }

  /** @internal */
  columnToSQL(col: ColumnDefinition, driver: DatabaseDriver): string {
    let sql = this.quoteIdentifier(col.name, driver);
    if (col.check !== undefined) throw new Error('Use table.check(name, Schema.expression(...)) for named checks.');
    if (col.dropDefault && !col.change) throw new Error('Default removal requires a column change.');
    sql += ` ${this.columnTypeSQL(col, driver)}`;

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
      sql += ` DEFAULT ${this.defaultToSQL(col.defaultValue, driver)}`;
    }

    return sql;
  }

  /** @internal */
  toChangeColumnSQL(tableName: string, driver: DatabaseDriver): string[] {
    const statements: string[] = [];
    for (const col of this.columns.filter((column) => column.change)) {
      if (driver === 'sqlite') throw new Error('SQLite column changes require an explicit table rebuild.');
      if (col.primaryKey || col.autoIncrement || col.unique || col.references || col.check !== undefined) {
        throw new Error('Column changes cannot redefine primary, unique, foreign-key or check constraints.');
      }
      const table = this.quoteIdentifier(tableName, driver);
      const column = this.quoteIdentifier(col.name, driver);
      const options = col.changeOptions ?? {};
      if (driver === 'mysql') {
        if (options.using !== undefined) throw new Error('USING conversions require PostgreSQL.');
        if (col.type || col.nullableChanged || col.unsigned || options.replaceDefinition) {
          if (!col.type || !options.replaceDefinition || !col.nullableChanged || !col.defaultChanged) {
            throw new Error('MySQL type/nullability changes require change({ replaceDefinition: true }) and explicit nullability and default()/dropDefault(). Omitted attributes are replaced.');
          }
          statements.push(`ALTER TABLE ${table} MODIFY COLUMN ${this.columnToSQL(col, driver)}`);
        } else if (col.defaultChanged) {
          statements.push(`ALTER TABLE ${table} ALTER COLUMN ${column} ${col.dropDefault ? 'DROP DEFAULT' : `SET DEFAULT ${this.defaultToSQL(col.defaultValue!, driver)}`}`);
        } else throw new Error('A column change must specify a type or modifier.');
        continue;
      }
      if (options.replaceDefinition || col.unsigned) throw new Error('PostgreSQL changes do not support replacement definitions or unsigned modifiers.');
      if (options.using !== undefined && !col.type) throw new Error('USING requires a replacement column type.');
      const actions: string[] = [];
      if (col.defaultChanged && (col.type || col.dropDefault)) actions.push(`ALTER COLUMN ${column} DROP DEFAULT`);
      if (col.type) actions.push(`ALTER COLUMN ${column} TYPE ${this.columnTypeSQL(col, driver)}${options.using ? ` USING (${expressionSQL(options.using)})` : ''}`);
      if (col.nullableChanged) actions.push(`ALTER COLUMN ${column} ${col.nullable ? 'DROP' : 'SET'} NOT NULL`);
      if (col.defaultChanged && !col.dropDefault) actions.push(`ALTER COLUMN ${column} SET DEFAULT ${this.defaultToSQL(col.defaultValue!, driver)}`);
      if (!actions.length) throw new Error('A column change must specify a type or modifier.');
      statements.push(`ALTER TABLE ${table} ${actions.join(', ')}`);
    }
    return statements;
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
    if (typeof identifier !== 'string') throw new TypeError('SQL identifiers must be strings.');
    const clean = assertSqlIdentifier(identifier);
    return driver === 'mysql' ? `\`${clean}\`` : `"${clean}"`;
  }

  private indexOptions(options: IndexOptions): IndexOptions {
    if (Object.keys(options).some((key) => !['where', 'include', 'concurrently'].includes(key))) throw new TypeError('Unknown index option.');
    if (options.where !== undefined) expressionSQL(options.where);
    if (options.concurrently !== undefined && typeof options.concurrently !== 'boolean') throw new TypeError('concurrently must be boolean.');
    if (options.include !== undefined && (!Array.isArray(options.include) || !options.include.length)) throw new TypeError('INCLUDE requires a nonempty column list.');
    return { ...options, include: options.include ? [...options.include] : undefined };
  }

  private checkToSQL(check: { name: string; expression: SchemaExpression }, driver: DatabaseDriver): string {
    return `CONSTRAINT ${this.quoteIdentifier(check.name, driver)} CHECK (${expressionSQL(check.expression)})`;
  }

  private columnTypeSQL(col: ColumnDefinition, driver: DatabaseDriver): string {
    const type = col.type;
    if (!['INTEGER', 'BIGINT', 'TEXT', 'LONGTEXT', 'FLOAT', 'BOOLEAN', 'DATE', 'DATETIME', 'TIMESTAMP', 'JSON', 'JSONB', 'BLOB', 'UUID', 'ULID', 'ENUM'].includes(type) &&
        !/^VARCHAR\([1-9][0-9]*\)$/.test(type) && !/^DECIMAL\([1-9][0-9]*,[0-9]+\)$/.test(type)) {
      throw new TypeError('Column types must come from the schema type builders.');
    }
    if (driver === 'mysql' && type.startsWith('DECIMAL')) {
      const dimensions = type.match(/[0-9]+/g)!.map(Number);
      if (dimensions[0] > 65 || dimensions[1] > 30) throw new Error('MySQL decimal precision exceeds its supported limits.');
    }
    if (driver === 'sqlite') return this.mapSQLiteType(type, col);
    if (driver === 'postgres') return this.mapPostgresType(type, col);
    return this.mapMySQLType(type, col);
  }

  private mapSQLiteType(type: string, col: ColumnDefinition): string {
    if (type === 'LONGTEXT') return 'TEXT';
    if (type === 'BOOLEAN') return 'INTEGER';
    if (type === 'UUID' || type === 'ULID') return 'TEXT';
    if (type.startsWith('ENUM')) return 'TEXT';
    if (type === 'JSON' || type === 'JSONB') return 'TEXT';
    if (type === 'BIGINT' && col.autoIncrement) return 'INTEGER';
    return type;
  }

  private mapPostgresType(type: string, col: ColumnDefinition): string {
    if (type === 'LONGTEXT') return 'TEXT';
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
    if (type === 'ENUM') {
      if (!col.enumValues?.length) throw new TypeError('Enums require values.');
      if (col.enumValues.some((value) => value.includes('\\'))) throw new Error('MySQL enum values containing backslashes require a reviewed raw migration.');
      return `ENUM(${col.enumValues.map((value) => this.defaultToSQL(value, 'mysql', false)).join(',')})`;
    }
    if (type === 'BOOLEAN') return 'TINYINT(1)';
    if (type === 'UUID') return 'CHAR(36)';
    if (type === 'ULID') return 'CHAR(26)';
    if (type === 'JSONB') return 'JSON'; // MySQL has no JSONB, uses JSON
    if (type === 'TIMESTAMP') return 'DATETIME';
    if (col.unsigned && !type.startsWith('DECIMAL')) return `${type} UNSIGNED`;
    return type;
  }

  private defaultToSQL(value: SchemaDefault, driver: DatabaseDriver, legacyTimeExpression: boolean = true): string {
    if (value === null) return 'NULL';
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new TypeError('Column defaults require finite numbers.');
      return String(value);
    }
    if (typeof value === 'bigint') return String(value);
    if (value instanceof Date) {
      if (!Number.isFinite(value.getTime())) throw new TypeError('Invalid date default.');
      return this.defaultToSQL(value.toISOString(), driver, false);
    }

    if (typeof value === 'string') {
      if (value.includes('\0')) throw new TypeError('Column defaults cannot contain NUL bytes.');
      const normalized = value.trim().toUpperCase();
      if (legacyTimeExpression && ['CURRENT_TIMESTAMP', 'CURRENT_DATE', 'CURRENT_TIME'].includes(normalized)) {
        return normalized;
      }
      if (value.includes('\\')) {
        if (driver === 'mysql') return `_utf8mb4 X'${Buffer.from(value, 'utf8').toString('hex')}'`;
        if (driver === 'postgres') return `E'${value.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`;
      }
      return `'${value.replaceAll("'", "''")}'`;
    }
    if (typeof value === 'object' && trustedExpressions.has(value)) return `(${expressionSQL(value as SchemaExpression)})`;
    throw new TypeError('Column defaults must be literals or Schema.expression(...), not arbitrary objects.');
  }
}

// ── Schema Facade ──────────────────────────────────────────

export class Schema {
  constructor(private connectionName?: string) {}

  static expression(sql: string): SchemaExpression { return SchemaExpression.trusted(sql); }

  async createTable(name: string, callback: (table: TableBuilder) => void): Promise<void> {
    name = assertSqlIdentifier(name, 'Table name');
    const builder = this.buildTable(callback);

    const driver = Connection.getDriver(this.connectionName);
    const statements = builder.toSQL(name, driver);
    this.assertConcurrentIndexes(builder);

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
    name = assertSqlIdentifier(name, 'Table name');
    const builder = this.buildTable(callback);

    const driver = Connection.getDriver(this.connectionName);
    const tableName = this.quoteIdentifier(name, 'Table name');
    const statements = [...builder.toDropIndexSQL(name, driver), ...builder.toDropCheckSQL(name, driver)];

    for (const col of builder.getColumns()) {
      if (col.change) continue;
      const colSQL = builder.columnToSQL(col, driver);
      statements.push(`ALTER TABLE ${tableName} ADD COLUMN ${colSQL}`);
    }
    statements.push(...builder.toChangeColumnSQL(name, driver));

    for (const rename of builder.getRenamedColumns()) {
      statements.push(`ALTER TABLE ${tableName} RENAME COLUMN ${this.quoteIdentifier(rename.from, 'Column name')} TO ${this.quoteIdentifier(rename.to, 'Column name')}`);
    }

    for (const column of builder.getDroppedColumns()) {
      statements.push(`ALTER TABLE ${tableName} DROP COLUMN ${this.quoteIdentifier(column, 'Column name')}`);
    }

    statements.push(...builder.toAddCheckSQL(name, driver), ...builder.toIndexSQL(name, driver));
    this.assertConcurrentIndexes(builder);
    for (const sql of statements) {
      await Connection.raw(sql, [], this.connectionName);
    }
  }

  async addColumn(table: string, callback: (tb: TableBuilder) => void): Promise<void> {
    await this.table(table, callback);
  }

  async dropColumn(table: string, column: string): Promise<void> {
    await this.table(table, (tb) => tb.dropColumn(column));
  }

  private assertConcurrentIndexes(builder: TableBuilder): void {
    if (builder.hasConcurrentIndexes() && Connection.inTransaction(this.connectionName)) {
      throw new Error('Concurrent index operations cannot run inside an active transaction.');
    }
  }

  private buildTable(callback: (table: TableBuilder) => void): TableBuilder {
    const builder = new TableBuilder();
    const result: unknown = callback(builder);
    if (result && typeof (result as any).then === 'function') {
      Promise.resolve(result).catch(() => {});
      throw new TypeError('Schema definition callbacks must be synchronous.');
    }
    return builder;
  }

  private quoteIdentifier(identifier: string, label: string = 'SQL identifier'): string {
    if (typeof identifier !== 'string') throw new TypeError('SQL identifiers must be strings.');
    const driver = Connection.getDriver(this.connectionName);
    const clean = assertSqlIdentifier(identifier, label);
    return driver === 'mysql' ? `\`${clean}\`` : `"${clean}"`;
  }
}

/** Default schema instance */
export const schema = singleton('svelar.schema', () => new Schema());
