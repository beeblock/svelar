/**
 * Svelar QueryBuilder
 *
 * Eloquent-like fluent query builder that compiles to raw SQL.
 * Works across SQLite, PostgreSQL, and MySQL through the Connection manager.
 */

import { Connection, type DatabaseDriver } from '../database/Connection.js';

// ── Types ──────────────────────────────────────────────────

export type WhereOperator = '=' | '!=' | '<>' | '>' | '>=' | '<' | '<=' | 'LIKE' | 'NOT LIKE' | 'IN' | 'NOT IN' | 'IS' | 'IS NOT' | 'BETWEEN';
export type OrderDirection = 'asc' | 'desc';
export type JoinType = 'INNER' | 'LEFT' | 'RIGHT' | 'CROSS';

interface WhereClause {
  type: 'basic' | 'in' | 'notIn' | 'null' | 'notNull' | 'between' | 'raw' | 'nested' | 'or';
  column?: string;
  operator?: string;
  value?: any;
  values?: any[];
  builder?: QueryBuilder;
  boolean: 'AND' | 'OR';
  raw?: string;
}

interface JoinClause {
  type: JoinType;
  table: string;
  first: string;
  operator: string;
  second: string;
}

interface OrderClause {
  column: string;
  direction: OrderDirection;
}

interface PaginationResult<T> {
  data: T[];
  total: number;
  page: number;
  perPage: number;
  lastPage: number;
  hasMore: boolean;
}

// ── QueryBuilder ───────────────────────────────────────────

export class QueryBuilder<TModel = any> {
  private tableName: string;
  private selectColumns: string[] = ['*'];
  private whereClauses: WhereClause[] = [];
  private joinClauses: JoinClause[] = [];
  private orderClauses: OrderClause[] = [];
  private groupByColumns: string[] = [];
  private havingClauses: WhereClause[] = [];
  private limitValue: number | null = null;
  private offsetValue: number | null = null;
  private eagerLoads: string[] = [];
  private isDistinct = false;
  private connectionName?: string;

  // Model class reference for hydrating results
  private modelClass?: any;

  constructor(table: string, modelClass?: any, connectionName?: string) {
    this.tableName = table;
    this.modelClass = modelClass;
    this.connectionName = connectionName;
  }

  // ── SELECT ───────────────────────────────────────────────

  select(...columns: string[]): this {
    this.selectColumns = columns.length > 0 ? columns : ['*'];
    return this;
  }

  addSelect(...columns: string[]): this {
    if (this.selectColumns[0] === '*') {
      this.selectColumns = columns;
    } else {
      this.selectColumns.push(...columns);
    }
    return this;
  }

  distinct(): this {
    this.isDistinct = true;
    return this;
  }

  // ── WHERE ────────────────────────────────────────────────

  where(column: string, operatorOrValue?: any, value?: any): this {
    if (value === undefined) {
      // Two-argument form: where('name', 'John') → where name = 'John'
      this.whereClauses.push({
        type: 'basic',
        column,
        operator: '=',
        value: operatorOrValue,
        boolean: 'AND',
      });
    } else {
      this.whereClauses.push({
        type: 'basic',
        column,
        operator: operatorOrValue,
        value,
        boolean: 'AND',
      });
    }
    return this;
  }

  orWhere(column: string, operatorOrValue?: any, value?: any): this {
    if (value === undefined) {
      this.whereClauses.push({
        type: 'basic',
        column,
        operator: '=',
        value: operatorOrValue,
        boolean: 'OR',
      });
    } else {
      this.whereClauses.push({
        type: 'basic',
        column,
        operator: operatorOrValue,
        value,
        boolean: 'OR',
      });
    }
    return this;
  }

  whereIn(column: string, values: any[]): this {
    this.whereClauses.push({ type: 'in', column, values, boolean: 'AND' });
    return this;
  }

  whereNotIn(column: string, values: any[]): this {
    this.whereClauses.push({ type: 'notIn', column, values, boolean: 'AND' });
    return this;
  }

  whereNull(column: string): this {
    this.whereClauses.push({ type: 'null', column, boolean: 'AND' });
    return this;
  }

  whereNotNull(column: string): this {
    this.whereClauses.push({ type: 'notNull', column, boolean: 'AND' });
    return this;
  }

  whereBetween(column: string, range: [any, any]): this {
    this.whereClauses.push({
      type: 'between',
      column,
      values: range,
      boolean: 'AND',
    });
    return this;
  }

  whereRaw(sql: string, bindings: any[] = []): this {
    this.whereClauses.push({
      type: 'raw',
      raw: sql,
      values: bindings,
      boolean: 'AND',
    });
    return this;
  }

  // ── JOIN ─────────────────────────────────────────────────

  join(table: string, first: string, operator: string, second: string): this {
    this.joinClauses.push({ type: 'INNER', table, first, operator, second });
    return this;
  }

  leftJoin(table: string, first: string, operator: string, second: string): this {
    this.joinClauses.push({ type: 'LEFT', table, first, operator, second });
    return this;
  }

  rightJoin(table: string, first: string, operator: string, second: string): this {
    this.joinClauses.push({ type: 'RIGHT', table, first, operator, second });
    return this;
  }

  // ── ORDER / GROUP / LIMIT ────────────────────────────────

  orderBy(column: string, direction: OrderDirection = 'asc'): this {
    this.orderClauses.push({ column, direction });
    return this;
  }

  latest(column: string = 'created_at'): this {
    return this.orderBy(column, 'desc');
  }

  oldest(column: string = 'created_at'): this {
    return this.orderBy(column, 'asc');
  }

  groupBy(...columns: string[]): this {
    this.groupByColumns.push(...columns);
    return this;
  }

  having(column: string, operator: string, value: any): this {
    this.havingClauses.push({
      type: 'basic',
      column,
      operator,
      value,
      boolean: 'AND',
    });
    return this;
  }

  limit(count: number): this {
    this.limitValue = count;
    return this;
  }

  offset(skip: number): this {
    this.offsetValue = skip;
    return this;
  }

  take(count: number): this {
    return this.limit(count);
  }

  skip(count: number): this {
    return this.offset(count);
  }

  // ── EAGER LOADING ────────────────────────────────────────

  with(...relations: string[]): this {
    this.eagerLoads.push(...relations);
    return this;
  }

  // ── EXECUTION ────────────────────────────────────────────

  async get(): Promise<TModel[]> {
    const { sql, bindings } = this.toSQL();
    const rows = await Connection.raw(sql, bindings, this.connectionName);
    const models = this.hydrateMany(rows);

    // Eager load relations
    if (this.eagerLoads.length > 0 && this.modelClass) {
      await this.loadRelations(models);
    }

    return models;
  }

  async first(): Promise<TModel | null> {
    this.limitValue = 1;
    const results = await this.get();
    return results[0] ?? null;
  }

  async firstOrFail(): Promise<TModel> {
    const result = await this.first();
    if (!result) {
      throw new Error(`No results found for query on "${this.tableName}".`);
    }
    return result;
  }

  async find(id: any, primaryKey: string = 'id'): Promise<TModel | null> {
    return this.where(primaryKey, id).first();
  }

  async findOrFail(id: any, primaryKey: string = 'id'): Promise<TModel> {
    return this.where(primaryKey, id).firstOrFail();
  }

  async count(column: string = '*'): Promise<number> {
    const { sql, bindings } = this.buildAggregate(`COUNT(${column})`);
    const rows = await Connection.raw(sql, bindings, this.connectionName);
    return Number(rows[0]?.aggregate ?? 0);
  }

  async sum(column: string): Promise<number> {
    const { sql, bindings } = this.buildAggregate(`SUM(${column})`);
    const rows = await Connection.raw(sql, bindings, this.connectionName);
    return Number(rows[0]?.aggregate ?? 0);
  }

  async avg(column: string): Promise<number> {
    const { sql, bindings } = this.buildAggregate(`AVG(${column})`);
    const rows = await Connection.raw(sql, bindings, this.connectionName);
    return Number(rows[0]?.aggregate ?? 0);
  }

  async max(column: string): Promise<any> {
    const { sql, bindings } = this.buildAggregate(`MAX(${column})`);
    const rows = await Connection.raw(sql, bindings, this.connectionName);
    return rows[0]?.aggregate ?? null;
  }

  async min(column: string): Promise<any> {
    const { sql, bindings } = this.buildAggregate(`MIN(${column})`);
    const rows = await Connection.raw(sql, bindings, this.connectionName);
    return rows[0]?.aggregate ?? null;
  }

  async exists(): Promise<boolean> {
    return (await this.count()) > 0;
  }

  async doesntExist(): Promise<boolean> {
    return !(await this.exists());
  }

  async pluck(column: string): Promise<any[]> {
    this.selectColumns = [column];
    const rows = await Connection.raw(
      this.toSQL().sql,
      this.toSQL().bindings,
      this.connectionName
    );
    return rows.map((r: any) => r[column]);
  }

  async paginate(page: number = 1, perPage: number = 15): Promise<PaginationResult<TModel>> {
    const total = await this.clone().count();
    const lastPage = Math.ceil(total / perPage);

    this.limitValue = perPage;
    this.offsetValue = (page - 1) * perPage;
    const data = await this.get();

    return {
      data,
      total,
      page,
      perPage,
      lastPage,
      hasMore: page < lastPage,
    };
  }

  // ── INSERT / UPDATE / DELETE ─────────────────────────────

  async insert(data: Record<string, any>): Promise<any> {
    const columns = Object.keys(data);
    const values = Object.values(data);
    const placeholders = values.map(() => '?').join(', ');

    const sql = `INSERT INTO ${this.tableName} (${columns.join(', ')}) VALUES (${placeholders})`;
    return Connection.raw(sql, values, this.connectionName);
  }

  async insertGetId(data: Record<string, any>, primaryKey: string = 'id'): Promise<number> {
    const driver = Connection.getDriver(this.connectionName);
    const columns = Object.keys(data);
    const values = Object.values(data);
    const placeholders = values.map(() => '?').join(', ');

    let sql = `INSERT INTO ${this.tableName} (${columns.join(', ')}) VALUES (${placeholders})`;

    if (driver === 'postgres') {
      sql += ` RETURNING ${primaryKey}`;
      const rows = await Connection.raw(sql, values, this.connectionName);
      return rows[0]?.[primaryKey];
    }

    await Connection.raw(sql, values, this.connectionName);

    if (driver === 'sqlite') {
      const rows = await Connection.raw('SELECT last_insert_rowid() as id', [], this.connectionName);
      return rows[0]?.id;
    }

    if (driver === 'mysql') {
      const rows = await Connection.raw('SELECT LAST_INSERT_ID() as id', [], this.connectionName);
      return rows[0]?.id;
    }

    return 0;
  }

  async update(data: Record<string, any>): Promise<number> {
    const columns = Object.keys(data);
    const values = Object.values(data);
    const setClause = columns.map((c) => `${c} = ?`).join(', ');

    const { whereSQL, whereBindings } = this.buildWhere();
    const sql = `UPDATE ${this.tableName} SET ${setClause}${whereSQL}`;

    await Connection.raw(sql, [...values, ...whereBindings], this.connectionName);
    return 1; // Simplified — real impl would return affected rows
  }

  async delete(): Promise<number> {
    const { whereSQL, whereBindings } = this.buildWhere();
    const sql = `DELETE FROM ${this.tableName}${whereSQL}`;
    await Connection.raw(sql, whereBindings, this.connectionName);
    return 1;
  }

  async increment(column: string, amount: number = 1): Promise<void> {
    const { whereSQL, whereBindings } = this.buildWhere();
    const sql = `UPDATE ${this.tableName} SET ${column} = ${column} + ?${whereSQL}`;
    await Connection.raw(sql, [amount, ...whereBindings], this.connectionName);
  }

  async decrement(column: string, amount: number = 1): Promise<void> {
    return this.increment(column, -amount);
  }

  // ── SQL COMPILATION ──────────────────────────────────────

  toSQL(): { sql: string; bindings: any[] } {
    const parts: string[] = [];
    const bindings: any[] = [];

    // SELECT
    const distinctStr = this.isDistinct ? 'DISTINCT ' : '';
    parts.push(`SELECT ${distinctStr}${this.selectColumns.join(', ')}`);

    // FROM
    parts.push(`FROM ${this.tableName}`);

    // JOINs
    for (const join of this.joinClauses) {
      parts.push(`${join.type} JOIN ${join.table} ON ${join.first} ${join.operator} ${join.second}`);
    }

    // WHERE
    const { whereSQL, whereBindings } = this.buildWhere();
    if (whereSQL) {
      parts.push(whereSQL.trim());
      bindings.push(...whereBindings);
    }

    // GROUP BY
    if (this.groupByColumns.length > 0) {
      parts.push(`GROUP BY ${this.groupByColumns.join(', ')}`);
    }

    // HAVING
    if (this.havingClauses.length > 0) {
      const havingParts: string[] = [];
      for (const clause of this.havingClauses) {
        havingParts.push(`${clause.column} ${clause.operator} ?`);
        bindings.push(clause.value);
      }
      parts.push(`HAVING ${havingParts.join(' AND ')}`);
    }

    // ORDER BY
    if (this.orderClauses.length > 0) {
      const orderParts = this.orderClauses.map((o) => `${o.column} ${o.direction.toUpperCase()}`);
      parts.push(`ORDER BY ${orderParts.join(', ')}`);
    }

    // LIMIT
    if (this.limitValue !== null) {
      parts.push(`LIMIT ${this.limitValue}`);
    }

    // OFFSET
    if (this.offsetValue !== null) {
      parts.push(`OFFSET ${this.offsetValue}`);
    }

    return { sql: parts.join(' '), bindings };
  }

  // ── CLONE ────────────────────────────────────────────────

  clone(): QueryBuilder<TModel> {
    const cloned = new QueryBuilder<TModel>(this.tableName, this.modelClass, this.connectionName);
    cloned.selectColumns = [...this.selectColumns];
    cloned.whereClauses = [...this.whereClauses];
    cloned.joinClauses = [...this.joinClauses];
    cloned.orderClauses = [...this.orderClauses];
    cloned.groupByColumns = [...this.groupByColumns];
    cloned.havingClauses = [...this.havingClauses];
    cloned.limitValue = this.limitValue;
    cloned.offsetValue = this.offsetValue;
    cloned.eagerLoads = [...this.eagerLoads];
    cloned.isDistinct = this.isDistinct;
    return cloned;
  }

  // ── PRIVATE ──────────────────────────────────────────────

  private buildWhere(): { whereSQL: string; whereBindings: any[] } {
    if (this.whereClauses.length === 0) {
      return { whereSQL: '', whereBindings: [] };
    }

    const parts: string[] = [];
    const bindings: any[] = [];

    for (let i = 0; i < this.whereClauses.length; i++) {
      const clause = this.whereClauses[i];
      const prefix = i === 0 ? 'WHERE' : clause.boolean;

      switch (clause.type) {
        case 'basic':
          // Handle IS/IS NOT operators with null values specially
          if ((clause.operator === 'IS' || clause.operator === 'IS NOT') && clause.value === null) {
            const nullKeyword = clause.operator === 'IS' ? 'null' : 'null';
            parts.push(`${prefix} ${clause.column} ${clause.operator} ${nullKeyword}`);
          } else {
            parts.push(`${prefix} ${clause.column} ${clause.operator} ?`);
            bindings.push(clause.value);
          }
          break;

        case 'in':
          const inPlaceholders = clause.values!.map(() => '?').join(', ');
          parts.push(`${prefix} ${clause.column} IN (${inPlaceholders})`);
          bindings.push(...clause.values!);
          break;

        case 'notIn':
          const notInPlaceholders = clause.values!.map(() => '?').join(', ');
          parts.push(`${prefix} ${clause.column} NOT IN (${notInPlaceholders})`);
          bindings.push(...clause.values!);
          break;

        case 'null':
          parts.push(`${prefix} ${clause.column} IS NULL`);
          break;

        case 'notNull':
          parts.push(`${prefix} ${clause.column} IS NOT NULL`);
          break;

        case 'between':
          parts.push(`${prefix} ${clause.column} BETWEEN ? AND ?`);
          bindings.push(clause.values![0], clause.values![1]);
          break;

        case 'raw':
          parts.push(`${prefix} ${clause.raw}`);
          if (clause.values) bindings.push(...clause.values);
          break;
      }
    }

    return { whereSQL: parts.join(' '), whereBindings: bindings };
  }

  private buildAggregate(fn: string): { sql: string; bindings: any[] } {
    const savedSelect = this.selectColumns;
    this.selectColumns = [`${fn} as aggregate`];
    const result = this.toSQL();
    this.selectColumns = savedSelect;
    return result;
  }

  private hydrateMany(rows: any[]): TModel[] {
    if (!this.modelClass) return rows as TModel[];
    return rows.map((row) => this.modelClass.hydrate(row));
  }

  private async loadRelations(models: TModel[]): Promise<void> {
    if (!this.modelClass || models.length === 0) return;

    for (const relationName of this.eagerLoads) {
      // Create a temporary instance to access the relationship method
      const instance = new this.modelClass();
      const relation = instance[relationName]?.();

      if (relation && typeof relation.eagerLoad === 'function') {
        await relation.eagerLoad(models, relationName);
      }
    }
  }
}
