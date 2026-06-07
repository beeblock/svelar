import { afterEach, describe, expect, it, vi } from 'vitest';
import { SocialAuth, GitHubProvider, GoogleProvider } from '../src/index.js';

function createEvent(path: string, cookieJar = new Map<string, string>()): any {
  const url = new URL(path, 'http://localhost');

  return {
    request: new Request(url),
    url,
    cookies: {
      get: (name: string) => cookieJar.get(name),
      set: (name: string, value: string) => {
        cookieJar.set(name, value);
      },
      delete: (name: string) => {
        cookieJar.delete(name);
      },
    },
  };
}

function redirectLocation(response: Response): URL {
  const location = response.headers.get('location');
  if (!location) throw new Error('Missing redirect Location header');
  return new URL(location);
}

describe('@beeblock/svelar-social-auth', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    SocialAuth.reset();
  });

  it('supports Google and GitHub only', () => {
    SocialAuth.configure({
      providers: {
        google: {
          clientId: 'google-client',
          clientSecret: 'google-secret',
          redirectUrl: '/auth/google/callback',
        },
        github: {
          clientId: 'github-client',
          clientSecret: 'github-secret',
          redirectUrl: '/auth/github/callback',
        },
      },
    });

    expect(SocialAuth.supportedProviders()).toEqual(['google', 'github']);
    expect(SocialAuth.isProviderName('google')).toBe(true);
    expect(SocialAuth.isProviderName('github')).toBe(true);
    expect(SocialAuth.isProviderName('discord')).toBe(false);
    expect(() => SocialAuth.driver('discord' as any)).toThrow('Unknown social auth provider');
    expect(SocialAuth.driver('google')).toBeInstanceOf(GoogleProvider);
    expect(SocialAuth.driver('github')).toBeInstanceOf(GitHubProvider);
  });

  it('does not allow extra params to override reserved OAuth redirect params', () => {
    SocialAuth.configure({
      providers: {
        google: {
          clientId: 'google-client',
          clientSecret: 'google-secret',
          redirectUrl: '/auth/google/callback',
        },
      },
    });

    const cookieJar = new Map<string, string>();
    const response = SocialAuth.driver('google')
      .with({
        state: 'attacker-state',
        client_id: 'attacker-client',
        redirect_uri: 'https://attacker.test/callback',
        response_type: 'token',
        scope: 'profile',
        prompt: 'select_account',
      })
      .redirect(createEvent('/login', cookieJar));

    const location = redirectLocation(response);
    const state = cookieJar.get('social_auth_state');

    expect(response.status).toBe(302);
    expect(location.searchParams.get('client_id')).toBe('google-client');
    expect(location.searchParams.get('redirect_uri')).toBe('http://localhost/auth/google/callback');
    expect(location.searchParams.get('response_type')).toBe('code');
    expect(location.searchParams.get('scope')).toBe('openid email profile');
    expect(location.searchParams.get('prompt')).toBe('select_account');
    expect(location.searchParams.get('state')).toBe(state);
    expect(location.searchParams.get('state')).not.toBe('attacker-state');
  });

  it('sets state cookies with secure=false on local http development origins', () => {
    SocialAuth.configure({
      providers: {
        github: {
          clientId: 'github-client',
          clientSecret: 'github-secret',
          redirectUrl: '/auth/github/callback',
        },
      },
    });

    const options: Record<string, unknown>[] = [];
    const event = createEvent('/login');
    event.cookies.set = (_name: string, _value: string, opts: Record<string, unknown>) => {
      options.push(opts);
    };

    SocialAuth.driver('github').redirect(event);

    expect(options[0]).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      maxAge: 300,
    });
  });

  it('checks callback state before token exchange', async () => {
    SocialAuth.configure({
      providers: {
        google: {
          clientId: 'google-client',
          clientSecret: 'google-secret',
          redirectUrl: '/auth/google/callback',
        },
      },
    });

    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const cookieJar = new Map<string, string>([['social_auth_state', 'expected-state']]);
    const event = createEvent('/auth/google/callback?code=oauth-code&state=wrong-state', cookieJar);

    await expect(SocialAuth.driver('google').callback(event))
      .rejects
      .toThrow('Invalid OAuth state');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(cookieJar.has('social_auth_state')).toBe(false);
  });

  it('maps a successful GitHub callback to a SocialUser', async () => {
    SocialAuth.configure({
      providers: {
        github: {
          clientId: 'github-client',
          clientSecret: 'github-secret',
          redirectUrl: '/auth/github/callback',
        },
      },
    });

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'gho_token',
        token_type: 'bearer',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 123,
        login: 'octo',
        name: 'Octo Cat',
        avatar_url: 'https://avatars.githubusercontent.com/u/123',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { email: 'octo@example.test', primary: true, verified: true },
      ]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    const cookieJar = new Map<string, string>([['social_auth_state', 'valid-state']]);
    const event = createEvent('/auth/github/callback?code=oauth-code&state=valid-state', cookieJar);
    const user = await SocialAuth.driver('github').callback(event);

    expect(user.toJSON()).toMatchObject({
      id: '123',
      name: 'Octo Cat',
      email: 'octo@example.test',
      provider: 'github',
      accessToken: 'gho_token',
    });
  });
});
