import { randomBytes, timingSafeEqual } from 'node:crypto';
import { SocialUser } from '../SocialUser.js';
import type { ProviderConfig, OAuthTokenResponse, RequestEvent, SocialUser as ISocialUser } from '../types.js';

export abstract class Provider {
  protected config: ProviderConfig;
  protected customScopes: string[] | null = null;
  protected extraParams: Record<string, string> = {};
  protected isStateless = false;
  protected stateCookieName: string;
  protected stateCookieMaxAge: number;

  constructor(config: ProviderConfig, stateCookieName = 'social_auth_state', stateCookieMaxAge = 300) {
    this.config = config;
    this.stateCookieName = stateCookieName;
    this.stateCookieMaxAge = stateCookieMaxAge;
  }

  protected abstract getAuthorizationUrl(): string;
  protected abstract getTokenUrl(): string;
  protected abstract getUserInfoUrl(): string;
  protected abstract getDefaultScopes(): string[];
  protected abstract getScopeSeparator(): string;
  protected abstract getProviderName(): string;
  protected abstract mapUserResponse(data: Record<string, unknown>, tokens: OAuthTokenResponse): ISocialUser;

  scopes(scopes: string[]): this {
    this.customScopes = scopes;
    return this;
  }

  with(params: Record<string, string>): this {
    this.extraParams = { ...this.extraParams, ...params };
    return this;
  }

  stateless(): this {
    this.isStateless = true;
    return this;
  }

  protected getScopes(): string[] {
    return this.customScopes ?? this.config.scopes ?? this.getDefaultScopes();
  }

  protected generateState(): string {
    return randomBytes(32).toString('hex');
  }

  protected cookieOptions(event: RequestEvent): Record<string, unknown> {
    return {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: event.url.protocol === 'https:',
      maxAge: this.stateCookieMaxAge,
    };
  }

  protected compareState(storedState: string | undefined, callbackState: string | null): boolean {
    if (!storedState || !callbackState) return false;
    const expected = Buffer.from(storedState);
    const actual = Buffer.from(callbackState);
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  }

  redirect(event: RequestEvent): Response {
    const state = this.generateState();
    const scopes = this.getScopes();

    if (!this.isStateless) {
      event.cookies.set(this.stateCookieName, state, this.cookieOptions(event));
    }

    const params = new URLSearchParams({
      ...this.extraParams,
      client_id: this.config.clientId,
      redirect_uri: this.buildRedirectUri(event),
      response_type: 'code',
      scope: scopes.join(this.getScopeSeparator()),
      state,
    });

    const url = `${this.getAuthorizationUrl()}?${params.toString()}`;
    return new Response(null, {
      status: 302,
      headers: { Location: url },
    });
  }

  async callback(event: RequestEvent): Promise<SocialUser> {
    const url = event.url;
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    if (!code) {
      const error = url.searchParams.get('error');
      const description = url.searchParams.get('error_description');
      throw new Error(`OAuth callback error: ${error ?? 'no code received'}${description ? ` — ${description}` : ''}`);
    }

    if (!this.isStateless) {
      const storedState = event.cookies.get(this.stateCookieName);
      event.cookies.delete(this.stateCookieName, { path: '/' });

      if (!this.compareState(storedState, state)) {
        throw new Error('Invalid OAuth state — possible CSRF attack');
      }
    }

    const tokens = await this.exchangeCodeForTokens(code, event);
    const userData = await this.fetchUserData(tokens);
    const mapped = this.mapUserResponse(userData, tokens);

    return new SocialUser(mapped);
  }

  protected async exchangeCodeForTokens(code: string, event: RequestEvent): Promise<OAuthTokenResponse> {
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.getClientSecret(),
      code,
      grant_type: 'authorization_code',
      redirect_uri: this.buildRedirectUri(event),
    });

    const response = await fetch(this.getTokenUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Token exchange failed (${response.status}): ${text}`);
    }

    return await response.json() as OAuthTokenResponse;
  }

  protected getClientSecret(): string {
    return this.config.clientSecret;
  }

  protected async fetchUserData(tokens: OAuthTokenResponse): Promise<Record<string, unknown>> {
    const response = await fetch(this.getUserInfoUrl(), {
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`User info fetch failed (${response.status}): ${text}`);
    }

    return await response.json() as Record<string, unknown>;
  }

  protected buildRedirectUri(event: RequestEvent): string {
    const redirectUrl = this.config.redirectUrl;
    if (redirectUrl.startsWith('http://') || redirectUrl.startsWith('https://')) {
      return redirectUrl;
    }
    const origin = event.url.origin;
    return `${origin}${redirectUrl.startsWith('/') ? '' : '/'}${redirectUrl}`;
  }
}
