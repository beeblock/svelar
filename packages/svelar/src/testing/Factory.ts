/**
 * Factory — Laravel-inspired model factory for tests.
 *
 * Subclass this to define factories for your models. Each factory
 * has a `definition()` method that returns default attributes and
 * a `model()` method that returns the Model class.
 */

import type { Model } from '../orm/Model.js';

type ModelClass<T> = new (...args: any[]) => T;

export abstract class Factory<T extends Model> {
  private static _sequence = 0;

  /** Auto-incrementing counter unique per factory invocation */
  get sequence(): number {
    return ++Factory._sequence;
  }

  /** Reset the global sequence counter (useful between tests) */
  static resetSequence(): void {
    Factory._sequence = 0;
  }

  /** Return the Model class this factory produces */
  abstract model(): ModelClass<T>;

  /** Return default attribute values for the model */
  abstract definition(): Record<string, any>;

  /**
   * Create a model instance and persist it to the database.
   */
  async create(overrides: Partial<Record<string, any>> = {}): Promise<T> {
    const ModelClass = this.model();
    const attrs = { ...this.definition(), ...overrides };
    const instance = new ModelClass();
    Object.assign(instance, attrs);
    await (instance as any).save();
    return instance;
  }

  /**
   * Create multiple model instances and persist them.
   */
  async createMany(count: number, overrides: Partial<Record<string, any>> = {}): Promise<T[]> {
    const results: T[] = [];
    for (let i = 0; i < count; i++) {
      results.push(await this.create(overrides));
    }
    return results;
  }

  /**
   * Make a model instance without persisting it.
   */
  make(overrides: Partial<Record<string, any>> = {}): T {
    const ModelClass = this.model();
    const attrs = { ...this.definition(), ...overrides };
    const instance = new ModelClass();
    Object.assign(instance, attrs);
    return instance;
  }

  /**
   * Make multiple model instances without persisting them.
   */
  makeMany(count: number, overrides: Partial<Record<string, any>> = {}): T[] {
    const results: T[] = [];
    for (let i = 0; i < count; i++) {
      results.push(this.make(overrides));
    }
    return results;
  }
}
