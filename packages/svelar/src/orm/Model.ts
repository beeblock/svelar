/**
 * Svelar Model
 *
 * Eloquent-like base Model class. Extend this for each database table.
 *
 * @example
 * ```ts
 * class User extends Model {
 *   static table = 'users';
 *   static timestamps = true;
 *
 *   declare id: number;
 *   declare email: string;
 *   declare name: string;
 *
 *   posts() {
 *     return this.hasMany(Post, 'user_id');
 *   }
 * }
 *
 * const user = await User.find(1);
 * const posts = await user.posts().load(user);
 * ```
 */

import { QueryBuilder, type GlobalScope } from './QueryBuilder.js';
import { isDeepStrictEqual } from 'node:util';
import { Connection } from '../database/Connection.js';
import { HasOne, HasMany, BelongsTo, BelongsToMany } from './Relationship.js';
import { type ModelObserver, type ModelEventName, MODEL_EVENTS } from './Observer.js';
import { Event } from '../events/index.js';
import { ulid, uuidv7 } from '../support/uuid.js';
import { ApplicationContext } from '../support/Context.js';

// ── Types ──────────────────────────────────────────────────

export type ModelAttributes = Record<string, any>;

/** Synchronous conversion between database storage and an application value. */
export interface AttributeCast<T = any> {
  get(value: any, model: Model, key: string): T;
  set(value: T, model: Model, key: string): any;
  equals?(left: T, right: T): boolean;
}

export type ModelCast = 'string' | 'number' | 'boolean' | 'date' | 'json' |
  'decimal' | `decimal:${number}` | AttributeCast;

function snapshot<T>(value: T): T {
  if (Buffer.isBuffer(value)) return Buffer.from(value) as T;
  return structuredClone(value);
}

function snapshotAttributes(attributes: ModelAttributes): ModelAttributes {
  return Object.fromEntries(Object.entries(attributes).map(([key, value]) => [key, snapshot(value)]));
}

// Decimal strings must never pass through Number: database decimals can exceed IEEE-754 precision.
function decimal(value: unknown, precision?: number): string {
  const input = String(value);
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(input);
  if (!match || input.length > 10000) throw new TypeError('Invalid decimal value.');
  const exponent = Number(match[4] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 10000) throw new TypeError('Invalid decimal exponent.');
  let digits = (match[2] + (match[3] ?? '')).replace(/^0+/, '') || '0';
  let scale = (match[3]?.length ?? 0) - exponent;
  if (digits === '0' && precision === undefined) return '0';
  if (scale < 0) { digits += '0'.repeat(-scale); scale = 0; }
  if (precision !== undefined) {
    if (!Number.isInteger(precision) || precision < 0 || precision > 100) throw new TypeError('Invalid decimal precision.');
    if (scale > precision) {
      const divisor = 10n ** BigInt(scale - precision);
      const coefficient = BigInt(digits);
      digits = (coefficient / divisor + (coefficient % divisor * 2n >= divisor ? 1n : 0n)).toString();
    } else digits += '0'.repeat(precision - scale);
    scale = precision;
  } else {
    while (scale > 0 && digits.endsWith('0')) { digits = digits.slice(0, -1); scale--; }
    digits ||= '0';
  }
  digits = digits.replace(/^0+/, '') || '0';
  const padded = digits.padStart(scale + 1, '0');
  const result = scale ? `${padded.slice(0, -scale)}.${padded.slice(-scale)}` : padded;
  return match[1] === '-' && BigInt(digits) !== 0n ? `-${result}` : result;
}

/** @internal Persistence context supplied by model-backed query helpers. */
interface ModelCreateOptions<T> {
  query?: QueryBuilder<T>;
  tenantId?: string | number;
  recoverInsert?: (error: unknown) => Promise<T>;
}

export interface ModelHooks {
  creating?: (model: Model) => Promise<void> | void;
  created?: (model: Model) => Promise<void> | void;
  updating?: (model: Model) => Promise<void> | void;
  updated?: (model: Model) => Promise<void> | void;
  saving?: (model: Model) => Promise<void> | void;
  saved?: (model: Model) => Promise<void> | void;
  deleting?: (model: Model) => Promise<void> | void;
  deleted?: (model: Model) => Promise<void> | void;
  restoring?: (model: Model) => Promise<void> | void;
  restored?: (model: Model) => Promise<void> | void;
  forceDeleting?: (model: Model) => Promise<void> | void;
  forceDeleted?: (model: Model) => Promise<void> | void;
}

// ── Model Base Class ───────────────────────────────────────

export class Model {
  // ── Static Configuration ──

  /** The database table name */
  static table: string;

  /** Primary key column */
  static primaryKey: string = 'id';

  /** Whether the model uses auto-incrementing IDs */
  static incrementing: boolean = true;

  /** Whether the model manages created_at/updated_at */
  static timestamps: boolean = true;

  /** Column names for timestamps */
  static createdAt: string = 'created_at';
  static updatedAt: string = 'updated_at';

  /** Whether deletes should set deleted_at instead of removing the row */
  static softDeletes: boolean = false;

  /** Column name for soft deletes */
  static deletedAt: string = 'deleted_at';

  /** Columns that should be auto-filled with UUID/ULID values before insert */
  static uniqueIds: string[] = [];

  /** Default unique ID generator for static uniqueIds */
  static uniqueIdType: 'uuid' | 'ulid' = 'uuid';

  /** Attribute casting definitions */
  static casts: Record<string, ModelCast> = {};

  /** Columns that can be mass-assigned */
  static fillable: string[] = [];

  /** Columns that are hidden from serialization */
  static hidden: string[] = [];

  /** Database connection name (null = default) */
  static connection: string | undefined = undefined;

  /** Whether queries should be scoped to the current team/tenant context */
  static tenantScoped: boolean = false;

  /** Tenant/team column name used by tenant-scoped models */
  static tenantColumn: string = 'team_id';

  /** Whether tenant-scoped queries should fail without a current tenant */
  static requireTenantContext: boolean = true;

  /** Registered model hooks */
  private static hooks = new WeakMap<Function, ModelHooks>();

  /** Registered model observers */
  private static observers = new WeakMap<Function, ModelObserver[]>();

  private static scopeRegistry = new WeakMap<typeof Model, Map<string, GlobalScope>>();

  /** Custom model events (e.g. ['published', 'archived']) */
  static events: string[] = [];

  // ── Instance Properties ──

  private attributes: ModelAttributes = {};
  private originalAttributes: ModelAttributes = {};
  private previousOriginalAttributes: ModelAttributes = {};
  private changedAttributes: ModelAttributes = {};
  private castCache = new Map<string, { raw: any; value: any }>();
  private relations: Record<string, any> = {};
  private exists: boolean = false;

  constructor(attributes?: ModelAttributes) {
    if (attributes) {
      this.fill(attributes);
    }

    // Return a Proxy so that property access maps to getAttribute/setAttribute
    // This enables `model.id`, `model.name`, etc. like Laravel's __get/__set
    return new Proxy(this, {
      get(target, prop, receiver) {
        // Check own properties/methods first
        if (typeof prop === 'symbol' || prop in target || typeof prop !== 'string') {
          return Reflect.get(target, prop, receiver);
        }
        // Check if it's a static config property
        if (['table', 'primaryKey', 'incrementing', 'timestamps', 'createdAt', 'updatedAt', 'softDeletes', 'deletedAt', 'uniqueIds', 'uniqueIdType', 'casts', 'fillable', 'hidden', 'connection'].includes(prop)) {
          return Reflect.get(target, prop, receiver);
        }
        // Check if it's a relation method
        if (typeof (target as any)[prop] === 'function') {
          return (target as any)[prop].bind(target);
        }
        // Fall back to getAttribute
        return target.getAttribute(prop);
      },
      set(target, prop, value) {
        if (typeof prop === 'symbol' || prop in target) {
          return Reflect.set(target, prop, value);
        }
        target.setAttribute(prop as string, value);
        return true;
      },
    });
  }

  // ── Static Query Methods ─────────────────────────────────

  static query<T extends Model>(this: new () => T): QueryBuilder<T> {
    const ctor = this as unknown as typeof Model;
    return new QueryBuilder<T>(ctor.table, this, ctor.connection);
  }

  /** Inherited scopes are copied; registering a child scope cannot change its parent. */
  static globalScopes(): ReadonlyMap<string, GlobalScope> {
    const parent = Object.getPrototypeOf(this) as typeof Model | undefined;
    const scopes = new Map<string, GlobalScope>(parent?.globalScopes?.() ?? []);
    for (const [name, scope] of Model.scopeRegistry.get(this) ?? []) scopes.set(name, scope);
    return scopes;
  }

  static addGlobalScope(name: string, scope: GlobalScope): void {
    if (!name.trim() || typeof scope !== 'function') throw new TypeError('A global scope needs a name and a condition callback.');
    let scopes = Model.scopeRegistry.get(this);
    if (!scopes) { scopes = new Map(); Model.scopeRegistry.set(this, scopes); }
    scopes.set(name, scope);
  }

  static withoutGlobalScope<T extends Model>(this: new () => T, name: string): QueryBuilder<T> {
    return (this as any).query().withoutGlobalScope(name);
  }

  static async find<T extends Model>(this: new () => T, id: any): Promise<T | null> {
    const ctor = this as unknown as typeof Model;
    return (this as any).query().find(id, ctor.primaryKey);
  }

  static async findOrFail<T extends Model>(this: new () => T, id: any): Promise<T> {
    const ctor = this as unknown as typeof Model;
    return (this as any).query().findOrFail(id, ctor.primaryKey);
  }

  static async all<T extends Model>(this: new () => T): Promise<T[]> {
    return (this as any).query().get();
  }

  static async first<T extends Model>(this: new () => T): Promise<T | null> {
    return (this as any).query().first();
  }

  static async firstOrFail<T extends Model>(this: new () => T): Promise<T> {
    return (this as any).query().firstOrFail();
  }

  static where<T extends Model>(
    this: new () => T,
    column: string,
    operatorOrValue?: any,
    value?: any
  ): QueryBuilder<T> {
    return (this as any).query().where(column, operatorOrValue, value);
  }

  static whereIn<T extends Model>(
    this: new () => T,
    column: string,
    values: any[]
  ): QueryBuilder<T> {
    return (this as any).query().whereIn(column, values);
  }

  static whereNull<T extends Model>(this: new () => T, column: string): QueryBuilder<T> {
    return (this as any).query().whereNull(column);
  }

  static whereNotNull<T extends Model>(this: new () => T, column: string): QueryBuilder<T> {
    return (this as any).query().whereNotNull(column);
  }

  static orderBy<T extends Model>(
    this: new () => T,
    column: string,
    direction?: 'asc' | 'desc'
  ): QueryBuilder<T> {
    return (this as any).query().orderBy(column, direction);
  }

  static latest<T extends Model>(this: new () => T, column?: string): QueryBuilder<T> {
    return (this as any).query().latest(column);
  }

  static oldest<T extends Model>(this: new () => T, column?: string): QueryBuilder<T> {
    return (this as any).query().oldest(column);
  }

  static with<T extends Model>(this: new () => T, ...relations: string[]): QueryBuilder<T> {
    return (this as any).query().with(...relations);
  }

  static withoutTenantScope<T extends Model>(this: new () => T): QueryBuilder<T> {
    return (this as any).query().withoutTenantScope();
  }

  static forTenant<T extends Model>(this: new () => T, teamId: string | number): QueryBuilder<T> {
    return (this as any).query().forTenant(teamId);
  }

  static withTrashed<T extends Model>(this: new () => T): QueryBuilder<T> {
    return (this as any).query().withTrashed();
  }

  static withoutTrashed<T extends Model>(this: new () => T): QueryBuilder<T> {
    return (this as any).query().withoutTrashed();
  }

  static onlyTrashed<T extends Model>(this: new () => T): QueryBuilder<T> {
    return (this as any).query().onlyTrashed();
  }

  static async count(this: typeof Model): Promise<number> {
    return (this as any).query().count();
  }

  static async create<T extends Model>(
    this: new () => T,
    attributes: ModelAttributes,
    options: ModelCreateOptions<T> = {},
  ): Promise<T> {
    const instance = new this();
    const ctor = this as unknown as typeof Model;
    instance.fill(attributes);
    instance.populateUniqueIds();
    if (options.query) {
      if (options.tenantId !== undefined) instance.setAttribute(ctor.tenantColumn, options.tenantId);
    } else {
      instance.applyTenantAttributes();
    }

    // Run creating hook
    await instance.fireHook('creating');
    await instance.fireHook('saving');

    // Add timestamps
    if (ctor.timestamps) {
      const now = new Date().toISOString();
      instance.setAttribute(ctor.createdAt, now);
      instance.setAttribute(ctor.updatedAt, now);
    }

    const data = instance.getInsertableAttributes();
    const qb = options.query ?? new QueryBuilder(ctor.table, this, ctor.connection);
    let id: any;
    try {
      id = await Connection.withSavepointIfNeeded(
        () => qb.insertGetId(data, ctor.primaryKey),
        options.query ? options.query.getConnectionName() : ctor.connection,
      );
    } catch (error) {
      if (options.recoverInsert) return options.recoverInsert(error);
      throw error;
    }

    if (ctor.incrementing && id) {
      instance.setAttribute(ctor.primaryKey, id);
    }

    instance.exists = true;

    instance.captureChanges();
    await instance.fireHook('created');
    await instance.fireHook('saved');
    instance.syncOriginal();

    return instance as T;
  }

  // ── Instance Methods ─────────────────────────────────────

  async save(query?: QueryBuilder): Promise<void> {
    const ctor = this.constructor as typeof Model;

    if (this.exists) {
      // Update
      await this.fireHook('updating');
      await this.fireHook('saving');

      if (ctor.timestamps) {
        this.setAttribute(ctor.updatedAt, new Date().toISOString());
      }

      const dirty = this.getDirty();
      if (Object.keys(dirty).length > 0) {
        const pk = this.getOriginal(ctor.primaryKey) ?? this.getAttribute(ctor.primaryKey);
        const qb = query?.clone() ?? new QueryBuilder(ctor.table, this.constructor, ctor.connection);
        qb.where(ctor.primaryKey, pk);
        const affected = await qb.update(dirty);
        if ((query || qb.hasRowScopes()) && affected === 0 && !await qb.clone().exists()) {
          throw new Error(`Model "${ctor.name}" is no longer available in the query scope.`);
        }
      } else {
        const qb = query?.clone() ?? new QueryBuilder(ctor.table, this.constructor, ctor.connection);
        if ((query || qb.hasRowScopes()) && !await qb.where(ctor.primaryKey, this.getOriginal(ctor.primaryKey)).exists()) {
          throw new Error(`Model "${ctor.name}" is no longer available in the query scope.`);
        }
      }

      this.captureChanges();
      await this.fireHook('updated');
      await this.fireHook('saved');
      this.syncOriginal();
    } else {
      // Insert (delegate to static create)
      this.populateUniqueIds();
      if (!query) this.applyTenantAttributes();

      await this.fireHook('creating');
      await this.fireHook('saving');

      if (ctor.timestamps) {
        const now = new Date().toISOString();
        if (!this.getAttribute(ctor.createdAt)) {
          this.setAttribute(ctor.createdAt, now);
        }
        this.setAttribute(ctor.updatedAt, now);
      }

      const data = this.getInsertableAttributes();
      const qb = query?.clone() ?? new QueryBuilder(ctor.table, this.constructor, ctor.connection);
      const id = await qb.insertGetId(data, ctor.primaryKey);

      if (ctor.incrementing && id) {
        this.setAttribute(ctor.primaryKey, id);
      }

      this.exists = true;

      this.captureChanges();
      await this.fireHook('created');
      await this.fireHook('saved');
      this.syncOriginal();
    }
  }

  async update(attributes: ModelAttributes): Promise<void> {
    this.fill(attributes);
    await this.save();
  }

  async delete(): Promise<void> {
    const ctor = this.constructor as typeof Model;

    await this.fireHook('deleting');

    const pk = this.getAttribute(ctor.primaryKey);
    const qb = new QueryBuilder(ctor.table, this.constructor, ctor.connection);
    if (ctor.softDeletes) {
      const deletedAt = new Date().toISOString();
      const affected = await qb.where(ctor.primaryKey, pk).update({ [ctor.deletedAt]: deletedAt });
      if (affected === 0 && qb.hasRowScopes()) throw new Error(`Model "${ctor.name}" is no longer available in the query scope.`);
      this.setAttribute(ctor.deletedAt, deletedAt);
      this.captureChanges();
    } else {
      const affected = await qb.where(ctor.primaryKey, pk).delete();
      if (affected === 0 && qb.hasRowScopes()) throw new Error(`Model "${ctor.name}" is no longer available in the query scope.`);
      this.exists = false;
      this.captureChanges();
    }

    await this.fireHook('deleted');
    this.syncOriginal();
  }

  async forceDelete(): Promise<void> {
    const ctor = this.constructor as typeof Model;

    await this.fireHook('forceDeleting');
    await this.fireHook('deleting');

    const pk = this.getAttribute(ctor.primaryKey);
    const qb = new QueryBuilder(ctor.table, this.constructor, ctor.connection);
    const affected = await qb.withTrashed().where(ctor.primaryKey, pk).forceDelete();
    if (affected === 0 && qb.hasRowScopes()) throw new Error(`Model "${ctor.name}" is no longer available in the query scope.`);

    this.exists = false;
    this.captureChanges();

    await this.fireHook('deleted');
    await this.fireHook('forceDeleted');
    this.syncOriginal();
  }

  async restore(): Promise<void> {
    const ctor = this.constructor as typeof Model;
    if (!ctor.softDeletes) {
      throw new Error(`Model "${ctor.name}" does not use soft deletes.`);
    }

    const pk = this.getAttribute(ctor.primaryKey);
    const qb = new QueryBuilder(ctor.table, this.constructor, ctor.connection);
    await this.fireHook('restoring');
    const affected = await qb.withTrashed().where(ctor.primaryKey, pk).update({ [ctor.deletedAt]: null });
    if (affected === 0 && qb.hasRowScopes() && !await qb.clone().exists()) {
      throw new Error(`Model "${ctor.name}" is no longer available in the query scope.`);
    }

    this.setAttribute(ctor.deletedAt, null);
    this.captureChanges();
    this.exists = true;
    await this.fireHook('restored');
    this.syncOriginal();
  }

  trashed(): boolean {
    const ctor = this.constructor as typeof Model;
    return ctor.softDeletes && this.getAttribute(ctor.deletedAt) !== null && this.getAttribute(ctor.deletedAt) !== undefined;
  }

  async refresh(): Promise<void> {
    const ctor = this.constructor as typeof Model;
    const pk = this.getAttribute(ctor.primaryKey);
    const fresh = await (this.constructor as any).find(pk);

    if (fresh) {
      this.castCache.clear();
      this.attributes = snapshotAttributes(fresh.attributes);
      this.syncOriginal();
    }
  }

  // ── Attribute Management ─────────────────────────────────

  getAttribute(key: string): any {
    const ctor = this.constructor as typeof Model;
    const raw = this.attributes[key];
    const cast = ctor.casts[key];
    if (raw != null && (cast === 'json' || cast === 'date' || typeof cast === 'object')) {
      const cached = this.castCache.get(key);
      if (cached && cached.raw === raw) return cached.value;
      const value = this.readCast(key, raw);
      this.castCache.set(key, { raw, value });
      return value;
    }
    return this.readCast(key, raw);
  }

  setAttribute(key: string, value: any): void {
    this.castCache.delete(key);
    this.attributes[key] = this.writeCast(key, value);
  }

  fill(attributes: ModelAttributes): void {
    const ctor = this.constructor as typeof Model;

    for (const [key, value] of Object.entries(attributes)) {
      // If fillable is set, only allow those columns
      if (ctor.fillable.length > 0 && !ctor.fillable.includes(key)) {
        continue;
      }
      this.setAttribute(key, value);
    }
  }

  getAttributes(): ModelAttributes {
    this.flushCastCache();
    return snapshotAttributes(this.attributes);
  }

  getOriginal(key?: string): any {
    if (key !== undefined) return snapshot(this.originalAttributes[key]);
    return snapshotAttributes(this.originalAttributes);
  }

  getPreviousOriginal(key?: string): any {
    if (key !== undefined) return snapshot(this.previousOriginalAttributes[key]);
    return snapshotAttributes(this.previousOriginalAttributes);
  }

  getChanges(): ModelAttributes {
    return snapshotAttributes(this.changedAttributes);
  }

  getDirty(): ModelAttributes {
    this.flushCastCache();
    const dirty: ModelAttributes = {};
    for (const [key, value] of Object.entries(this.attributes)) {
      if (!Object.hasOwn(this.originalAttributes, key) || !this.attributesEqual(key, value, this.originalAttributes[key])) {
        dirty[key] = snapshot(value);
      }
    }
    return dirty;
  }

  isDirty(...keys: string[]): boolean {
    const dirty = this.getDirty();
    if (keys.length === 0) return Object.keys(dirty).length > 0;
    return keys.some((k) => k in dirty);
  }

  isClean(...keys: string[]): boolean {
    return !this.isDirty(...keys);
  }

  wasChanged(...keys: string[]): boolean {
    if (keys.length === 0) return Object.keys(this.changedAttributes).length > 0;
    return keys.some((k) => k in this.changedAttributes);
  }

  // ── Relationships ────────────────────────────────────────

  protected hasOne(related: typeof Model, foreignKey: string, localKey?: string): HasOne {
    return new HasOne(
      this,
      related,
      foreignKey,
      localKey ?? (this.constructor as typeof Model).primaryKey
    );
  }

  protected hasMany(related: typeof Model, foreignKey: string, localKey?: string): HasMany {
    return new HasMany(
      this,
      related,
      foreignKey,
      localKey ?? (this.constructor as typeof Model).primaryKey
    );
  }

  protected belongsTo(related: typeof Model, foreignKey: string, ownerKey?: string): BelongsTo {
    return new BelongsTo(this, related, foreignKey, ownerKey ?? related.primaryKey);
  }

  protected belongsToMany(
    related: typeof Model,
    pivotTable: string,
    foreignPivotKey: string,
    relatedPivotKey: string,
    parentKey?: string,
    relatedKey?: string
  ): BelongsToMany {
    return new BelongsToMany(
      this,
      related,
      pivotTable,
      foreignPivotKey,
      relatedPivotKey,
      parentKey ?? (this.constructor as typeof Model).primaryKey,
      relatedKey ?? related.primaryKey
    );
  }

  setRelation(name: string, value: any): void {
    this.relations[name] = value;
  }

  getRelation(name: string): any {
    return this.relations[name];
  }

  relationLoaded(name: string): boolean {
    return name in this.relations;
  }

  // ── Serialization ────────────────────────────────────────

  toJSON(): ModelAttributes {
    const ctor = this.constructor as typeof Model;
    const result: ModelAttributes = {};

    for (const [key, value] of Object.entries(this.attributes)) {
      if (!ctor.hidden.includes(key)) {
        result[key] = this.getAttribute(key);
      }
    }

    // Include loaded relations
    for (const [key, value] of Object.entries(this.relations)) {
      if (Array.isArray(value)) {
        result[key] = value.map((v: any) => (v instanceof Model ? v.toJSON() : v));
      } else if (value instanceof Model) {
        result[key] = value.toJSON();
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  toObject(): ModelAttributes {
    return this.toJSON();
  }

  // ── Hydration ────────────────────────────────────────────

  /** @internal Create a model instance from a database row */
  static hydrate<T extends Model>(this: new () => T, row: Record<string, any>): T {
    const instance = new this();
    instance.attributes = snapshotAttributes(row);
    instance.syncOriginal();
    instance.previousOriginalAttributes = {};
    instance.changedAttributes = {};
    instance.exists = true;
    return instance;
  }

  // ── Hooks ────────────────────────────────────────────────

  /** Register hooks for this model class */
  static boot(hooks: ModelHooks): void {
    this.hooks.set(this, hooks);
  }

  /** Register an observer for this model class */
  static observe(observer: ModelObserver): void {
    const existing = this.observers.get(this) ?? [];
    existing.push(observer);
    this.observers.set(this, existing);
  }

  /** Remove all observers for this model class */
  static removeObservers(): void {
    this.observers.delete(this);
  }

  private async fireHook(event: keyof ModelHooks): Promise<void> {
    const ctor = this.constructor as typeof Model;

    // Inline hooks (from static boot())
    const hooks = Model.hooks.get(ctor);
    if (hooks?.[event]) {
      await hooks[event]!(this);
    }

    // Instance-level methods (e.g. creating() on the model itself)
    if (typeof (this as any)[event] === 'function') {
      await (this as any)[event]();
    }

    // Observer methods
    const observers = Model.observers.get(ctor) ?? [];
    for (const observer of observers) {
      const method = observer[event as ModelEventName];
      if (typeof method === 'function') {
        await method.call(observer, this);
      }
    }

    // Auto-dispatch event through EventDispatcher (e.g. 'user.created')
    const modelName = ctor.name.toLowerCase();
    await Event.emit(`${modelName}.${event}`, this);
  }

  /** Fire a custom model event */
  async fireEvent(eventName: string): Promise<void> {
    const ctor = this.constructor as typeof Model;

    // Validate it's a declared custom event
    if (!ctor.events.includes(eventName)) {
      throw new Error(
        `Event "${eventName}" is not declared in ${ctor.name}.events. ` +
        `Add it to: static events = ['${eventName}', ...];`
      );
    }

    // Call observer method if it exists
    const observers = Model.observers.get(ctor) ?? [];
    for (const observer of observers) {
      const method = (observer as any)[eventName];
      if (typeof method === 'function') {
        await method.call(observer, this);
      }
    }

    // Dispatch through EventDispatcher
    const modelName = ctor.name.toLowerCase();
    await Event.emit(`${modelName}.${eventName}`, this);
  }

  // ── Private Helpers ──────────────────────────────────────

  private syncOriginal(): void {
    this.flushCastCache();
    this.originalAttributes = snapshotAttributes(this.attributes);
  }

  private captureChanges(): void {
    this.previousOriginalAttributes = snapshotAttributes(this.originalAttributes);
    this.changedAttributes = this.getDirty();
  }

  private getInsertableAttributes(): ModelAttributes {
    const ctor = this.constructor as typeof Model;
    const attrs = this.getAttributes();

    // Remove auto-incrementing primary key from insert data
    if (ctor.incrementing && attrs[ctor.primaryKey] === undefined) {
      delete attrs[ctor.primaryKey];
    }

    return attrs;
  }

  private readCast(key: string, raw: any): any {
    if (raw == null) return raw;
    const cast = (this.constructor as typeof Model).casts[key];
    if (typeof cast === 'object') return cast.get(snapshot(raw), this, key);
    if (cast === 'decimal' || cast?.startsWith('decimal:')) {
      return decimal(raw, cast === 'decimal' ? undefined : Number(cast.slice(8)));
    }
    switch (cast) {
      case 'number': return Number(raw);
      case 'boolean': return raw === '0' ? false : Boolean(raw);
      case 'string': return String(raw);
      case 'date': return new Date(raw);
      case 'json': return typeof raw === 'string' ? JSON.parse(raw) : snapshot(raw);
      default: return raw;
    }
  }

  private writeCast(key: string, value: any): any {
    if (value == null) return value;
    const cast = (this.constructor as typeof Model).casts[key];
    if (typeof cast === 'object') return snapshot(cast.set(value, this, key));
    if (cast === 'json') return typeof value === 'string' ? value : JSON.stringify(value);
    if (cast === 'date') {
      const date = new Date(value);
      if (!Number.isFinite(date.getTime())) throw new TypeError(`Invalid date for attribute "${key}".`);
      return date.toISOString();
    }
    if (cast === 'decimal' || cast?.startsWith('decimal:')) {
      return decimal(value, cast === 'decimal' ? undefined : Number(cast.slice(8)));
    }
    return snapshot(value);
  }

  private flushCastCache(): void {
    for (const [key, cached] of this.castCache) {
      const raw = this.writeCast(key, cached.value);
      this.attributes[key] = raw;
      cached.raw = raw;
    }
  }

  private attributesEqual(key: string, left: any, right: any): boolean {
    if (left == null || right == null) return left === right;
    const cast = (this.constructor as typeof Model).casts[key];
    if (typeof cast === 'object') {
      const a = this.readCast(key, left);
      const b = this.readCast(key, right);
      if (cast.equals) {
        const equivalent = cast.equals(a, b);
        if (typeof equivalent !== 'boolean') throw new TypeError('Custom cast equality must return a boolean synchronously.');
        return equivalent;
      }
      return isDeepStrictEqual(cast.set(a, this, key), cast.set(b, this, key));
    }
    return isDeepStrictEqual(this.readCast(key, left), this.readCast(key, right));
  }

  private applyTenantAttributes(): void {
    const ctor = this.constructor as typeof Model;
    if (!ctor.tenantScoped || this.getAttribute(ctor.tenantColumn) !== undefined) {
      return;
    }

    const teamId = ApplicationContext.get<string | number | null>('teamId');
    if (teamId === undefined || teamId === null || teamId === '') {
      if (!ctor.requireTenantContext) return;
      throw new Error(
        `Tenant context is required for model "${ctor.name}". ` +
        'Wrap the operation in Teams.runWithTeam(...) or call withoutTenantScope() explicitly.',
      );
    }

    this.setAttribute(ctor.tenantColumn, teamId);
  }

  /** Getter-based table name accessor (for relationship classes) */
  static get tableName(): string {
    return this.table;
  }

  protected newUniqueId(_column: string): string {
    const ctor = this.constructor as typeof Model;
    return ctor.uniqueIdType === 'ulid' ? generateUlid() : generateUuidV7();
  }

  private populateUniqueIds(): void {
    const ctor = this.constructor as typeof Model;
    for (const column of ctor.uniqueIds) {
      if (!this.getAttribute(column)) {
        this.setAttribute(column, this.newUniqueId(column));
      }
    }
  }
}

export function generateUuidV7(): string {
  return uuidv7();
}

export function generateUlid(): string {
  return ulid();
}

export class TenantModel extends Model {
  static tenantScoped = true;
  static tenantColumn = 'team_id';
  static requireTenantContext = true;
}
