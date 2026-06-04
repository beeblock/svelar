/**
 * Svelar Events
 *
 * Laravel-inspired event dispatcher with typed events, listeners, and subscribers.
 *
 * @example
 * ```ts
 * import { Event } from '@beeblock/svelar/events';
 *
 * // Define an event
 * class UserRegistered {
 *   constructor(public readonly user: User) {}
 * }
 *
 * // Register a listener
 * Event.listen(UserRegistered, async (event) => {
 *   await sendWelcomeEmail(event.user);
 * });
 *
 * // Dispatch
 * await Event.dispatch(new UserRegistered(user));
 * ```
 */

// ── Types ──────────────────────────────────────────────────

export type EventClass<T = any> = new (...args: any[]) => T;
export type EventListener<T = any> = (event: T) => void | Promise<void>;
export type WildcardListener = (eventName: string, event: any) => void | Promise<void>;

export interface Subscriber {
  subscribe(events: EventDispatcher): void;
}

// ── Event Dispatcher ───────────────────────────────────────

export class EventDispatcher {
  private listeners = new Map<string, EventListener[]>();
  private wildcardListeners: WildcardListener[] = [];
  private onceListeners = new Map<string, EventListener[]>();

  /**
   * Register an event listener
   */
  listen<T>(event: EventClass<T> | string, listener: EventListener<T>): () => void {
    const name = typeof event === 'string' ? event : event.name;

    if (!this.listeners.has(name)) {
      this.listeners.set(name, []);
    }
    this.listeners.get(name)!.push(listener as EventListener);

    // Return unsubscribe function
    return () => {
      const listeners = this.listeners.get(name);
      if (listeners) {
        const idx = listeners.indexOf(listener as EventListener);
        if (idx >= 0) listeners.splice(idx, 1);
      }
    };
  }

  /**
   * Register a one-time listener
   */
  once<T>(event: EventClass<T> | string, listener: EventListener<T>): () => void {
    const name = typeof event === 'string' ? event : event.name;

    if (!this.onceListeners.has(name)) {
      this.onceListeners.set(name, []);
    }
    this.onceListeners.get(name)!.push(listener as EventListener);

    return () => {
      const listeners = this.onceListeners.get(name);
      if (listeners) {
        const idx = listeners.indexOf(listener as EventListener);
        if (idx >= 0) listeners.splice(idx, 1);
      }
    };
  }

  /**
   * Register a wildcard listener (called for every event)
   */
  onAny(listener: WildcardListener): () => void {
    this.wildcardListeners.push(listener);
    return () => {
      const idx = this.wildcardListeners.indexOf(listener);
      if (idx >= 0) this.wildcardListeners.splice(idx, 1);
    };
  }

  /**
   * Dispatch an event
   */
  async dispatch<T extends object>(event: T): Promise<void> {
    const name = event.constructor.name;

    // Regular listeners
    const listeners = this.listeners.get(name) ?? [];
    for (const listener of listeners) {
      await listener(event);
    }

    // Once listeners
    const onceListeners = this.onceListeners.get(name) ?? [];
    for (const listener of onceListeners) {
      await listener(event);
    }
    this.onceListeners.delete(name);

    // Wildcard listeners
    for (const listener of this.wildcardListeners) {
      await listener(name, event);
    }
  }

  /**
   * Dispatch an event by string name with payload
   */
  async emit(name: string, payload?: any): Promise<void> {
    const listeners = this.listeners.get(name) ?? [];
    for (const listener of listeners) {
      await listener(payload);
    }

    const onceListeners = this.onceListeners.get(name) ?? [];
    for (const listener of onceListeners) {
      await listener(payload);
    }
    this.onceListeners.delete(name);

    for (const listener of this.wildcardListeners) {
      await listener(name, payload);
    }
  }

  /**
   * Register a subscriber (an object that subscribes to multiple events)
   */
  subscribe(subscriber: Subscriber): void {
    subscriber.subscribe(this);
  }

  /**
   * Remove all listeners for an event
   */
  forget(event: EventClass | string): void {
    const name = typeof event === 'string' ? event : event.name;
    this.listeners.delete(name);
    this.onceListeners.delete(name);
  }

  /**
   * Remove all listeners
   */
  flush(): void {
    this.listeners.clear();
    this.onceListeners.clear();
    this.wildcardListeners = [];
  }

  /**
   * Check if an event has listeners
   */
  hasListeners(event: EventClass | string): boolean {
    const name = typeof event === 'string' ? event : event.name;
    return (
      (this.listeners.get(name)?.length ?? 0) > 0 ||
      (this.onceListeners.get(name)?.length ?? 0) > 0 ||
      this.wildcardListeners.length > 0
    );
  }

  /**
   * Get the count of listeners for an event
   */
  listenerCount(event: EventClass | string): number {
    const name = typeof event === 'string' ? event : event.name;
    return (
      (this.listeners.get(name)?.length ?? 0) +
      (this.onceListeners.get(name)?.length ?? 0)
    );
  }
}

import { singleton } from '../support/singleton.js';

/**
 * Global event dispatcher singleton
 */
export const Event = singleton('svelar.event', () => new EventDispatcher());

// ── Re-exports ────────────────────────────────────────────

export { Listener } from './Listener.js';
export { EventServiceProvider, type ListenMap, type ObserverMap, type ListenerClass } from './EventServiceProvider.js';
