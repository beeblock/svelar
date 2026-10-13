import { z } from 'zod/v4';
import { isReservedRoleName } from '../permissions/PermissionManifest.js';

const identity = z.string().min(1).max(255).refine((value) => value.trim() === value && !/[\x00-\x1f\x7f]/.test(value), 'Invalid identity');
const name = z.string().min(1).max(255).regex(/^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*)*$/, 'Invalid name');
export const dashboardAccessScopeSchema = z.object({ scope: z.enum(['team', 'platform']), teamId: identity.optional() })
  .refine((input) => input.scope === 'team' ? !!input.teamId : input.teamId === undefined, 'Select exactly the assignment scope and its team');
export const dashboardRoleCreateSchema = dashboardAccessScopeSchema.safeExtend({
  name: name.max(64).refine((value) => !isReservedRoleName(value), 'Reserved platform identity cannot be created'),
  label: z.string().trim().min(1).max(255).refine((value) => !/[\x00-\x1f\x7f]/.test(value), 'Invalid label'), confirmed: z.literal(true),
});
export const dashboardUserAccessSchema = dashboardAccessScopeSchema.safeExtend({ id: identity });
export const dashboardUserRoleSchema = dashboardUserAccessSchema.safeExtend({ roleId: z.coerce.number().int().positive().safe(), confirmed: z.literal(true) });
export const dashboardUserCapabilitySchema = dashboardUserAccessSchema.safeExtend({ capability: name, confirmed: z.literal(true) });
export type DashboardRoleCreateInput = z.infer<typeof dashboardRoleCreateSchema>;
export type DashboardUserAccessInput = z.infer<typeof dashboardUserAccessSchema>;
export type DashboardUserRoleInput = z.infer<typeof dashboardUserRoleSchema>;
export type DashboardUserCapabilityInput = z.infer<typeof dashboardUserCapabilitySchema>;
