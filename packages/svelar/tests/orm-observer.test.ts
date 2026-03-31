import { describe, it, expect } from 'vitest';
import { ModelObserver, MODEL_EVENTS, type ModelEventName } from '../src/orm/Observer.js';

class UserObserver extends ModelObserver {
  log: string[] = [];

  creating(model: any) { this.log.push(`creating:${model.id}`); }
  created(model: any) { this.log.push(`created:${model.id}`); }
  updating(model: any) { this.log.push(`updating:${model.id}`); }
  updated(model: any) { this.log.push(`updated:${model.id}`); }
  saving(model: any) { this.log.push(`saving:${model.id}`); }
  saved(model: any) { this.log.push(`saved:${model.id}`); }
  deleting(model: any) { this.log.push(`deleting:${model.id}`); }
  deleted(model: any) { this.log.push(`deleted:${model.id}`); }
}

class PartialObserver extends ModelObserver {
  log: string[] = [];
  created(model: any) { this.log.push(`created:${model.id}`); }
}

describe('ModelObserver', () => {
  it('should define all lifecycle events', () => {
    expect(MODEL_EVENTS).toEqual([
      'creating', 'created',
      'updating', 'updated',
      'saving', 'saved',
      'deleting', 'deleted',
    ]);
  });

  it('should allow implementing all lifecycle methods', () => {
    const observer = new UserObserver();
    const model = { id: 1 };

    for (const event of MODEL_EVENTS) {
      observer[event]!(model as any);
    }

    expect(observer.log).toEqual([
      'creating:1', 'created:1',
      'updating:1', 'updated:1',
      'saving:1', 'saved:1',
      'deleting:1', 'deleted:1',
    ]);
  });

  it('should allow partial implementation', () => {
    const observer = new PartialObserver();
    expect(observer.created).toBeDefined();
    expect(observer.creating).toBeUndefined();
    expect(observer.updating).toBeUndefined();
    expect(observer.deleting).toBeUndefined();
  });

  it('should call only implemented methods', () => {
    const observer = new PartialObserver();
    const model = { id: 5 };

    // Only 'created' is implemented
    for (const event of MODEL_EVENTS) {
      if (observer[event]) {
        observer[event]!(model as any);
      }
    }

    expect(observer.log).toEqual(['created:5']);
  });
});
