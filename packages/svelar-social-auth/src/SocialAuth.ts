import type { SocialAuthConfig, ProviderName, ProviderConfig } from './types.js';
import type { Provider } from './providers/Provider.js';
import { GoogleProvider } from './providers/GoogleProvider.js';
import { GitHubProvider } from './providers/GitHubProvider.js';
import { singleton } from '@beeblock/svelar/support';

const providerFactories: Record<ProviderName, new (config: ProviderConfig, cookieName?: string, cookieMaxAge?: number) => Provider> = {
  google: GoogleProvider,
  github: GitHubProvider,
};

const shared = singleton('svelar.social-auth.config', () => ({ config: null as SocialAuthConfig | null }));

export class SocialAuth {
  static supportedProviders(): ProviderName[] {
    return Object.keys(providerFactories) as ProviderName[];
  }

  static isProviderName(name: string): name is ProviderName {
    return Object.hasOwn(providerFactories, name);
  }

  private static getConfig(): SocialAuthConfig {
    if (!shared.config) {
      throw new Error('SocialAuth not configured. Call SocialAuth.configure() first.');
    }
    return shared.config;
  }

  static configure(config: SocialAuthConfig): void {
    shared.config = config;
  }

  static driver(name: ProviderName): Provider {
    if (!this.isProviderName(name)) {
      throw new Error(`Unknown social auth provider: ${name}`);
    }

    const config = this.getConfig();
    const providerConfig = config.providers[name];

    if (!providerConfig) {
      throw new Error(`Social auth provider "${name}" is not configured`);
    }

    const Factory = providerFactories[name];
    if (!Factory) {
      throw new Error(`Unknown social auth provider: ${name}`);
    }

    return new Factory(
      providerConfig,
      config.stateCookieName ?? 'social_auth_state',
      config.stateCookieMaxAge ?? 300,
    );
  }

  static configuredProviders(): ProviderName[] {
    const config = this.getConfig();
    return Object.keys(config.providers) as ProviderName[];
  }

  static isConfigured(name: ProviderName): boolean {
    if (!shared.config) return false;
    return Object.hasOwn(shared.config.providers, name) && shared.config.providers[name] !== undefined;
  }

  static reset(): void {
    shared.config = null;
  }
}
