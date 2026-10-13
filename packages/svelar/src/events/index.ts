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

import { ApplicationContext, type ApplicationContextSnapshot } from '../support/Context.js';
import { captureEventEnvelope, readEventEnvelope, type EventDispatchOptions, type EventJson, type NamedEventEnvelope } from './ContextEnvelope.js';

// ── Types ──────────────────────────────────────────────────

export type EventClass<T = any> = new (...args: any[]) => T;
export type EventListener<T = any> = (event: T) => void | Promise<void>;
export type WildcardListener = (eventName: string, event: any) => void | Promise<void>;

export interface Subscriber {
  subscribe(events: EventDispatcher): void;
}

// ── Event Dispatcher ───────────────────────────────────────

export class EventDispatcher {
  private listeners = new Map<EventClass | string, EventListener[]>();
  private wildcardListeners: WildcardListener[] = [];
  private onceListeners = new Map<EventClass | string, EventListener[]>();
  private legacyClasses = new Map<string, EventClass>();
  private testingInterceptors = new Set<(name: string, payload: unknown) => boolean>();

  /** @internal Intercept delivery without modifying registered listeners. */
  interceptForTesting(interceptor: (name: string, payload: unknown) => boolean): () => void {
    const handler = (name: string, payload: unknown) => interceptor(name, payload);
    this.testingInterceptors.add(handler);
    return () => { this.testingInterceptors.delete(handler); };
  }

  /**
   * Register an event listener
   */
  listen<T>(event: EventClass<T> | string, listener: EventListener<T>): () => void {
    const name = event;

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
      this.releaseLegacyName(name);
    };
  }

  /**
   * Register a one-time listener
   */
  once<T>(event: EventClass<T> | string, listener: EventListener<T>): () => void {
    const name = event;

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
      this.releaseLegacyName(name);
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
  async dispatch<T extends object>(event: T, options: EventDispatchOptions = {}): Promise<void> {
    const context = options.context === undefined ? ApplicationContext.snapshot() : { ...options.context };
    const name = event.constructor.name;
    const key = event.constructor as EventClass<T>;
    const keys: (EventClass | string)[] = [key];
    if (this.namedCount(name)) { this.assertLegacyClass(key); keys.push(name); }
    await this.deliver(name, event, keys, context);
  }

  /**
   * Dispatch an event by string name with payload
   */
  async emit(name: string, payload?: any, options: EventDispatchOptions = {}): Promise<void> {
    const context = options.context === undefined ? ApplicationContext.snapshot() : { ...options.context };
    await this.deliver(name, payload, [name], context);
  }

  /** Capture plain data for an explicitly named app-owned job; no constructor names or ambient worker identity. */
  capture(name: string, payload: EventJson = null, options: EventDispatchOptions = {}): NamedEventEnvelope {
    return captureEventEnvelope(name, payload, options);
  }

  /** Replay a serialized envelope inside the original isolated context. */
  async replay(envelope: NamedEventEnvelope): Promise<void> {
    const captured = readEventEnvelope(envelope);
    await this.deliver(captured.name, captured.payload, [captured.name], captured.context, true);
  }

  private async deliver(name: string, payload: unknown, keys: (EventClass | string)[], context: ApplicationContextSnapshot, transport = false): Promise<void> {
    const isolated = <T>(callback: () => T | Promise<T>): T | Promise<T> => ApplicationContext.runIsolated(transport ? structuredClone(context) : { ...context }, callback);
    for (const interceptor of [...this.testingInterceptors].reverse()) {
      if (await isolated(() => interceptor(name, payload))) return;
    }
    const listeners = keys.flatMap((key) => this.listeners.get(key) ?? []);
    for (const listener of listeners) {
      await isolated(() => listener(payload));
    }
    const onceListeners = keys.flatMap((key) => this.onceListeners.get(key) ?? []);
    for (const key of keys) { this.onceListeners.delete(key); this.releaseLegacyName(key); }
    for (const listener of onceListeners) {
      await isolated(() => listener(payload));
    }
    for (const listener of [...this.wildcardListeners]) {
      await isolated(() => listener(name, payload));
    }
  }

  private namedCount(name: string): number {
    return (this.listeners.get(name)?.length ?? 0) + (this.onceListeners.get(name)?.length ?? 0);
  }

  private releaseLegacyName(key: EventClass | string): void {
    if (!this.listeners.get(key)?.length) this.listeners.delete(key);
    if (!this.onceListeners.get(key)?.length) this.onceListeners.delete(key);
    if (typeof key === 'string' && !this.namedCount(key)) this.legacyClasses.delete(key);
  }

  private assertLegacyClass(event: EventClass): void {
    const known = this.legacyClasses.get(event.name);
    const keys = [...this.listeners.keys(), ...this.onceListeners.keys()];
    if ((known && known !== event) || keys.some((key) => typeof key !== 'string' && key.name === event.name && key !== event)) {
      throw new Error(`Ambiguous event class name ${event.name}; bind local listeners by class identity or use explicit namespaced events.`);
    }
    this.legacyClasses.set(event.name, event);
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
    const name = event;
    this.listeners.delete(name);
    this.onceListeners.delete(name);
    this.releaseLegacyName(name);
  }

  /**
   * Remove all listeners
   */
  flush(): void {
    this.listeners.clear();
    this.onceListeners.clear();
    this.wildcardListeners = [];
    this.legacyClasses.clear();
  }

  /**
   * Check if an event has listeners
   */
  hasListeners(event: EventClass | string): boolean {
    return this.listenerCount(event) > 0 || this.wildcardListeners.length > 0;
  }

  /**
   * Get the count of listeners for an event
   */
  listenerCount(event: EventClass | string): number {
    return (
      (this.listeners.get(event)?.length ?? 0) +
      (this.onceListeners.get(event)?.length ?? 0) +
      (typeof event === 'string' ? 0 : this.namedCount(event.name))
    );
  }
}

import { singleton } from '../support/singleton.js';
export type { EventDispatchOptions, EventJson, NamedEventEnvelope } from './ContextEnvelope.js';

/**
 * Global event dispatcher singleton
 */
export const Event = singleton('svelar.event', () => new EventDispatcher());

// ── Re-exports ────────────────────────────────────────────

export { Listener } from './Listener.js';
export { EventServiceProvider, type ListenMap, type ObserverMap, type ListenerClass } from './EventServiceProvider.js';
