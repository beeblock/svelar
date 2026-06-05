import { Model } from './Model.js';

type ModelConstructor<T extends Model = Model> = new (...args: any[]) => T;

export interface UniqueIdsStatic {
  primaryKey: string;
  incrementing: boolean;
  uniqueIds: string[];
  uniqueIdType: 'uuid' | 'ulid';
}

export function HasUuids<TBase extends ModelConstructor>(Base: TBase): TBase & UniqueIdsStatic {
  class HasUuidsModel extends Base {
    static primaryKey = 'id';
    static incrementing = false;
    static uniqueIds = ['id'];
    static uniqueIdType = 'uuid' as const;
  }

  return HasUuidsModel as TBase & UniqueIdsStatic;
}

export function HasUlids<TBase extends ModelConstructor>(Base: TBase): TBase & UniqueIdsStatic {
  class HasUlidsModel extends Base {
    static primaryKey = 'id';
    static incrementing = false;
    static uniqueIds = ['id'];
    static uniqueIdType = 'ulid' as const;
  }

  return HasUlidsModel as TBase & UniqueIdsStatic;
}
