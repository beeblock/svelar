import { z } from '../validation/index.js';
import { FormRequest } from '../routing/FormRequest.js';
import type { RequestEvent } from '../routing/Controller.js';
import { authorizeDashboard, type DashboardOperation } from './security.js';

const identifier = z.string().min(1).max(255).refine((value) => !/[\x00-\x1f\x7f]/.test(value), 'Invalid identifier');
const integer = (fallback: number, maximum: number) => z.string().regex(/^\d+$/)
  .transform(Number).refine((value) => Number.isSafeInteger(value) && value <= maximum, 'Out of range').default(String(fallback));

export const dashboardQueueSchema = z.object({
  queue: identifier.default('default'),
  status: z.enum(['waiting', 'active', 'failed', 'completed', 'delayed']).default('failed'),
  limit: integer(25, 100).refine((value) => value > 0, 'Must be positive'),
  offset: integer(0, 1_000_000),
});

export const dashboardLogSchema = z.object({
  level: z.enum(['debug', 'info', 'warn', 'error', 'fatal']).optional(),
  channel: identifier.optional(),
  search: z.string().max(500).optional(),
  limit: integer(25, 100).refine((value) => value > 0, 'Must be positive'),
  offset: integer(0, 1_000_000),
});

export const dashboardJobSchema = z.object({ id: identifier, queue: identifier.default('default') });
export const dashboardRunSchema = z.object({ name: identifier });
export const dashboardToggleSchema = z.object({ name: identifier, enabled: z.boolean() });
export const dashboardDeleteSchema = dashboardJobSchema.extend({ confirmed: z.literal(true) });

export type DashboardMutationInput = z.infer<typeof dashboardJobSchema> | z.infer<typeof dashboardRunSchema>
  | z.infer<typeof dashboardToggleSchema> | z.infer<typeof dashboardDeleteSchema>;

export class DashboardMutationDto {
  constructor(readonly operation: Exclude<DashboardOperation, 'view'>, readonly input: DashboardMutationInput) {}
}

export class DashboardMutationRequest extends FormRequest<z.ZodTypeAny, DashboardMutationDto> {
    constructor(readonly operation: Exclude<DashboardOperation, 'view'> = 'retryJob') { super(); }

    rules() {
      const operation = this.operation;
      if (operation === 'deleteJob') return dashboardDeleteSchema;
      if (operation === 'runTask') return dashboardRunSchema;
      if (operation === 'toggleTask') return dashboardToggleSchema;
      return dashboardJobSchema;
    }

    authorize(event: RequestEvent) { return authorizeDashboard(event, this.operation); }

    protected async parseBody(event: RequestEvent) {
      const operation = this.operation;
      // Route identity and queue scope cannot be overridden by JSON body fields.
      let body: Record<string, unknown> = {};
      if (operation === 'toggleTask' || operation === 'deleteJob') {
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
      return { id: event.params.id, queue: event.url.searchParams.get('queue') ?? 'default',
        ...(operation === 'deleteJob' ? { confirmed: body.confirmed } : {}) };
    }

    passedValidation(input: DashboardMutationInput) { return new DashboardMutationDto(this.operation, input); }
}

export function dashboardMutationRequest(operation: Exclude<DashboardOperation, 'view'>): typeof DashboardMutationRequest {
  return class extends DashboardMutationRequest {
    constructor() { super(operation); }
  };
}
