import { describe, expect, it } from 'vitest';
import { AuthManager } from '../src/auth/Auth.js';
import { authFailurePresentation, resolveAuthPresentation, type AuthFederationProvider } from '../src/auth/Presentation.js';
import { Model } from '../src/orm/Model.js';

function provider(overrides: Partial<AuthFederationProvider> = {}): AuthFederationProvider {
  return { id: 'enterprise', label: 'Enterprise SSO', protocol: 'oidc', loginUrl: '/auth/enterprise/redirect', configured: true, ...overrides };
}

describe('Public auth presentation and federation contract', () => {
  it('uses app branding defaults without advertising unconfigured providers', () => {
    expect(resolveAuthPresentation({}, 'Example')).toEqual({ brand: { name: 'Example' }, providers: [] });
    expect(resolveAuthPresentation({ providers: [provider({ configured: false })] }).providers).toEqual([]);
    const auth = new AuthManager({ guard: 'session', model: Model, appName: 'Configured application' });
    expect(auth.presentation().brand.name).toBe('Configured application');
    expect(auth.federationProvider('unknown')).toBeNull();
  });

  it('selects only public branding/provider fields, preserves availability, and returns owned objects', () => {
    const brand = { name: 'Example', title: 'Sign in', description: 'Account access', logoUrl: '/brand.svg', logoAlt: 'Example',
      imageUrl: 'https://assets.example.test/account.jpg', imageAlt: 'Office', accentColor: '#138A61', internalToken: 'private-brand-token' };
    const configured = { ...provider({ iconUrl: '/sso.svg' }), clientSecret: 'private-provider-secret' };
    const output = resolveAuthPresentation({ brand, providers: [configured, provider({ id: 'saml', protocol: 'saml', available: false })] });
    expect(output.brand).toMatchObject({ name: 'Example', accentColor: '#138A61', logoUrl: '/brand.svg' });
    expect(output.providers.map((item) => [item.id, item.available])).toEqual([['enterprise', true], ['saml', false]]);
    expect(JSON.stringify(output)).not.toContain('private');
    expect(output.providers[0]).not.toHaveProperty('configured');
    output.brand.name = 'Changed';
    output.providers[0].label = 'Changed';
    expect(brand.name).toBe('Example');
    expect(configured.label).toBe('Enterprise SSO');
  });

  it.each(['//attacker.test/signin', 'https://attacker.test/signin', 'javascript:alert(1)', '/\\attacker.test', '/auth\n/redirect', 'auth/start'])('rejects unsafe configured initiation URL %s', (loginUrl) => {
    expect(() => resolveAuthPresentation({ providers: [provider({ loginUrl })] })).toThrow('Invalid configured');
  });

  it.each(['javascript:alert(1)', 'data:image/svg+xml,test', 'http://assets.example.test/a.png', 'https://user:secret@assets.example.test/a.png', '//assets.example.test/a.png'])('rejects unsafe media URL %s', (logoUrl) => {
    expect(() => resolveAuthPresentation({ brand: { logoUrl } })).toThrow();
  });

  it.each(['red', '#12345', '#1234567', 'var(--color)', '#fff; color: red'])('rejects noncontract accent color %s', (accentColor) => {
    expect(() => resolveAuthPresentation({ brand: { accentColor } })).toThrow('accentColor');
  });

  it('rejects duplicate configured provider identities and malformed availability', () => {
    expect(() => resolveAuthPresentation({ providers: [provider(), provider()] })).toThrow('Duplicate');
    const malformed = provider();
    Reflect.set(malformed, 'available', 'false');
    expect(() => resolveAuthPresentation({ providers: [malformed] })).toThrow('Invalid configured');
    Reflect.set(malformed, 'configured', 'true');
    expect(resolveAuthPresentation({ providers: [malformed] }).providers).toEqual([]);
  });

  it('maps domain-independent account, session, rate, and availability failures to explicit statuses', () => {
    expect(authFailurePresentation('account_disabled').status).toBe(403);
    expect(authFailurePresentation('account_locked').status).toBe(403);
    expect(authFailurePresentation('email_unverified').status).toBe(403);
    expect(authFailurePresentation('invalid_credentials').status).toBe(401);
    expect(authFailurePresentation('session_expired').status).toBe(401);
    expect(authFailurePresentation('provider_unavailable').status).toBe(503);
    expect(authFailurePresentation('temporarily_unavailable').status).toBe(503);
    expect(authFailurePresentation('rate_limited', 30)).toEqual({ reason: 'rate_limited', status: 429, retryAfter: 30 });
    expect(() => authFailurePresentation('rate_limited', 0)).toThrow('positive integer');
  });
});
