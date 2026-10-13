import { ApplicationContext, type ApplicationContextSnapshot } from '../support/Context.js';
import { createRequestEvent, type RequestEventOptions } from './request.js';

export interface TestApplicationContext {
  teamId?: string | number | null;
  tenantId?: string | number | null;
  actorId?: string | number | null;
  userId?: string | number | null;
  correlationId?: string | null;
}

function identifier(value: unknown, field: string): void {
  if (value === undefined || value === null) return;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return;
  if (typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 255) return;
  throw new TypeError(`Test ${field} must be a nonempty bounded string, safe integer, or null.`);
}

/** Explicit test boundary: absent tenant/actor/authentication values never inherit a previous test. */
export async function runWithContext<T>(context: TestApplicationContext, callback: () => T | Promise<T>): Promise<T> {
  if (!context || typeof context !== 'object' || Array.isArray(context) || typeof callback !== 'function') throw new TypeError('runWithContext requires explicit context and a callback.');
  for (const field of ['teamId', 'tenantId', 'actorId', 'userId'] as const) identifier(context[field], field);
  if (context.correlationId !== undefined && context.correlationId !== null && (typeof context.correlationId !== 'string' || Buffer.byteLength(context.correlationId) > 255)) throw new TypeError('Test correlationId must be a bounded string or null.');
  if (context.teamId !== undefined && context.tenantId !== undefined && context.teamId !== context.tenantId) throw new Error('Test teamId and tenantId must identify the same tenant.');
  const snapshot: ApplicationContextSnapshot = {};
  for (const field of ['teamId', 'tenantId', 'actorId', 'userId', 'correlationId'] as const) if (context[field] !== undefined) snapshot[field] = context[field];
  const tenant = context.tenantId === undefined ? context.teamId : context.tenantId;
  if (tenant !== undefined) { snapshot.teamId = tenant; snapshot.tenantId = tenant; }
  return await ApplicationContext.runIsolated(snapshot, callback);
}

export function withTenant<T>(tenantId: string | number | null, callback: () => T | Promise<T>, context: Omit<TestApplicationContext, 'tenantId' | 'teamId'> = {}): Promise<T> {
  return runWithContext({ ...context, tenantId }, callback);
}

export function withActor<T>(actorId: string | number | null, callback: () => T | Promise<T>, context: Omit<TestApplicationContext, 'actorId'> = {}): Promise<T> {
  return runWithContext({ ...context, actorId }, callback);
}

/** Build the existing request fake inside the current explicit context; authentication stays caller-owned. */
export function createContextRequestEvent(options: RequestEventOptions = {}): ReturnType<typeof createRequestEvent> {
  return createRequestEvent({ ...options, locals: { ...options.locals, context: ApplicationContext.snapshot() } });
}

export function assertApplicationContext(expected: TestApplicationContext): void {
  for (const field of Object.keys(expected) as (keyof TestApplicationContext)[]) {
    if (!Object.is(ApplicationContext.get(field), expected[field])) throw new Error(`Application context ${field} does not match the expected test scope.`);
  }
}
