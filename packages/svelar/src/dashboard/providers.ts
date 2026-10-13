import type { RequestEvent } from '../routing/Controller.js';
import type { PermissionManifestDefinition, CapabilityScope } from '../permissions/PermissionManifest.js';
import type { RoleCapabilityPreview } from '../permissions/PermissionProfiles.js';
import { singleton } from '../support/singleton.js';
import type { DashboardRoleCreateInput, DashboardUserAccessInput, DashboardUserRoleInput, DashboardUserCapabilityInput } from './schemas.js';
export type { DashboardRoleCreateInput, DashboardUserAccessInput, DashboardUserRoleInput, DashboardUserCapabilityInput } from './schemas.js';

export interface DashboardListFilter { search?: string; limit: number; offset: number; }
export interface DashboardPage<T> {
  items: T[];
  total: number | null;
  hasMore: boolean;
  scope: 'shared' | 'process' | 'unknown';
}
export interface DashboardUser {
  id: string | number;
  name: string;
  email: string;
  globalRole: string | null;
  protected: boolean;
  canResetPassword: boolean;
  canDelete: boolean;
}
export interface DashboardUserProvider {
  list(filter: DashboardListFilter, event: RequestEvent): Promise<DashboardPage<DashboardUser>>;
  /** Application policy must protect platform owners, self-deletion and tenant boundaries. Never return a password/token. */
  delete(id: string, event: RequestEvent): Promise<void>;
  resetPassword(id: string, event: RequestEvent): Promise<{ queued: boolean }>;
  /** Snapshot of the exact user/assignment scope. Mutation callbacks must recheck protected owner/self/tenant policy. */
  access?(input: DashboardUserAccessInput, event: RequestEvent): Promise<DashboardUserAccess>;
  assignRole?(input: DashboardUserRoleInput, event: RequestEvent): Promise<void>;
  detachRole?(input: DashboardUserRoleInput, event: RequestEvent): Promise<void>;
  grantCapability?(input: DashboardUserCapabilityInput, event: RequestEvent): Promise<void>;
  revokeCapability?(input: DashboardUserCapabilityInput, event: RequestEvent): Promise<void>;
}
export interface DashboardRole { id: number; name: string; label: string; guard: string; protected: boolean; }
export interface DashboardUserAccess extends DashboardUserAccessInput {
  protected: boolean;
  roles: readonly DashboardRole[];
  directCapabilities: readonly string[];
}
export interface DashboardProfileScope { roleId: number; scope: CapabilityScope; teamId?: string; }
export interface DashboardProfileUpdate extends DashboardProfileScope {
  kind: 'system' | 'custom';
  systemProfile?: string;
  capabilities: readonly string[];
  exclusions: readonly string[];
  inclusions: readonly string[];
}
export interface DashboardPermissionProvider {
  roles(filter: DashboardListFilter, event: RequestEvent): Promise<DashboardPage<DashboardRole>>;
  manifest(event: RequestEvent): Promise<PermissionManifestDefinition>;
  profile?(scope: DashboardProfileScope, event: RequestEvent): Promise<RoleCapabilityPreview>;
  /** Provider authorizes the exact tenant/role before delegating to PermissionProfiles. No reserved-owner bypass. */
  saveProfile?(input: DashboardProfileUpdate, event: RequestEvent): Promise<void>;
  deleteRole?(scope: DashboardProfileScope, event: RequestEvent): Promise<void>;
  /** Creates an empty exact scoped profile. Never assigns its role automatically or sets the trusted User.role column. */
  createRole?(input: DashboardRoleCreateInput, event: RequestEvent): Promise<DashboardRole>;
  getRole?(id: number, event: RequestEvent): Promise<DashboardRole | null>;
}
export interface DashboardDependency { name: string; status: 'healthy' | 'degraded' | 'unavailable' | 'unknown'; latencyMs: number | null;
  scope?: 'shared' | 'process' | 'unknown'; reason?: 'unsupported' | 'timeout' | 'capacity' | 'probe-failed'; }
export interface DashboardProviders {
  users?: DashboardUserProvider;
  permissions?: DashboardPermissionProvider;
  /** Bounded names already registered with Features. The console never scans all feature rows. */
  features?: { names: readonly string[]; scope: 'shared' | 'process' | 'unknown' };
  dependencies?: (event: RequestEvent) => Promise<readonly DashboardDependency[]>;
  /** Trusted resource URL mapping. Only same-origin paths are returned to the browser. */
  resourcePath?: (metadata: Readonly<Record<string, unknown>>) => string | null;
  shell?: { title?: string; appPath?: string; logoutPath?: string; };
}
export const dashboardProviders = singleton('svelar.dashboard.providers', () => ({ current: {} as DashboardProviders }));

export function configureDashboardProviders(providers: DashboardProviders): void {
  if (providers.features && (providers.features.names.length > 100 || providers.features.names.some((name) => typeof name !== 'string' || !name || name.length > 255))) throw new TypeError('Dashboard features require at most 100 bounded names.');
  for (const path of [providers.shell?.appPath, providers.shell?.logoutPath]) if (path !== undefined && !safeDashboardPath(path)) throw new TypeError('Dashboard shell paths must be same-origin paths.');
  dashboardProviders.current = { ...providers, ...(providers.features ? { features: { ...providers.features, names: [...new Set(providers.features.names)] } } : {}), ...(providers.shell ? { shell: { ...providers.shell } } : {}) };
}
export function safeDashboardPath(value: unknown): value is string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.length > 2048 || /[\\\x00-\x20\x7f]/.test(value)) return false;
  try { const decoded = decodeURIComponent(value); return !decoded.startsWith('//') && !/[\\\x00-\x20\x7f]/.test(decoded); } catch { return false; }
}
