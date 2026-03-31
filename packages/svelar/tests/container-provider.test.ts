import { describe, it, expect } from 'vitest';
import { ServiceProvider } from '../src/container/ServiceProvider.js';
import { Container } from '../src/container/Container.js';

class TestProvider extends ServiceProvider {
  registered = false;
  booted = false;

  register() {
    this.registered = true;
    this.app.bind('test', () => 'hello');
  }

  boot() {
    this.booted = true;
  }
}

class AsyncProvider extends ServiceProvider {
  async register() {
    this.app.bind('async', () => 'async-value');
  }

  async boot() {
    // async boot
  }
}

describe('ServiceProvider', () => {
  it('should receive container in constructor', () => {
    const container = new Container();
    const provider = new TestProvider(container);
    expect(provider).toBeDefined();
  });

  it('should register bindings', async () => {
    const container = new Container();
    const provider = new TestProvider(container);
    provider.register();
    expect(provider.registered).toBe(true);
    expect(await container.make('test')).toBe('hello');
  });

  it('should boot after registration', () => {
    const container = new Container();
    const provider = new TestProvider(container);
    provider.register();
    provider.boot();
    expect(provider.booted).toBe(true);
  });

  it('should support async register', async () => {
    const container = new Container();
    const provider = new AsyncProvider(container);
    await provider.register();
    expect(await container.make('async')).toBe('async-value');
  });
});
