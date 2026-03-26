/**
 * Svelar Service Layer
 *
 * Base classes for the service layer in a hybrid DDD architecture.
 * Services orchestrate business logic, coordinate actions, and
 * interact with repositories.
 *
 * @example
 * ```ts
 * import { Service } from 'svelar/services';
 *
 * class UserService extends Service {
 *   constructor(private userRepo: UserRepository) {
 *     super();
 *   }
 *
 *   async register(data: RegisterDTO): Promise<User> {
 *     const exists = await this.userRepo.findByEmail(data.email);
 *     if (exists) throw new ConflictError('Email already taken');
 *
 *     const hashedPassword = await Hash.make(data.password);
 *     const user = await this.userRepo.create({
 *       ...data,
 *       password: hashedPassword,
 *     });
 *
 *     await this.emit('user:registered', user);
 *     return user;
 *   }
 * }
 * ```
 */

// ── Types ──────────────────────────────────────────────────

export interface ServiceResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  errors?: Record<string, string[]>;
}

// ── Base Service ───────────────────────────────────────────

export abstract class Service {
  private eventDispatchFn?: (event: any) => Promise<void>;

  /**
   * Set the event dispatch function for this service
   */
  setEventDispatcher(dispatchFn: (event: any) => Promise<void>): void {
    this.eventDispatchFn = dispatchFn;
  }

  /**
   * Emit a domain event object
   */
  protected async emit(event: any): Promise<void> {
    if (this.eventDispatchFn) {
      await this.eventDispatchFn(event);
    }
  }

  /**
   * Return a success result
   */
  protected ok<T>(data?: T): ServiceResult<T> {
    return { success: true, data };
  }

  /**
   * Return a failure result
   */
  protected fail(error: string, errors?: Record<string, string[]>): ServiceResult<never> {
    return { success: false, error, errors };
  }

  /**
   * Execute an action within a try/catch, returning a ServiceResult
   */
  protected async attempt<T>(fn: () => Promise<T>): Promise<ServiceResult<T>> {
    try {
      const data = await fn();
      return this.ok(data);
    } catch (error: any) {
      return this.fail(error.message);
    }
  }
}

// ── CRUD Service ───────────────────────────────────────────

/**
 * Pre-built CRUD service that delegates to a repository.
 * Extend to add custom business logic.
 */
export abstract class CrudService<TModel = any, TCreateDTO = any, TUpdateDTO = any> extends Service {
  protected abstract repository(): Repository<TModel>;

  async findAll(options?: { page?: number; perPage?: number }): Promise<TModel[]> {
    if (options?.page) {
      const result = await this.repository().paginate(options.page, options.perPage);
      return result.data;
    }
    return this.repository().all();
  }

  async findById(id: any): Promise<TModel | null> {
    return this.repository().findById(id);
  }

  async findByIdOrFail(id: any): Promise<TModel> {
    const item = await this.repository().findById(id);
    if (!item) throw new Error(`Record with id ${id} not found`);
    return item;
  }

  async create(data: TCreateDTO): Promise<TModel> {
    return this.repository().create(data as any);
  }

  async update(id: any, data: TUpdateDTO): Promise<TModel> {
    return this.repository().update(id, data as any);
  }

  async delete(id: any): Promise<void> {
    return this.repository().delete(id);
  }
}

// ── Re-export Repository for convenience ──────────────────

import { Repository } from '../repositories/index.js';
export { Repository };
