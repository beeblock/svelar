import type { SocialAuthConfig } from './types.js';
import { SocialAuth } from './SocialAuth.js';
import { Plugin } from '@beeblock/svelar/plugins';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface SocialAuthPluginConfig {
  providers?: SocialAuthConfig['providers'];
  stateCookieName?: string;
  stateCookieMaxAge?: number;
}

const distDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = dirname(distDir);
const pub = join(packageRoot, 'src', 'publishable');

export class SvelarSocialAuthPlugin extends Plugin {
  readonly name = 'svelar-social-auth';
  readonly version = '0.1.0';
  readonly description = 'OAuth social authentication plugin for Svelar — Google and GitHub';
  private readonly options: SocialAuthPluginConfig;

  constructor(config: SocialAuthPluginConfig = {}) {
    super();
    this.options = config;

    SocialAuth.configure({
      providers: config.providers ?? {},
      stateCookieName: config.stateCookieName,
      stateCookieMaxAge: config.stateCookieMaxAge,
    });
  }

  socialAuthConfig(): SocialAuthPluginConfig {
    return this.options;
  }

  config() {
    return {
      key: 'socialAuth',
      defaults: {
        stateCookieName: 'social_auth_state',
        stateCookieMaxAge: 300,
        providers: {},
      },
    };
  }

  static configuredProviders(): string[] {
    return SocialAuth.configuredProviders();
  }

  publishables() {
    return {
      routes: [
        { source: join(pub, 'routes/social-redirect.ts'), dest: 'src/routes/auth/[provider]/redirect/+server.ts', type: 'asset' as const },
        { source: join(pub, 'routes/social-callback.ts'), dest: 'src/routes/auth/[provider]/callback/+server.ts', type: 'asset' as const },
      ],
    };
  }
}
