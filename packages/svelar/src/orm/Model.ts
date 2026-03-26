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

import { QueryBuilder } from './QueryBuilder.js';
import { HasOne, HasMany, BelongsTo, BelongsToMany } from './Relationship.js';

// ── Types ──────────────────────────────────────────────────

export type ModelAttributes = Record<string, any>;

export interface ModelHooks {
  creating?: (model: Model) => Promise<void> | void;
  created?: (model: Model) => Promise<void> | void;
  updating?: (model: Model) => Promise<void> | void;
  updated?: (model: Model) => Promise<void> | void;
  saving?: (model: Model) => Promise<void> | void;
  saved?: (model: Model) => Promise<void> | void;
  deleting?: (model: Model) => Promise<void> | void;
  deleted?: (model: Model) => Promise<void> | void;
}

// ── Model Base Class ───────────────────────────────────────

export abstract class Model {
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

  /** Attribute casting definitions */
  static casts: Record<string, 'string' | 'number' | 'boolean' | 'date' | 'json'> = {};

  /** Columns that can be mass-assigned */
  static fillable: string[] = [];

  /** Columns that are hidden from serialization */
  static hidden: string[] = [];

  /** Database connection name (null = default) */
  static connection: string | undefined = undefined;

  /** Registered model hooks */
  private static hooks: Map<string, ModelHooks> = new Map();

  // ── Instance Properties ──

  private attributes: ModelAttributes = {};
  private originalAttributes: ModelAttributes = {};
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
        if (['table', 'primaryKey', 'incrementing', 'timestamps', 'casts', 'fillable', 'hidden', 'connection'].includes(prop)) {
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
    const instance = new this();
    const ctor = this as unknown as typeof Model;
    return new QueryBuilder<T>(ctor.table, this, ctor.connection);
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

  static async count(this: typeof Model): Promise<number> {
    return (this as any).query().count();
  }

  static async create<T extends Model>(
    this: new () => T,
    attributes: ModelAttributes
  ): Promise<T> {
    const instance = new this();
    const ctor = this as unknown as typeof Model;
    instance.fill(attributes);

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
    const qb = new QueryBuilder(ctor.table, this, ctor.connection);
    const id = await qb.insertGetId(data, ctor.primaryKey);

    if (ctor.incrementing && id) {
      instance.setAttribute(ctor.primaryKey, id);
    }

    instance.syncOriginal();
    instance.exists = true;

    await instance.fireHook('created');
    await instance.fireHook('saved');

    return instance as T;
  }

  // ── Instance Methods ─────────────────────────────────────

  async save(): Promise<void> {
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
        const pk = this.getAttribute(ctor.primaryKey);
        const qb = new QueryBuilder(ctor.table, this.constructor, ctor.connection);
        await qb.where(ctor.primaryKey, pk).update(dirty);
      }

      this.syncOriginal();

      await this.fireHook('updated');
      await this.fireHook('saved');
    } else {
      // Insert (delegate to static create)
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
      const qb = new QueryBuilder(ctor.table, this.constructor, ctor.connection);
      const id = await qb.insertGetId(data, ctor.primaryKey);

      if (ctor.incrementing && id) {
        this.setAttribute(ctor.primaryKey, id);
      }

      this.syncOriginal();
      this.exists = true;

      await this.fireHook('created');
      await this.fireHook('saved');
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
    await qb.where(ctor.primaryKey, pk).delete();

    this.exists = false;

    await this.fireHook('deleted');
  }

  async refresh(): Promise<void> {
    const ctor = this.constructor as typeof Model;
    const pk = this.getAttribute(ctor.primaryKey);
    const fresh = await (this.constructor as any).find(pk);

    if (fresh) {
      this.attributes = { ...fresh.attributes };
      this.syncOriginal();
    }
  }

  // ── Attribute Management ─────────────────────────────────

  getAttribute(key: string): any {
    const ctor = this.constructor as typeof Model;
    const raw = this.attributes[key];

    // Apply casts
    const cast = ctor.casts[key];
    if (cast && raw !== undefined && raw !== null) {
      switch (cast) {
        case 'number':
          return Number(raw);
        case 'boolean':
          return Boolean(raw);
        case 'string':
          return String(raw);
        case 'date':
          return new Date(raw);
        case 'json':
          return typeof raw === 'string' ? JSON.parse(raw) : raw;
      }
    }

    return raw;
  }

  setAttribute(key: string, value: any): void {
    const ctor = this.constructor as typeof Model;
    const cast = ctor.casts[key];

    // Serialize for storage
    if (cast === 'json' && typeof value !== 'string') {
      this.attributes[key] = JSON.stringify(value);
    } else {
      this.attributes[key] = value;
    }
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
    return { ...this.attributes };
  }

  getOriginal(key?: string): any {
    if (key) return this.originalAttributes[key];
    return { ...this.originalAttributes };
  }

  getDirty(): ModelAttributes {
    const dirty: ModelAttributes = {};
    for (const [key, value] of Object.entries(this.attributes)) {
      if (value !== this.originalAttributes[key]) {
        dirty[key] = value;
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
    return this.isDirty(...keys);
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
    instance.attributes = { ...row };
    instance.syncOriginal();
    instance.exists = true;
    return instance;
  }

  // ── Hooks ────────────────────────────────────────────────

  /** Register hooks for this model class */
  static boot(hooks: ModelHooks): void {
    this.hooks.set(this.name, hooks);
  }

  private async fireHook(event: keyof ModelHooks): Promise<void> {
    const ctor = this.constructor as typeof Model;
    const hooks = Model.hooks.get(ctor.name);
    if (hooks?.[event]) {
      await hooks[event]!(this);
    }

    // Also check instance-level methods
    if (typeof (this as any)[event] === 'function') {
      await (this as any)[event]();
    }
  }

  // ── Private Helpers ──────────────────────────────────────

  private syncOriginal(): void {
    this.originalAttributes = { ...this.attributes };
  }

  private getInsertableAttributes(): ModelAttributes {
    const ctor = this.constructor as typeof Model;
    const attrs = { ...this.attributes };

    // Remove auto-incrementing primary key from insert data
    if (ctor.incrementing && attrs[ctor.primaryKey] === undefined) {
      delete attrs[ctor.primaryKey];
    }

    return attrs;
  }

  /** Getter-based table name accessor (for relationship classes) */
  static get tableName(): string {
    return this.table;
  }
}
