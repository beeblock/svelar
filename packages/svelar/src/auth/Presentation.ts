import type { AuthEligibilityReason } from './Eligibility.js';

export type AuthFailureReason = AuthEligibilityReason | 'invalid_credentials' | 'session_expired' | 'rate_limited' | 'provider_unavailable';

export interface AuthBrand {
  name: string;
  title?: string;
  description?: string;
  logoUrl?: string;
  logoAlt?: string;
  imageUrl?: string;
  imageAlt?: string;
  accentColor?: string;
}

export interface AuthFederationProvider {
  id: string;
  label: string;
  protocol: 'oauth2' | 'oidc' | 'saml';
  /** Application-owned sign-in initiation route, not the external callback or redirect target. */
  loginUrl: string;
  configured: boolean;
  available?: boolean;
  iconUrl?: string;
}

export interface AuthPresentationConfig {
  brand?: Partial<AuthBrand>;
  providers?: readonly AuthFederationProvider[];
}

export interface AuthPresentation {
  brand: AuthBrand;
  providers: Array<Omit<AuthFederationProvider, 'configured' | 'available'> & { available: boolean }>;
}

export interface AuthFailurePresentation {
  reason: AuthFailureReason;
  status: 401 | 403 | 429 | 503;
  retryAfter?: number;
}

export function authFailurePresentation(reason: AuthFailureReason, retryAfter?: number): AuthFailurePresentation {
  if (retryAfter !== undefined && (!Number.isSafeInteger(retryAfter) || retryAfter < 1)) throw new TypeError('retryAfter must be a positive integer in seconds.');
  const status = reason === 'rate_limited' ? 429
    : reason === 'provider_unavailable' || reason === 'temporarily_unavailable' ? 503
    : reason === 'invalid_credentials' || reason === 'session_expired' ? 401 : 403;
  return { reason, status, ...(retryAfter === undefined ? {} : { retryAfter }) };
}

function localUrl(value: string): boolean {
  if (typeof value !== 'string') return false;
  if (!value.startsWith('/') || value.startsWith('//') || /[\\\s\u0000-\u001f\u007f]/.test(value)) return false;
  try { return new URL(value, 'https://svelar.invalid').origin === 'https://svelar.invalid'; } catch { return false; }
}

function mediaUrl(value: string): string {
  if (typeof value !== 'string' || /[\\\s\u0000-\u001f\u007f]/.test(value)) throw new TypeError('Invalid auth media URL.');
  if (localUrl(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password) return value;
  } catch { /* Invalid media URL. */ }
  throw new TypeError('Auth media URLs must be application-relative or HTTPS without credentials.');
}

/** Explicitly selects public presentation fields; provider secrets never enter the result. */
export function resolveAuthPresentation(config: AuthPresentationConfig = {}, appName = 'Svelar'): AuthPresentation {
  const source = config.brand ?? {};
  const brand: AuthBrand = { name: source.name ?? appName };
  if (typeof brand.name !== 'string' || !brand.name.trim()) throw new TypeError('Auth brand name must be nonempty.');
  for (const key of ['title', 'description', 'logoAlt', 'imageAlt'] as const) {
    const value = source[key];
    if (value !== undefined) {
      if (typeof value !== 'string') throw new TypeError(`Invalid auth brand ${key}.`);
      brand[key] = value;
    }
  }
  for (const key of ['logoUrl', 'imageUrl'] as const) if (source[key] !== undefined) brand[key] = mediaUrl(source[key]);
  if (source.accentColor !== undefined) {
    if (!/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(source.accentColor)) throw new TypeError('Auth accentColor must be a hexadecimal CSS color.');
    brand.accentColor = source.accentColor;
  }
  const ids = new Set<string>();
  const providers: AuthPresentation['providers'] = [];
  for (const provider of config.providers ?? []) {
    if (provider.configured !== true) continue;
    if (typeof provider.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(provider.id) || typeof provider.label !== 'string' || !provider.label.trim() || !['oauth2', 'oidc', 'saml'].includes(provider.protocol)
      || !localUrl(provider.loginUrl) || provider.available !== undefined && typeof provider.available !== 'boolean') throw new TypeError('Invalid configured auth federation provider.');
    if (ids.has(provider.id)) throw new TypeError(`Duplicate auth federation provider: ${provider.id}.`);
    ids.add(provider.id);
    providers.push({ id: provider.id, label: provider.label, protocol: provider.protocol, loginUrl: provider.loginUrl,
      available: provider.available ?? true, ...(provider.iconUrl === undefined ? {} : { iconUrl: mediaUrl(provider.iconUrl) }) });
  }
  return { brand, providers };
}
