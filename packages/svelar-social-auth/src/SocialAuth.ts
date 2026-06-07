import type { SocialAuthConfig, ProviderName, ProviderConfig } from './types.js';
import type { Provider } from './providers/Provider.js';
import { GoogleProvider } from './providers/GoogleProvider.js';
import { GitHubProvider } from './providers/GitHubProvider.js';

const providerFactories: Record<ProviderName, new (config: ProviderConfig, cookieName?: string, cookieMaxAge?: number) => Provider> = {
  google: GoogleProvider,
  github: GitHubProvider,
};

let globalConfig: SocialAuthConfig | null = null;

export class SocialAuth {
  static supportedProviders(): ProviderName[] {
    return Object.keys(providerFactories) as ProviderName[];
  }

  static isProviderName(name: string): name is ProviderName {
    return name in providerFactories;
  }

  private static getConfig(): SocialAuthConfig {
    if (!globalConfig) {
      throw new Error('SocialAuth not configured. Call SocialAuth.configure() first.');
    }
    return globalConfig;
  }

  static configure(config: SocialAuthConfig): void {
    globalConfig = config;
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
    if (!globalConfig) return false;
    return name in globalConfig.providers;
  }

  static reset(): void {
    globalConfig = null;
  }
}
