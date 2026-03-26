/**
 * Svelar Service Provider
 *
 * Base class for registering services into the IoC container.
 * Follows Laravel's register/boot lifecycle.
 */

import { Container } from './Container.js';

export abstract class ServiceProvider {
  protected app: Container;

  constructor(app: Container) {
    this.app = app;
  }

  /**
   * Register bindings into the container.
   * Called before any provider is booted.
   */
  abstract register(): void | Promise<void>;

  /**
   * Bootstrap services after all providers are registered.
   * Use this for logic that depends on other services being available.
   */
  boot(): void | Promise<void> {
    // Override in subclass if needed
  }
}
