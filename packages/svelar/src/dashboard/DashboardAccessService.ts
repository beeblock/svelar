import type { RequestEvent } from '../routing/Controller.js';
import { PermissionManifest, isReservedRoleName } from '../permissions/PermissionManifest.js';
import { DashboardOperationError } from './DashboardService.js';
import { dashboardProviders, type DashboardRole, type DashboardUserAccess } from './providers.js';
import { authorizeDashboard, type DashboardOperation } from './security.js';
import { dashboardRoleCreateSchema, dashboardUserAccessSchema, dashboardUserRoleSchema, dashboardUserCapabilitySchema,
  type DashboardUserAccessInput } from './schemas.js';

const capabilityName = /^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*)*$/;

function sameIdentity(left: string, right: string): boolean {
  if (/^\d+$/.test(left) && /^\d+$/.test(right)) return BigInt(left) === BigInt(right);
  return left === right;
}

function publicRole(role: DashboardRole): DashboardRole {
  if (!role || !Number.isSafeInteger(role.id) || role.id < 1 || typeof role.protected !== 'boolean'
    || [role.name, role.label, role.guard].some(value => typeof value !== 'string' || !value || value.length > 255 || /[\x00-\x1f\x7f]/.test(value))) {
    throw new DashboardOperationError(503, 'Invalid role observation.');
  }
  return { id: role.id, name: role.name, label: role.label, guard: role.guard, protected: role.protected || isReservedRoleName(role.name) };
}

/** Console policy is additional defense; app callbacks must recheck current user/team policy at the write boundary. */
export class DashboardAccessService {
  async snapshot(input: DashboardUserAccessInput, event: RequestEvent): Promise<DashboardUserAccess> {
    const provider = dashboardProviders.current.users;
    if (!provider?.access) throw new DashboardOperationError(503, 'User access management unavailable.');
    const requested = dashboardUserAccessSchema.parse(input);
    const result = await provider.access(requested, event);
    const identity = dashboardUserAccessSchema.safeParse(result);
    if (!identity.success || !sameIdentity(identity.data.id, requested.id) || identity.data.scope !== requested.scope
      || identity.data.teamId !== requested.teamId || typeof result.protected !== 'boolean'
      || !Array.isArray(result.roles) || result.roles.length > 100
      || !Array.isArray(result.directCapabilities) || result.directCapabilities.length > 10_000
      || result.directCapabilities.some(name => typeof name !== 'string' || name.length > 255 || !capabilityName.test(name))) {
      throw new DashboardOperationError(503, 'Invalid or unbounded user access observation.');
    }
    return { ...identity.data, protected: result.protected, roles: result.roles.map(publicRole), directCapabilities: [...new Set(result.directCapabilities)] };
  }

  private async writable(input: DashboardUserAccessInput, event: RequestEvent) {
    const actor = event.locals.user?.id;
    if ((typeof actor !== 'string' && typeof actor !== 'number') || !dashboardUserAccessSchema.safeParse({id:String(actor),scope:'platform'}).success
      || typeof actor === 'number' && !Number.isSafeInteger(actor)) throw new DashboardOperationError(403, 'Verified actor identity required.');
    const snapshot = await this.snapshot(input, event);
    if (snapshot.protected || sameIdentity(String(actor), input.id) || sameIdentity(String(actor), snapshot.id)) {
      throw new DashboardOperationError(403, 'Protected users and your own access cannot be changed here.');
    }
    return snapshot;
  }

  async mutate(operation: Extract<DashboardOperation, 'createRole' | 'assignRole' | 'detachRole' | 'grantCapability' | 'revokeCapability'>, input: unknown, event: RequestEvent) {
    if (!await authorizeDashboard(event, operation)) throw new DashboardOperationError(403, 'Dashboard action denied.');
    const permissions = dashboardProviders.current.permissions;
    if (!permissions) throw new DashboardOperationError(503, 'Permission catalog unavailable.');
    const catalog = new PermissionManifest(await permissions.manifest(event));
    if (operation === 'createRole') {
      const create = dashboardRoleCreateSchema.parse(input);
      if (!permissions.createRole) throw new DashboardOperationError(503, 'Role creation unavailable.');
      const role = publicRole(await permissions.createRole(create, event));
      if (role.protected || role.name !== create.name || role.guard !== catalog.guard) throw new DashboardOperationError(503, 'Role provider returned an unexpected role. Check its state before retrying.');
      return { message: 'Role created with an empty permission profile.', data: role };
    }
    const users = dashboardProviders.current.users;
    if (operation === 'assignRole' || operation === 'detachRole') {
      const grant = dashboardUserRoleSchema.parse(input);
      const callback = users?.[operation];
      if (!callback || !permissions.getRole) throw new DashboardOperationError(503, 'Role assignment unavailable.');
      await this.writable(grant, event);
      const found = await permissions.getRole(grant.roleId, event);
      if (!found) throw new DashboardOperationError(404, 'Role not found.');
      const role = publicRole(found);
      if (role.id !== grant.roleId) throw new DashboardOperationError(503, 'Role provider returned a different identity.');
      if (role.protected || role.guard !== catalog.guard) throw new DashboardOperationError(403, 'Protected or incompatible role cannot be assigned or detached here.');
      await callback.call(users, grant, event);
      return { message: operation === 'assignRole' ? 'Role assigned in this scope.' : 'Role detached in this scope.' };
    }
    const grant = dashboardUserCapabilitySchema.parse(input);
    const callback = users?.[operation];
    if (!callback) throw new DashboardOperationError(503, 'Direct capability management unavailable.');
    const snapshot = await this.writable(grant, event);
    if (operation === 'grantCapability') {
      const capability = catalog.capabilities().find(item => item.name === grant.capability);
      if (!capability || capability.scope !== grant.scope) throw new DashboardOperationError(422, 'Unknown or out-of-scope capability.');
    } else if (!snapshot.directCapabilities.includes(grant.capability)) {
      throw new DashboardOperationError(404, 'Direct grant not found in this scope.');
    }
    await callback.call(users, grant, event);
    return { message: operation === 'grantCapability' ? 'Direct capability granted in this scope.' : 'Direct capability revoked in this scope.' };
  }
}
