import { Plugin } from 'svelar/plugins';
import type { Container } from 'svelar/container';

/**
 * Example plugin demonstrating the Svelar plugin system.
 * Tracks page views in memory (replace with a real analytics service).
 */
export class AnalyticsPlugin extends Plugin {
  readonly name = 'svelar-analytics';
  readonly version = '1.0.0';
  description = 'Simple analytics tracking for page views';

  private pageViews = new Map<string, number>();

  async register(app: Container): Promise<void> {
    // Register the analytics tracker as a singleton
    app.instance('analytics', this);
  }

  async boot(app: Container): Promise<void> {
    console.log('[AnalyticsPlugin] Booted successfully');
  }

  track(path: string): void {
    const current = this.pageViews.get(path) ?? 0;
    this.pageViews.set(path, current + 1);
  }

  getStats(): Record<string, number> {
    return Object.fromEntries(this.pageViews);
  }

  middleware() {
    return [
      {
        name: 'analytics',
        handler: async (ctx: any, next: any) => {
          this.track(ctx.event.url.pathname);
          return next();
        },
      },
    ];
  }

  config() {
    return {
      key: 'analytics',
      defaults: {
        enabled: true,
        trackQueryParams: false,
      },
    };
  }
}
