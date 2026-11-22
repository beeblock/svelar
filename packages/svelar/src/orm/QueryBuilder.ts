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
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonLengthOperator = '=' | '!=' | '<>' | '>' | '>=' | '<' | '<=';
export interface WindowOrder { column: string; direction?: OrderDirection }
interface WindowOptions { partitionBy?: readonly string[]; orderBy?: readonly WindowOrder[] }
export type WindowSpecification = WindowOptions & (
  | { function: 'row_number' | 'rank' | 'dense_rank'; column?: never; frame?: never }
  | { function: 'count' | 'sum' | 'avg' | 'min' | 'max'; column: string; frame?: 'partition' | 'running' }
);

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

/** Model attributes are driver values in lean mode, not cast model properties. */
export type LeanResult<T> = T extends { getAttributes(): unknown }
  ? Record<string, unknown>
  : T extends object ? T : Record<string, unknown>;

interface WhereClause {
  type: 'basic' | 'in' | 'notIn' | 'null' | 'notNull' | 'between' | 'raw' | 'nested' | 'or' | 'exists' | 'notExists' | 'sub';
  column?: string;
  operator?: string;
  value?: any;
  values?: any[];
  builder?: QueryBuilder;
  conditions?: WhereClause[];
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

interface TableJoinClause {
  type: JoinType;
  table: string;
  first: string;
  operator: string;
  second: string;
}

interface LateralJoinClause {
  type: 'LEFT' | 'CROSS';
  lateral: true;
  alias: string;
  sql: string;
  bindings: any[];
  connection: WeakRef<object>;
  driver: DatabaseDriver;
}

type JoinClause = TableJoinClause | LateralJoinClause;

interface BindingSlot {
  root: 'where' | 'having';
  path: number[];
  source: 'value' | 'array' | 'element';
  index?: number;
  scope: boolean;
}

interface CompiledQuery {
  shape: string;
  sql: string;
  slots: BindingSlot[];
}

const whereOperators = new Set(['=', '!=', '<>', '>', '>=', '<', '<=', 'LIKE', 'NOT LIKE', 'IN', 'NOT IN', 'IS', 'IS NOT', 'BETWEEN']);
const scopeAdapters = new WeakMap<ScopeConditions, { clauses: WhereClause[]; active: boolean }>();

function snapshotBinding(value: any): any {
  if (value === null || typeof value !== 'object') return value;
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Date) return new Date(value);
  if (Array.isArray(value)) return value.map(snapshotBinding);
  return structuredClone(value);
}

function snapshotArrayBinding(value: any): any {
  return Array.isArray(value) ? value.map(snapshotBinding) : value;
}

function scopeColumn(name: string): string {
  if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_$]*$/.test(name)) {
    throw new TypeError('Global scopes require unqualified column names.');
  }
  return name;
}

function scopeValue(input: ScopeValue): ScopeValue {
  if (input === null || typeof input === 'string' || typeof input === 'boolean' || typeof input === 'bigint') return input;
  if (typeof input === 'number' && Number.isFinite(input)) return input;
  if (input instanceof Date && Number.isFinite(input.getTime())) return new Date(input);
  throw new TypeError('Global scopes require finite, scalar condition values.');
}

function scopeState(adapter: ScopeConditions): WhereClause[] {
  const state = scopeAdapters.get(adapter);
  if (!state?.active) throw new Error('Global scope callbacks must be synchronous.');
  return state.clauses;
}

function scopeBasic(adapter: ScopeConditions, boolean: 'AND' | 'OR', name: string, args: [ScopeValue] | [WhereOperator, ScopeValue]): GlobalScopeQuery {
  const clauses = scopeState(adapter);
  const column = scopeColumn(name);
  if ((args.length !== 1 && args.length !== 2) || args[args.length - 1] === undefined) {
    throw new TypeError('Global scope conditions require a value.');
  }
  const operator = args.length === 1 ? '=' : String(args[0]).toUpperCase();
  if (!whereOperators.has(operator)) throw new TypeError('Invalid global scope operator.');
  if (['IN', 'NOT IN', 'BETWEEN'].includes(operator)) throw new TypeError('Use the dedicated global scope condition method.');
  const value = scopeValue(args[args.length - 1] as ScopeValue);
  clauses.push(value === null && ['=', '!=', '<>'].includes(operator)
    ? { type: operator === '=' ? 'null' : 'notNull', column, boolean }
    : { type: 'basic', column, operator, value, boolean });
  return adapter;
}

function scopeList(adapter: ScopeConditions, type: 'in' | 'notIn' | 'between', name: string, inputs: readonly ScopeValue[]): GlobalScopeQuery {
  const clauses = scopeState(adapter);
  const column = scopeColumn(name);
  if (!Array.isArray(inputs) || inputs.length === 0 || (type === 'between' && inputs.length !== 2)) {
    throw new TypeError('Global scope lists must be nonempty; BETWEEN requires two values.');
  }
  clauses.push({ type, column, values: inputs.map(scopeValue), boolean: 'AND' });
  return adapter;
}

function scopeNested(adapter: ScopeConditions, boolean: 'AND' | 'OR', callback: GlobalScope): GlobalScopeQuery {
  scopeState(adapter).push({ type: 'nested', conditions: compileScopeConditions(callback), boolean });
  return adapter;
}

// Shared prototype methods avoid allocating a builder and closures for every applied scope.
class ScopeConditions implements GlobalScopeQuery {
  where(name: string, ...args: [ScopeValue] | [WhereOperator, ScopeValue]): GlobalScopeQuery { return scopeBasic(this, 'AND', name, args); }
  orWhere(name: string, ...args: [ScopeValue] | [WhereOperator, ScopeValue]): GlobalScopeQuery { return scopeBasic(this, 'OR', name, args); }
  whereIn(name: string, inputs: readonly ScopeValue[]): GlobalScopeQuery { return scopeList(this, 'in', name, inputs); }
  whereNotIn(name: string, inputs: readonly ScopeValue[]): GlobalScopeQuery { return scopeList(this, 'notIn', name, inputs); }
  whereBetween(name: string, inputs: readonly [ScopeValue, ScopeValue]): GlobalScopeQuery { return scopeList(this, 'between', name, inputs); }
  whereNull(name: string): GlobalScopeQuery {
    scopeState(this).push({ type: 'null', column: scopeColumn(name), boolean: 'AND' }); return this;
  }
  whereNotNull(name: string): GlobalScopeQuery {
    scopeState(this).push({ type: 'notNull', column: scopeColumn(name), boolean: 'AND' }); return this;
  }
  whereNested(callback: GlobalScope): GlobalScopeQuery { return scopeNested(this, 'AND', callback); }
  orWhereNested(callback: GlobalScope): GlobalScopeQuery { return scopeNested(this, 'OR', callback); }
}
Object.freeze(ScopeConditions.prototype);

function compileScopeConditions(callback: GlobalScope): WhereClause[] {
  const adapter = Object.freeze(new ScopeConditions());
  const state = { clauses: [] as WhereClause[], active: true };
  scopeAdapters.set(adapter, state);
  try {
    const result = callback(adapter);
    if (result && typeof (result as any).then === 'function') {
      Promise.resolve(result).catch(() => {});
      throw new TypeError('Global scope callbacks must be synchronous.');
    }
    if (state.clauses.length === 0) throw new Error('A global scope must add conditions; disable it explicitly instead.');
    return state.clauses;
  } finally { state.active = false; }
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
  private leanResults = false;
  private hasCompiledOnce = false;
  private compiledQuery?: CompiledQuery;

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
      const conditions = compileScopeConditions(callback);
      clauses.push({ type: 'nested', conditions, boolean: 'AND', globalScope: name });
    }
    // Only publish a complete registry; a failing callback must never leave a partially scoped query.
    this.whereClauses.push(...clauses);
    this.globalScopesApplied = true;
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

  /** PostgreSQL JSONB containment at the root; SQLite/MySQL semantics are deliberately not emulated. */
  whereJsonContains(column: string, value: JsonValue): this {
    return this.jsonContains(column, value, 'AND', false);
  }

  orWhereJsonContains(column: string, value: JsonValue): this {
    return this.jsonContains(column, value, 'OR', false);
  }

  whereJsonDoesntContain(column: string, value: JsonValue): this {
    return this.jsonContains(column, value, 'AND', true);
  }

  orWhereJsonDoesntContain(column: string, value: JsonValue): this {
    return this.jsonContains(column, value, 'OR', true);
  }

  /** PostgreSQL JSONB top-level key or string-array element existence, not a JSON path. */
  whereJsonContainsKey(column: string, key: string): this {
    return this.jsonContainsKey(column, key, 'AND', false);
  }

  orWhereJsonContainsKey(column: string, key: string): this {
    return this.jsonContainsKey(column, key, 'OR', false);
  }

  whereJsonDoesntContainKey(column: string, key: string): this {
    return this.jsonContainsKey(column, key, 'AND', true);
  }

  orWhereJsonDoesntContainKey(column: string, key: string): this {
    return this.jsonContainsKey(column, key, 'OR', true);
  }

  /** Root array length on all drivers. SQL NULL and non-arrays never match, including length zero. */
  whereJsonLength(column: string, length: number): this;
  whereJsonLength(column: string, operator: JsonLengthOperator, length: number): this;
  whereJsonLength(column: string, operatorOrLength: JsonLengthOperator | number, length?: number): this {
    return this.jsonLength(column, operatorOrLength, length, 'AND');
  }

  orWhereJsonLength(column: string, length: number): this;
  orWhereJsonLength(column: string, operator: JsonLengthOperator, length: number): this;
  orWhereJsonLength(column: string, operatorOrLength: JsonLengthOperator | number, length?: number): this {
    return this.jsonLength(column, operatorOrLength, length, 'OR');
  }

  whereIn(column: string, values: readonly any[]): this {
    this.whereClauses.push({ type: 'in', column, values: [...values], boolean: 'AND' });
    return this;
  }

  whereNotIn(column: string, values: readonly any[]): this {
    this.whereClauses.push({ type: 'notIn', column, values: [...values], boolean: 'AND' });
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

  orWhereIn(column: string, values: readonly any[]): this {
    this.whereClauses.push({ type: 'in', column, values: [...values], boolean: 'OR' });
    return this;
  }

  orWhereNotIn(column: string, values: readonly any[]): this {
    this.whereClauses.push({ type: 'notIn', column, values: [...values], boolean: 'OR' });
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

  /** MySQL requires 8.0.14+ (not MariaDB); SQLite has no lateral derived tables. */
  leftJoinLateral(subquery: QueryBuilder<any>, alias: string): this {
    return this.joinLateral('LEFT', subquery, alias);
  }

  crossJoinLateral(subquery: QueryBuilder<any>, alias: string): this {
    return this.joinLateral('CROSS', subquery, alias);
  }

  private joinLateral(type: 'LEFT' | 'CROSS', subquery: QueryBuilder<any>, alias: string): this {
    if (this.currentDriver() === 'sqlite') throw new Error('Lateral joins require PostgreSQL or MySQL 8.0.14+.');
    if (!(subquery instanceof QueryBuilder)) throw new TypeError('Lateral joins require a structured QueryBuilder subquery.');
    if (typeof alias !== 'string') throw new TypeError('Lateral alias must be a simple identifier.');
    assertSqlIdentifier(alias, 'Lateral alias');
    const connection = Connection.getConfig(this.connectionName);
    if (Connection.getConfig(subquery.connectionName) !== connection) {
      throw new Error('Lateral subqueries must use the same connection as their parent.');
    }
    const { sql, bindings } = subquery.clone().toSQL();
    this.joinClauses.push({ type, lateral: true, alias, sql, bindings: bindings.map(snapshotBinding),
      connection: new WeakRef(connection), driver: this.currentDriver() });
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
    if (this.leanResults) throw new Error('Lean queries cannot eager load model relations.');
    this.eagerLoads.push(...relations);
    return this;
  }

  /** Read-only driver rows: no models, proxies, casts, accessors, hidden filtering, or relations. */
  lean<TPlain extends object = LeanResult<TModel>>(): QueryBuilder<TPlain> {
    if (this.eagerLoads.length) throw new Error('Lean queries cannot eager load model relations.');
    const query = this.clone();
    query.leanResults = true;
    return query as unknown as QueryBuilder<TPlain>;
  }

  // ── EXECUTION ────────────────────────────────────────────

  async get(): Promise<TModel[]> {
    const { sql, bindings } = this.toSQL();
    const rows = await Connection.raw(sql, bindings, this.connectionName);
    const models = this.hydrateMany(rows);

    // Eager load relations
    if (this.eagerLoads.length > 0 && this.modelClass && !this.leanResults) {
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
    const { sql, bindings } = this.toSQL();
    const rows = await Connection.raw(sql, bindings, this.connectionName);
    return rows.map((r: any) => r[column]);
  }

  async value(column: string): Promise<any> {
    this.selectColumns = [column];
    this.limitValue = 1;
    const { sql, bindings } = this.toSQL();
    const rows = await Connection.raw(sql, bindings, this.connectionName);
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

  /** Aggregates default to the whole partition; running frames require an explicit order. */
  selectWindow(alias: string, specification: WindowSpecification): this {
    if (!specification || typeof specification !== 'object' || Array.isArray(specification)
      || Object.keys(specification).some((key) => !['function', 'column', 'partitionBy', 'orderBy', 'frame'].includes(key))) {
      throw new TypeError('Window selection requires a structured specification.');
    }
    if (typeof alias !== 'string') throw new TypeError('Window alias must be a simple identifier.');
    const label = assertSqlIdentifier(alias, 'Window alias');
    const fn = specification.function;
    const ranking = ['row_number', 'rank', 'dense_rank'].includes(fn);
    if (!ranking && !['count', 'sum', 'avg', 'min', 'max'].includes(fn)) throw new TypeError('Unsupported window function.');
    const partition = specification.partitionBy ?? [];
    const order = specification.orderBy ?? [];
    if (!Array.isArray(partition) || partition.length > 16 || !Array.isArray(order) || order.length > 16) {
      throw new RangeError('Window partition/order lists must contain at most 16 columns.');
    }
    const partitions = Array.from(partition, (column) => this.structuredColumn(column));
    const orders = Array.from(order, (item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)
        || Object.keys(item).some((key) => !['column', 'direction'].includes(key))) throw new TypeError('Invalid window order.');
      const direction = item.direction ?? 'asc';
      if (direction !== 'asc' && direction !== 'desc') throw new TypeError('Invalid window order direction.');
      return `${this.structuredColumn(item.column)} ${direction.toUpperCase()}`;
    });
    if (ranking && (!orders.length || specification.column !== undefined || specification.frame !== undefined)) {
      throw new TypeError('Ranking windows require ordering and accept no column or frame.');
    }
    const frame = ranking ? undefined : specification.frame ?? 'partition';
    if (frame !== undefined && !['partition', 'running'].includes(frame)) throw new TypeError('Invalid window frame.');
    if (frame === 'running' && !orders.length) throw new TypeError('Running windows require ordering.');
    const column = ranking ? '' : specification.column === '*' && fn === 'count' ? '*' : this.structuredColumn(specification.column!);
    const clauses = [
      ...(partitions.length ? [`PARTITION BY ${partitions.join(', ')}`] : []),
      ...(orders.length ? [`ORDER BY ${orders.join(', ')}`] : []),
      ...(frame ? [`ROWS BETWEEN UNBOUNDED PRECEDING AND ${frame === 'running' ? 'CURRENT ROW' : 'UNBOUNDED FOLLOWING'}`] : []),
    ];
    return this.selectRaw(`${fn.toUpperCase()}(${column}) OVER (${clauses.join(' ')}) as ${this.quoteIdentifier(label, 'Window alias')}`);
  }

  // ── INSERT / UPSERT ───────────────────────────────────────

  async upsert(
    data: Record<string, any> | Record<string, any>[],
    conflictColumns: string | string[],
    updateColumns?: string[]
  ): Promise<any> {
    this.assertWritable();
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
    this.assertWritable();
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
    this.assertWritable();
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
    this.assertWritable();
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
    this.assertWritable();
    data = this.applyTenantInsertAttributes(data);
    this.assertGlobalScopeInsert(data);
    const columns = Object.keys(data);
    const values = Object.values(data);
    const placeholders = values.map(() => '?').join(', ');

    const sql = `${this.buildInsertSQL(columns, placeholders)}${this.buildReturning()}`;
    return Connection.raw(sql, values, this.connectionName);
  }

  async insertGetId<TId = number>(data: Record<string, any>, primaryKey: string = 'id'): Promise<TId> {
    this.assertWritable();
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
    this.assertWritable();
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
    this.assertWritable();
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
    this.assertWritable();
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
    // Single-use builders never fingerprint or allocate a compilation plan.
    const shape = this.hasCompiledOnce ? this.queryShape() : undefined;
    if (shape !== undefined && this.compiledQuery?.shape === shape) {
      return { sql: this.compiledQuery.sql, bindings: this.bindCompiledQuery(this.compiledQuery.slots) };
    }
    this.compiledQuery = undefined;
    const parts: string[] = [];
    const bindings: any[] = [];

    // CTEs (WITH)
    if (this.cteClauses.length > 0) {
      const hasRecursive = this.cteClauses.some((c) => c.recursive);
      const cteKeyword = hasRecursive ? 'WITH RECURSIVE' : 'WITH';
      const cteParts = this.cteClauses.map((c) => {
        bindings.push(...c.bindings.map(snapshotArrayBinding));
        return `${this.quoteIdentifier(c.name, 'CTE name')} AS (${c.sql})`;
      });
      parts.push(`${cteKeyword} ${cteParts.join(', ')}`);
    }

    // SELECT (with subquery bindings)
    if (this._selectBindings?.length) {
      bindings.push(...this._selectBindings.map(snapshotArrayBinding));
    }
    const distinctStr = this.isDistinct ? 'DISTINCT ' : '';
    parts.push(`SELECT ${distinctStr}${this.selectColumns.map((column) => this.formatSelectColumn(column)).join(', ')}`);

    // FROM
    parts.push(`FROM ${this.quoteIdentifier(this.tableName, 'Table name')}`);

    // JOINs
    for (const join of this.joinClauses) {
      if ('lateral' in join) {
        if (this.currentDriver() === 'sqlite') throw new Error('Lateral joins require PostgreSQL or MySQL 8.0.14+.');
        if (join.connection.deref() !== Connection.getConfig(this.connectionName) || join.driver !== this.currentDriver()) {
          throw new Error('Lateral subqueries must use the same connection as their parent.');
        }
        parts.push(`${join.type} JOIN LATERAL (${join.sql}) AS ${this.quoteIdentifier(join.alias, 'Lateral alias')}${join.type === 'LEFT' ? ' ON TRUE' : ''}`);
        bindings.push(...join.bindings.map(snapshotBinding));
      } else if (join.type === 'CROSS') {
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
          if (clause.values) bindings.push(...clause.values.map(snapshotArrayBinding));
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
        if (order.raw && order.bindings?.length) bindings.push(...order.bindings.map(snapshotArrayBinding));
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
        bindings.push(...u.bindings.map(snapshotArrayBinding));
      }
    }

    const sql = parts.join(' ');
    // One bounded, builder-local plan. No binding values or closures enter this cache.
    if (shape !== undefined && shape.length + sql.length <= 32768) {
      this.compiledQuery = { shape, sql, slots: this.bindingSlots() };
    }
    this.hasCompiledOnce = true;
    return { sql, bindings };
  }

  // ── CLONE ────────────────────────────────────────────────

  clone(): QueryBuilder<TModel> {
    this.ensureGlobalScopes();
    const cloned = new QueryBuilder<TModel>(this.tableName, this.modelClass, this.connectionName);
    cloned.selectColumns = [...this.selectColumns];
    const cloneConditions = (clauses: WhereClause[]): WhereClause[] => clauses.map((clause) => ({
      ...clause, builder: clause.builder?.clone(), conditions: clause.conditions ? cloneConditions(clause.conditions) : undefined,
      values: clause.values?.map(snapshotArrayBinding),
    }));
    cloned.whereClauses = cloneConditions(this.whereClauses);
    cloned.joinClauses = this.joinClauses.map((join) => 'lateral' in join ? { ...join, bindings: join.bindings.map(snapshotBinding) } : { ...join });
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
    cloned.leanResults = this.leanResults;
    return cloned;
  }

  // ── PRIVATE ──────────────────────────────────────────────

  private assertWritable(): void {
    if (this.leanResults) throw new Error('Lean queries are read-only. Use a model or non-lean builder for writes.');
  }

  /** Raw fragments and captured subqueries may contain literals, so they are deliberately uncached. */
  private queryShape(): string | undefined {
    if (this.cteClauses.length || this.unionClauses.length || this._selectBindings?.length || this.rawSelectColumns.size ||
        this.joinClauses.some((join) => 'lateral' in join) || this.orderClauses.some((order) => order.raw) ||
        this.havingClauses.some((clause) => clause.type !== 'basic') ||
        this.selectColumns.some((column) => !/^(?:\*|[A-Za-z_][A-Za-z0-9_$.]*(?:\.[*])?)(?:\s+(?:as\s+)?[A-Za-z_][A-Za-z0-9_]*)?$/i.test(column))) {
      return undefined;
    }
    const driver = this.currentDriver();
    const conditions = (clauses: WhereClause[]): unknown[] | undefined => {
      const shape: unknown[] = [];
      for (const clause of clauses) {
        if (!['basic', 'in', 'notIn', 'null', 'notNull', 'between', 'nested'].includes(clause.type) || clause.builder) return;
        const nested = clause.conditions ? conditions(clause.conditions) : null;
        if (clause.conditions && nested === undefined) return;
        shape.push([clause.type, clause.column, clause.operator, clause.boolean, !!clause.globalScope,
          !!clause.tenantScope, !!clause.softDeleteScope,
          (clause.operator === 'IS' || clause.operator === 'IS NOT') && clause.value === null,
          driver !== 'postgres' && (clause.type === 'in' || clause.type === 'notIn') ? clause.values?.length : null, nested]);
      }
      return shape;
    };
    const where = conditions(this.whereClauses);
    if (where === undefined) return;
    return JSON.stringify([driver, this.tableName, this.selectColumns, this.isDistinct, this.joinClauses, where,
      this.groupByColumns, this.havingClauses.map((clause) => [clause.column, clause.operator]),
      this.orderClauses, this.limitValue, this.offsetValue, this.lockMode, this.useSkipLocked]);
  }

  private bindingSlots(): BindingSlot[] {
    const slots: BindingSlot[] = [];
    const driver = this.currentDriver();
    const collect = (clause: WhereClause, path: number[], scope: boolean): void => {
      scope ||= !!clause.globalScope;
      if (clause.type === 'nested') {
        clause.conditions!.forEach((child, index) => collect(child, [...path, index], scope));
      } else if (clause.type === 'basic') {
        if ((clause.operator !== 'IS' && clause.operator !== 'IS NOT') || clause.value !== null) {
          slots.push({ root: 'where', path, source: 'value', scope });
        }
      } else if (clause.type === 'in' || clause.type === 'notIn' || clause.type === 'between') {
        if (driver === 'postgres' && clause.type !== 'between') slots.push({ root: 'where', path, source: 'array', scope });
        else for (let index = 0; index < (clause.type === 'between' ? 2 : clause.values!.length); index++) {
          slots.push({ root: 'where', path, source: 'element', index, scope });
        }
      }
    };
    // Match buildWhere's protected-scope ordering rather than the caller's clause insertion order.
    for (const scoped of [true, false]) this.whereClauses.forEach((clause, index) => {
      if (!!(clause.globalScope || clause.tenantScope || clause.softDeleteScope) === scoped) collect(clause, [index], false);
    });
    this.havingClauses.forEach((_clause, index) => slots.push({ root: 'having', path: [index], source: 'value', scope: false }));
    return slots;
  }

  private bindCompiledQuery(slots: BindingSlot[]): any[] {
    return slots.map((slot) => {
      const clauses = slot.root === 'where' ? this.whereClauses : this.havingClauses;
      let clause = clauses[slot.path[0]];
      for (let index = 1; index < slot.path.length; index++) clause = clause.conditions![slot.path[index]];
      const copy = (value: any) => slot.scope && value instanceof Date ? new Date(value) : value;
      if (slot.source === 'array') return clause.values!.map(copy);
      return copy(slot.source === 'element' ? clause.values![slot.index!] : clause.value);
    });
  }

  private structuredColumn(column: string): string {
    if (typeof column !== 'string' || !column || column.split('.').some((part) => !part || part === '*')) {
      throw new TypeError('Structured queries require a column identifier, not SQL or an alias.');
    }
    for (const part of column.split('.')) assertSqlIdentifier(part, 'Structured column');
    return this.quoteIdentifier(column, 'Structured column');
  }

  private jsonContains(column: string, value: JsonValue, boolean: 'AND' | 'OR', negate: boolean): this {
    if (Connection.getDriver(this.connectionName) !== 'postgres') throw new Error('JSONB containment requires PostgreSQL.');
    const identifier = this.structuredColumn(column);
    const active = new WeakSet<object>(); let nodes = 0;
    const validate = (input: unknown, depth: number): void => {
      if (++nodes > 10000 || depth > 64) throw new RangeError('JSON predicate exceeds its bounded structure limit.');
      if (input === null || typeof input === 'string' || typeof input === 'boolean') return;
      if (typeof input === 'number' && Number.isFinite(input)) return;
      if (!input || typeof input !== 'object' || active.has(input)
        || !Array.isArray(input) && ![Object.prototype, null].includes(Object.getPrototypeOf(input))) {
        throw new TypeError('JSON predicates require finite JSON values without cycles.');
      }
      active.add(input);
      if (Object.getOwnPropertySymbols(input).length) {
        throw new TypeError('JSON predicates do not invoke custom serialization.');
      }
      const descriptors = Object.getOwnPropertyDescriptors(input);
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (Array.isArray(input) && key === 'length') continue;
        if (!descriptor.enumerable || !('value' in descriptor)) throw new TypeError('JSON predicates require enumerable data properties.');
        if (Array.isArray(input) && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= input.length)) {
          throw new TypeError('JSON predicates do not accept augmented arrays.');
        }
        validate(descriptor.value, depth + 1);
      }
      if (Array.isArray(input) && Object.keys(input).length !== input.length) throw new TypeError('JSON predicates do not accept sparse or augmented arrays.');
      active.delete(input);
    };
    validate(value, 0);
    const encoded = JSON.stringify(value);
    if (typeof encoded !== 'string') throw new TypeError('JSON predicate must be serializable.');
    if (Buffer.byteLength(encoded) > 1_048_576) throw new RangeError('JSON predicate must fit in 1 MiB.');
    this.whereClauses.push({ type: 'raw', raw: `${negate ? 'NOT ' : ''}(${identifier}::jsonb @> ?::jsonb)`, values: [encoded], boolean });
    return this;
  }

  private jsonContainsKey(column: string, key: string, boolean: 'AND' | 'OR', negate: boolean): this {
    if (Connection.getDriver(this.connectionName) !== 'postgres') throw new Error('JSONB key existence requires PostgreSQL.');
    const identifier = this.structuredColumn(column);
    if (typeof key !== 'string' || key.includes('\0')) throw new TypeError('JSON key must be a text value without NUL.');
    this.whereClauses.push({ type: 'raw', raw: `${negate ? 'NOT ' : ''}(${identifier}::jsonb ? ?)`, values: [key], boolean });
    return this;
  }

  private jsonLength(column: string, operatorOrLength: JsonLengthOperator | number, length: number | undefined, boolean: 'AND' | 'OR'): this {
    const identifier = this.structuredColumn(column);
    const operator = typeof operatorOrLength === 'number' && length === undefined ? '=' : operatorOrLength;
    const value = typeof operatorOrLength === 'number' && length === undefined ? operatorOrLength : length;
    if (typeof operator !== 'string' || !['=', '!=', '<>', '>', '>=', '<', '<='].includes(operator)) throw new TypeError('Invalid JSON length comparison.');
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new RangeError('JSON length requires a nonnegative safe integer.');
    const driver = Connection.getDriver(this.connectionName);
    let expression: string;
    if (driver === 'postgres') expression = `CASE WHEN jsonb_typeof(${identifier}::jsonb) = 'array' THEN jsonb_array_length(${identifier}::jsonb) END`;
    else if (driver === 'mysql') expression = `CASE WHEN JSON_TYPE(${identifier}) = 'ARRAY' THEN JSON_LENGTH(${identifier}) END`;
    else if (driver === 'sqlite') expression = `CASE WHEN json_type(${identifier}) = 'array' THEN json_array_length(${identifier}) END`;
    else throw new Error('JSON array length is unsupported by this database driver.');
    this.whereClauses.push({ type: 'raw', raw: `(${expression}) ${operator} ?`, values: [value], boolean });
    return this;
  }

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
        case 'notIn': {
          const identifier = this.quoteIdentifier(column!, 'Where column');
          const values = clause.values!.map(bind);
          if (this.currentDriver() === 'postgres') {
            // ALL is the three-valued-logic complement of ANY, including NULL and empty arrays.
            parts.push(`${prefix} ${identifier} ${clause.type === 'in' ? '= ANY' : '<> ALL'}(?)`);
            bindings.push(values);
          } else if (values.length === 0) {
            parts.push(`${prefix} 1 = ${clause.type === 'in' ? '0' : '1'}`);
          } else {
            parts.push(`${prefix} ${identifier} ${clause.type === 'in' ? 'IN' : 'NOT IN'} (${values.map(() => '?').join(', ')})`);
            bindings.push(...values);
          }
          break;
        }

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
          const nested = this.compileWhereClauses(clause.conditions ?? clause.builder!.whereClauses,
            scopeTable ?? (clause.globalScope ? this.tableReferenceForColumn() : undefined));
          parts.push(`${prefix} (${nested.whereSQL.slice('WHERE '.length)})`);
          bindings.push(...nested.whereBindings);
          break;
        }

        case 'raw':
          parts.push(`${prefix} ${clause.raw}`);
          if (clause.values) bindings.push(...clause.values.map(snapshotArrayBinding));
          break;

        case 'exists':
          parts.push(`${prefix} EXISTS (${clause.subSQL})`);
          if (clause.subBindings) bindings.push(...clause.subBindings.map(snapshotArrayBinding));
          break;

        case 'notExists':
          parts.push(`${prefix} NOT EXISTS (${clause.subSQL})`);
          if (clause.subBindings) bindings.push(...clause.subBindings.map(snapshotArrayBinding));
          break;

        case 'sub':
          this.assertOperator(clause.operator!);
          parts.push(`${prefix} ${this.quoteIdentifier(clause.column!, 'Where column')} ${clause.operator} (${clause.subSQL})`);
          if (clause.subBindings) bindings.push(...clause.subBindings.map(snapshotArrayBinding));
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
        if (clause.conditions) collect(clause.conditions);
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
        if (clause.type === 'nested') matches = evaluate(clause.conditions ?? clause.builder!.whereClauses);
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
    if (!whereOperators.has(operator.toUpperCase())) {
      throw new Error(`SQL operator contains invalid characters: "${operator}"`);
    }
  }

  private hydrateMany(rows: any[]): TModel[] {
    if (!this.modelClass || this.leanResults) return rows as TModel[];
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
