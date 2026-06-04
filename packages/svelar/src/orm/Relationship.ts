/**
 * Svelar Relationships
 *
 * Eloquent-like relationship definitions:
 * HasOne, HasMany, BelongsTo, BelongsToMany
 */

import { QueryBuilder } from './QueryBuilder.js';
import { assertSqlIdentifier } from '../database/Connection.js';

// ── Base Relation ──────────────────────────────────────────

export abstract class Relation<TParent = any, TRelated = any> {
  protected parentModel: any;
  protected relatedModel: any;

  constructor(parent: any, related: any) {
    this.parentModel = parent;
    this.relatedModel = related;
  }

  /** Load related models for a single parent */
  abstract load(parent: TParent): Promise<TRelated>;

  /** Eager load related models for a collection of parents */
  abstract eagerLoad(parents: TParent[], relationName: string): Promise<void>;

  /** Get a query builder for the related model */
  query(): QueryBuilder {
    return this.relatedModel.query();
  }
}

// ── HasOne ─────────────────────────────────────────────────

export class HasOne extends Relation {
  constructor(
    parent: any,
    related: any,
    private foreignKey: string,
    private localKey: string = 'id'
  ) {
    super(parent, related);
  }

  async load(parent: any): Promise<any> {
    const parentKeyValue = parent.getAttribute(this.localKey);
    return this.relatedModel.query().where(this.foreignKey, parentKeyValue).first();
  }

  async eagerLoad(parents: any[], relationName: string): Promise<void> {
    const parentIds = parents.map((p) => p.getAttribute(this.localKey));
    const related = await this.relatedModel.query().whereIn(this.foreignKey, parentIds).get();

    const map = new Map<any, any>();
    for (const r of related) {
      map.set(r.getAttribute(this.foreignKey), r);
    }

    for (const parent of parents) {
      const key = parent.getAttribute(this.localKey);
      parent.setRelation(relationName, map.get(key) ?? null);
    }
  }

  async create(attributes: Record<string, any>): Promise<any> {
    const parentKeyValue = this.parentModel.getAttribute(this.localKey);
    return this.relatedModel.create({
      ...attributes,
      [this.foreignKey]: parentKeyValue,
    });
  }
}

// ── HasMany ────────────────────────────────────────────────

export class HasMany extends Relation {
  constructor(
    parent: any,
    related: any,
    private foreignKey: string,
    private localKey: string = 'id'
  ) {
    super(parent, related);
  }

  async load(parent: any): Promise<any[]> {
    const parentKeyValue = parent.getAttribute(this.localKey);
    return this.relatedModel.query().where(this.foreignKey, parentKeyValue).get();
  }

  async eagerLoad(parents: any[], relationName: string): Promise<void> {
    const parentIds = parents.map((p) => p.getAttribute(this.localKey));
    const related = await this.relatedModel.query().whereIn(this.foreignKey, parentIds).get();

    const map = new Map<any, any[]>();
    for (const r of related) {
      const fk = r.getAttribute(this.foreignKey);
      if (!map.has(fk)) map.set(fk, []);
      map.get(fk)!.push(r);
    }

    for (const parent of parents) {
      const key = parent.getAttribute(this.localKey);
      parent.setRelation(relationName, map.get(key) ?? []);
    }
  }

  async create(attributes: Record<string, any>): Promise<any> {
    const parentKeyValue = this.parentModel.getAttribute(this.localKey);
    return this.relatedModel.create({
      ...attributes,
      [this.foreignKey]: parentKeyValue,
    });
  }

  async createMany(items: Record<string, any>[]): Promise<any[]> {
    const results: any[] = [];
    for (const attrs of items) {
      results.push(await this.create(attrs));
    }
    return results;
  }
}

// ── BelongsTo ──────────────────────────────────────────────

export class BelongsTo extends Relation {
  constructor(
    parent: any,
    related: any,
    private foreignKey: string,
    private ownerKey: string = 'id'
  ) {
    super(parent, related);
  }

  async load(parent: any): Promise<any> {
    const foreignKeyValue = parent.getAttribute(this.foreignKey);
    if (foreignKeyValue == null) return null;
    return this.relatedModel.query().where(this.ownerKey, foreignKeyValue).first();
  }

  async eagerLoad(parents: any[], relationName: string): Promise<void> {
    const foreignKeys = parents
      .map((p) => p.getAttribute(this.foreignKey))
      .filter((v) => v != null);

    if (foreignKeys.length === 0) {
      for (const parent of parents) {
        parent.setRelation(relationName, null);
      }
      return;
    }

    const related = await this.relatedModel.query().whereIn(this.ownerKey, foreignKeys).get();

    const map = new Map<any, any>();
    for (const r of related) {
      map.set(r.getAttribute(this.ownerKey), r);
    }

    for (const parent of parents) {
      const fk = parent.getAttribute(this.foreignKey);
      parent.setRelation(relationName, map.get(fk) ?? null);
    }
  }

  associate(model: any): any {
    this.parentModel.setAttribute(this.foreignKey, model.getAttribute(this.ownerKey));
    return this.parentModel;
  }

  dissociate(): any {
    this.parentModel.setAttribute(this.foreignKey, null);
    return this.parentModel;
  }
}

// ── BelongsToMany ──────────────────────────────────────────

export class BelongsToMany extends Relation {
  constructor(
    parent: any,
    related: any,
    private pivotTable: string,
    private foreignPivotKey: string,
    private relatedPivotKey: string,
    private parentKey: string = 'id',
    private relatedKey: string = 'id'
  ) {
    super(parent, related);
    this.pivotTable = assertSqlIdentifier(this.pivotTable, 'Pivot table name');
    this.foreignPivotKey = assertSqlIdentifier(this.foreignPivotKey, 'Foreign pivot key');
    this.relatedPivotKey = assertSqlIdentifier(this.relatedPivotKey, 'Related pivot key');
    this.parentKey = assertSqlIdentifier(this.parentKey, 'Parent key');
    this.relatedKey = assertSqlIdentifier(this.relatedKey, 'Related key');
  }

  async load(parent: any): Promise<any[]> {
    const parentKeyValue = parent.getAttribute(this.parentKey);

    // Join through pivot table
    const pivotRows = await new QueryBuilder(this.pivotTable)
      .select(this.relatedPivotKey)
      .where(this.foreignPivotKey, parentKeyValue)
      .get();

    const relatedIds = pivotRows.map((r: any) => r[this.relatedPivotKey]);
    if (relatedIds.length === 0) return [];

    return this.relatedModel.query().whereIn(this.relatedKey, relatedIds).get();
  }

  async eagerLoad(parents: any[], relationName: string): Promise<void> {
    const parentIds = parents.map((p) => p.getAttribute(this.parentKey));

    if (parentIds.length === 0) {
      for (const parent of parents) {
        parent.setRelation(relationName, []);
      }
      return;
    }

    // Get all pivot records
    const pivotRows = await new QueryBuilder(this.pivotTable)
      .whereIn(this.foreignPivotKey, parentIds)
      .get();

    // Get all related models
    const relatedIds = [...new Set(pivotRows.map((r: any) => r[this.relatedPivotKey]))];
    const related =
      relatedIds.length > 0
        ? await this.relatedModel.query().whereIn(this.relatedKey, relatedIds).get()
        : [];

    // Build lookup map
    const relatedMap = new Map<any, any>();
    for (const r of related) {
      relatedMap.set(r.getAttribute(this.relatedKey), r);
    }

    // Map pivot → parent → related[]
    const parentRelatedMap = new Map<any, any[]>();
    for (const pivot of pivotRows) {
      const parentId = pivot[this.foreignPivotKey];
      const relatedId = pivot[this.relatedPivotKey];
      const relatedModel = relatedMap.get(relatedId);
      if (!relatedModel) continue;

      if (!parentRelatedMap.has(parentId)) parentRelatedMap.set(parentId, []);
      parentRelatedMap.get(parentId)!.push(relatedModel);
    }

    for (const parent of parents) {
      const key = parent.getAttribute(this.parentKey);
      parent.setRelation(relationName, parentRelatedMap.get(key) ?? []);
    }
  }

  async attach(id: any, pivot?: Record<string, any>): Promise<void> {
    const parentKeyValue = this.parentModel.getAttribute(this.parentKey);
    const data: Record<string, any> = {
      [this.foreignPivotKey]: parentKeyValue,
      [this.relatedPivotKey]: id,
      ...pivot,
    };

    await new QueryBuilder(this.pivotTable).insert(data);
  }

  async detach(id?: any): Promise<void> {
    const parentKeyValue = this.parentModel.getAttribute(this.parentKey);

    if (id) {
      await new QueryBuilder(this.pivotTable)
        .where(this.foreignPivotKey, parentKeyValue)
        .where(this.relatedPivotKey, id)
        .delete();
    } else {
      await new QueryBuilder(this.pivotTable)
        .where(this.foreignPivotKey, parentKeyValue)
        .delete();
    }
  }

  async sync(ids: any[]): Promise<void> {
    await this.detach();
    for (const id of ids) {
      await this.attach(id);
    }
  }

  async toggle(ids: any[]): Promise<void> {
    const parentKeyValue = this.parentModel.getAttribute(this.parentKey);

    for (const id of ids) {
      const exists = await new QueryBuilder(this.pivotTable)
        .where(this.foreignPivotKey, parentKeyValue)
        .where(this.relatedPivotKey, id)
        .exists();

      if (exists) {
        await this.detach(id);
      } else {
        await this.attach(id);
      }
    }
  }
}
