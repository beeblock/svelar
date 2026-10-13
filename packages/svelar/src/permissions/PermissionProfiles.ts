import { Connection } from '../database/Connection.js';
import { QueryBuilder } from '../orm/QueryBuilder.js';
import { PermissionAssignments } from './PermissionAssignments.js';
import { PermissionManifest, isReservedRoleName, permissionIdentifier, type CapabilityName, type CapabilityScope } from './PermissionManifest.js';
import type { PermissionRecord, RoleRecord } from './index.js';

export interface PermissionSubject { modelType: string; modelId: number; }
export interface RoleCapabilityProfile {
  roleId: number;
  kind: 'system' | 'custom';
  systemProfile: string | null;
  capabilities: readonly string[];
  exclusions: readonly string[];
  inclusions: readonly string[];
}
export interface RoleCapabilityPreview {
  profile: RoleCapabilityProfile | null;
  /** Selected bits before dependencies and other roles are composed. Use authorizer.snapshot for user access. */
  selected: readonly CapabilityName[];
  staleCapabilities: readonly string[];
}
interface ProfileRow {
  role_id: number;
  kind: 'system' | 'custom';
  system_profile: string | null;
  capabilities: string;
  exclusions: string;
  inclusions: string;
}
const MAX_ROLES = 100;
const MAX_CAPABILITIES = 10_000;

export function permissionTeamId(value: string | number): string {
  if ((typeof value !== 'string' && typeof value !== 'number') || (typeof value === 'number' && !Number.isSafeInteger(value)) || !String(value).trim() || String(value).length > 255) throw new TypeError('Permission scope requires a bounded team ID.');
  return String(value);
}
export function validPermissionSubject(subject: PermissionSubject): boolean {
  return !!subject && typeof subject.modelType === 'string' && /^[A-Za-z][A-Za-z0-9_.-]*$/.test(subject.modelType) && subject.modelType.length <= 255 && Number.isSafeInteger(subject.modelId) && subject.modelId > 0;
}
function storedNames(value: string): string[] {
  if (typeof value !== 'string' || value.length > 2_600_000) throw new Error('Invalid or oversized stored permission profile.');
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.length > MAX_CAPABILITIES || parsed.some((name) => typeof name !== 'string' || name.length > 255)) throw new Error('Invalid stored permission profile.');
  return parsed as string[];
}

/** Profile settings replace this role's legacy grant list in exactly one assignment scope. */
export class PermissionProfiles {
  readonly scope: CapabilityScope;
  readonly teamId: string | null;

  constructor(readonly manifest: PermissionManifest, teamId: string | number | null = null) {
    this.teamId = teamId === null ? null : permissionTeamId(teamId);
    this.scope = this.teamId === null ? 'platform' : 'team';
    Object.freeze(this);
  }
  forTeam(teamId: string | number): PermissionProfiles { return new PermissionProfiles(this.manifest, teamId); }
  forPlatform(): PermissionProfiles { return new PermissionProfiles(this.manifest); }
  private table(name: string): string { return this.teamId === null ? name : `team_${name}`; }
  private scoped<T>(query: QueryBuilder<T>, alias: string): QueryBuilder<T> { return this.teamId === null ? query : query.where(`${alias}.team_id`, this.teamId); }
  private query(): QueryBuilder<ProfileRow> {
    const query = new QueryBuilder<ProfileRow>(this.table('role_capability_profiles'));
    return this.teamId === null ? query : query.forTenant(this.teamId);
  }
  private async editableRole(roleId: number): Promise<RoleRecord> {
    if (!Number.isSafeInteger(roleId) || roleId < 1) throw new TypeError('Invalid permission profile role ID.');
    const role = await new QueryBuilder<RoleRecord>('roles').where('id', roleId).firstOrFail();
    if (role.guard !== this.manifest.guard || isReservedRoleName(role.name)) throw new Error('Reserved role or incompatible permission guard.');
    return role;
  }
  private hydrate(row: ProfileRow): RoleCapabilityProfile {
    if (row.kind !== 'system' && row.kind !== 'custom') throw new Error('Invalid stored permission profile kind.');
    return { roleId: row.role_id, kind: row.kind, systemProfile: row.system_profile,
      capabilities: storedNames(row.capabilities), exclusions: storedNames(row.exclusions), inclusions: storedNames(row.inclusions) };
  }
  async get(roleId: number): Promise<RoleCapabilityProfile | null> {
    const row = await this.query().where('role_id', roleId).first();
    return row ? this.hydrate(row) : null;
  }
  async setSystem(roleId: number, systemProfile: string, overrides: { exclusions?: readonly string[]; inclusions?: readonly string[] } = {}): Promise<RoleCapabilityProfile> {
    const definition = this.manifest.systemProfile(systemProfile);
    if (definition.scope !== this.scope) throw new Error('System profile cannot cross permission scopes.');
    const exclusions = this.manifest.exactNames(overrides.exclusions ?? [], this.scope);
    const inclusions = this.manifest.exactNames(overrides.inclusions ?? [], this.scope);
    if (inclusions.some((name) => exclusions.includes(name))) throw new Error('Profile inclusions and exclusions must not overlap.');
    return this.save(roleId, { kind: 'system', system_profile: systemProfile, capabilities: '[]', exclusions: JSON.stringify(exclusions), inclusions: JSON.stringify(inclusions) });
  }
  async setCustom(roleId: number, capabilities: readonly string[]): Promise<RoleCapabilityProfile> {
    return this.save(roleId, { kind: 'custom', system_profile: null, capabilities: JSON.stringify(this.manifest.exactNames(capabilities, this.scope)), exclusions: '[]', inclusions: '[]' });
  }
  private async save(roleId: number, fields: Omit<ProfileRow, 'role_id'>): Promise<RoleCapabilityProfile> {
    await this.editableRole(roleId);
    await this.query().upsert({ ...fields, role_id: roleId, ...(this.teamId === null ? {} : { team_id: this.teamId }) },
      this.teamId === null ? ['role_id'] : ['team_id', 'role_id'], ['kind', 'system_profile', 'capabilities', 'exclusions', 'inclusions']);
    const profile = await this.get(roleId);
    if (!profile) throw new Error('Permission profile was not persisted.');
    return profile;
  }
  async remove(roleId: number): Promise<void> { await this.editableRole(roleId); await this.query().where('role_id', roleId).delete(); }

  /** Remove a role's profile and grants only here. The shared role catalog and other scopes remain intact. */
  async deleteRole(roleId: number): Promise<void> {
    await this.editableRole(roleId);
    await Connection.transaction(async () => {
      const pivot = (name: string) => {
        const query = new QueryBuilder(this.table(name));
        return this.teamId === null ? query : query.forTenant(this.teamId);
      };
      await pivot('model_has_roles').where('role_id', roleId).delete();
      await pivot('role_has_permissions').where('role_id', roleId).delete();
      await this.query().where('role_id', roleId).delete();
    });
  }

  private addKnown(target: Set<CapabilityName>, names: readonly string[]): void {
    for (const name of names) for (const canonical of this.manifest.resolve(name) ?? []) if (this.manifest.require(canonical).scope === this.scope) target.add(canonical);
  }
  private profileNames(profile: RoleCapabilityProfile): CapabilityName[] {
    const result = new Set<CapabilityName>();
    if (profile.kind === 'custom') this.addKnown(result, profile.capabilities);
    else {
      if (!profile.systemProfile) throw new Error('Stored system profile is missing its template.');
      const definition = this.manifest.systemProfile(profile.systemProfile);
      if (definition.scope !== this.scope) throw new Error('Stored permission profile crosses scopes.');
      this.addKnown(result, definition.defaults === 'all' ? this.manifest.capabilities(this.scope).map((entry) => entry.name) : definition.defaults);
      for (const name of profile.exclusions) for (const canonical of this.manifest.resolve(name) ?? []) result.delete(canonical);
      this.addKnown(result, profile.inclusions);
    }
    return [...result];
  }

  /** Public editor data: recompute current system defaults on the server and expose orphaned legacy selections. */
  async preview(roleId: number): Promise<RoleCapabilityPreview> {
    await this.editableRole(roleId);
    const profile = await this.get(roleId);
    if (profile) {
      const names = [...profile.capabilities, ...profile.inclusions, ...profile.exclusions];
      return { profile, selected: this.profileNames(profile).sort(), staleCapabilities: [...new Set(names.filter((name) => !this.inScope(name)))].sort() };
    }
    const rows = await this.scoped(new QueryBuilder<{ name: string }>('permissions p').select('p.name')
      .join(`${this.table('role_has_permissions')} rp`, 'p.id', '=', 'rp.permission_id')
      .where('rp.role_id', roleId).where('p.guard', this.manifest.guard), 'rp').limit(MAX_CAPABILITIES + 1).get();
    if (rows.length > MAX_CAPABILITIES) throw new RangeError('Permission role grants exceed the capability limit.');
    const selected = new Set<CapabilityName>();
    this.addKnown(selected, rows.map((row) => row.name));
    return { profile: null, selected: [...selected].sort(), staleCapabilities: rows.map((row) => row.name).filter((name) => !this.inScope(name)).sort() };
  }

  private inScope(name: string): boolean { return this.manifest.resolve(name)?.every((target) => this.manifest.require(target).scope === this.scope) ?? false; }

  /** Union roles and direct grants first; dependencies are enforced by the authorizer afterwards. */
  async effective(subject: PermissionSubject): Promise<CapabilityName[]> {
    if (!validPermissionSubject(subject)) return [];
    const roles = await this.scoped(new QueryBuilder<RoleRecord>('roles r').select('r.*')
      .join(`${this.table('model_has_roles')} mr`, 'r.id', '=', 'mr.role_id')
      .where('mr.model_type', subject.modelType).where('mr.model_id', subject.modelId).where('r.guard', this.manifest.guard), 'mr')
      .limit(MAX_ROLES + 1).get();
    if (roles.length > MAX_ROLES) throw new RangeError('Permission subject exceeds 100 assigned roles.');
    const eligibleRoles = roles.filter((role) => !isReservedRoleName(role.name));
    const profiles = eligibleRoles.length ? await this.query().whereIn('role_id', eligibleRoles.map((role) => role.id)).limit(MAX_ROLES + 1).get() : [];
    const byRole = new Map(profiles.map((row) => [row.role_id, this.hydrate(row)]));
    const result = new Set<CapabilityName>();
    for (const profile of byRole.values()) this.addKnown(result, this.profileNames(profile));
    const legacyIds = eligibleRoles.filter((role) => !byRole.has(role.id)).map((role) => role.id);
    if (legacyIds.length) {
      const rows = await this.scoped(new QueryBuilder<{ name: string }>('permissions p').select('p.name').distinct()
        .join(`${this.table('role_has_permissions')} rp`, 'p.id', '=', 'rp.permission_id')
        .whereIn('rp.role_id', legacyIds).where('p.guard', this.manifest.guard), 'rp').limit(MAX_CAPABILITIES + 1).get();
      if (rows.length > MAX_CAPABILITIES) throw new RangeError('Permission role grants exceed the capability limit.');
      this.addKnown(result, rows.map((row) => row.name));
    }
    const direct = await this.scoped(new QueryBuilder<{ name: string }>('permissions p').select('p.name')
      .join(`${this.table('model_has_permissions')} mp`, 'p.id', '=', 'mp.permission_id')
      .where('mp.model_type', subject.modelType).where('mp.model_id', subject.modelId).where('p.guard', this.manifest.guard), 'mp').limit(MAX_CAPABILITIES + 1).get();
    if (direct.length > MAX_CAPABILITIES) throw new RangeError('Direct permission grants exceed the capability limit.');
    this.addKnown(result, direct.map((row) => row.name));
    return [...result].sort();
  }

  /** Convert only this scope's actual legacy pivots; shared legacy catalog records stay visible. */
  async migrateLegacyAliases(): Promise<{ aliases: number; roleLinks: number; modelLinks: number }> {
    const result = { aliases: 0, roleLinks: 0, modelLinks: 0 };
    let work = 0;
    await Connection.transaction(async () => {
      const assignments = new PermissionAssignments(this.teamId);
      for (const alias of this.manifest.aliases(this.scope)) {
        permissionIdentifier(alias.name, 'legacy alias');
        const old = await new QueryBuilder<PermissionRecord>('permissions').where('name', alias.name).where('guard', this.manifest.guard).first();
        if (!old) continue;
        const roleLinks = await this.scoped(new QueryBuilder<{ role_id: number }>(`${this.table('role_has_permissions')} rp`).select('rp.role_id').where('rp.permission_id', old.id), 'rp').limit(MAX_CAPABILITIES + 1).get();
        const modelLinks = await this.scoped(new QueryBuilder<{ model_type: string; model_id: number }>(`${this.table('model_has_permissions')} mp`).select('mp.model_type', 'mp.model_id').where('mp.permission_id', old.id), 'mp').limit(MAX_CAPABILITIES + 1).get();
        if (roleLinks.length + modelLinks.length > MAX_CAPABILITIES) throw new RangeError('Legacy permission migration exceeds its bounded link limit.');
        if (!roleLinks.length && !modelLinks.length) continue;
        work += (roleLinks.length + modelLinks.length) * (alias.capabilities.length + 1) + alias.capabilities.length;
        if (work > MAX_CAPABILITIES) throw new RangeError('Legacy permission migration exceeds its aggregate work limit; migrate smaller catalogs separately.');
        for (const target of alias.capabilities) {
          const permission = await new QueryBuilder<PermissionRecord>('permissions').firstOrCreate({ name: target, guard: this.manifest.guard }, { description: this.manifest.require(target).label });
          for (const link of roleLinks) { await assignments.giveRolePermission(link.role_id, permission.id); result.roleLinks++; }
          for (const link of modelLinks) { await assignments.giveModelPermission(link.model_type, link.model_id, permission.id); result.modelLinks++; }
        }
        for (const link of roleLinks) await assignments.revokeRolePermission(link.role_id, old.id);
        for (const link of modelLinks) await assignments.revokeModelPermission(link.model_type, link.model_id, old.id);
        result.aliases++;
      }
    });
    return result;
  }
}
