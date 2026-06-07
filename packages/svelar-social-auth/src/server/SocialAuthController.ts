import { SocialAuth } from '../SocialAuth.js';
import type { ProviderName, RequestEvent } from '../types.js';

export class SocialAuthController {
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
