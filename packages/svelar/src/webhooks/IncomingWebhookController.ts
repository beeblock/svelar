import { z } from '../validation/index.js';
import { Controller, type RequestEvent } from '../routing/Controller.js';
import { FormRequest, FormValidationError } from '../routing/FormRequest.js';
import { Resource } from '../routing/Resource.js';
import { Action } from '../actions/index.js';
import { Log } from '../logging/index.js';
import { randomUUID } from 'node:crypto';
import { WebhookInbox, WebhookSignatureError, type WebhookInboxReceiveResult } from './index.js';
import { IncomingWebhookError } from './InboxProcessor.js';

export const incomingWebhookSchema = z.object({ source: z.string().trim().min(1).max(255) });

export class IncomingWebhookDto {
  constructor(readonly source: string) {}
}
export class IncomingWebhookRequest extends FormRequest<typeof incomingWebhookSchema, IncomingWebhookDto> {
  rules() { return incomingWebhookSchema; }
  authorize() { return true; } // Registered source signatures, not session cookies, authorize ingress.
  protected async parseBody(event: RequestEvent) { return { source: event.params.source }; }
  passedValidation(input: z.output<typeof incomingWebhookSchema>) { return new IncomingWebhookDto(input.source); }
}
export class ReceiveIncomingWebhookAction extends Action<{ dto: IncomingWebhookDto; request: Request }, WebhookInboxReceiveResult> {
  async execute(input: { dto: IncomingWebhookDto; request: Request }) { return WebhookInbox.capture(input.dto.source, input.request); }
}
export interface IncomingWebhookReceipt { id: string; status: string; duplicate: boolean; }
export class IncomingWebhookResource extends Resource<WebhookInboxReceiveResult, IncomingWebhookReceipt> {
  toJSON(): IncomingWebhookReceipt { return { id: this.data.entry.id, status: this.data.entry.status, duplicate: this.data.duplicate }; }
}

export class IncomingWebhookController extends Controller {
  async receive(event: RequestEvent): Promise<Response> {
    const dto = await IncomingWebhookRequest.validate(event);
    const result = await new ReceiveIncomingWebhookAction().run({ dto, request: event.request });
    const status = WebhookInbox.acknowledgementStatus(dto.source);
    if (status === 204) { const response = this.noContent(); response.headers.set('Cache-Control', 'no-store'); return response; }
    return this.json({ data: new IncomingWebhookResource(result).toJSON(), meta: {} }, status, { 'Cache-Control': 'no-store' });
  }
  protected handleError(error: unknown, event: RequestEvent): Response {
    if (error instanceof IncomingWebhookError) return this.json({ data: null, meta: { message: error.message } }, error.status);
    if (error instanceof WebhookSignatureError) return this.json({ data: null, meta: { message: 'Invalid webhook signature.' } }, 401);
    if (error instanceof FormValidationError) return this.json({ data: null, meta: { errors: error.errors } }, 422);
    const incidentId = randomUUID();
    void Log.error('Incoming webhook capture unavailable', { incidentId, path: event.url.pathname,
      error: error instanceof Error ? error : new Error('Unknown capture failure') })
      .catch(() => console.error('Incoming webhook capture unavailable', { incidentId }));
    return this.json({ data: null, meta: { message: 'Webhook capture unavailable.', incidentId } }, 503, { 'Cache-Control': 'no-store' });
  }
}
