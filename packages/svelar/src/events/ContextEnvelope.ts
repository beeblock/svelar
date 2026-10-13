import { ApplicationContext, type ApplicationContextSnapshot } from '../support/Context.js';

export type EventJson = null | boolean | number | string | EventJson[] | { [key: string]: EventJson };

export interface EventDispatchOptions {
  /** An explicit empty object delivers a system event without ambient identity. */
  context?: ApplicationContextSnapshot;
}

export interface NamedEventEnvelope {
  version: 1;
  name: string;
  payload: EventJson;
  context: ApplicationContextSnapshot;
}

const MAX_BYTES = 1_048_576;
const MAX_NODES = 10_000;
const MAX_DEPTH = 32;

function transportName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || name.length > 255 || name.trim() !== name || !/^[A-Za-z][A-Za-z0-9_-]*(?:[.:][A-Za-z][A-Za-z0-9_-]*)+$/.test(name)) {
    throw new TypeError('Transport events require an explicit namespaced name, such as billing.invoice.created.');
  }
}

/** Validate before stringify: JSON must not silently discard identities or invoke custom serializers. */
function copyJson(input: unknown): EventJson {
  const ancestors = new Set<object>();
  let nodes = 0;
  let bytes = 0;
  const charge = (text: string) => {
    if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) throw new RangeError('Event envelope exceeds the 1 MiB transport limit.');
    bytes += Buffer.byteLength(JSON.stringify(text), 'utf8');
    if (bytes > MAX_BYTES) throw new RangeError('Event envelope exceeds the 1 MiB transport limit.');
  };
  const visit = (value: unknown, depth: number): EventJson => {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) throw new RangeError('Event envelope exceeds its node/depth transport limit.');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') { charge(value); return value; }
    if (!value || typeof value !== 'object') throw new TypeError('Event envelope accepts only JSON data; undefined, functions, symbols and nonfinite numbers are not transportable.');
    const array = Array.isArray(value);
    if (array && value.length > MAX_NODES) throw new RangeError('Event envelope array exceeds its transport limit.');
    if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError('Event envelope objects must be plain JSON records.');
    if (ancestors.has(value)) throw new TypeError('Event envelope cannot contain circular data.');
    ancestors.add(value);
    try {
      const keys = Reflect.ownKeys(value);
      if (keys.length > MAX_NODES) throw new RangeError('Event envelope record exceeds its transport limit.');
      if (keys.some((key) => typeof key === 'symbol')) throw new TypeError('Event envelope cannot contain symbol properties.');
      if (array) {
        if (keys.some((key) => key !== 'length' && (!/^(0|[1-9]\d*)$/.test(String(key)) || Number(key) >= value.length))) throw new TypeError('Event envelope arrays cannot contain extra properties.');
        return Array.from({ length: value.length }, (_, index) => {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
          if (!descriptor || !('value' in descriptor)) throw new TypeError('Event envelope cannot contain sparse arrays or accessors.');
          return visit(descriptor.value, depth + 1);
        });
      }
      const result: { [key: string]: EventJson } = {};
      for (const property of keys) {
        const key = String(property);
        const descriptor = Object.getOwnPropertyDescriptor(value, property)!;
        if (!descriptor.enumerable || !('value' in descriptor)) throw new TypeError('Event envelope cannot contain accessors or hidden properties.');
        charge(key);
        Object.defineProperty(result, key, { value: visit(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true });
      }
      return result;
    } finally { ancestors.delete(value); }
  };
  const result = visit(input, 0);
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_BYTES) throw new RangeError('Event envelope exceeds the 1 MiB transport limit.');
  return result;
}

export function captureEventEnvelope(name: string, payload: EventJson = null, options: EventDispatchOptions = {}): NamedEventEnvelope {
  transportName(name);
  const context = options.context === undefined ? ApplicationContext.snapshot() : options.context;
  return readEventEnvelope({ version: 1, name, payload, context });
}

export function readEventEnvelope(input: unknown): NamedEventEnvelope {
  const copy = copyJson(input);
  if (!copy || typeof copy !== 'object' || Array.isArray(copy) || copy.version !== 1) throw new TypeError('Unsupported event envelope version.');
  transportName(copy.name);
  if (!Object.hasOwn(copy, 'payload') || !copy.context || typeof copy.context !== 'object' || Array.isArray(copy.context)) throw new TypeError('Event envelope requires a payload and explicit context record.');
  for (const key of ['teamId', 'tenantId', 'actorId', 'userId']) {
    const id = copy.context[key];
    if (id !== undefined && id !== null && !(typeof id === 'string' && id.length > 0 && Buffer.byteLength(id, 'utf8') <= 255) && !(typeof id === 'number' && Number.isSafeInteger(id))) throw new TypeError(`Event context ${key} must be a scalar identifier.`);
  }
  if (copy.context.teamId !== undefined && copy.context.tenantId !== undefined && copy.context.teamId !== copy.context.tenantId) throw new TypeError('Event context tenantId and teamId must agree.');
  return { version: 1, name: copy.name, payload: copy.payload, context: copy.context };
}
