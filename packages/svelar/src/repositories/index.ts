/**
 * Svelar Repository
 *
 * Base repository classes that abstract data access from business logic.
 * Repositories wrap Model queries and provide a clean interface for
 * services and actions to work with.
 *
 * @example
 * ```ts
 * import { Repository } from '@beeblock/svelar/repositories';
 * import { User } from '../models/User';
 *
 * class UserRepository extends Repository<User> {
 *   model() {
 *     return User;
 *   }
 *
 *   async findByEmail(email: string): Promise<User | null> {
 *     return this.query().where('email', email).first();
 *   }
 *
 *   async findActive(): Promise<User[]> {
 *     return this.query()
 *       .where('active', true)
 *       .orderBy('name')
 *       .get();
 *   }
 *
 *   async findWithPosts(id: number): Promise<User | null> {
 *     return this.query()
 *       .with('posts')
 *       .find(id);
 *   }
 * }
 * ```
 */

// ── Types ──────────────────────────────────────────────────

export interface PaginationMeta {
  total: number;
  page: number;
  perPage: number;
  lastPage: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface SortOption {
  column: string;
  direction: 'asc' | 'desc';
}

export interface FilterCriteria {
  column: string;
  operator: '=' | '!=' | '>' | '<' | '>=' | '<=' | 'like' | 'in' | 'not_in';
  value: any;
}

// ── Base Repository ────────────────────────────────────────

export abstract class Repository<TModel = any> {
  /**
   * Return the Model class this repository works with
   */
  abstract model(): any;

  /**
   * Get a fresh query builder for the model
   */
  protected query(): any {
    return this.model().query();
  }

  // ── Standard CRUD ────────────────────────────────────────

  /**
   * Get all records
   */
  async all(): Promise<TModel[]> {
    return this.model().all();
  }

  /**
   * Find a record by primary key
   */
  async findById(id: any): Promise<TModel | null> {
    return this.model().find(id);
  }

  /**
   * Find a record by primary key or throw
   */
  async findByIdOrFail(id: any): Promise<TModel> {
    return this.model().findOrFail(id);
  }

  /**
   * Find records matching a where clause
   */
  async findWhere(column: string, value: any): Promise<TModel[]> {
    return this.model().where(column, value).get();
  }

  /**
   * Find the first record matching a where clause
   */
  async findFirstWhere(column: string, value: any): Promise<TModel | null> {
    return this.model().where(column, value).first();
  }

  /**
   * Create a new record
   */
  async create(attributes: Record<string, any>): Promise<TModel> {
    return this.model().create(attributes);
  }

  /**
   * Update a record by primary key
   */
  async update(id: any, attributes: Record<string, any>): Promise<TModel> {
    const record = await this.findByIdOrFail(id);
    await (record as any).update(attributes);
    return record;
  }

  /**
   * Delete a record by primary key
   */
  async delete(id: any): Promise<void> {
    const record = await this.findByIdOrFail(id);
    await (record as any).delete();
  }

  // ── Bulk Operations ──────────────────────────────────────

  /**
   * Create multiple records
   */
  async createMany(items: Record<string, any>[]): Promise<TModel[]> {
    const results: TModel[] = [];
    for (const item of items) {
      results.push(await this.create(item));
    }
    return results;
  }

  /**
   * Delete records matching a where clause
   */
  async deleteWhere(column: string, value: any): Promise<number> {
    return this.query().where(column, value).delete();
  }

  // ── Query Helpers ────────────────────────────────────────

  /**
   * Count all records
   */
  async count(): Promise<number> {
    return this.model().count();
  }

  /**
   * Count records matching a where clause
   */
  async countWhere(column: string, value: any): Promise<number> {
    return this.query().where(column, value).count();
  }

  /**
   * Check if a record exists with the given criteria
   */
  async exists(column: string, value: any): Promise<boolean> {
    return this.query().where(column, value).exists();
  }

  /**
   * Paginate results
   */
  async paginate(page: number = 1, perPage: number = 15): Promise<PaginatedResult<TModel>> {
    const result = await this.query().paginate(page, perPage);
    return {
      data: result.data,
      meta: {
        total: result.total,
        page: result.currentPage,
        perPage: result.perPage,
        lastPage: result.lastPage,
        hasNextPage: result.currentPage < result.lastPage,
        hasPrevPage: result.currentPage > 1,
      },
    };
  }

  /**
   * Get the latest records
   */
  async latest(limit?: number, column: string = 'created_at'): Promise<TModel[]> {
    const q = this.query().orderBy(column, 'desc');
    if (limit) q.limit(limit);
    return q.get();
  }

  /**
   * Get the oldest records
   */
  async oldest(limit?: number, column: string = 'created_at'): Promise<TModel[]> {
    const q = this.query().orderBy(column, 'asc');
    if (limit) q.limit(limit);
    return q.get();
  }

  /**
   * Find or create a record
   */
  async firstOrCreate(
    searchAttributes: Record<string, any>,
    createAttributes?: Record<string, any>,
  ): Promise<TModel> {
    const entries = Object.entries(searchAttributes);
    let q = this.query();
    for (const [key, value] of entries) {
      q = q.where(key, value);
    }
    const existing = await q.first();
    if (existing) return existing;

    return this.create({ ...searchAttributes, ...createAttributes });
  }

  /**
   * Update or create a record
   */
  async updateOrCreate(
    searchAttributes: Record<string, any>,
    updateAttributes: Record<string, any>,
  ): Promise<TModel> {
    const entries = Object.entries(searchAttributes);
    let q = this.query();
    for (const [key, value] of entries) {
      q = q.where(key, value);
    }
    const existing = await q.first();

    if (existing) {
      await (existing as any).update(updateAttributes);
      return existing;
    }

    return this.create({ ...searchAttributes, ...updateAttributes });
  }

  // ── Scoped Queries ───────────────────────────────────────

  /**
   * Apply multiple filter criteria
   */
  async filter(criteria: FilterCriteria[], sort?: SortOption): Promise<TModel[]> {
    let q = this.query();

    for (const { column, operator, value } of criteria) {
      switch (operator) {
        case 'in':
          q = q.whereIn(column, value);
          break;
        case 'not_in':
          q = q.whereNotIn(column, value);
          break;
        case 'like':
          q = q.where(column, 'like', value);
          break;
        default:
          q = q.where(column, operator, value);
      }
    }

    if (sort) {
      q = q.orderBy(sort.column, sort.direction);
    }

    return q.get();
  }

  /**
   * Pluck a single column from all records
   */
  async pluck(column: string): Promise<any[]> {
    return this.query().pluck(column);
  }
}
