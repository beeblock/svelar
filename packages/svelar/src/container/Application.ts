/**
 * Svelar Application
 *
 * Bootstraps the framework by registering and booting all service providers.
 */

import { Container } from './Container.js';
import { ServiceProvider } from './ServiceProvider.js';

export class Application {
  readonly container: Container;
  private providers: ServiceProvider[] = [];
  private booted = false;

  constructor(container?: Container) {
    this.container = container ?? new Container();
    // Register the application itself
    this.container.instance('app', this);
    this.container.instance('container', this.container);
  }

  /**
   * Register a service provider
   */
  register(ProviderClass: new (app: Container) => ServiceProvider): this {
    const provider = new ProviderClass(this.container);
    this.providers.push(provider);
    return this;
  }

  /**
   * Bootstrap the application: register all, then boot all
   */
  async bootstrap(): Promise<this> {
    if (this.booted) return this;

    // Phase 1: Register all providers
    for (const provider of this.providers) {
      await provider.register();
    }

    // Phase 2: Boot all providers
    for (const provider of this.providers) {
      await provider.boot();
    }

    this.booted = true;
    return this;
  }

  /**
   * Check if the application has been bootstrapped
   */
  isBooted(): boolean {
    return this.booted;
  }

  /**
   * Resolve a service from the container
   */
  async make<T = any>(name: string): Promise<T> {
    return this.container.make<T>(name);
  }

  /**
   * Get the list of registered providers
   */
  getProviders(): ServiceProvider[] {
    return [...this.providers];
  }
}
