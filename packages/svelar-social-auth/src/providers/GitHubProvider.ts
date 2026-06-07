import { Provider } from './Provider.js';
import type { OAuthTokenResponse, SocialUser } from '../types.js';

export class GitHubProvider extends Provider {
  protected getAuthorizationUrl(): string {
    return 'https://github.com/login/oauth/authorize';
  }

  protected getTokenUrl(): string {
    return 'https://github.com/login/oauth/access_token';
  }

  protected getUserInfoUrl(): string {
    return 'https://api.github.com/user';
  }

  protected getDefaultScopes(): string[] {
    return ['read:user', 'user:email'];
  }

  protected getScopeSeparator(): string {
    return ' ';
  }

  protected getProviderName(): string {
    return 'github';
  }

  protected async fetchUserData(tokens: OAuthTokenResponse): Promise<Record<string, unknown>> {
    const [userResponse, emailsResponse] = await Promise.all([
      fetch(this.getUserInfoUrl(), {
        headers: {
          'Authorization': `Bearer ${tokens.access_token}`,
          'Accept': 'application/json',
        },
      }),
      fetch('https://api.github.com/user/emails', {
        headers: {
          'Authorization': `Bearer ${tokens.access_token}`,
          'Accept': 'application/json',
        },
      }),
    ]);

    if (!userResponse.ok) {
      const text = await userResponse.text();
      throw new Error(`GitHub user info fetch failed (${userResponse.status}): ${text}`);
    }

    const user = await userResponse.json() as Record<string, unknown>;

    if (emailsResponse.ok) {
      const emails = await emailsResponse.json() as Array<{ email: string; primary: boolean; verified: boolean }>;
      const primaryEmail = emails.find(e => e.primary && e.verified);
      if (primaryEmail) {
        user._primary_email = primaryEmail.email;
      }
    }

    return user;
  }

  protected mapUserResponse(data: Record<string, unknown>, tokens: OAuthTokenResponse): SocialUser {
    const email = data._primary_email
      ? String(data._primary_email)
      : data.email
        ? String(data.email)
        : null;

    return {
      id: String(data.id ?? ''),
      name: String(data.name ?? data.login ?? ''),
      email,
      avatar: data.avatar_url ? String(data.avatar_url) : null,
      provider: this.getProviderName(),
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      expiresIn: tokens.expires_in ?? null,
      raw: data,
    };
  }
}
