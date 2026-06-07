export type ProviderName = 'google' | 'github';

export interface ProviderConfig {
  clientId: string;
  clientSecret: string;
  redirectUrl: string;
  scopes?: string[];
}

export interface SocialAuthConfig {
  providers: Partial<Record<ProviderName, ProviderConfig>>;
  stateCookieName?: string;
  stateCookieMaxAge?: number;
}

export type SocialAuthCallbackHandler = (event: RequestEvent, user: SocialUser) => Response | Promise<Response>;

export interface SocialUser {
  id: string;
  name: string;
  email: string | null;
  avatar: string | null;
  provider: string;
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
  raw: Record<string, unknown>;
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
}

export interface RequestEvent {
  url: URL;
  cookies: {
    get(name: string, opts?: { decode?: (value: string) => string }): string | undefined;
    set(name: string, value: string, opts?: Record<string, unknown>): void;
    delete(name: string, opts?: Record<string, unknown>): void;
  };
  request: Request;
}
