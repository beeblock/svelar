import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from '../validation/index.js';
import { Controller, type RequestEvent } from '../routing/Controller.js';
import { FormRequest, FormAuthorizationError, FormValidationError } from '../routing/FormRequest.js';
import { Action } from '../actions/index.js';
import { Log } from '../logging/index.js';
import { Broadcast } from './index.js';

const channelSchema = z.string().regex(/^[A-Za-z0-9_.:=-]{1,200}$/);
export const internalBroadcastSchema = z.object({
  channel: channelSchema,
  eventName: z.string().min(1).max(255).regex(/^[^\r\n\0]+$/),
  data: z.unknown().optional(),
});
const pusherAuthorizationSchema = z.object({ channel_name: channelSchema, socket_id: z.string().regex(/^\d+\.\d+$/).max(100) });
const bodyLimit = 256 * 1024;

class BroadcastRequestError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

function verifiedInternalRequest(event: RequestEvent): boolean {
  const expected = process.env.INTERNAL_SECRET;
  const supplied = event.request.headers.get('x-internal-secret');
  if (!expected || !supplied || supplied.length > 1024) return false;
  return timingSafeEqual(createHash('sha256').update(expected).digest(), createHash('sha256').update(supplied).digest());
}

async function boundedBody(request: Request): Promise<string> {
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > bodyLimit)) throw new BroadcastRequestError(413, 'BODY_TOO_LARGE');
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > bodyLimit) { await reader.cancel(); throw new BroadcastRequestError(413, 'BODY_TOO_LARGE'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}

export class InternalBroadcastDto {
  constructor(readonly channel: string, readonly eventName: string, readonly data: unknown) {}
}
export class InternalBroadcastRequest extends FormRequest<typeof internalBroadcastSchema, InternalBroadcastDto> {
  rules() { return internalBroadcastSchema; }
  authorize(event: RequestEvent) { return verifiedInternalRequest(event); }
  protected async parseBody(event: RequestEvent) {
    if (!event.request.headers.get('content-type')?.split(';')[0].trim().match(/^application\/json$/i)) throw new BroadcastRequestError(415, 'JSON_REQUIRED');
    const text = await boundedBody(event.request);
    try { return JSON.parse(text); } catch { throw new BroadcastRequestError(400, 'INVALID_JSON'); }
  }
  passedValidation(input: z.output<typeof internalBroadcastSchema>) { return new InternalBroadcastDto(input.channel, input.eventName, input.data ?? {}); }
}
export class PublishInternalBroadcastAction extends Action<InternalBroadcastDto, void> {
  async execute(dto: InternalBroadcastDto) { await Broadcast.to(dto.channel).send(dto.eventName, dto.data); }
}

class PusherAuthorizationDto {
  constructor(readonly channel: string, readonly socketId: string) {}
}
class PusherAuthorizationRequest extends FormRequest<typeof pusherAuthorizationSchema, PusherAuthorizationDto> {
  rules() { return pusherAuthorizationSchema; }
  authorize(event: RequestEvent) { return Boolean(event.locals.user); }
  protected async parseBody(event: RequestEvent) {
    if (!event.request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) throw new BroadcastRequestError(415, 'FORM_REQUIRED');
    return Object.fromEntries(new URLSearchParams(await boundedBody(event.request)));
  }
  passedValidation(input: z.output<typeof pusherAuthorizationSchema>) { return new PusherAuthorizationDto(input.channel_name, input.socket_id); }
}
class AuthorizeBroadcastChannelAction extends Action<{ dto: PusherAuthorizationDto; user: unknown }, Awaited<ReturnType<typeof Broadcast.authenticatePusher>>> {
  execute({ dto, user }: { dto: PusherAuthorizationDto; user: unknown }) { return Broadcast.authenticatePusher(dto.channel, dto.socketId, user); }
}

/** Protocol endpoints; application policies still authorize private/presence channels. */
export class BroadcastingController extends Controller {
  constructor() {
    super();
    this.middleware(async (ctx, next) => {
      if (!process.env.INTERNAL_SECRET) return this.reply(null, 503, { code: 'BROADCAST_UNAVAILABLE' });
      if (!verifiedInternalRequest(ctx.event)) return this.reply(null, 401, { code: 'UNAUTHENTICATED' });
      return next();
    }, { only: ['publish'] });
  }

  async stream(event: RequestEvent): Promise<Response> {
    const channel = channelSchema.safeParse(event.params.channel);
    const lastEventId = event.request.headers.get('last-event-id') ?? undefined;
    if (!channel.success || lastEventId !== undefined && (!lastEventId || lastEventId.length > 128 || /[\r\n\0]/.test(lastEventId))) return this.reply(null, 422, { code: 'INVALID_SUBSCRIPTION' });
    const user = event.locals.user;
    let presence: Record<string, unknown> | undefined;
    if (/^(?:private-|presence-)/.test(channel.data)) {
      if (!user) return this.reply(null, 401, { code: 'UNAUTHENTICATED' });
      const authorized = await Broadcast.authorize(channel.data, user);
      if (!authorized) return this.reply(null, 403, { code: 'FORBIDDEN' });
      if (channel.data.startsWith('presence-') && typeof authorized === 'object') presence = authorized;
    }
    return Broadcast.subscribe(channel.data, user?.getAttribute?.('id') ?? user?.id, presence, { signal: event.request.signal, lastEventId });
  }

  async authenticate(event: RequestEvent): Promise<Response> {
    if (!event.locals.user) return this.reply(null, 401, { code: 'UNAUTHENTICATED' });
    const dto = await PusherAuthorizationRequest.validate(event);
    const auth = await new AuthorizeBroadcastChannelAction().run({ dto, user: event.locals.user });
    if (!auth) return this.reply(null, 403, { code: 'FORBIDDEN' });
    // pusher-js requires the signed protocol response at the top level, not a resource envelope.
    return this.json(auth, 200, { 'Cache-Control': 'private, no-store', Vary: 'Cookie' });
  }

  async publish(event: RequestEvent): Promise<Response> {
    if (event.request.method !== 'POST') return this.reply(null, 405, { code: 'METHOD_NOT_ALLOWED' });
    const dto = await InternalBroadcastRequest.validate(event);
    await new PublishInternalBroadcastAction().run(dto);
    return this.reply({ subscribers: Broadcast.totalSubscribers() }, 200, { message: 'Event broadcast.' });
  }

  protected handleError(error: unknown, event: RequestEvent): Response {
    if (error instanceof BroadcastRequestError) return this.reply(null, error.status, { code: error.code });
    if (error instanceof FormAuthorizationError) return this.reply(null, 401, { code: 'UNAUTHENTICATED' });
    if (error instanceof FormValidationError) return this.reply(null, 422, { code: 'INVALID_BROADCAST', errors: error.errors });
    const incidentId = randomUUID();
    void Log.error('Broadcast endpoint unavailable', { incidentId, path: event.url.pathname, error })
      .catch(() => console.error('Broadcast endpoint unavailable', { incidentId }));
    return this.reply(null, 503, { code: 'BROADCAST_UNAVAILABLE', incidentId });
  }

  private reply(data: unknown, status = 200, meta: Record<string, unknown> = {}) {
    return this.json({ data, meta }, status, { 'Cache-Control': 'private, no-store', Vary: 'Cookie' });
  }
}
