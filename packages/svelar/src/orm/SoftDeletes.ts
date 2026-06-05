import { Model } from './Model.js';

type ModelConstructor<T extends Model = Model> = new (...args: any[]) => T;

export interface SoftDeletesStatic {
  softDeletes: boolean;
  deletedAt: string;
}

/**
 * Laravel-style soft delete mixin.
 *
 * @example
 * ```ts
 * class Post extends SoftDeletes(Model) {
 *   static table = 'posts';
 * }
 * ```
 */
export function SoftDeletes<TBase extends ModelConstructor>(Base: TBase): TBase & SoftDeletesStatic {
  class SoftDeletesModel extends Base {
    static softDeletes = true;
    static deletedAt = 'deleted_at';
  }

  return SoftDeletesModel as TBase & SoftDeletesStatic;
}
