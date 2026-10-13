import type { AuthUser } from './Auth.js';

export type AuthAuthenticationMethod = 'session' | 'jwt' | 'refresh' | 'passwordless' | 'federation' | 'api_token' | 'registration';
export type AuthEligibilityReason = 'account_disabled' | 'account_locked' | 'email_unverified' | 'temporarily_unavailable';
export type AuthEligibilityResult = { eligible: true } | { eligible: false; reason: AuthEligibilityReason };

export interface AuthEligibilityConfig {
  /** Boolean flag; only false, 0, '0', 'false', or null explicitly mean enabled. */
  disabledColumn?: string;
  /** Nullable timestamp; any non-null value means disabled. */
  disabledAtColumn?: string;
  lockedColumn?: string;
  /** Nullable date or epoch-millisecond value. */
  lockedUntilColumn?: string;
  requireVerifiedEmail?: boolean;
  verifiedColumn?: string;
  check?: (user: AuthUser, context: { method: AuthAuthenticationMethod }) => AuthEligibilityResult | Promise<AuthEligibilityResult>;
}

export class AuthEligibilityError extends Error {
  constructor(public readonly reason: AuthEligibilityReason) {
    super(`Authentication denied: ${reason}.`);
    this.name = 'AuthEligibilityError';
  }
}

function flagBlocked(value: unknown): boolean | undefined {
  if (value === false || value === 0 || value === '0' || value === 'false' || value === null) return false;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return undefined;
}

function dateTime(value: unknown): number | undefined {
  const result = value instanceof Date ? value.getTime()
    : typeof value === 'number' ? value
    : typeof value === 'string' && value.trim() ? (/^\d+$/.test(value) ? Number(value) : Date.parse(value)) : NaN;
  return Number.isSafeInteger(result) && result >= 0 ? result : undefined;
}

export async function evaluateAuthEligibility(
  user: AuthUser,
  options: AuthEligibilityConfig | undefined,
  method: AuthAuthenticationMethod,
  verifiedColumn = 'email_verified_at',
): Promise<AuthEligibilityResult> {
  if (!options) return { eligible: true };
  const denied = (reason: AuthEligibilityReason): AuthEligibilityResult => ({ eligible: false, reason });
  for (const [column, reason] of [[options.disabledColumn, 'account_disabled'], [options.lockedColumn, 'account_locked']] as const) {
    if (column === undefined) continue;
    if (typeof column !== 'string' || !column.trim()) throw new TypeError('Eligibility columns must be nonempty strings.');
    const blocked = flagBlocked(user.getAttribute(column));
    if (blocked === undefined) return denied('temporarily_unavailable');
    if (blocked) return denied(reason);
  }
  if (options.disabledAtColumn !== undefined) {
    if (typeof options.disabledAtColumn !== 'string' || !options.disabledAtColumn.trim()) throw new TypeError('Eligibility columns must be nonempty strings.');
    const value: unknown = user.getAttribute(options.disabledAtColumn);
    if (value === undefined) return denied('temporarily_unavailable');
    if (value !== null) return denied('account_disabled');
  }
  if (options.lockedUntilColumn !== undefined) {
    if (typeof options.lockedUntilColumn !== 'string' || !options.lockedUntilColumn.trim()) throw new TypeError('Eligibility columns must be nonempty strings.');
    const value: unknown = user.getAttribute(options.lockedUntilColumn);
    if (value !== null) {
      const deadline = dateTime(value);
      if (deadline === undefined) return denied('temporarily_unavailable');
      if (deadline > Date.now()) return denied('account_locked');
    }
  }
  if (options.requireVerifiedEmail !== undefined && typeof options.requireVerifiedEmail !== 'boolean') throw new TypeError('requireVerifiedEmail must be a boolean.');
  if (options.requireVerifiedEmail) {
    const column = options.verifiedColumn ?? verifiedColumn;
    if (typeof column !== 'string' || !column.trim()) throw new TypeError('Verification column must be a nonempty string.');
    const value: unknown = user.getAttribute(column);
    if (value === null || value === undefined || value === false || value === '') return denied('email_unverified');
    if (value !== true && dateTime(value) === undefined) return denied('temporarily_unavailable');
  }
  if (options.check) {
    const result: unknown = await options.check(user, { method });
    if (!result || typeof result !== 'object' || !('eligible' in result)) return denied('temporarily_unavailable');
    if (result.eligible === true) return { eligible: true };
    if (result.eligible === false && 'reason' in result &&
      (result.reason === 'account_disabled' || result.reason === 'account_locked' || result.reason === 'email_unverified' || result.reason === 'temporarily_unavailable')) return denied(result.reason);
    return denied('temporarily_unavailable');
  }
  return { eligible: true };
}
