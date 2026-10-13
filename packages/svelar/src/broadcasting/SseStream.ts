import type { BroadcastBackplaneMessage, BroadcastEvent } from './index.js';

export interface SseStreamOptions {
  lastEventId?: string | null;
  signal?: AbortSignal;
  heartbeatSeconds?: number;
  maxDurationSeconds?: number;
  maxBufferedEvents?: number;
  retryMilliseconds?: number;
}

export interface BroadcastReplay {
  messages: BroadcastBackplaneMessage[];
  /** The cursor expired, is unknown, or exceeds the bounded replay window. Reload authoritative state. */
  reset: boolean;
}

export interface SseConnection {
  send(event: BroadcastEvent): void;
  close(reason?: string): void;
}

function bounded(value: number | undefined, fallback: number, maximum: number, name: string): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected < 1 || selected > maximum) throw new RangeError(`Invalid SSE ${name}.`);
  return selected;
}

export function assertSseEvent(event: string, id?: string): void {
  if (typeof event !== 'string' || !event || event.length > 255 || /[\r\n\0]/.test(event)) throw new TypeError('Invalid SSE event name.');
  if (id !== undefined && (typeof id !== 'string' || !id || id.length > 128 || /[\r\n\0]/.test(id))) throw new TypeError('Invalid SSE event ID.');
}

export function createSseStream(config: {
  initial: unknown;
  register(connection: SseConnection): () => void;
  replay?: (cursor: string, limit: number) => Promise<BroadcastReplay>;
  ready?: () => Promise<void>;
  userId?: string | number;
  onReplay?: (count: number, reset: boolean) => void;
  onClose?: (reason: string) => void;
}, options: SseStreamOptions = {}): Response {
  const heartbeatMs = bounded(options.heartbeatSeconds, 15, 3600, 'heartbeat') * 1000;
  const durationMs = bounded(options.maxDurationSeconds, 300, 86_400, 'duration') * 1000;
  const bufferSize = bounded(options.maxBufferedEvents, 64, 10_000, 'buffer');
  const retry = bounded(options.retryMilliseconds, 1000, 60_000, 'retry');
  if (options.lastEventId) assertSseEvent('resume', options.lastEventId);
  const encoder = new TextEncoder();
  let disconnect = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let initializing = true;
      let unregister: (() => void) | undefined;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let expiry: ReturnType<typeof setTimeout> | undefined;
      const waiting: BroadcastEvent[] = [];
      const delivered = new Set<string>();
      const finish = (reason: string, cancel = false) => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat); clearTimeout(expiry);
        options.signal?.removeEventListener('abort', aborted);
        unregister?.(); waiting.length = 0;
        config.onClose?.(reason);
        if (!cancel) { try { controller.close(); } catch {} }
      };
      const enqueue = (text: string): boolean => {
        if (closed) return false;
        if ((controller.desiredSize ?? 0) <= 0) { finish('backpressure'); return false; }
        controller.enqueue(encoder.encode(text));
        return true;
      };
      const write = (event: BroadcastEvent) => {
        if (closed || (event.id && delivered.has(event.id))) return;
        assertSseEvent(event.event, event.id);
        const data = JSON.stringify(event.data);
        if (data === undefined || Buffer.byteLength(data) > 1_048_576) { finish('invalid-payload'); return; }
        if (enqueue(`event: ${event.event}\ndata: ${data}\n${event.id ? `id: ${event.id}\n` : ''}\n`) && event.id) {
          delivered.add(event.id);
          if (delivered.size > bufferSize * 2) delivered.delete(delivered.values().next().value!);
        }
      };
      const connection: SseConnection = {
        send(event) {
          if (closed) return;
          if (initializing) {
            if (waiting.length >= bufferSize) { finish('backpressure'); return; }
            waiting.push(event);
          } else write(event);
        },
        close(reason = 'drain') {
          if (!closed) enqueue(`event: reconnect\ndata: ${JSON.stringify({ reason })}\n\n`);
          finish(reason);
        },
      };
      const aborted = () => finish('aborted');
      disconnect = () => finish('cancelled', true);
      unregister = config.register(connection);
      options.signal?.addEventListener('abort', aborted, { once: true });
      if (options.signal?.aborted) { finish('aborted'); return; }
      heartbeat = setInterval(() => { enqueue(': heartbeat\n\n'); }, heartbeatMs);
      heartbeat.unref?.();
      expiry = setTimeout(() => connection.close('reauthorize'), durationMs);
      expiry.unref?.();
      void (async () => {
        try {
          await config.ready?.();
          if (closed) return;
          enqueue(`retry: ${retry}\nevent: connected\ndata: ${JSON.stringify(config.initial)}\n\n`);
          if (options.lastEventId) {
            const replay = config.replay ? await config.replay(options.lastEventId, Math.max(1, bufferSize - 1)) : { messages: [], reset: true };
            if (closed) return;
            config.onReplay?.(replay.messages.length, replay.reset);
            if (replay.reset) write({ event: 'reset', data: { reason: 'replay-unavailable' } });
            else for (const message of replay.messages) {
              if (message.targetUserId !== undefined && String(message.targetUserId) !== String(config.userId)) continue;
              write({ event: message.event, data: message.data, id: message.id });
            }
          }
          initializing = false;
          for (const event of waiting.splice(0)) write(event);
        } catch { connection.close('backplane-unavailable'); }
      })();
    },
    cancel() { disconnect(); },
  }, { highWaterMark: bufferSize });
  return new Response(stream, { headers: {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-store',
    'Connection': 'keep-alive', 'X-Accel-Buffering': 'no',
  } });
}
