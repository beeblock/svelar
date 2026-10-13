import type { CapabilityName, CapabilityScope } from './PermissionManifest.js';

export interface CapabilitySnapshot {
  version: 1;
  scope: CapabilityScope;
  teamId: string | null;
  guard: string;
  known: readonly CapabilityName[];
  capabilities: readonly CapabilityName[];
  aliases: Readonly<Record<string, readonly CapabilityName[]>>;
}

/** Presentation only. Never use a browser snapshot as a server-side authorization credential. */
export function capabilityClient(snapshot: CapabilitySnapshot): { can(name: string): boolean; canAny(names: readonly string[]): boolean } {
  if (!snapshot || snapshot.version !== 1 || !['team', 'platform'].includes(snapshot.scope) || !Array.isArray(snapshot.known) || !Array.isArray(snapshot.capabilities)
    || snapshot.known.length > 10_000 || snapshot.capabilities.length > 10_000 || !snapshot.aliases || typeof snapshot.aliases !== 'object' || Array.isArray(snapshot.aliases)
    || typeof snapshot.guard !== 'string' || !snapshot.guard || (snapshot.scope === 'team' ? typeof snapshot.teamId !== 'string' || !snapshot.teamId : snapshot.teamId !== null)) throw new TypeError('Invalid capability snapshot.');
  const known = new Set(snapshot.known);
  const allowed = new Set(snapshot.capabilities);
  if ([...known, ...allowed].some((name) => typeof name !== 'string' || name.length > 255 || !/^(?:screen\.[A-Za-z0-9_.-]+\.view|action\.[A-Za-z0-9_.-]+\.[A-Za-z0-9_.-]+)$/.test(name)) || [...allowed].some((name) => !known.has(name))) throw new TypeError('Capability snapshot contains undeclared grants.');
  const aliases = new Map<string, readonly string[]>();
  const entries = Object.entries(snapshot.aliases);
  if (entries.length > 10_000) throw new RangeError('Capability snapshot alias limit exceeded.');
  for (const [name, targets] of entries) {
    if (known.has(name as CapabilityName) || !Array.isArray(targets) || !targets.length || targets.length > 10_000 || targets.some((target) => !known.has(target))) throw new TypeError('Invalid capability snapshot alias.');
    aliases.set(name, [...targets]);
  }
  const can = (name: string) => known.has(name as CapabilityName) ? allowed.has(name as CapabilityName) : (aliases.get(name)?.every((target) => allowed.has(target as CapabilityName)) ?? false);
  return Object.freeze({ can, canAny: (names: readonly string[]) => Array.isArray(names) && names.length <= 10_000 && names.some(can) });
}
