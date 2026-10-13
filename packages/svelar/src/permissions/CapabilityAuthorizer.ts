import { error as httpError } from '@sveltejs/kit';
import { ApplicationContext, type ApplicationContextSnapshot } from '../support/Context.js';
import { PermissionManifest, type CapabilityName, type CapabilityScope } from './PermissionManifest.js';
import { PermissionProfiles, permissionTeamId, validPermissionSubject, type PermissionSubject } from './PermissionProfiles.js';
import type { CapabilitySnapshot } from './client.js';

type Identity = string | number;
export interface UserCapabilityPrincipal extends PermissionSubject {
  kind: 'user';
  actorId?: Identity;
  /** Present for user-bound API credentials. Roles cannot exceed this authenticated credential ceiling. */
  credentialCapabilities?: readonly string[];
}
export interface ServiceCapabilityPrincipal {
  kind: 'service_account';
  actorId: Identity;
  teamId: Identity;
  /** Trusted authenticated credential grants, not fields submitted by the requester. */
  capabilities: readonly string[];
  /** Optional role subject: when present the credential grants are also a ceiling on its roles. */
  subject?: PermissionSubject;
}
export type CapabilityPrincipal = UserCapabilityPrincipal | ServiceCapabilityPrincipal;
export type CapabilityAuthorizationScope = { teamId: Identity } | { platform: true };
export interface CapabilityAuthorizationInput {
  principal: CapabilityPrincipal;
  scope: CapabilityAuthorizationScope;
  context?: ApplicationContextSnapshot;
}
export type CapabilityResolver<E> = (event: E) => CapabilityAuthorizationInput | null | Promise<CapabilityAuthorizationInput | null>;
export interface CapabilityAuthorizerOptions {
  profiles?: PermissionProfiles;
  /** Trusted platform identity check. It only affects known platform capabilities, never team grants. */
  platformOwner?: (principal: UserCapabilityPrincipal, context: ApplicationContextSnapshot) => boolean | Promise<boolean>;
}
interface PreparedInput {
  principal: CapabilityPrincipal;
  scope: CapabilityScope;
  teamId: string | null;
  context: ApplicationContextSnapshot;
}
export class CapabilityAuthorizationError extends Error {
  constructor(readonly status: 401 | 403, message = 'Capability access denied.') { super(message); this.name = 'CapabilityAuthorizationError'; }
  toResponse(): Response { return Response.json({ data: null, meta: { code: this.status === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN', message: this.message } },
    { status: this.status, headers: { 'Cache-Control': 'no-store' } }); }
}
function identity(value: unknown): value is Identity { return typeof value === 'number' ? Number.isSafeInteger(value) : typeof value === 'string' && value.trim().length > 0 && value.length <= 255; }
function sameIdentity(left: unknown, right: unknown): boolean { return identity(left) && identity(right) && String(left) === String(right); }

/** Functional RBAC first. Resource policies/ownership checks still belong in FormRequests and domain code. */
export class CapabilityAuthorizer {
  private readonly profiles: PermissionProfiles;
  private readonly options: CapabilityAuthorizerOptions;
  constructor(readonly manifest: PermissionManifest, options: CapabilityAuthorizerOptions = {}) {
    this.options = { ...options };
    this.profiles = options.profiles ?? new PermissionProfiles(manifest);
    if (this.profiles.manifest !== manifest) throw new Error('Authorizer and profile store must share the same explicit manifest.');
  }

  private prepare(input: CapabilityAuthorizationInput | null): PreparedInput | null {
    if (!input?.principal || !input.scope || typeof input.scope !== 'object') return null;
    const original = input.context ?? ApplicationContext.snapshot();
    if (!original || typeof original !== 'object' || Array.isArray(original)) return null;
    const context = { ...original };
    const scope = input.scope;
    if (('teamId' in scope) === ('platform' in scope)) return null;
    let teamId: string | null = null;
    if ('teamId' in scope) { try { teamId = permissionTeamId(scope.teamId); } catch { return null; } }
    else if (scope.platform !== true) return null;
    for (const field of ['teamId', 'tenantId']) if (context[field] !== undefined && (teamId === null ? context[field] !== null : !sameIdentity(context[field], teamId))) return null;
    const source = input.principal;
    let principal: CapabilityPrincipal;
    if (source.kind === 'user') {
      if (!validPermissionSubject(source) || (source.actorId !== undefined && !identity(source.actorId)) || (context.actorType !== undefined && context.actorType !== 'user')) return null;
      if (source.credentialCapabilities !== undefined && (!Array.isArray(source.credentialCapabilities) || source.credentialCapabilities.length > 10_000 ||
        source.credentialCapabilities.some((name) => typeof name !== 'string' || name.length > 255))) return null;
      principal = { kind: 'user', modelType: source.modelType, modelId: source.modelId, actorId: source.actorId ?? source.modelId,
        ...(source.credentialCapabilities !== undefined ? { credentialCapabilities: [...source.credentialCapabilities] } : {}) };
      if (context.userId !== undefined && !sameIdentity(context.userId, principal.modelId)) return null;
      if (context.actorId !== undefined && !sameIdentity(context.actorId, principal.actorId)) return null;
    } else if (source.kind === 'service_account') {
      if (teamId === null || !identity(source.actorId) || !sameIdentity(source.teamId, teamId) || !sameIdentity(context.teamId ?? context.tenantId, teamId)
        || !sameIdentity(context.actorId, source.actorId) || (context.actorType !== undefined && context.actorType !== 'service_account')
        || !Array.isArray(source.capabilities) || source.capabilities.length > 10_000 || source.capabilities.some((name) => typeof name !== 'string' || name.length > 255)
        || (source.subject !== undefined && !validPermissionSubject(source.subject))) return null;
      principal = { kind: 'service_account', actorId: source.actorId, teamId, capabilities: [...source.capabilities],
        ...(source.subject ? { subject: { modelType: source.subject.modelType, modelId: source.subject.modelId } } : {}) };
    } else return null;
    return { principal, scope: teamId === null ? 'platform' : 'team', teamId, context };
  }

  private async allowed(input: PreparedInput): Promise<Set<CapabilityName>> {
    const { principal, scope, teamId } = input;
    const scopedProfiles = teamId === null ? this.profiles.forPlatform() : this.profiles.forTeam(teamId);
    let grants: readonly CapabilityName[];
    if (principal.kind === 'service_account') {
      if (principal.capabilities.some((name) => name !== '*' && !(this.manifest.resolve(name)?.every((target) => this.manifest.require(target).scope === 'team')))) return new Set();
      const ceiling = new Set(principal.capabilities.includes('*') ? this.manifest.capabilities('team').map((entry) => entry.name) : this.manifest.exactNames(principal.capabilities, 'team'));
      grants = principal.subject ? (await scopedProfiles.effective(principal.subject)).filter((name) => ceiling.has(name)) : [...ceiling];
    } else if (scope === 'platform' && await this.options.platformOwner?.(principal, { ...input.context }) === true) {
      grants = this.manifest.capabilities('platform').map((entry) => entry.name);
    } else grants = await scopedProfiles.effective(principal);
    if (principal.kind === 'user' && principal.credentialCapabilities !== undefined) {
      if (principal.credentialCapabilities.some((name) => name !== '*' && !this.manifest.resolve(name))) return new Set();
      const ceiling = new Set(principal.credentialCapabilities.includes('*') ? this.manifest.capabilities(scope).map((entry) => entry.name)
        : principal.credentialCapabilities.flatMap((name) => this.manifest.resolve(name) ?? []).filter((name) => this.manifest.require(name).scope === scope));
      grants = grants.filter((name) => ceiling.has(name));
    }
    const selected = new Set(grants);
    const memo = new Map<CapabilityName, boolean>();
    const permits = (name: CapabilityName): boolean => {
      const cached = memo.get(name);
      if (cached !== undefined) return cached;
      const capability = this.manifest.require(name);
      const allowed = capability.scope === scope && selected.has(name) && capability.dependencies.every(permits);
      memo.set(name, allowed);
      return allowed;
    };
    return new Set(this.manifest.capabilities(scope).filter((entry) => permits(entry.name)).map((entry) => entry.name));
  }

  async can(name: string, input: CapabilityAuthorizationInput | null): Promise<boolean> {
    const targets = this.manifest.resolve(name);
    const prepared = this.prepare(input);
    if (!targets || !prepared || targets.some((target) => this.manifest.require(target).scope !== prepared.scope)) return false;
    const allowed = await this.allowed(prepared);
    return targets.every((target) => allowed.has(target));
  }
  async authorize(name: string, input: CapabilityAuthorizationInput | null): Promise<void> {
    if (!await this.can(name, input)) throw new CapabilityAuthorizationError(input?.principal ? 403 : 401);
  }
  async authorizePath(path: string, input: CapabilityAuthorizationInput | null): Promise<void> {
    const screen = this.manifest.screenForPath(path);
    if (!screen) throw new CapabilityAuthorizationError(input?.principal ? 403 : 401);
    await this.authorize(screen.name, input);
  }
  async snapshot(input: CapabilityAuthorizationInput): Promise<CapabilitySnapshot> {
    const prepared = this.prepare(input);
    if (!prepared) throw new CapabilityAuthorizationError(input?.principal ? 403 : 401);
    return { version: 1, scope: prepared.scope, teamId: prepared.teamId, guard: this.manifest.guard,
      known: this.manifest.capabilities(prepared.scope).map((entry) => entry.name), capabilities: [...await this.allowed(prepared)].sort(),
      aliases: Object.fromEntries(this.manifest.aliases(prepared.scope).map((alias) => [alias.name, [...alias.capabilities]])) };
  }

  private domainContext(input: PreparedInput): ApplicationContextSnapshot {
    const context = { ...input.context };
    context.teamId = input.teamId;
    context.tenantId = input.teamId;
    context.actorId = input.principal.actorId;
    context.actorType = input.principal.kind;
    if (input.principal.kind === 'user') context.userId = input.principal.modelId;
    else delete context.userId;
    return context;
  }

  private async guardInput<E>(event: E, name: string, resolver: CapabilityResolver<E>): Promise<PreparedInput> {
    const resolved = await resolver(event);
    const prepared = this.prepare(resolved);
    if (!prepared) throw new CapabilityAuthorizationError(resolved?.principal ? 403 : 401);
    const targets = this.manifest.resolve(name);
    if (!targets || targets.some((target) => this.manifest.require(target).scope !== prepared.scope) || !(await this.allowed(prepared)).has(name as CapabilityName)) throw new CapabilityAuthorizationError(403);
    return prepared;
  }

  guardEndpoint<E, R>(name: string, handler: (event: E) => R | Promise<R>, resolver: CapabilityResolver<E>): (event: E) => Promise<R | Response> {
    this.manifest.require(name);
    if (typeof handler !== 'function' || typeof resolver !== 'function') throw new TypeError('Capability guard requires a handler and trusted principal resolver.');
    return async (event) => {
      let input: PreparedInput;
      try { input = await this.guardInput(event, name, resolver); }
      catch (error) { if (error instanceof CapabilityAuthorizationError) return error.toResponse(); throw error; }
      return await ApplicationContext.runIsolated(this.domainContext(input), () => handler(event));
    };
  }
  guardPageAction<E, R>(name: string, handler: (event: E) => R | Promise<R>, resolver: CapabilityResolver<E>): (event: E) => Promise<R> {
    if (this.manifest.require(name).kind !== 'action') throw new Error('Page action requires an action capability.');
    if (typeof handler !== 'function' || typeof resolver !== 'function') throw new TypeError('Capability guard requires a handler and trusted principal resolver.');
    return async (event) => {
      let input: PreparedInput;
      try { input = await this.guardInput(event, name, resolver); }
      catch (error) { if (error instanceof CapabilityAuthorizationError) httpError(error.status, error.message); throw error; }
      return await ApplicationContext.runIsolated(this.domainContext(input), () => handler(event));
    };
  }
  guardPageActions<E, R>(actions: Readonly<Record<string, { capability: string; handler: (event: E) => R | Promise<R> }>>, resolver: CapabilityResolver<E>): Record<string, (event: E) => Promise<R>> {
    const result: Record<string, (event: E) => Promise<R>> = {};
    for (const [name, action] of Object.entries(actions)) {
      if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) throw new TypeError('Invalid named page action.');
      Object.defineProperty(result, name, { value: this.guardPageAction(action.capability, action.handler, resolver), enumerable: true });
    }
    return result;
  }
  guardLayout<E extends { url: URL }, R>(handler: (event: E) => R | Promise<R>, resolver: CapabilityResolver<E>): (event: E) => Promise<R> {
    if (typeof handler !== 'function' || typeof resolver !== 'function') throw new TypeError('Layout guard requires a handler and trusted principal resolver.');
    return async (event) => {
      const screen = this.manifest.screenForPath(event.url.pathname);
      if (!screen) httpError(403, 'Route is not declared in the permission manifest.');
      let input: PreparedInput;
      try { input = await this.guardInput(event, screen.name, resolver); }
      catch (error) { if (error instanceof CapabilityAuthorizationError) httpError(error.status, error.message); throw error; }
      return await ApplicationContext.runIsolated(this.domainContext(input), () => handler(event));
    };
  }
}
