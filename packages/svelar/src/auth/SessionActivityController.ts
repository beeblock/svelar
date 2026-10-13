import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod/v4';
import { Action } from '../actions/index.js';
import type { CsrfOptions } from '../middleware/Middleware.js';
import { Controller, type RequestEvent } from '../routing/Controller.js';
import { FormRequest, FormValidationError } from '../routing/FormRequest.js';
import { isSession, type Session } from '../session/Session.js';
import { isSessionExpiredError, type SessionActivityStatus } from '../session/Activity.js';

const renewSessionSchema = z.strictObject({});
interface RenewSessionDto { session: Session }

function authenticatedSession(event: RequestEvent): Session | null {
  const session = event.locals.session;
  if (!isSession(session)) return null;
  const user = event.locals.user;
  const id = user?.getAttribute?.('id') ?? user?.id;
  const storedId = session.get('auth_user_id');
  return id !== undefined && id !== null
    && storedId !== undefined && storedId !== null && storedId !== ''
    && String(storedId) === String(id) && session.getActivityStatus() ? session : null;
}

class RenewSessionRequest extends FormRequest<typeof renewSessionSchema, RenewSessionDto> {
  private session: Session | null = null;
  rules() { return renewSessionSchema; }
  authorize(event: RequestEvent): boolean { this.session = authenticatedSession(event); return this.session !== null; }
  passedValidation(): RenewSessionDto {
    if (!this.session) this.failedAuthorization();
    return { session: this.session };
  }
}

class RenewSessionAction extends Action<RenewSessionDto, SessionActivityStatus> {
  execute(dto: RenewSessionDto): Promise<SessionActivityStatus> { return dto.session.renew(); }
}

/** Bind GET to status and POST to renew after SessionMiddleware and AuthenticateMiddleware. */
export class SessionActivityController extends Controller {
  constructor(private csrf: Pick<CsrfOptions, 'cookieName' | 'headerName'> = {}) { super(); }

  async status(event: RequestEvent): Promise<Response> {
    if (event.request.method !== 'GET') return this.reply(null, 405, 'METHOD_NOT_ALLOWED');
    const session = authenticatedSession(event);
    session?.markActivity(false);
    const status = session?.getActivityStatus();
    return status && !status.expired ? this.reply(status) : this.reply(null, 401, 'SESSION_EXPIRED');
  }

  async renew(event: RequestEvent): Promise<Response> {
    if (event.request.method !== 'POST') return this.reply(null, 405, 'METHOD_NOT_ALLOWED');
    const session = authenticatedSession(event);
    session?.markActivity(false);
    if (!session || session.getActivityStatus()?.expired) return this.reply(null, 401, 'SESSION_EXPIRED');
    if (!this.validCsrf(event)) return this.reply(null, 419, 'CSRF_MISMATCH');
    try {
      const dto = await RenewSessionRequest.validate(event);
      return this.reply(await new RenewSessionAction().run(dto));
    } catch (error) {
      if (isSessionExpiredError(error)) return this.reply(null, 401, 'SESSION_EXPIRED');
      if (error instanceof FormValidationError || error instanceof SyntaxError) return this.reply(null, 422, 'INVALID_RENEWAL');
      throw error;
    }
  }

  private validCsrf(event: RequestEvent): boolean {
    const origin = event.request.headers.get('origin');
    if ((origin && origin !== event.url.origin) || event.request.headers.get('sec-fetch-site') === 'cross-site') return false;
    const name = this.csrf.cookieName ?? 'XSRF-TOKEN';
    let token: string | undefined;
    for (const part of (event.request.headers.get('cookie') ?? '').split(';')) {
      const separator = part.indexOf('=');
      if (part.slice(0, separator).trim() === name) {
        try { token = decodeURIComponent(part.slice(separator + 1)); } catch { return false; }
      }
    }
    const submitted = event.request.headers.get(this.csrf.headerName ?? 'X-CSRF-Token');
    if (!token || !submitted) return false;
    const first = Buffer.from(token);
    const second = Buffer.from(submitted);
    return first.length === second.length && timingSafeEqual(first, second);
  }

  private reply(data: SessionActivityStatus | null, status = 200, code?: string): Response {
    return Response.json({ data, meta: code ? { code } : {} }, {
      status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' },
    });
  }
}
