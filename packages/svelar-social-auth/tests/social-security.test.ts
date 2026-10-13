import { afterEach, describe, expect, it } from 'vitest';
import { AuthManager } from '@beeblock/svelar/auth';
import { compile } from 'svelte/compiler';
import { readFileSync } from 'node:fs';
import { SocialAuth } from '../src/SocialAuth.js';
import { SocialAuthController } from '../src/server/SocialAuthController.js';

class Account {
  static persisted: Account | null;
  static async find() { return this.persisted; }
  constructor(readonly data: Record<string, unknown>) {}
  getAttribute(key: string) { return this.data[key]; }
}
function configure(disabled = false, available = true) {
  SocialAuth.configure({ providers: { github: { clientId: 'fixture-client', clientSecret: 'fixture-secret', redirectUrl: '/auth/github/callback' } } });
  Account.persisted = new Account({ id: 7, disabled });
  const audit: unknown[] = [];
  const writes: unknown[] = [];
  const auth = new AuthManager({ guard: 'session', model: Account, eligibility: { disabledColumn: 'disabled' }, audit: { record: (event) => { audit.push(event); } },
    presentation: { providers: [{ id: 'github', label: 'GitHub', protocol: 'oauth2', configured: true, available, loginUrl: '/auth/github/redirect' }] },
  });
  const session = { set: (key: string, value: unknown) => { writes.push([key, value]); }, regenerateId: () => { writes.push('rotate'); }, startAuthentication: (remember: boolean) => { writes.push(['remember', remember]); } };
  return { event: { locals: { auth, session, user: null } }, auth, audit, writes };
}
afterEach(() => SocialAuth.reset());

describe('Social auth current core security contract', () => {
  it.each(['constructor', 'toString', '__proto__'])('rejects inherited provider keys (%s)', (provider) => {
    SocialAuth.configure({ providers: {} });
    expect(SocialAuth.isProviderName(provider)).toBe(false);
    expect(SocialAuth.isConfigured(provider as never)).toBe(false);
    expect(() => SocialAuth.driver(provider as never)).toThrow('Unknown social auth provider');
  });

  it('uses fresh persisted account eligibility without writing a disabled account session', async () => {
    const { event, auth, audit, writes } = configure(true);
    expect(await SocialAuthController.login('github', event, new Account({ id: 7, disabled: false }))).toBeNull();
    expect(auth.failureReason()).toBe('account_disabled');
    expect(writes).toEqual([]);
    expect(audit).toMatchObject([{ action: 'auth.federation', outcome: 'denied', providerId: 'github' }]);
  });

  it('establishes an eligible federation session through core login with audit and genuine remember semantics', async () => {
    const { event, auth, audit, writes } = configure();
    const result = await SocialAuthController.login('github', event, new Account({ id: 7 }), { remember: true });
    expect(result).toBe(Account.persisted);
    expect(event.locals.user).toBe(result);
    expect(auth.user()).toBe(result);
    expect(writes).toContainEqual(['auth_user_id', 7]);
    expect(writes).toContain('rotate');
    expect(writes).toContainEqual(['remember', true]);
    expect(audit).toMatchObject([{ action: 'auth.federation', outcome: 'allowed', providerId: 'github' }]);
  });

  it('respects core provider availability and rejects unmanaged request contexts', async () => {
    const { event, auth, writes } = configure(false, false);
    expect(await SocialAuthController.login('github', event, new Account({ id: 7 }))).toBeNull();
    expect(auth.failureReason()).toBe('provider_unavailable');
    expect(writes).toEqual([]);
    await expect(SocialAuthController.login('github', { locals: {} }, new Account({ id: 7 }))).rejects.toThrow('request-local');
  });

  it.each([{ providers: [] }, { providers: [{ id: 'github', label: 'GitHub', protocol: 'oauth2' as const, configured: false, loginUrl: '/auth/github/redirect' }] }])('requires a configured Core Auth provider entry even when the plugin has credentials (%j)', async ({ providers }) => {
    const { event, writes } = configure();
    event.locals.auth = new AuthManager({ guard: 'session', model: Account, audit: false, presentation: { providers } });
    expect(await SocialAuthController.login('github', event, new Account({ id: 7 }))).toBeNull();
    expect(event.locals.auth.failureReason()).toBe('provider_unavailable');
    expect(writes).toEqual([]);
  });

  it.each(['SocialLoginButton', 'SocialLoginButtons'])('compiles %s for server/client without accessibility errors', (name) => {
    const source = readFileSync(new URL('../src/ui/' + name + '.svelte', import.meta.url), 'utf8');
    for (const generate of ['client', 'server'] as const) expect(compile(source, { filename: name + '.svelte', generate }).warnings.filter((warning) => warning.code.startsWith('a11y'))).toEqual([]);
  });

  it('keeps the published callback fail-closed and never advertises direct session writes or exposes upstream secrets', () => {
    const source = readFileSync(new URL('../src/publishable/routes/social-callback.ts', import.meta.url), 'utf8');
    expect(source).toContain('SocialAuthController.login(provider, event, user)');
    expect(source).not.toContain("session.set('auth_user_id'");
    expect(source).not.toMatch(/message:\s*error/);
    expect(source).toContain('501');
  });

  it('publishes credential-derived Core Auth provider configuration instead of manual session authentication', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    expect(readme).toContain('presentation: authPresentation');
    expect(readme).toContain("id: 'google'");
    expect(readme).toContain("id: 'github'");
    expect(readme).toContain('configured: googleConfigured');
    expect(readme).toContain('available: githubConfigured');
    expect(readme).toContain('always supplies `providerId`');
    expect(readme).not.toContain('set `auth_user_id`');
  });
});
