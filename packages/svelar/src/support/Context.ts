import { AsyncLocalStorage } from 'node:async_hooks';
import { singleton } from './singleton.js';

export interface ApplicationContextSnapshot {
  teamId?: string | number | null;
  userId?: string | number | null;
  correlationId?: string | null;
  [key: string]: any;
}

class ApplicationContextManager {
  private storage = new AsyncLocalStorage<ApplicationContextSnapshot>();
  private fallback: ApplicationContextSnapshot = {};

  run<T>(context: ApplicationContextSnapshot, callback: () => T | Promise<T>): T | Promise<T> {
    return this.storage.run({ ...this.current(), ...context }, callback);
  }

  current(): ApplicationContextSnapshot {
    return this.storage.getStore() ?? this.fallback;
  }

  snapshot(): ApplicationContextSnapshot {
    return { ...this.current() };
  }

  get<T = any>(key: string): T | undefined {
    return this.current()[key] as T | undefined;
  }

  set<T = any>(key: string, value: T): void {
    const current = this.current();
    current[key] = value;
  }

  clear(): void {
    const current = this.current();
    for (const key of Object.keys(current)) {
      delete current[key];
    }
  }
}

export const ApplicationContext = singleton('svelar.applicationContext', () => new ApplicationContextManager());
