/**
 * Svelar EventServiceProvider
 *
 * Base class for registering event-to-listener mappings and model observers
 * in a declarative way. Extend this in your app to wire up all event handling.
 *
 * @example
 * ```ts
 * import { EventServiceProvider } from '@beeblock/svelar/events';
 * import { UserRegistered } from '../events/UserRegistered.js';
 * import { SendWelcomeEmail } from '../listeners/SendWelcomeEmail.js';
 * import { User } from '../modules/users/User.js';
 * import { UserObserver } from '../modules/users/UserObserver.js';
 *
 * export class AppEventServiceProvider extends EventServiceProvider {
 *   protected listen = {
 *     [UserRegistered.name]: [SendWelcomeEmail],
 *     'order.created': [NotifyWarehouse, SendOrderConfirmation],
 *   };
 *
 *   protected observers = {
 *     [User.name]: [UserObserver],
 *   };
 * }
 * ```
 */

import { ServiceProvider } from '../container/ServiceProvider.js';
import { Event, type EventListener } from './index.js';
import type { Listener } from './Listener.js';
import type { ModelObserver } from '../orm/Observer.js';

export type ListenerClass = new () => { handle(event: any): void | Promise<void> };

export type ListenMap = Record<string, (ListenerClass | EventListener)[]>;

export type ObserverMap = Record<string, (new () => ModelObserver)[]>;

export abstract class EventServiceProvider extends ServiceProvider {
  /**
   * Map of event names/classes to their listeners.
   *
   * Keys can be class names (for class-based events) or string event names.
   * Values are arrays of Listener classes or inline functions.
   */
  protected listen: ListenMap = {};

  /**
   * Map of model class names to their observer classes.
   *
   * Keys are model class names (e.g. 'User').
   * Values are arrays of observer class constructors.
   */
  protected observers: ObserverMap = {};

  /**
   * The subscriber classes to register.
   * Each subscriber's subscribe() method receives the EventDispatcher.
   */
  protected subscribe: (new () => { subscribe(events: typeof Event): void })[] = [];

  register(): void {
    // Nothing to register — event wiring happens in boot
  }

  async boot(): Promise<void> {
    this.registerListeners();
    this.registerSubscribers();
    await this.registerObservers();
  }

  private registerListeners(): void {
    for (const [eventName, listeners] of Object.entries(this.listen)) {
      for (const listener of listeners) {
        if (this.isListenerClass(listener)) {
          // Class-based listener: instantiate and use handle() with shouldHandle() guard
          const instance = new listener();
          Event.listen(eventName, async (event: any) => {
            if ('shouldHandle' in instance && typeof instance.shouldHandle === 'function') {
              if (!instance.shouldHandle(event)) return;
            }
            await instance.handle(event);
          });
        } else {
          // Inline function listener
          Event.listen(eventName, listener as EventListener);
        }
      }
    }
  }

  private registerSubscribers(): void {
    for (const SubscriberClass of this.subscribe) {
      const subscriber = new SubscriberClass();
      Event.subscribe(subscriber);
    }
  }

  private async registerObservers(): Promise<void> {
    for (const [modelName, observerClasses] of Object.entries(this.observers)) {
      // Dynamically resolve the model class from the container or global registry
      // Since we can't import model classes here, we use the model registry
      const ModelClass = EventServiceProvider.modelRegistry.get(modelName);
      if (!ModelClass) {
        console.warn(
          `[EventServiceProvider] Model "${modelName}" not found in registry. ` +
          `Register it with EventServiceProvider.registerModel(${modelName}).`
        );
        continue;
      }

      for (const ObserverClass of observerClasses) {
        ModelClass.observe(new ObserverClass());
      }
    }
  }

  /**
   * Check if a listener entry is a class (has a handle method) vs an inline function
   */
  private isListenerClass(listener: any): listener is ListenerClass {
    return (
      typeof listener === 'function' &&
      listener.prototype &&
      typeof listener.prototype.handle === 'function'
    );
  }

  // ── Model Registry ──────────────────────────────────────

  private static modelRegistry = new Map<string, any>();

  /**
   * Register a model class so observers can be attached by name.
   * Call this in your app setup or in a service provider's register().
   */
  static registerModel(ModelClass: { name: string; observe(observer: ModelObserver): void }): void {
    this.modelRegistry.set(ModelClass.name, ModelClass);
  }

  /**
   * Register multiple model classes at once.
   */
  static registerModels(...models: { name: string; observe(observer: ModelObserver): void }[]): void {
    for (const model of models) {
      this.registerModel(model);
    }
  }
}
