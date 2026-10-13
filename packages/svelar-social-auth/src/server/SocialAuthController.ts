import { SocialAuth } from '../SocialAuth.js';
import type { ProviderName, RequestEvent } from '../types.js';
import type { AuthLoginSession, AuthManager, AuthUser, SessionLoginOptions } from '@beeblock/svelar/auth';

export interface SocialLoginEvent {
  locals: { auth?: AuthManager; session?: AuthLoginSession; user?: AuthUser | null };
}

export class SocialAuthController {
  /** Only call after verified provider identity has been mapped through an application action. */
  static async login(provider: ProviderName, event: SocialLoginEvent, user: AuthUser, options: SessionLoginOptions = {}): Promise<AuthUser | null> {
    if (!SocialAuth.isProviderName(provider) || !SocialAuth.isConfigured(provider)) throw new Error('Social sign-in provider is unavailable.');
    const { auth, session } = event.locals;
    if (!auth || !session) throw new Error('Social sign-in requires request-local authentication and a managed session.');
    const authenticated = await auth.login(user, session, { ...options, providerId: provider });
    event.locals.user = authenticated;
    return authenticated;
  }

  static redirect(provider: ProviderName, event: RequestEvent, options?: { scopes?: string[]; params?: Record<string, string> }): Response {
    let driver = SocialAuth.driver(provider);

    if (options?.scopes) {
      driver = driver.scopes(options.scopes);
    }

    if (options?.params) {
      driver = driver.with(options.params);
    }

    return driver.redirect(event);
  }

  static async callback(provider: ProviderName, event: RequestEvent, options?: { stateless?: boolean }) {
    let driver = SocialAuth.driver(provider);

    if (options?.stateless) {
      driver = driver.stateless();
    }

    return driver.callback(event);
  }
}
