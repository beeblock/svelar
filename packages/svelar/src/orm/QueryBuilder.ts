/**
 * Svelar QueryBuilder
 *
 * Eloquent-like fluent query builder that compiles to raw SQL.
 * Works across SQLite, PostgreSQL, and MySQL through the Connection manager.
 */

import { assertSqlIdentifier, Connection, type DatabaseDriver } from '../database/Connection.js';
import { ApplicationContext } from '../support/Context.js';

// ── Types ──────────────────────────────────────────────────

export type WhereOperator = '=' | '!=' | '<>' | '>' | '>=' | '<' | '<=' | 'LIKE' | 'NOT LIKE' | 'IN' | 'NOT IN' | 'IS' | 'IS NOT' | 'BETWEEN';
export type OrderDirection = 'asc' | 'desc';
export type JoinType = 'INNER' | 'LEFT' | 'RIGHT' | 'CROSS';

export type ScopeValue = string | number | boolean | bigint | Date | null;

/** Global scopes can only add parameterized conditions, not run or rewrite queries. */
export interface GlobalScopeQuery {
  where(column: string, value: ScopeValue): GlobalScopeQuery;
  where(column: string, operator: WhereOperator, value: ScopeValue): GlobalScopeQuery;
  orWhere(column: string, value: ScopeValue): GlobalScopeQuery;
  orWhere(column: string, operator: WhereOperator, value: ScopeValue): GlobalScopeQuery;
  whereIn(column: string, values: readonly ScopeValue[]): GlobalScopeQuery;
  whereNotIn(column: string, values: readonly ScopeValue[]): GlobalScopeQuery;
  whereNull(column: string): GlobalScopeQuery;
  whereNotNull(column: string): GlobalScopeQuery;
  whereBetween(column: string, values: readonly [ScopeValue, ScopeValue]): GlobalScopeQuery;
  whereNested(callback: GlobalScope): GlobalScopeQuery;
  orWhereNested(callback: GlobalScope): GlobalScopeQuery;
}

export type GlobalScope = (query: GlobalScopeQuery) => void | GlobalScopeQuery;

interface WhereClause {
  type: 'basic' | 'in' | 'notIn' | 'null' | 'notNull' | 'between' | 'raw' | 'nested' | 'or' | 'exists' | 'notExists' | 'sub';
  column?: string;
  operator?: string;
  value?: any;
  values?: any[];
  builder?: QueryBuilder;
  boolean: 'AND' | 'OR';
  raw?: string;
  subSQL?: string;
  subBindings?: any[];
  softDeleteScope?: boolean;
  tenantScope?: boolean;
  globalScope?: string;
}

interface CTEClause {
  name: string;
  sql: string;
  bindings: any[];
  recursive: boolean;
}

interface UnionClause {
  sql: string;
  bindings: any[];
  all: boolean;
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
  bindings?: any[];
  raw?: boolean;
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
  private cteClauses: CTEClause[] = [];
  private unionClauses: UnionClause[] = [];
  private rawSelectColumns = new Set<string>();
  private forceDeleting = false;
  private tenantScopeDisabled = false;
  private tenantScopeApplied = false;
  private explicitTenantScope = false;
  private globalScopesApplied = false;
  private disabledGlobalScopes = new Set<string>();
  private lockMode: 'update' | null = null;
  private useSkipLocked = false;
  private returningColumns: string[] = [];

  // Model class reference for hydrating results
  private modelClass?: any;

  constructor(table: string, modelClass?: any, connectionName?: string) {
    this.tableName = table;
    this.modelClass = modelClass;
    this.connectionName = connectionName;
    this.applySoftDeleteScope('without');
    this.applyTenantScope();
  }

  /** @internal Preserve the connection when delegating model persistence. */
  getConnectionName(): string | undefined {
    return this.connectionName;
  }

  private get softDeletes(): boolean {
    return Boolean(this.modelClass?.softDeletes);
  }

  private get deletedAtColumn(): string {
    return this.modelClass?.deletedAt ?? 'deleted_at';
  }

  private get tenantScoped(): boolean {
    return this.explicitTenantScope || Boolean(this.modelClass?.tenantScoped);
  }

  private get tenantColumn(): string {
    return this.modelClass?.tenantColumn ?? 'team_id';
  }

  private get requireTenantContext(): boolean {
    return this.modelClass?.requireTenantContext !== false;
  }

  private applyTenantScope(): void {
    this.whereClauses = this.whereClauses.filter((clause) => !clause.tenantScope);
    this.tenantScopeApplied = false;

    if (!this.tenantScoped || this.tenantScopeDisabled) return;

    const teamId = ApplicationContext.get<string | number | null>('teamId');
    if (teamId === undefined || teamId === null || teamId === '') return;

    this.whereClauses.push({
      type: 'basic',
      column: this.qualifyTableColumn(this.tenantColumn),
      operator: '=',
      value: teamId,
      boolean: 'AND',
      tenantScope: true,
    });
    this.tenantScopeApplied = true;
  }

  private ensureTenantScope(): void {
    this.ensureGlobalScopes();
    if (this.whereClauses.some((clause) => clause.globalScope) &&
        (this.unionClauses.length || this.tableName !== this.modelClass.table)) {
      throw new Error('Global-scoped queries cannot change their source table or add unions.');
    }
    if (!this.tenantScoped || this.tenantScopeDisabled) return;
    if (!this.tenantScopeApplied) this.applyTenantScope();

    if (!this.tenantScopeApplied && this.requireTenantContext) {
      throw new Error(
        `Tenant context is required for model "${this.modelClass?.name ?? this.tableName}". ` +
        'Wrap the operation in Teams.runWithTeam(...) or call withoutTenantScope() explicitly.',
      );
    }
  }

  withoutGlobalScope(name: string): this {
    if (!this.modelClass?.globalScopes?.().has(name)) throw new Error(`Unknown global scope "${name}".`);
    this.disabledGlobalScopes.add(name);
    this.whereClauses = this.whereClauses.filter((clause) => clause.globalScope !== name);
    return this;
  }

  /** @internal Used to reject stale instance mutations instead of reporting false success. */
  hasRowScopes(): boolean {
    this.ensureTenantScope();
    return this.whereClauses.some((clause) => clause.tenantScope || clause.softDeleteScope || clause.globalScope);
  }

  private ensureGlobalScopes(): void {
    if (this.globalScopesApplied) return;
    const clauses: WhereClause[] = [];
    for (const [name, callback] of this.modelClass?.globalScopes?.() ?? []) {
      if (this.disabledGlobalScopes.has(name)) continue;
      const builder = this.scopeConditions(callback);
      clauses.push({ type: 'nested', builder, boolean: 'AND', globalScope: name });
    }
    // Only publish a complete registry; a failing callback must never leave a partially scoped query.
    this.whereClauses.push(...clauses);
    this.globalScopesApplied = true;
  }

  private scopeConditions(callback: GlobalScope): QueryBuilder {
    const builder = new QueryBuilder(this.tableName, undefined, this.connectionName);
    let active = true;
    const column = (name: string): string => {
      if (!active) throw new Error('Global scope callbacks must be synchronous.');
      if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(name)) throw new TypeError('Global scopes require unqualified column names.');
      return name;
    };
    const value = (input: ScopeValue): ScopeValue => {
      if (input === null || ['string', 'boolean', 'bigint'].includes(typeof input)) return input;
      if (typeof input === 'number' && Number.isFinite(input)) return input;
      if (input instanceof Date && Number.isFinite(input.getTime())) return new Date(input);
      throw new TypeError('Global scopes require finite, scalar condition values.');
    };
    const basic = (boolean: 'AND' | 'OR', name: string, operatorOrValue: ScopeValue | WhereOperator, input?: ScopeValue) => {
      const key = column(name);
      const operator = input === undefined ? '=' : String(operatorOrValue).toUpperCase();
      builder.assertOperator(operator);
      if (['IN', 'NOT IN', 'BETWEEN'].includes(operator)) throw new TypeError('Use the dedicated global scope condition method.');
      const operand = value(input === undefined ? operatorOrValue as ScopeValue : input);
      builder.whereClauses.push(operand === null && ['=', '!=', '<>'].includes(operator)
        ? { type: operator === '=' ? 'null' : 'notNull', column: key, boolean }
        : { type: 'basic', column: key, operator, value: operand, boolean });
      return adapter;
    };
    const condition = (boolean: 'AND' | 'OR', name: string, args: [ScopeValue] | [WhereOperator, ScopeValue]) => {
      if ((args.length !== 1 && args.length !== 2) || args[args.length - 1] === undefined) {
        throw new TypeError('Global scope conditions require a value.');
      }
      return basic(boolean, name, args[0], args[1]);
    };
    const list = (type: 'in' | 'notIn' | 'between', name: string, inputs: readonly ScopeValue[]) => {
      const key = column(name);
      if (!Array.isArray(inputs) || inputs.length === 0 || (type === 'between' && inputs.length !== 2)) {
        throw new TypeError('Global scope lists must be nonempty; BETWEEN requires two values.');
      }
      builder.whereClauses.push({ type, column: key, values: inputs.map(value), boolean: 'AND' });
      return adapter;
    };
    const nested = (boolean: 'AND' | 'OR', scope: GlobalScope) => {
      if (!active) throw new Error('Global scope callbacks must be synchronous.');
      builder.whereClauses.push({ type: 'nested', builder: this.scopeConditions(scope), boolean });
      return adapter;
    };
    const adapter: GlobalScopeQuery = Object.freeze({
      where: (name: string, ...args: [ScopeValue] | [WhereOperator, ScopeValue]) => condition('AND', name, args),
      orWhere: (name: string, ...args: [ScopeValue] | [WhereOperator, ScopeValue]) => condition('OR', name, args),
      whereIn: (name: string, inputs: readonly ScopeValue[]) => list('in', name, inputs),
      whereNotIn: (name: string, inputs: readonly ScopeValue[]) => list('notIn', name, inputs),
      whereBetween: (name: string, inputs: readonly [ScopeValue, ScopeValue]) => list('between', name, inputs),
      whereNull: (name: string) => { builder.whereClauses.push({ type: 'null', column: column(name), boolean: 'AND' }); return adapter; },
      whereNotNull: (name: string) => { builder.whereClauses.push({ type: 'notNull', column: column(name), boolean: 'AND' }); return adapter; },
      whereNested: (scope: GlobalScope) => nested('AND', scope),
      orWhereNested: (scope: GlobalScope) => nested('OR', scope),
    });
    try {
      const result = callback(adapter);
      if (result && typeof (result as any).then === 'function') {
        Promise.resolve(result).catch(() => {});
        throw new TypeError('Global scope callbacks must be synchronous.');
      }
      if (builder.whereClauses.length === 0) throw new Error('A global scope must add conditions; disable it explicitly instead.');
    } finally { active = false; }
    return builder;
  }

  private applySoftDeleteScope(mode: 'without' | 'with' | 'only'): void {
    this.whereClauses = this.whereClauses.filter((clause) => !clause.softDeleteScope);

    if (!this.softDeletes || mode === 'with') return;

    this.whereClauses.push({
      type: mode === 'only' ? 'notNull' : 'null',
      column: this.qualifyTableColumn(this.deletedAtColumn),
      boolean: 'AND',
      softDeleteScope: true,
    });
  }

  private qualifyTableColumn(column: string): string {
    if (column.includes('.')) return column;
    return `${this.tableReferenceForColumn()}.${column}`;
  }

  private tableReferenceForColumn(): string {
    const aliased = this.tableName.match(/\s+as\s+([A-Za-z_][A-Za-z0-9_]*)$/i);
    if (aliased) return aliased[1];

    const implicitAlias = this.tableName.match(/^[A-Za-z_][A-Za-z0-9_$.]*\s+([A-Za-z_][A-Za-z0-9_]*)$/);
    if (implicitAlias) return implicitAlias[1];

    return this.tableName;
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

  from(table: string): this {
    this.tableName = table;
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
      this.assertOperator(operatorOrValue);
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
      this.assertOperator(operatorOrValue);
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

  withTrashed(): this {
    this.applySoftDeleteScope('with');
    return this;
  }

  withoutTrashed(): this {
    this.applySoftDeleteScope('without');
    return this;
  }

  onlyTrashed(): this {
    this.applySoftDeleteScope('only');
    return this;
  }

  withoutTenantScope(): this {
    this.tenantScopeDisabled = true;
    this.whereClauses = this.whereClauses.filter((clause) => !clause.tenantScope);
    this.tenantScopeApplied = false;
    return this;
  }

  forTenant(teamId: string | number): this {
    if ((typeof teamId !== 'string' && typeof teamId !== 'number') || teamId === '' ||
        (typeof teamId === 'number' && !Number.isSafeInteger(teamId))) {
      throw new Error('Tenant scope requires a nonempty string or safe integer.');
    }
    this.explicitTenantScope = true;
    this.tenantScopeDisabled = false;
    this.whereClauses = this.whereClauses.filter((clause) => !clause.tenantScope);
    this.whereClauses.push({
      type: 'basic', column: this.qualifyTableColumn(this.tenantColumn), operator: '=',
      value: teamId, boolean: 'AND', tenantScope: true,
    });
    this.tenantScopeApplied = true;
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

  whereNested(callback: (query: QueryBuilder) => void, bool: 'AND' | 'OR' = 'AND'): this {
    const nested = new QueryBuilder(this.tableName, undefined, this.connectionName);
    callback(nested);
    if (nested.whereClauses.length > 0) {
      const { whereSQL, whereBindings } = nested.buildWhere();
      // Strip the leading "WHERE " to get just the conditions
      const conditions = whereSQL.replace(/^WHERE /, '');
      this.whereClauses.push({
        type: 'raw',
        raw: `(${conditions})`,
        values: whereBindings,
        boolean: bool,
      });
    }
    return this;
  }

  orWhereNested(callback: (query: QueryBuilder) => void): this {
    return this.whereNested(callback, 'OR');
  }

  whereExists(callback: (query: QueryBuilder) => void): this {
    const sub = new QueryBuilder('__placeholder__', undefined, this.connectionName);
    callback(sub);
    const { sql, bindings } = sub.toSQL();
    this.whereClauses.push({
      type: 'exists',
      subSQL: sql,
      subBindings: bindings,
      boolean: 'AND',
    });
    return this;
  }

  whereNotExists(callback: (query: QueryBuilder) => void): this {
    const sub = new QueryBuilder('__placeholder__', undefined, this.connectionName);
    callback(sub);
    const { sql, bindings } = sub.toSQL();
    this.whereClauses.push({
      type: 'notExists',
      subSQL: sql,
      subBindings: bindings,
      boolean: 'AND',
    });
    return this;
  }

  whereSub(column: string, operator: string, callback: (query: QueryBuilder) => void): this {
    this.assertOperator(operator);
    const sub = new QueryBuilder('__placeholder__', undefined, this.connectionName);
    callback(sub);
    const { sql, bindings } = sub.toSQL();
    this.whereClauses.push({
      type: 'sub',
      column,
      operator,
      subSQL: sql,
      subBindings: bindings,
      boolean: 'AND',
    });
    return this;
  }

  orWhereRaw(sql: string, bindings: any[] = []): this {
    this.whereClauses.push({
      type: 'raw',
      raw: sql,
      values: bindings,
      boolean: 'OR',
    });
    return this;
  }

  orWhereIn(column: string, values: any[]): this {
    this.whereClauses.push({ type: 'in', column, values, boolean: 'OR' });
    return this;
  }

  orWhereNull(column: string): this {
    this.whereClauses.push({ type: 'null', column, boolean: 'OR' });
    return this;
  }

  orWhereNotNull(column: string): this {
    this.whereClauses.push({ type: 'notNull', column, boolean: 'OR' });
    return this;
  }

  // ── CTE (WITH) ─────────────────────────────────────────

  withCTE(name: string, callback: (query: QueryBuilder) => void, recursive: boolean = false): this {
    const sub = new QueryBuilder('__placeholder__', undefined, this.connectionName);
    callback(sub);
    const { sql, bindings } = sub.toSQL();
    this.cteClauses.push({ name, sql, bindings, recursive });
    return this;
  }

  withRecursiveCTE(name: string, callback: (query: QueryBuilder) => void): this {
    return this.withCTE(name, callback, true);
  }

  withRawCTE(name: string, sql: string, bindings: any[] = [], recursive: boolean = false): this {
    this.cteClauses.push({ name, sql, bindings, recursive });
    return this;
  }

  // ── UNION ──────────────────────────────────────────────

  union(callback: (query: QueryBuilder) => void): this {
    const sub = new QueryBuilder('__placeholder__', undefined, this.connectionName);
    callback(sub);
    const { sql, bindings } = sub.toSQL();
    this.unionClauses.push({ sql, bindings, all: false });
    return this;
  }

  unionAll(callback: (query: QueryBuilder) => void): this {
    const sub = new QueryBuilder('__placeholder__', undefined, this.connectionName);
    callback(sub);
    const { sql, bindings } = sub.toSQL();
    this.unionClauses.push({ sql, bindings, all: true });
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

  crossJoin(table: string): this {
    this.joinClauses.push({ type: 'CROSS', table, first: '', operator: '', second: '' });
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
    this.assertOperator(operator);
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

  async find(id: any, primaryKey?: string): Promise<TModel | null> {
    return this.where(primaryKey ?? this.modelClass?.primaryKey ?? 'id', id).first();
  }

  async findOrFail(id: any, primaryKey?: string): Promise<TModel> {
    return this.where(primaryKey ?? this.modelClass?.primaryKey ?? 'id', id).firstOrFail();
  }

  async count(column: string = '*'): Promise<number> {
    const { sql, bindings } = this.buildAggregate('COUNT', column);
    const rows = await Connection.raw(sql, bindings, this.connectionName);
    return Number(rows[0]?.aggregate ?? 0);
  }

  async countDistinct(column: string): Promise<number> {
    const { sql, bindings } = this.buildAggregate('COUNT DISTINCT', column);
    const rows = await Connection.raw(sql, bindings, this.connectionName);
    return Number(rows[0]?.aggregate ?? 0);
  }

  async sum(column: string): Promise<number> {
    const { sql, bindings } = this.buildAggregate('SUM', column);
    const rows = await Connection.raw(sql, bindings, this.connectionName);
    return Number(rows[0]?.aggregate ?? 0);
  }

  async avg(column: string): Promise<number> {
    const { sql, bindings } = this.buildAggregate('AVG', column);
    const rows = await Connection.raw(sql, bindings, this.connectionName);
    return Number(rows[0]?.aggregate ?? 0);
  }

  async max(column: string): Promise<any> {
    const { sql, bindings } = this.buildAggregate('MAX', column);
    const rows = await Connection.raw(sql, bindings, this.connectionName);
    return rows[0]?.aggregate ?? null;
  }

  async min(column: string): Promise<any> {
    const { sql, bindings } = this.buildAggregate('MIN', column);
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

  async value(column: string): Promise<any> {
    this.selectColumns = [column];
    this.limitValue = 1;
    const rows = await Connection.raw(
      this.toSQL().sql,
      this.toSQL().bindings,
      this.connectionName
    );
    return rows[0]?.[column] ?? null;
  }

  async chunk(size: number, callback: (items: TModel[], page: number) => Promise<boolean | void>): Promise<void> {
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const cloned = this.clone();
      cloned.limitValue = size;
      cloned.offsetValue = (page - 1) * size;
      const results = await cloned.get();

      if (results.length === 0) break;

      const shouldContinue = await callback(results, page);
      if (shouldContinue === false) break;

      if (results.length < size) break;
      page++;
    }
  }

  async chunkById(
    size: number,
    callback: (items: TModel[], lastId: any) => Promise<boolean | void>,
    column: string = this.modelClass?.primaryKey ?? 'id',
  ): Promise<void> {
    let lastId: any = null;

    for (;;) {
      const cloned = this.cloneForHelper();
      cloned.orderClauses = [];
      cloned.limitValue = size;
      cloned.orderBy(column, 'asc');
      if (lastId !== null && lastId !== undefined) {
        cloned.where(column, '>', lastId);
      }

      const results = await cloned.get();
      if (results.length === 0) break;

      const last = results[results.length - 1] as any;
      lastId = typeof last?.getAttribute === 'function' ? last.getAttribute(column) : last?.[column];
      const shouldContinue = await callback(results, lastId);
      if (shouldContinue === false || results.length < size) break;
    }
  }

  when(condition: boolean | any, callback: (query: this) => this): this {
    if (condition) {
      callback(this);
    }
    return this;
  }

  selectRaw(expression: string, bindings: any[] = []): this {
    if (this.selectColumns[0] === '*') {
      this.selectColumns = [expression];
    } else {
      this.selectColumns.push(expression);
    }
    this.rawSelectColumns.add(expression);
    if (bindings.length > 0) {
      if (!this._selectBindings) this._selectBindings = [];
      this._selectBindings.push(...bindings);
    }
    return this;
  }

  // ── INSERT / UPSERT ───────────────────────────────────────

  async upsert(
    data: Record<string, any> | Record<string, any>[],
    conflictColumns: string | string[],
    updateColumns?: string[]
  ): Promise<any> {
    const rows = (Array.isArray(data) ? data : [data]).map((row) => this.applyTenantInsertAttributes(row));
    if (rows.length === 0) return;
    this.assertSingleTableWrite();
    if (this.whereClauses.some((clause) => !clause.tenantScope)) {
      throw new Error('Upsert cannot apply row filters or soft-delete scopes. Use model helpers, or explicitly remove those filters.');
    }

    const driver = Connection.getDriver(this.connectionName);
    const columns = Object.keys(rows[0]);
    const conflict = Array.isArray(conflictColumns) ? conflictColumns : [conflictColumns];
    if (conflict.length === 0) throw new Error('Upsert requires at least one conflict column.');
    if (rows.some((row) => Object.keys(row).length !== columns.length || columns.some((column) => !(column in row)))) {
      throw new Error('Upsert rows must contain the same columns.');
    }
    const tenantProtected = this.tenantScoped && !this.tenantScopeDisabled;
    if (tenantProtected && (!columns.includes(this.tenantColumn) || !conflict.includes(this.tenantColumn))) {
      throw new Error(`Tenant-scoped upsert requires "${this.tenantColumn}" in the conflict columns.`);
    }
    const toUpdate = updateColumns ?? columns.filter((c) => !conflict.includes(c));
    const rowPlaceholders = rows.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');
    const values = rows.flatMap((row) => columns.map((column) => row[column]));

    let sql: string;
    const table = this.quoteIdentifier(this.tableName, 'Table name');
    const quotedColumns = columns.map((column) => this.quoteIdentifier(column, 'Column name'));
    const quotedConflict = conflict.map((column) => this.quoteIdentifier(column, 'Conflict column'));
    const quotedTenant = tenantProtected ? this.quoteIdentifier(this.tenantColumn, 'Tenant column') : '';

    if (driver === 'postgres') {
      const updateSet = toUpdate.map((c) => `${this.quoteIdentifier(c, 'Update column')} = EXCLUDED.${this.quoteIdentifier(c, 'Update column')}`).join(', ');
      const tenantGuard = tenantProtected ? ` WHERE ${table}.${quotedTenant} = EXCLUDED.${quotedTenant}` : '';
      sql = `INSERT INTO ${table} (${quotedColumns.join(', ')}) VALUES ${rowPlaceholders} ON CONFLICT (${quotedConflict.join(', ')}) ${updateSet ? `DO UPDATE SET ${updateSet}${tenantGuard}` : 'DO NOTHING'}`;
    } else if (driver === 'mysql') {
      const updateSet = toUpdate.map((c) => {
        const column = this.quoteIdentifier(c, 'Update column');
        return `${column} = ${tenantProtected ? `IF(${quotedTenant} = VALUES(${quotedTenant}), VALUES(${column}), ${column})` : `VALUES(${column})`}`;
      }).join(', ');
      sql = updateSet
        ? `INSERT INTO ${table} (${quotedColumns.join(', ')}) VALUES ${rowPlaceholders} ON DUPLICATE KEY UPDATE ${updateSet}`
        : `INSERT INTO ${table} (${quotedColumns.join(', ')}) VALUES ${rowPlaceholders} ON DUPLICATE KEY UPDATE ${quotedConflict[0]} = ${quotedConflict[0]}`;
    } else {
      // SQLite
      const updateSet = toUpdate.map((c) => `${this.quoteIdentifier(c, 'Update column')} = excluded.${this.quoteIdentifier(c, 'Update column')}`).join(', ');
      const tenantGuard = tenantProtected ? ` WHERE ${table}.${quotedTenant} = excluded.${quotedTenant}` : '';
      sql = `INSERT INTO ${table} (${quotedColumns.join(', ')}) VALUES ${rowPlaceholders} ON CONFLICT (${quotedConflict.join(', ')}) ${updateSet ? `DO UPDATE SET ${updateSet}${tenantGuard}` : 'DO NOTHING'}`;
    }

    return Connection.raw(sql, values, this.connectionName);
  }

  async insertMany(rows: Record<string, any>[]): Promise<any> {
    rows = rows.map((row) => this.applyTenantInsertAttributes(row));
    if (rows.length === 0) return;
    for (const row of rows) this.assertGlobalScopeInsert(row);
    const columns = Object.keys(rows[0]);
    const bindings: any[] = [];
    const rowPlaceholders: string[] = [];

    for (const row of rows) {
      const values = columns.map((c) => row[c]);
      bindings.push(...values);
      rowPlaceholders.push(`(${values.map(() => '?').join(', ')})`);
    }

    const sql = `INSERT INTO ${this.quoteIdentifier(this.tableName, 'Table name')} (${columns.map((column) => this.quoteIdentifier(column, 'Column name')).join(', ')}) VALUES ${rowPlaceholders.join(', ')}`;
    return Connection.raw(sql, bindings, this.connectionName);
  }

  async firstOrCreate(search: Record<string, any>, create: Record<string, any> = {}): Promise<TModel> {
    return (await this.findOrCreate(search, create)).model;
  }

  async updateOrCreate(search: Record<string, any>, update: Record<string, any>): Promise<TModel> {
    this.assertTenantAttributes(update);
    const { model, created } = await this.findOrCreate(search, update);
    if (created) return model;

    if (this.modelClass) {
      (model as any).fill(update);
      await (model as any).save(this.cloneForHelper());
      return model;
    }

    if (Object.keys(update).length === 0) return model;
    const id = (model as any).id;
    if (id === undefined || id === null) throw new Error('Raw-table updates require an id column.');
    const target = this.cloneForHelper().where('id', id);
    const affected = await target.update(update);
    if (affected === 0 && !await target.clone().exists()) {
      throw new Error('Record is no longer available in the query scope.');
    }
    return new QueryBuilder<TModel>(this.tableName, undefined, this.connectionName)
      .findOrFail(update.id ?? id);
  }

  private async findOrCreate(
    search: Record<string, any>,
    create: Record<string, any>,
  ): Promise<{ model: TModel; created: boolean }> {
    this.ensureTenantScope();
    this.assertTenantAttributes(search);
    this.assertTenantAttributes(create);
    this.assertSingleTableWrite();

    const query = this.cloneForHelper().select('*');
    query.rawSelectColumns.clear();
    query._selectBindings = undefined;
    for (const [key, value] of Object.entries(search)) {
      if (value === undefined) throw new Error(`Search attribute "${key}" must not be undefined.`);
      if (value === null) query.whereNull(key);
      else if (this.modelClass?.casts?.[key]) {
        const attributes = new this.modelClass();
        attributes.setAttribute(key, value);
        query.where(key, attributes.getAttributes()[key]);
      } else query.where(key, value);
    }
    const existing = await query.clone().first();
    if (existing) return { model: existing, created: false };

    if (!this.modelClass) {
      await new QueryBuilder(this.tableName, undefined, this.connectionName).select('id').limit(0).get();
    }

    let created = true;
    const recoverInsert = async (error: unknown): Promise<TModel> => {
      const code = (error as any)?.code;
      const nativeSqliteUnique = code === 'ERR_SQLITE_ERROR' && [1555, 2067].includes((error as any)?.errcode);
      if (!nativeSqliteUnique && !['23505', 'ER_DUP_ENTRY', 'SQLITE_CONSTRAINT_UNIQUE', 'SQLITE_CONSTRAINT_PRIMARYKEY'].includes(code)) {
        throw error;
      }
      const winner = await query.clone().first();
      if (!winner) throw error;
      created = false;
      return winner;
    };

    const data = { ...search, ...create };
    let model: TModel;
    if (this.modelClass) {
      const tenantData = this.applyTenantInsertAttributes(data);
      const tenantId = this.whereClauses.find((clause) => clause.tenantScope)?.value ?? tenantData[this.tenantColumn];
      if (this.tenantScoped && this.tenantScopeDisabled && this.requireTenantContext &&
          (tenantId === undefined || tenantId === null || tenantId === '')) {
        throw new Error('Unscoped tenant model creation requires an explicit tenant attribute.');
      }
      model = await this.modelClass.create(data, {
        query: this.clone(),
        tenantId: this.tenantScoped ? tenantId : undefined,
        recoverInsert,
      });
    } else {
      let id: any;
      try {
        const generatedId = await Connection.withSavepointIfNeeded(
          () => this.clone().insertGetId(data), this.connectionName,
        );
        id = data.id ?? generatedId;
      } catch (error) {
        model = await recoverInsert(error);
        return { model, created };
      }
      model = await new QueryBuilder<TModel>(this.tableName, undefined, this.connectionName).findOrFail(id);
    }
    return { model, created };
  }

  private assertTenantAttributes(attributes: Record<string, any>): void {
    this.ensureTenantScope();
    if (!this.tenantScoped || this.tenantScopeDisabled || !(this.tenantColumn in attributes)) return;
    const scope = this.whereClauses.find((clause) => clause.tenantScope);
    const tenant = attributes[this.tenantColumn];
    if (scope && ((typeof tenant !== 'string' && typeof tenant !== 'number') || String(tenant) !== String(scope.value))) {
      throw new Error(`Cannot write a different tenant through model "${this.modelClass?.name ?? this.tableName}".`);
    }
  }

  private assertSingleTableWrite(): void {
    if (this.joinClauses.length || this.groupByColumns.length || this.havingClauses.length ||
        this.cteClauses.length || this.unionClauses.length ||
        this.tableReferenceForColumn() !== this.tableName ||
        (this.modelClass && this.tableName !== this.modelClass.table)) {
      throw new Error('Write helpers require a single, unaliased model/table query.');
    }
  }

  private cloneForHelper(): QueryBuilder<TModel> {
    const query = this.clone();
    query.returningColumns = [];
    const scopes = query.whereClauses.filter((clause) => clause.tenantScope || clause.softDeleteScope || clause.globalScope);
    const predicates = query.whereClauses.filter((clause) => !clause.tenantScope && !clause.softDeleteScope && !clause.globalScope);
    if (predicates.length) {
      const { whereSQL, whereBindings } = query.compileWhereClauses(predicates);
      query.whereClauses = [...scopes, {
        type: 'raw', raw: `(${whereSQL.slice('WHERE '.length)})`, values: whereBindings, boolean: 'AND',
      }];
    }
    return query;
  }

  whereColumn(first: string, operatorOrSecond: string, second?: string): this {
    if (second === undefined) {
      this.whereClauses.push({
        type: 'raw',
        raw: `${this.quoteIdentifier(first, 'Column name')} = ${this.quoteIdentifier(operatorOrSecond, 'Column name')}`,
        values: [],
        boolean: 'AND',
      });
    } else {
      this.assertOperator(operatorOrSecond);
      this.whereClauses.push({
        type: 'raw',
        raw: `${this.quoteIdentifier(first, 'Column name')} ${operatorOrSecond} ${this.quoteIdentifier(second, 'Column name')}`,
        values: [],
        boolean: 'AND',
      });
    }
    return this;
  }

  havingRaw(sql: string, bindings: any[] = []): this {
    this.havingClauses.push({
      type: 'raw',
      raw: sql,
      values: bindings,
      boolean: 'AND',
    });
    return this;
  }

  orderByRaw(sql: string, bindings: any[] = []): this {
    // Store as a special order clause
    this.orderClauses.push({ column: sql, direction: 'asc' as OrderDirection, raw: true, bindings });
    return this;
  }

  returning(...columns: string[]): this {
    this.returningColumns = columns.length > 0 ? columns : ['*'];
    return this;
  }

  async insertReturning(data: Record<string, any>, columns: string[] = ['*']): Promise<any[]> {
    return await this.returning(...columns).insert(data);
  }

  async updateReturning(data: Record<string, any>, columns: string[] = ['*']): Promise<any[]> {
    return await this.returning(...columns).update(data) as unknown as any[];
  }

  async deleteReturning(columns: string[] = ['*']): Promise<any[]> {
    return await this.returning(...columns).delete() as unknown as any[];
  }

  forUpdate(): this {
    this.lockMode = 'update';
    return this;
  }

  skipLocked(): this {
    this.useSkipLocked = true;
    return this;
  }

  selectSub(callback: (query: QueryBuilder) => void, alias: string): this {
    const sub = new QueryBuilder('__placeholder__', undefined, this.connectionName);
    callback(sub);
    const { sql, bindings } = sub.toSQL();
    // We store bindings in a special way — they'll be prepended
    const expr = `(${sql}) as ${this.quoteIdentifier(alias, 'Alias')}`;
    if (this.selectColumns[0] === '*') {
      this.selectColumns = [expr];
    } else {
      this.selectColumns.push(expr);
    }
    // Store bindings for the subquery select
    if (!this._selectBindings) this._selectBindings = [];
    this._selectBindings.push(...bindings);
    return this;
  }

  private _selectBindings?: any[];

  async truncate(): Promise<void> {
    const driver = Connection.getDriver(this.connectionName);
    const table = this.quoteIdentifier(this.tableName, 'Table name');
    if (driver === 'sqlite') {
      await Connection.raw(`DELETE FROM ${table}`, [], this.connectionName);
      await Connection.raw(`DELETE FROM sqlite_sequence WHERE name = ?`, [this.tableName], this.connectionName);
    } else {
      await Connection.raw(`TRUNCATE TABLE ${table}`, [], this.connectionName);
    }
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
    data = this.applyTenantInsertAttributes(data);
    this.assertGlobalScopeInsert(data);
    const columns = Object.keys(data);
    const values = Object.values(data);
    const placeholders = values.map(() => '?').join(', ');

    const sql = `${this.buildInsertSQL(columns, placeholders)}${this.buildReturning()}`;
    return Connection.raw(sql, values, this.connectionName);
  }

  async insertGetId<TId = number>(data: Record<string, any>, primaryKey: string = 'id'): Promise<TId> {
    data = this.applyTenantInsertAttributes(data);
    this.assertGlobalScopeInsert(data);
    const driver = Connection.getDriver(this.connectionName);
    const columns = Object.keys(data);
    const values = Object.values(data);
    const placeholders = values.map(() => '?').join(', ');

    let sql = this.buildInsertSQL(columns, placeholders);

    if (driver === 'postgres') {
      sql += ` RETURNING ${this.quoteIdentifier(primaryKey, 'Primary key')}`;
      const rows = await Connection.raw(sql, values, this.connectionName);
      return rows[0]?.[primaryKey] as TId;
    }

    const result = await Connection.raw(sql, values, this.connectionName);
    if (data[primaryKey] !== undefined && data[primaryKey] !== null) return data[primaryKey] as TId;

    if (driver === 'sqlite') {
      return result.lastInsertRowid as TId;
    }

    if (driver === 'mysql') {
      return result.insertId as TId;
    }

    return 0 as TId;
  }

  private buildInsertSQL(columns: string[], placeholders: string): string {
    const table = this.quoteIdentifier(this.tableName, 'Table name');
    if (columns.length === 0) {
      return this.currentDriver() === 'mysql'
        ? `INSERT INTO ${table} () VALUES ()`
        : `INSERT INTO ${table} DEFAULT VALUES`;
    }
    return `INSERT INTO ${table} (${columns.map((column) => this.quoteIdentifier(column, 'Column name')).join(', ')}) VALUES (${placeholders})`;
  }

  async update(data: Record<string, any>): Promise<number> {
    this.ensureTenantScope();
    this.assertTenantAttributes(data);
    const columns = Object.keys(data);
    const values = Object.values(data);
    const setClause = columns.map((c) => `${this.quoteIdentifier(c, 'Column name')} = ?`).join(', ');

    const { whereSQL, whereBindings } = this.buildWhere();
    const returning = this.buildReturning();
    const sql = `UPDATE ${this.quoteIdentifier(this.tableName, 'Table name')} SET ${setClause}${whereSQL ? ` ${whereSQL}` : ''}${returning}`;

    const result = await Connection.raw(sql, [...values, ...whereBindings], this.connectionName);
    if (returning) return result as any;
    return this.affectedRows(result);
  }

  async delete(): Promise<number> {
    if (this.softDeletes && !this.forceDeleting) {
      return this.update({ [this.deletedAtColumn]: new Date().toISOString() });
    }

    this.ensureTenantScope();
    const { whereSQL, whereBindings } = this.buildWhere();
    const returning = this.buildReturning();
    const sql = `DELETE FROM ${this.quoteIdentifier(this.tableName, 'Table name')}${whereSQL ? ` ${whereSQL}` : ''}${returning}`;
    const result = await Connection.raw(sql, whereBindings, this.connectionName);
    if (returning) return result as any;
    return this.affectedRows(result);
  }

  async forceDelete(): Promise<number> {
    this.forceDeleting = true;
    try {
      return await this.delete();
    } finally {
      this.forceDeleting = false;
    }
  }

  async restore(): Promise<number> {
    if (!this.softDeletes) {
      throw new Error(`Model "${this.modelClass?.name ?? this.tableName}" does not use soft deletes.`);
    }

    return this.update({ [this.deletedAtColumn]: null });
  }

  async increment(column: string, amount: number = 1): Promise<void> {
    this.ensureTenantScope();
    const { whereSQL, whereBindings } = this.buildWhere();
    const quotedColumn = this.quoteIdentifier(column, 'Column name');
    const sql = `UPDATE ${this.quoteIdentifier(this.tableName, 'Table name')} SET ${quotedColumn} = ${quotedColumn} + ?${whereSQL ? ` ${whereSQL}` : ''}`;
    await Connection.raw(sql, [amount, ...whereBindings], this.connectionName);
  }

  async decrement(column: string, amount: number = 1): Promise<void> {
    return this.increment(column, -amount);
  }

  private affectedRows(result: any): number {
    if (!result) return 0;
    if (typeof result.changes === 'number') return result.changes;
    if (typeof result.affectedRows === 'number') return result.affectedRows;
    if (typeof result.rowCount === 'number') return result.rowCount;
    if (typeof result.count === 'number') return result.count;
    return 0;
  }

  // ── SQL COMPILATION ──────────────────────────────────────

  toSQL(): { sql: string; bindings: any[] } {
    this.ensureTenantScope();
    const parts: string[] = [];
    const bindings: any[] = [];

    // CTEs (WITH)
    if (this.cteClauses.length > 0) {
      const hasRecursive = this.cteClauses.some((c) => c.recursive);
      const cteKeyword = hasRecursive ? 'WITH RECURSIVE' : 'WITH';
      const cteParts = this.cteClauses.map((c) => {
        bindings.push(...c.bindings);
        return `${this.quoteIdentifier(c.name, 'CTE name')} AS (${c.sql})`;
      });
      parts.push(`${cteKeyword} ${cteParts.join(', ')}`);
    }

    // SELECT (with subquery bindings)
    if (this._selectBindings?.length) {
      bindings.push(...this._selectBindings);
    }
    const distinctStr = this.isDistinct ? 'DISTINCT ' : '';
    parts.push(`SELECT ${distinctStr}${this.selectColumns.map((column) => this.formatSelectColumn(column)).join(', ')}`);

    // FROM
    parts.push(`FROM ${this.quoteIdentifier(this.tableName, 'Table name')}`);

    // JOINs
    for (const join of this.joinClauses) {
      if (join.type === 'CROSS') {
        parts.push(`CROSS JOIN ${this.quoteIdentifier(join.table, 'Join table')}`);
      } else {
        this.assertOperator(join.operator);
        parts.push(`${join.type} JOIN ${this.quoteIdentifier(join.table, 'Join table')} ON ${this.quoteIdentifier(join.first, 'Join column')} ${join.operator} ${this.quoteIdentifier(join.second, 'Join column')}`);
      }
    }

    // WHERE
    const { whereSQL, whereBindings } = this.buildWhere();
    if (whereSQL) {
      parts.push(whereSQL.trim());
      bindings.push(...whereBindings);
    }

    // GROUP BY
    if (this.groupByColumns.length > 0) {
      parts.push(`GROUP BY ${this.groupByColumns.map((column) => this.quoteIdentifier(column, 'Group column')).join(', ')}`);
    }

    // HAVING
    if (this.havingClauses.length > 0) {
      const havingParts: string[] = [];
      for (const clause of this.havingClauses) {
        if (clause.type === 'raw') {
          havingParts.push(clause.raw!);
          if (clause.values) bindings.push(...clause.values);
        } else {
          this.assertOperator(clause.operator!);
          havingParts.push(`${this.quoteIdentifier(clause.column!, 'Having column')} ${clause.operator} ?`);
          bindings.push(clause.value);
        }
      }
      parts.push(`HAVING ${havingParts.join(' AND ')}`);
    }

    // ORDER BY
    if (this.orderClauses.length > 0) {
      const orderParts = this.orderClauses.map((o) =>
        o.raw ? o.column : `${this.quoteIdentifier(o.column, 'Order column')} ${o.direction.toUpperCase()}`
      );
      parts.push(`ORDER BY ${orderParts.join(', ')}`);
      for (const order of this.orderClauses) {
        if (order.raw && order.bindings?.length) bindings.push(...order.bindings);
      }
    }

    // LIMIT
    if (this.limitValue !== null) {
      parts.push(`LIMIT ${this.limitValue}`);
    }

    // OFFSET
    if (this.offsetValue !== null) {
      parts.push(`OFFSET ${this.offsetValue}`);
    }

    const lockSQL = this.buildLock();
    if (lockSQL) parts.push(lockSQL);

    // UNIONs
    if (this.unionClauses.length > 0) {
      for (const u of this.unionClauses) {
        parts.push(u.all ? 'UNION ALL' : 'UNION');
        parts.push(u.sql);
        bindings.push(...u.bindings);
      }
    }

    return { sql: parts.join(' '), bindings };
  }

  // ── CLONE ────────────────────────────────────────────────

  clone(): QueryBuilder<TModel> {
    this.ensureGlobalScopes();
    const cloned = new QueryBuilder<TModel>(this.tableName, this.modelClass, this.connectionName);
    cloned.selectColumns = [...this.selectColumns];
    cloned.whereClauses = this.whereClauses.map((clause) => ({
      ...clause, builder: clause.builder?.clone(),
      values: clause.values ? [...clause.values] : undefined,
    }));
    cloned.joinClauses = [...this.joinClauses];
    cloned.orderClauses = [...this.orderClauses];
    cloned.groupByColumns = [...this.groupByColumns];
    cloned.havingClauses = [...this.havingClauses];
    cloned.limitValue = this.limitValue;
    cloned.offsetValue = this.offsetValue;
    cloned.eagerLoads = [...this.eagerLoads];
    cloned.isDistinct = this.isDistinct;
    cloned.cteClauses = [...this.cteClauses];
    cloned.unionClauses = [...this.unionClauses];
    cloned.rawSelectColumns = new Set(this.rawSelectColumns);
    cloned._selectBindings = this._selectBindings ? [...this._selectBindings] : undefined;
    cloned.forceDeleting = this.forceDeleting;
    cloned.tenantScopeDisabled = this.tenantScopeDisabled;
    cloned.tenantScopeApplied = this.tenantScopeApplied;
    cloned.explicitTenantScope = this.explicitTenantScope;
    cloned.globalScopesApplied = this.globalScopesApplied;
    cloned.disabledGlobalScopes = new Set(this.disabledGlobalScopes);
    cloned.lockMode = this.lockMode;
    cloned.useSkipLocked = this.useSkipLocked;
    cloned.returningColumns = [...this.returningColumns];
    return cloned;
  }

  // ── PRIVATE ──────────────────────────────────────────────

  private buildWhere(): { whereSQL: string; whereBindings: any[] } {
    const scopes = this.whereClauses.filter((clause) => clause.tenantScope || clause.softDeleteScope || clause.globalScope);
    const predicates = this.whereClauses.filter((clause) => !clause.tenantScope && !clause.softDeleteScope && !clause.globalScope);
    if (scopes.length && predicates.length) {
      const scoped = this.compileWhereClauses(scopes);
      const filtered = this.compileWhereClauses(predicates);
      return {
        whereSQL: `${scoped.whereSQL} AND (${filtered.whereSQL.slice('WHERE '.length)})`,
        whereBindings: [...scoped.whereBindings, ...filtered.whereBindings],
      };
    }
    return this.compileWhereClauses(this.whereClauses);
  }

  private compileWhereClauses(clauses: WhereClause[], scopeTable?: string): { whereSQL: string; whereBindings: any[] } {
    if (clauses.length === 0) {
      return { whereSQL: '', whereBindings: [] };
    }

    const parts: string[] = [];
    const bindings: any[] = [];

    for (let i = 0; i < clauses.length; i++) {
      const clause = clauses[i];
      const prefix = i === 0 ? 'WHERE' : clause.boolean;
      const column = clause.column && scopeTable ? `${scopeTable}.${clause.column}` : clause.column;
      const bind = (value: any) => scopeTable && value instanceof Date ? new Date(value) : value;

      switch (clause.type) {
        case 'basic':
          this.assertOperator(clause.operator!);
          // Handle IS/IS NOT operators with null values specially
          if ((clause.operator === 'IS' || clause.operator === 'IS NOT') && clause.value === null) {
            const nullKeyword = clause.operator === 'IS' ? 'null' : 'null';
            parts.push(`${prefix} ${this.quoteIdentifier(column!, 'Where column')} ${clause.operator} ${nullKeyword}`);
          } else {
            parts.push(`${prefix} ${this.quoteIdentifier(column!, 'Where column')} ${clause.operator} ?`);
            bindings.push(bind(clause.value));
          }
          break;

        case 'in':
          const inPlaceholders = clause.values!.map(() => '?').join(', ');
          parts.push(`${prefix} ${this.quoteIdentifier(column!, 'Where column')} IN (${inPlaceholders})`);
          bindings.push(...clause.values!.map(bind));
          break;

        case 'notIn':
          const notInPlaceholders = clause.values!.map(() => '?').join(', ');
          parts.push(`${prefix} ${this.quoteIdentifier(column!, 'Where column')} NOT IN (${notInPlaceholders})`);
          bindings.push(...clause.values!.map(bind));
          break;

        case 'null':
          parts.push(`${prefix} ${this.quoteIdentifier(column!, 'Where column')} IS NULL`);
          break;

        case 'notNull':
          parts.push(`${prefix} ${this.quoteIdentifier(column!, 'Where column')} IS NOT NULL`);
          break;

        case 'between':
          parts.push(`${prefix} ${this.quoteIdentifier(column!, 'Where column')} BETWEEN ? AND ?`);
          bindings.push(bind(clause.values![0]), bind(clause.values![1]));
          break;

        case 'nested': {
          const nested = this.compileWhereClauses(clause.builder!.whereClauses,
            scopeTable ?? (clause.globalScope ? this.tableReferenceForColumn() : undefined));
          parts.push(`${prefix} (${nested.whereSQL.slice('WHERE '.length)})`);
          bindings.push(...nested.whereBindings);
          break;
        }

        case 'raw':
          parts.push(`${prefix} ${clause.raw}`);
          if (clause.values) bindings.push(...clause.values);
          break;

        case 'exists':
          parts.push(`${prefix} EXISTS (${clause.subSQL})`);
          if (clause.subBindings) bindings.push(...clause.subBindings);
          break;

        case 'notExists':
          parts.push(`${prefix} NOT EXISTS (${clause.subSQL})`);
          if (clause.subBindings) bindings.push(...clause.subBindings);
          break;

        case 'sub':
          this.assertOperator(clause.operator!);
          parts.push(`${prefix} ${this.quoteIdentifier(clause.column!, 'Where column')} ${clause.operator} (${clause.subSQL})`);
          if (clause.subBindings) bindings.push(...clause.subBindings);
          break;
      }
    }

    return { whereSQL: parts.join(' '), whereBindings: bindings };
  }

  private applyTenantInsertAttributes(data: Record<string, any>): Record<string, any> {
    this.assertTenantAttributes(data);
    if (!this.tenantScoped || this.tenantScopeDisabled || this.tenantColumn in data) {
      return data;
    }

    const teamId = this.whereClauses.find((clause) => clause.tenantScope)?.value ??
      ApplicationContext.get<string | number | null>('teamId');
    if (teamId === undefined || teamId === null || teamId === '') {
      if (!this.requireTenantContext) return data;
      throw new Error(
        `Tenant context is required for model "${this.modelClass?.name ?? this.tableName}". ` +
        'Wrap the operation in Teams.runWithTeam(...) or call withoutTenantScope() explicitly.',
      );
    }

    return { ...data, [this.tenantColumn]: teamId };
  }

  private assertGlobalScopeInsert(data: Record<string, any>): void {
    const scopes = this.whereClauses.filter((clause) => clause.globalScope);
    if (!scopes.length) return;
    this.assertSingleTableWrite();
    const columns = new Set<string>();
    const collect = (clauses: WhereClause[]) => {
      for (const clause of clauses) {
        if (clause.column) columns.add(clause.column);
        if (clause.builder) collect(clause.builder.whereClauses);
      }
    };
    collect(scopes);
    for (const column of columns) {
      if (!(column in data) || data[column] === undefined) {
        throw new Error(`Global-scoped inserts require an explicit "${column}" value; database defaults are not inferred.`);
      }
    }
    const scalar = (value: any) => value instanceof Date ? value.toISOString()
      : this.currentDriver() === 'sqlite' && typeof value === 'boolean' ? Number(value) : value;
    // Do not emulate arbitrary SQL: affinity, collation and NULL semantics vary across drivers.
    const evaluate = (clauses: WhereClause[]): boolean => {
      let disjunction = false;
      let conjunction = true;
      for (const [index, clause] of clauses.entries()) {
        let matches: boolean;
        const actual = clause.column ? data[clause.column] : undefined;
        if (clause.type === 'nested') matches = evaluate(clause.builder!.whereClauses);
        else if (clause.type === 'null') matches = actual === null;
        else if (clause.type === 'notNull') matches = actual != null;
        else if (clause.type === 'basic' && clause.operator === '=') {
          matches = actual != null && clause.value != null && scalar(actual) === scalar(clause.value);
        } else if (clause.type === 'in') {
          matches = actual != null && clause.values!.some((value) => value != null && scalar(actual) === scalar(value));
        } else {
          throw new Error('Global-scoped inserts only support equality, IN and null conditions. Disable the scope explicitly for other predicates.');
        }
        if (index > 0 && clause.boolean === 'OR') { disjunction ||= conjunction; conjunction = matches; }
        else conjunction &&= matches;
      }
      return disjunction || conjunction;
    };
    if (!evaluate(scopes)) throw new Error('Insert does not satisfy the model global scopes.');
  }

  private buildAggregate(fn: string, column: string): { sql: string; bindings: any[] } {
    const savedSelect = this.selectColumns;
    const savedOrder = this.orderClauses;
    const savedLimit = this.limitValue;
    const savedOffset = this.offsetValue;
    const savedBindings = this._selectBindings;
    const expression = fn === 'COUNT DISTINCT'
      ? `COUNT(DISTINCT ${this.quoteIdentifier(column, 'Aggregate column')}) as aggregate`
      : `${fn}(${this.quoteIdentifier(column, 'Aggregate column')}) as aggregate`;
    this.selectColumns = [expression];
    this.orderClauses = [];
    this.limitValue = null;
    this.offsetValue = null;
    this._selectBindings = undefined;
    try { return this.toSQL(); }
    finally {
      this.selectColumns = savedSelect;
      this.orderClauses = savedOrder;
      this.limitValue = savedLimit;
      this.offsetValue = savedOffset;
      this._selectBindings = savedBindings;
    }
  }

  private buildReturning(): string {
    if (this.returningColumns.length === 0) return '';
    const driver = this.currentDriver();
    if (driver === 'mysql') {
      throw new Error('RETURNING is not supported by the MySQL query builder.');
    }
    return ` RETURNING ${this.returningColumns.map((column) => this.formatSelectColumn(column)).join(', ')}`;
  }

  private buildLock(): string {
    if (!this.lockMode) return '';
    const driver = this.currentDriver();
    if (driver === 'sqlite') return '';
    let sql = this.lockMode === 'update' ? 'FOR UPDATE' : '';
    if (sql && this.useSkipLocked) sql += ' SKIP LOCKED';
    return sql;
  }

  private currentDriver(): DatabaseDriver {
    try {
      return Connection.getDriver(this.connectionName);
    } catch {
      return 'sqlite';
    }
  }

  private quoteIdentifier(identifier: string, label: string = 'SQL identifier'): string {
    if (identifier === '*') return '*';

    const aliasMatch = identifier.match(/^(.+?)\s+as\s+(.+)$/i);
    if (aliasMatch) {
      return `${this.quoteIdentifier(aliasMatch[1].trim(), label)} as ${this.quoteIdentifier(aliasMatch[2].trim(), 'Alias')}`;
    }

    const implicitAliasMatch = identifier.match(/^([A-Za-z_][A-Za-z0-9_$.]*)\s+([A-Za-z_][A-Za-z0-9_]*)$/);
    if (implicitAliasMatch) {
      return `${this.quoteIdentifier(implicitAliasMatch[1], label)} ${this.quoteIdentifier(implicitAliasMatch[2], 'Alias')}`;
    }

    const driver = this.currentDriver();
    return identifier
      .split('.')
      .map((part) => {
        if (part === '*') return '*';
        const clean = assertSqlIdentifier(part, label);
        return driver === 'mysql' ? `\`${clean}\`` : `"${clean}"`;
      })
      .join('.');
  }

  private formatSelectColumn(column: string): string {
    if (column === '*') return '*';
    if (this.rawSelectColumns.has(column)) return column;
    if (/^[A-Z]+\(.+\)\s+as\s+[A-Za-z_][A-Za-z0-9_]*$/i.test(column)) {
      return column.replace(/\s+as\s+([A-Za-z_][A-Za-z0-9_]*)$/i, (_match, alias) => ` as ${this.quoteIdentifier(alias, 'Alias')}`);
    }
    if (column.trim().startsWith('(')) return column;
    return this.quoteIdentifier(column, 'Select column');
  }

  private assertOperator(operator: string): void {
    const allowed = ['=', '!=', '<>', '>', '>=', '<', '<=', 'LIKE', 'NOT LIKE', 'IN', 'NOT IN', 'IS', 'IS NOT', 'BETWEEN'];
    if (!allowed.includes(operator.toUpperCase())) {
      throw new Error(`SQL operator contains invalid characters: "${operator}"`);
    }
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
