import { z } from '../validation/index.js';
import { FormRequest } from '../routing/FormRequest.js';
import type { RequestEvent } from '../routing/Controller.js';
import { authorizeDashboard, type DashboardOperation } from './security.js';
import { dashboardRoleCreateSchema, dashboardUserRoleSchema, dashboardUserCapabilitySchema,
  type DashboardRoleCreateInput, type DashboardUserRoleInput, type DashboardUserCapabilityInput } from './schemas.js';

const identifier = z.string().min(1).max(255).refine((value) => !/[\x00-\x1f\x7f]/.test(value), 'Invalid identifier');
const integer = (fallback: number, maximum: number) => z.string().regex(/^\d+$/)
  .transform(Number).refine((value) => Number.isSafeInteger(value) && value <= maximum, 'Out of range').prefault(String(fallback));

export const dashboardQueueSchema = z.object({
  queue: identifier.default('default'),
  connection: identifier.optional(),
  tenantId: identifier.optional(), accountId: identifier.optional(), resourceId: identifier.optional(), correlationId: identifier.optional(),
  jobClass: identifier.optional(),
  status: z.enum(['waiting', 'active', 'failed', 'completed', 'delayed', 'dead-letter']).default('failed'),
  limit: integer(25, 100).refine((value) => value > 0, 'Must be positive'),
  offset: integer(0, 1_000_000),
});

export const dashboardLogSchema = z.object({
  cursor: z.string().regex(/^\d+$/).transform(Number).refine(Number.isSafeInteger, 'Invalid cursor').optional(),
  correlationId: identifier.optional(),
  tenantId: identifier.optional(),
  level: z.enum(['debug', 'info', 'warn', 'error', 'fatal']).optional(),
  channel: identifier.optional(),
  search: z.string().max(500).optional(),
  limit: integer(25, 100).refine((value) => value > 0, 'Must be positive'),
  offset: integer(0, 1_000_000),
});

export const dashboardJobSchema = z.object({ id: identifier, queue: identifier.default('default'), connection: identifier.optional(), source: z.enum(['live', 'dead-letter']).default('live') });
export const dashboardTimelineSchema = dashboardJobSchema.extend({ limit: integer(50, 100).refine((value) => value > 0, 'Must be positive') });
export const dashboardRunSchema = z.object({ name: identifier });
export const dashboardToggleSchema = z.object({ name: identifier, enabled: z.boolean() });
export const dashboardDeleteSchema = dashboardJobSchema.extend({ confirmed: z.literal(true) });
export const dashboardBatchSchema = z.object({ queue: identifier.default('default'), connection: identifier.optional(),
  references: z.array(z.object({ id: identifier, source: z.enum(['live', 'dead-letter']) })).min(1).max(100), confirmed: z.literal(true) });
export const dashboardPauseSchema = z.object({ queue: identifier.default('default'), connection: identifier.optional(), paused: z.boolean(), confirmed: z.literal(true) });
export const dashboardListSchema = z.object({ search: z.string().max(255).optional(), limit: integer(25, 100).refine((value) => value > 0, 'Must be positive'), offset: integer(0, 1_000_000) });
export const dashboardSchedulerSchema = z.object({ limit: integer(25, 100).refine((value) => value > 0, 'Must be positive'),
  offset: integer(0, 1_000_000), processOffset: integer(0, 1_000_000) });
export const dashboardUserSchema = z.object({ id: identifier });
export const dashboardDeleteUserSchema = dashboardUserSchema.extend({ confirmed: z.literal(true) });
export const dashboardFeatureSchema = z.object({ name: identifier, enabled: z.boolean(), confirmed: z.literal(true) });
export const dashboardProfileScopeSchema = z.object({ roleId: z.coerce.number().int().positive().safe(), scope: z.enum(['team', 'platform']), teamId: identifier.optional() })
  .refine((input) => input.scope === 'team' ? !!input.teamId : input.teamId === undefined, 'Profile scope requires exactly its tenant identity');
const capabilityNames = z.array(identifier).max(10_000).default([]);
export const dashboardProfileSchema = dashboardProfileScopeSchema.safeExtend({ kind: z.enum(['system', 'custom']), systemProfile: identifier.optional(),
  capabilities: capabilityNames, exclusions: capabilityNames, inclusions: capabilityNames, confirmed: z.literal(true) })
  .refine((input) => input.scope === 'team' ? !!input.teamId : input.teamId === undefined, 'Profile scope requires exactly its tenant identity')
  .refine((input) => input.kind === 'system' ? !!input.systemProfile && !input.capabilities.length : input.systemProfile === undefined && !input.exclusions.length && !input.inclusions.length, 'Invalid system/custom profile fields');
export const dashboardDeleteRoleSchema = dashboardProfileScopeSchema.safeExtend({ confirmed: z.literal(true) }).refine((input) => input.scope === 'team' ? !!input.teamId : input.teamId === undefined, 'Profile scope requires exactly its tenant identity');
export const dashboardRunRequestSchema = z.object({ name: identifier, requestId: identifier });

export type DashboardMutationInput = z.infer<typeof dashboardJobSchema> | z.infer<typeof dashboardRunSchema>
  | z.infer<typeof dashboardToggleSchema> | z.infer<typeof dashboardDeleteSchema> | z.infer<typeof dashboardBatchSchema>
  | z.infer<typeof dashboardPauseSchema> | z.infer<typeof dashboardUserSchema> | z.infer<typeof dashboardDeleteUserSchema>
  | z.infer<typeof dashboardFeatureSchema> | z.infer<typeof dashboardProfileSchema> | z.infer<typeof dashboardDeleteRoleSchema>
  | DashboardRoleCreateInput | DashboardUserRoleInput | DashboardUserCapabilityInput;
export type DashboardMutationOperation = Exclude<DashboardOperation, 'view' | 'users' | 'permissions' | 'features' | 'userAccess'>;

export class DashboardMutationDto {
  constructor(readonly operation: DashboardMutationOperation, readonly input: DashboardMutationInput) {}
}

export class DashboardMutationRequest extends FormRequest<z.ZodType, DashboardMutationDto> {
    constructor(readonly operation: DashboardMutationOperation = 'retryJob') { super(); }

    rules() {
      const operation = this.operation;
      if (operation === 'deleteJob') return dashboardDeleteSchema;
      if (operation === 'runTask') return dashboardRunSchema;
      if (operation === 'toggleTask') return dashboardToggleSchema;
      if (operation === 'retryJobs' || operation === 'cleanupJobs') return dashboardBatchSchema;
      if (operation === 'pauseQueue') return dashboardPauseSchema;
      if (operation === 'resetPassword') return dashboardUserSchema;
      if (operation === 'deleteUser') return dashboardDeleteUserSchema;
      if (operation === 'toggleFeature') return dashboardFeatureSchema;
      if (operation === 'saveProfile') return dashboardProfileSchema;
      if (operation === 'deleteRole') return dashboardDeleteRoleSchema;
      if (operation === 'createRole') return dashboardRoleCreateSchema;
      if (operation === 'assignRole' || operation === 'detachRole') return dashboardUserRoleSchema;
      if (operation === 'grantCapability' || operation === 'revokeCapability') return dashboardUserCapabilitySchema;
      return dashboardJobSchema;
    }

    authorize(event: RequestEvent) { return authorizeDashboard(event, this.operation); }

    protected async parseBody(event: RequestEvent) {
      const operation = this.operation;
      // Route identity and queue scope cannot be overridden by JSON body fields.
      let body: Record<string, unknown> = {};
      if (!['retryJob', 'runTask', 'resetPassword'].includes(operation)) {
        if (!event.request.headers.get('content-type')?.includes('application/json')) {
          this.failedValidation({ _root: ['Expected a JSON body.'] });
        }
        try {
          const parsed: unknown = await event.request.json();
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
          body = parsed as Record<string, unknown>;
        } catch { this.failedValidation({ _root: ['Invalid JSON body.'] }); }
      }
      if (operation === 'toggleTask') return { name: event.params.name, enabled: body.enabled };
      if (operation === 'runTask') return { name: event.params.name };
      if (operation === 'resetPassword' || operation === 'deleteUser') return { id: event.params.id, ...(operation === 'deleteUser' ? { confirmed: body.confirmed } : {}) };
      if (operation === 'toggleFeature') return { name: event.params.name, enabled: body.enabled, confirmed: body.confirmed };
      if (operation === 'saveProfile' || operation === 'deleteRole') return { ...body, roleId: event.params.id };
      if (operation === 'createRole') return { name: body.name, label: body.label, scope: body.scope, teamId: body.teamId, confirmed: body.confirmed };
      if (['assignRole', 'detachRole', 'grantCapability', 'revokeCapability'].includes(operation)) return {
        id: event.params.id, scope: body.scope, teamId: body.teamId, confirmed: body.confirmed,
        ...(['assignRole', 'detachRole'].includes(operation) ? { roleId: body.roleId } : { capability: body.capability }),
      };
      const scope = { queue: event.url.searchParams.get('queue') ?? 'default', connection: event.url.searchParams.get('connection') ?? undefined };
      if (operation === 'retryJobs' || operation === 'cleanupJobs') return { ...scope, references: body.references, confirmed: body.confirmed };
      if (operation === 'pauseQueue') return { ...scope, paused: body.paused, confirmed: body.confirmed };
      return { id: event.params.id, ...scope, source: event.url.searchParams.get('source') ?? 'live',
        ...(operation === 'deleteJob' ? { confirmed: body.confirmed } : {}) };
    }

    passedValidation(input: DashboardMutationInput) { return new DashboardMutationDto(this.operation, input); }
}

export function dashboardMutationRequest(operation: DashboardMutationOperation): typeof DashboardMutationRequest {
  return class extends DashboardMutationRequest {
    constructor() { super(operation); }
  };
}
