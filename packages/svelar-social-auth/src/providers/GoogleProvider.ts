import { Provider } from './Provider.js';
import type { OAuthTokenResponse, SocialUser } from '../types.js';

export class GoogleProvider extends Provider {
  protected getAuthorizationUrl(): string {
    return 'https://accounts.google.com/o/oauth2/v2/auth';
  }

  protected getTokenUrl(): string {
    return 'https://oauth2.googleapis.com/token';
  }

  protected getUserInfoUrl(): string {
    return 'https://www.googleapis.com/oauth2/v2/userinfo';
  }

  protected getDefaultScopes(): string[] {
    return ['openid', 'email', 'profile'];
  }

  protected getScopeSeparator(): string {
    return ' ';
  }

  protected getProviderName(): string {
    return 'google';
  }

  protected mapUserResponse(data: Record<string, unknown>, tokens: OAuthTokenResponse): SocialUser {
    return {
      id: String(data.id ?? ''),
      name: String(data.name ?? ''),
      email: data.email ? String(data.email) : null,
      avatar: data.picture ? String(data.picture) : null,
      provider: this.getProviderName(),
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      expiresIn: tokens.expires_in ?? null,
      raw: data,
    };
  }
}
