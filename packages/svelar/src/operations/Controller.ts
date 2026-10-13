import { z } from '../validation/index.js';
import { Action } from '../actions/index.js';
import { CsrfMiddleware, OriginMiddleware } from '../middleware/Middleware.js';
import { Controller, type RequestEvent } from '../routing/Controller.js';
import { FormRequest, FormAuthorizationError, FormValidationError } from '../routing/FormRequest.js';
import { ApplicationContext, type ApplicationContextSnapshot } from '../support/Context.js';
import { BackgroundOperation } from './index.js';

const cancelOperationSchema = z.object({ id: z.uuid() });
const operationPageSchema = z.object({
  limit: z.string().regex(/^\d{1,3}$/).transform(Number).pipe(z.number().int().min(1).max(100)).prefault('20'),
  cursor: z.string().regex(/^\d{1,16}:[a-f0-9-]{36}$/).optional(),
});

function authenticatedContext(event: RequestEvent): ApplicationContextSnapshot | null {
  const user = event.locals.user;
  const id = user?.getAttribute?.('id') ?? user?.id;
  if ((typeof id !== 'number' && typeof id !== 'string') || !String(id).trim()) return null;
  const context = ApplicationContext.snapshot();
  const actorId = context.actorId ?? context.userId ?? id;
  if (String(actorId) !== String(id) || (context.userId != null && String(context.userId) !== String(id))
    || (context.actorType != null && context.actorType !== 'user')
    || (context.tenantId != null && context.teamId != null && String(context.tenantId) !== String(context.teamId))) return null;
  return { ...context, actorId: id, userId: id, actorType: 'user' };
}

class CancelOperationDto {
  constructor(readonly id: string) {}
}
class CancelOperationRequest extends FormRequest<typeof cancelOperationSchema, CancelOperationDto> {
  rules() { return cancelOperationSchema; }
  authorize(event: RequestEvent) { return authenticatedContext(event) !== null; }
  protected async parseBody(event: RequestEvent) { return { id: event.params.id }; }
  passedValidation(data: z.output<typeof cancelOperationSchema>) { return new CancelOperationDto(data.id); }
}
class CancelOperationAction extends Action<CancelOperationDto, boolean> {
  execute(dto: CancelOperationDto) { return BackgroundOperation.cancel(dto.id); }
}

/** Personal operation reads/cancellation. Dispatch and sweeps remain trusted application boundaries. */
export class OperationsController extends Controller {
  constructor() {
    super();
    this.middleware(async (ctx, next) => {
      const context = authenticatedContext(ctx.event);
      if (!context) return this.reply(null, 401, { code: 'UNAUTHENTICATED' });
      return ApplicationContext.runIsolated(context, async () => {
        // This session-oriented browser surface never trusts a Bearer header as a CSRF exemption.
        const request = new Request(ctx.event.request.clone());
        request.headers.delete('authorization');
        const scoped = { ...ctx, event: { ...ctx.event, request } };
        const response = await new OriginMiddleware().handle(scoped, () => new CsrfMiddleware().handle(scoped, next));
        if (response?.status === 419) return this.reply(null, 419, { code: 'CSRF_MISMATCH' });
        if (response?.status === 403) return this.reply(null, 403, { code: 'ORIGIN_MISMATCH' });
        return response;
      });
    });
  }

  async index(event: RequestEvent) {
    const page = operationPageSchema.safeParse(Object.fromEntries(event.url.searchParams));
    if (!page.success) return this.reply(null, 422, { code: 'INVALID_PAGE', errors: page.error.flatten().fieldErrors });
    const result = await BackgroundOperation.list(page.data);
    return this.reply(result.data, 200, { ...result.meta, channel: BackgroundOperation.currentChannel() });
  }

  async show(event: RequestEvent) {
    const id = cancelOperationSchema.safeParse({ id: event.params.id });
    if (!id.success) return this.reply(null, 404, { code: 'NOT_FOUND' });
    const operation = await BackgroundOperation.find(id.data.id);
    return operation ? this.reply(operation) : this.reply(null, 404, { code: 'NOT_FOUND' });
  }

  async cancel(event: RequestEvent) {
    if (event.request.method !== 'POST') return this.reply(null, 405, { code: 'METHOD_NOT_ALLOWED' });
    const dto = await CancelOperationRequest.validate(event);
    const current = await BackgroundOperation.find(dto.id);
    if (!current) return this.reply(null, 404, { code: 'NOT_FOUND' });
    if (!await new CancelOperationAction().run(dto)) return this.reply(current, 409, { code: 'ALREADY_SETTLED' });
    return this.reply(await BackgroundOperation.find(dto.id), 202, { message: 'Cancellation requested.' });
  }

  protected handleError(error: unknown, _event: RequestEvent): Response {
    if (error instanceof FormValidationError) return this.reply(null, 422, { code: 'INVALID_OPERATION', errors: error.errors });
    if (error instanceof FormAuthorizationError) return this.reply(null, 403, { code: 'FORBIDDEN' });
    console.error('[Operations] Personal operation endpoint unavailable.');
    return this.reply(null, 503, { code: 'OPERATIONS_UNAVAILABLE' });
  }

  private reply(data: unknown, status = 200, meta: Record<string, unknown> = {}) {
    return this.json({ data, meta }, status, { 'Cache-Control': 'private, no-store', Vary: 'Cookie' });
  }
}
