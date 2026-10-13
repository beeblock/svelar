/**
 * Svelar Broadcasting
 *
 * Real-time event broadcasting with multiple drivers and Laravel-style
 * channel authorization. Supports SSE (zero-dependency), Pusher/Soketi
 * (WebSocket via pusher protocol), and a log driver for development.
 *
 * Channel types:
 *   - Public channels:   Anyone can subscribe
 *   - Private channels:  Require authorization (prefixed with 'private-')
 *   - Presence channels: Require authorization + track who's online (prefixed with 'presence-')
 *
 * @example
 * ```ts
 * import { Broadcast } from '@beeblock/svelar/broadcasting';
 *
 * // Configure
 * Broadcast.configure({
 *   default: 'sse',
 *   drivers: {
 *     sse: { driver: 'sse' },
 *     pusher: {
 *       driver: 'pusher',
 *       key: env('PUSHER_KEY'),
 *       secret: env('PUSHER_SECRET'),
 *       appId: env('PUSHER_APP_ID'),
 *       cluster: env('PUSHER_CLUSTER', 'mt1'),
 *       host: env('PUSHER_HOST'),           // For Soketi
 *       port: env<number>('PUSHER_PORT'),   // For Soketi
 *       useTLS: env<boolean>('PUSHER_TLS', true),
 *     },
 *   },
 * });
 *
 * // Register channel authorization
 * Broadcast.channel('private-orders.{orderId}', async (user, { orderId }) => {
 *   return user.id === (await Order.findOrFail(orderId)).user_id;
 * });
 *
 * Broadcast.channel('presence-chat.{roomId}', async (user, { roomId }) => {
 *   const room = await ChatRoom.findOrFail(roomId);
 *   if (!room.hasMember(user.id)) return false;
 *   return { id: user.id, name: user.name, avatar: user.avatar };
 * });
 *
 * // Broadcast events from anywhere
 * Broadcast.event('OrderShipped', { orderId: 123 })
 *   .on('private-orders.123')
 *   .send();
 *
 * // Or the shorthand
 * Broadcast.to('private-orders.123').send('OrderShipped', { orderId: 123 });
 * ```
 */

import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createSseStream, assertSseEvent, type BroadcastReplay, type SseConnection, type SseStreamOptions } from './SseStream.js';
export type { BroadcastReplay, SseStreamOptions } from './SseStream.js';

// ── Types ──────────────────────────────────────────────────

export interface BroadcastConfig {
  default: string;
  drivers: Record<string, BroadcastDriverConfig>;
}

export type BroadcastDriverConfig =
  | { driver: 'sse'; backplane?: BroadcastBackplaneConfig }
  | { driver: 'log' }
  | {
      driver: 'pusher';
      key: string;
      secret: string;
      appId: string;
      cluster?: string;
      host?: string;
      port?: number;
      useTLS?: boolean;
    };

export interface BroadcastEvent {
  event: string;
  data: any;
  id?: string;
}

export type BroadcastBackplaneConfig =
  | { driver: 'redis'; url?: string; channel?: string; client?: any; subscriber?: any; historyLimit?: number; historyTtlSeconds?: number }
  | { driver: 'memory' };

export interface BroadcastBackplaneMessage {
  id: string;
  origin: string;
  channel: string;
  event: string;
  data: any;
  targetUserId?: string | number;
}

export interface BroadcastBackplane {
  publish(message: BroadcastBackplaneMessage): Promise<void>;
  subscribe(handler: (message: BroadcastBackplaneMessage) => void | Promise<void>): Promise<void>;
  close?(): Promise<void>;
  replay?(channel: string, afterId: string, limit: number): Promise<BroadcastReplay>;
}

/** Channel authorization callback */
export type ChannelAuthCallback = (
  user: any,
  params: Record<string, string>
) => Promise<boolean | Record<string, any>> | boolean | Record<string, any>;

/** Presence channel member info */
export interface PresenceMember {
  id: string | number;
  [key: string]: any;
}

type Subscriber = {
  connection: SseConnection;
  userId?: string | number;
  userInfo?: Record<string, any>;
};

export class MemoryBroadcastBackplane implements BroadcastBackplane {
  private handlers = new Set<(message: BroadcastBackplaneMessage) => void | Promise<void>>();
  private history = new Map<string, BroadcastBackplaneMessage[]>();

  async publish(message: BroadcastBackplaneMessage): Promise<void> {
    const history = this.history.get(message.channel) ?? [];
    history.push(structuredClone(message));
    if (history.length > 1000) history.shift();
    this.history.set(message.channel, history);
    for (const handler of this.handlers) {
      await handler(message);
    }
  }

  async subscribe(handler: (message: BroadcastBackplaneMessage) => void | Promise<void>): Promise<void> {
    this.handlers.add(handler);
  }

  async close(): Promise<void> {
    this.handlers.clear();
    this.history.clear();
  }

  async replay(channel: string, afterId: string, limit: number): Promise<BroadcastReplay> {
    const history = this.history.get(channel) ?? [];
    const index = history.findIndex((message) => message.id === afterId);
    if (index < 0 || history.length - index - 1 > limit) return { messages: [], reset: true };
    return { messages: structuredClone(history.slice(index + 1)), reset: false };
  }
}

export class RedisBroadcastBackplane implements BroadcastBackplane {
  private channel: string;
  private publisher: any;
  private subscriber: any;
  private ownsPublisher = false;
  private ownsSubscriber = false;
  private subscribed = false;
  private historyLimit: number;
  private historyTtlSeconds: number;

  constructor(config: Extract<BroadcastBackplaneConfig, { driver: 'redis' }> = { driver: 'redis' }) {
    this.channel = config.channel ?? 'svelar:broadcasting:sse';
    this.historyLimit = config.historyLimit ?? 1000;
    this.historyTtlSeconds = config.historyTtlSeconds ?? 3600;
    if (!Number.isSafeInteger(this.historyLimit) || this.historyLimit < 1 || this.historyLimit > 10_000 ||
      !Number.isSafeInteger(this.historyTtlSeconds) || this.historyTtlSeconds < 1 || this.historyTtlSeconds > 86_400) throw new RangeError('Invalid SSE replay retention.');
    this.publisher = config.client;
    this.subscriber = config.subscriber;

    if (!this.publisher || !this.subscriber) {
      const RedisCtor = this.loadRedis();
      if (!this.publisher) {
        this.publisher = new RedisCtor(config.url);
        this.ownsPublisher = true;
      }
      if (!this.subscriber) {
        this.subscriber = new RedisCtor(config.url);
        this.ownsSubscriber = true;
      }
    }
  }

  async publish(message: BroadcastBackplaneMessage): Promise<void> {
    const payload = JSON.stringify(message);
    if (Buffer.byteLength(payload) > 1_048_576) throw new RangeError('SSE event exceeds the 1 MiB limit.');
    message.id = String(await this.publisher.eval(`
      local id = redis.call('XADD', KEYS[1], 'MAXLEN', '=', ARGV[2], '*', 'message', ARGV[1])
      redis.call('EXPIRE', KEYS[1], ARGV[3])
      redis.call('PUBLISH', ARGV[4], '{"id":"' .. id .. '","message":' .. ARGV[1] .. '}')
      return id
    `, 1, this.historyKey(message.channel), payload, this.historyLimit, this.historyTtlSeconds, this.channel));
  }

  async replay(channel: string, afterId: string, limit: number): Promise<BroadcastReplay> {
    if (!/^\d{1,20}-\d{1,20}$/.test(afterId) || !Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) return { messages: [], reset: true };
    const key = this.historyKey(channel);
    const cursor = await this.publisher.xrange(key, afterId, afterId, 'COUNT', 1);
    if (!cursor.length) return { messages: [], reset: true };
    const rows = await this.publisher.xrange(key, `(${afterId}`, '+', 'COUNT', limit + 1);
    if (rows.length > limit) return { messages: [], reset: true };
    return { reset: false, messages: rows.map(([id, fields]: [string, string[]]) => ({ ...JSON.parse(fields[1]), id })) };
  }

  private historyKey(channel: string): string {
    return `${this.channel}:history:${createHash('sha256').update(channel).digest('hex')}`;
  }

  async subscribe(handler: (message: BroadcastBackplaneMessage) => void | Promise<void>): Promise<void> {
    if (this.subscribed) return;
    this.subscribed = true;
    this.subscriber.on('message', async (channel: string, payload: string) => {
      if (channel !== this.channel) return;
      try {
        const decoded = JSON.parse(payload);
        const message = decoded.message ? { ...decoded.message, id: decoded.id } : decoded;
        await handler(message);
      } catch {
        // Ignore malformed backplane messages. A bad publisher should not kill subscribers.
      }
    });
    await this.subscriber.subscribe(this.channel);
  }

  async close(): Promise<void> {
    if (this.subscribed) {
      try { await this.subscriber.unsubscribe(this.channel); } catch {}
      this.subscribed = false;
    }
    if (this.ownsSubscriber) await this.subscriber.quit?.();
    if (this.ownsPublisher) await this.publisher.quit?.();
  }

  private loadRedis(): any {
    try {
      const require = createRequire(import.meta.url);
      const mod = require('ioredis');
      return mod.default ?? mod;
    } catch {
      throw new Error('Redis broadcast backplane requires optional dependency "ioredis".');
    }
  }
}

function validateDriverConfig(name: string, config: BroadcastDriverConfig): void {
  switch (config.driver) {
    case 'sse':
    case 'log':
      return;
    case 'pusher': {
      const missing = ['key', 'secret', 'appId'].filter((field) => !(config as any)[field]);
      if (missing.length > 0) {
        throw new Error(`Broadcast driver "${name}" is missing required Pusher config: ${missing.join(', ')}`);
      }
      return;
    }
    default:
      throw new Error(`Unknown broadcast driver "${(config as any).driver}" for "${name}".`);
  }
}

// ── Channel Types ─────────────────────────────────────────

export type ChannelType = 'public' | 'private' | 'presence';

/**
 * Determine channel type from its name.
 * - 'private-xxx' → private
 * - 'presence-xxx' → presence
 * - anything else → public
 */
export function channelType(name: string): ChannelType {
  if (name.startsWith('private-')) return 'private';
  if (name.startsWith('presence-')) return 'presence';
  return 'public';
}

// ── SSE Channel ───────────────────────────────────────────

class SSEChannel {
  private subscribers: Subscriber[] = [];
  private history: BroadcastBackplaneMessage[] = [];
  readonly name: string;
  readonly type: ChannelType;

  constructor(name: string, private replay?: (cursor: string, limit: number) => Promise<BroadcastReplay>,
    private ready?: () => Promise<void>, private feedback?: (kind: 'replay' | 'reset' | 'backpressure', count: number) => void) {
    this.name = name;
    this.type = channelType(name);
  }

  /**
   * Create an SSE streaming response for this channel.
   * For private/presence channels, authorization must be checked BEFORE calling this.
   */
  stream(userId?: string | number, userInfo?: Record<string, any>, options: SseStreamOptions = {}): Response {
    const initial: Record<string, unknown> = { channel: this.name };
    if (this.type === 'presence') initial.members = this.getMembers();
    return createSseStream({ initial, userId, ready: this.ready,
      replay: (cursor, limit) => this.replay ? this.replay(cursor, limit) : this.localReplay(cursor, limit),
      onReplay: (count, reset) => this.feedback?.(reset ? 'reset' : 'replay', count),
      onClose: (reason) => { if (reason === 'backpressure') this.feedback?.('backpressure', 1); },
      register: (connection) => {
        const subscriber = { connection, userId, userInfo };
        this.subscribers.push(subscriber);
        if (this.type === 'presence' && userId !== undefined) this.sendInternal('member:joined', { id: userId, ...userInfo }, subscriber);
        return () => {
          this.subscribers = this.subscribers.filter((entry) => entry !== subscriber);
          if (this.type === 'presence' && userId !== undefined) this.sendInternal('member:left', { id: userId, ...userInfo });
        };
      },
    }, options);
  }

  /**
   * Send an event to all subscribers
   */
  send(event: string, data: any, targetUserId?: string | number, id: string = randomUUID()): void {
    assertSseEvent(event, id);
    this.history.push({ id, channel: this.name, origin: 'local', event, data: structuredClone(data), targetUserId });
    if (this.history.length > 1000) this.history.shift();
    for (const subscriber of [...this.subscribers]) {
      if (targetUserId !== undefined && String(subscriber.userId) !== String(targetUserId)) continue;
      subscriber.connection.send({ event, data, id });
    }
  }

  async localReplay(cursor: string, limit: number): Promise<BroadcastReplay> {
    const index = this.history.findIndex((message) => message.id === cursor);
    if (index < 0 || this.history.length - index - 1 > limit) return { messages: [], reset: true };
    return { messages: structuredClone(this.history.slice(index + 1)), reset: false };
  }

  drain(): void { for (const subscriber of [...this.subscribers]) subscriber.connection.close('drain'); }

  /** Internal send that excludes a specific subscriber (for join/leave events) */
  private sendInternal(event: string, data: any, exclude?: Subscriber): void {
    for (const subscriber of [...this.subscribers]) {
      if (subscriber === exclude) continue;
      subscriber.connection.send({ event, data });
    }
  }

  /**
   * Send to a specific user in this channel
   */
  toUser(userId: string | number): { send: (event: string, data: any) => void } {
    return {
      send: (event: string, data: any) => this.send(event, data, userId),
    };
  }

  /**
   * Get the number of active subscribers
   */
  subscriberCount(): number {
    return this.subscribers.length;
  }

  /**
   * Get presence members (for presence channels)
   */
  getMembers(): PresenceMember[] {
    if (this.type !== 'presence') return [];
    return this.subscribers
      .filter((s) => s.userId !== undefined)
      .map((s) => ({ id: s.userId!, ...(s.userInfo ?? {}) }));
  }

  /**
   * Check if a user is present in this channel
   */
  hasMember(userId: string | number): boolean {
    return this.subscribers.some((s) => s.userId === userId);
  }

  /**
   * Whisper — send a client event to other users (not from server).
   * Useful for typing indicators, cursor positions, etc.
   */
  whisper(event: string, data: any, fromUserId: string | number): void {
    assertSseEvent(`client-${event}`);
    for (const subscriber of [...this.subscribers]) {
      if (subscriber.userId === fromUserId) continue; // Don't echo back
      subscriber.connection.send({ event: `client-${event}`, data });
    }
  }
}

// ── Pusher Driver ─────────────────────────────────────────

/**
 * Pusher/Soketi broadcast driver.
 * Sends events via HTTP API (compatible with Pusher and Soketi).
 * Clients connect using pusher-js.
 */
class PusherDriver {
  private config: Extract<BroadcastDriverConfig, { driver: 'pusher' }>;

  constructor(config: Extract<BroadcastDriverConfig, { driver: 'pusher' }>) {
    this.config = config;
  }

  /**
   * Send an event via the Pusher HTTP API
   */
  async send(channels: string | string[], event: string, data: any): Promise<void> {
    const channelList = Array.isArray(channels) ? channels : [channels];
    const body = JSON.stringify({
      name: event,
      channels: channelList,
      data: JSON.stringify(data),
    });

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const md5Body = await this.md5(body);

    const stringToSign = [
      'POST',
      `/apps/${this.config.appId}/events`,
      [
        `auth_key=${this.config.key}`,
        `auth_timestamp=${timestamp}`,
        `auth_version=1.0`,
        `body_md5=${md5Body}`,
      ].join('&'),
    ].join('\n');

    const signature = await this.hmacSha256(this.config.secret, stringToSign);

    const protocol = this.config.useTLS !== false ? 'https' : 'http';
    const host = this.config.host ?? `api-${this.config.cluster ?? 'mt1'}.pusher.com`;
    const port = this.config.port ?? (this.config.useTLS !== false ? 443 : 80);

    const url = `${protocol}://${host}:${port}/apps/${this.config.appId}/events?auth_key=${this.config.key}&auth_timestamp=${timestamp}&auth_version=1.0&body_md5=${md5Body}&auth_signature=${signature}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Pusher API error (${response.status}): ${text}`);
    }
  }

  /**
   * Generate auth signature for private/presence channel subscriptions.
   * Used in the channel authorization endpoint.
   */
  async authenticate(
    socketId: string,
    channelName: string,
    presenceData?: { user_id: string | number; user_info?: Record<string, any> }
  ): Promise<{ auth: string; channel_data?: string }> {
    let stringToSign = `${socketId}:${channelName}`;
    let channelData: string | undefined;

    if (presenceData) {
      channelData = JSON.stringify(presenceData);
      stringToSign += `:${channelData}`;
    }

    const signature = await this.hmacSha256(this.config.secret, stringToSign);
    const auth = `${this.config.key}:${signature}`;

    return channelData ? { auth, channel_data: channelData } : { auth };
  }

  /** Get the Pusher app key (needed by clients) */
  get key(): string {
    return this.config.key;
  }

  /** Get connection config for the client */
  clientConfig(): Record<string, any> {
    const cfg: Record<string, any> = {
      key: this.config.key,
      cluster: this.config.cluster ?? 'mt1',
    };

    if (this.config.host) {
      cfg.wsHost = this.config.host;
      cfg.wsPort = this.config.port ?? 6001;
      cfg.wssPort = this.config.port ?? 6001;
      cfg.forceTLS = this.config.useTLS ?? false;
      cfg.enabledTransports = ['ws', 'wss'];
      cfg.disableStats = true;
    }

    return cfg;
  }

  private async md5(data: string): Promise<string> {
    const { createHash } = await import('node:crypto');
    return createHash('md5').update(data).digest('hex');
  }

  private async hmacSha256(secret: string, data: string): Promise<string> {
    const { createHmac } = await import('node:crypto');
    return createHmac('sha256', secret).update(data).digest('hex');
  }
}

// ── Event Builder ─────────────────────────────────────────

class BroadcastEventBuilder {
  private channels: string[] = [];

  constructor(
    private manager: BroadcastManager,
    private eventName: string,
    private eventData: any
  ) {}

  /** Specify which channel(s) to broadcast on */
  on(...channels: string[]): BroadcastEventBuilder {
    this.channels.push(...channels);
    return this;
  }

  /** Send the event to all specified channels */
  async send(): Promise<void> {
    for (const channel of this.channels) {
      await this.manager.sendToChannel(channel, this.eventName, this.eventData);
    }
  }
}

// ── Broadcast Manager ──────────────────────────────────────

class BroadcastManager {
  private config: BroadcastConfig = {
    default: 'sse',
    drivers: { sse: { driver: 'sse' } },
  };

  private sseChannels = new Map<string, SSEChannel>();
  private channelAuth = new Map<string, ChannelAuthCallback>();
  private pusherDriver: PusherDriver | null = null;
  private backplane: BroadcastBackplane | null = null;
  private backplaneSubscribed = false;
  private subscribing?: Promise<void>;
  private draining = false;
  private streamMetrics = { replayed: 0, resets: 0, backpressureClosed: 0 };
  private origin = randomUUID();

  /**
   * Configure broadcasting drivers.
   */
  configure(config: BroadcastConfig): void {
    const defaultConfig = config.drivers[config.default];
    if (!defaultConfig) {
      throw new Error(`Broadcast default driver "${config.default}" is not defined.`);
    }

    for (const [name, driverConfig] of Object.entries(config.drivers)) {
      validateDriverConfig(name, driverConfig);
    }

    this.config = config;
    this.draining = false;
    this.pusherDriver = null;
    this.backplaneSubscribed = false;

    if (defaultConfig.driver === 'pusher') {
      this.pusherDriver = new PusherDriver(defaultConfig);
    }

    if (defaultConfig.driver === 'sse' && defaultConfig.backplane) {
      this.useBackplane(this.makeBackplane(defaultConfig.backplane));
    } else {
      const oldBackplane = this.backplane;
      this.backplane = null;
      this.backplaneSubscribed = false;
      void oldBackplane?.close?.();
    }
  }

  useBackplane(backplane: BroadcastBackplane): void {
    this.backplane = backplane;
    this.backplaneSubscribed = false;
    this.subscribing = undefined;
    void this.ensureBackplaneSubscribed().catch(() => { console.error('[Broadcast] SSE backplane subscription unavailable.'); });
  }

  async closeBackplane(): Promise<void> {
    await this.backplane?.close?.();
    this.backplane = null;
    this.backplaneSubscribed = false;
    this.subscribing = undefined;
  }

  async ready(): Promise<void> { await this.ensureBackplaneSubscribed(); }

  /** Disconnect SSE streams before terminating a replica; clients reconnect and reauthorize elsewhere. */
  async drain(): Promise<void> {
    this.draining = true;
    for (const channel of this.sseChannels.values()) channel.drain();
    await this.closeBackplane();
  }

  metrics() { return { ...this.streamMetrics, subscribers: this.totalSubscribers(), channels: this.sseChannels.size, draining: this.draining }; }

  // ── Channel Authorization ──

  /**
   * Register an authorization callback for a private or presence channel.
   * Pattern supports `{param}` placeholders that are extracted from the channel name.
   *
   * Return `true` for private channels to allow access.
   * Return an object with user info for presence channels (or `false` to deny).
   *
   * @example
   * // Private channel
   * Broadcast.channel('private-orders.{orderId}', async (user, { orderId }) => {
   *   const order = await Order.findOrFail(orderId);
   *   return order.user_id === user.id;
   * });
   *
   * // Presence channel — return user info to share with other members
   * Broadcast.channel('presence-chat.{roomId}', async (user, { roomId }) => {
   *   const room = await ChatRoom.findOrFail(roomId);
   *   if (!room.hasMember(user.id)) return false;
   *   return { id: user.id, name: user.name, avatar: user.avatar };
   * });
   */
  channel(pattern: string, callback: ChannelAuthCallback): void;

  /**
   * Get or create an SSE channel for subscribing.
   */
  channel(name: string): SSEChannel;

  channel(nameOrPattern: string, callback?: ChannelAuthCallback): SSEChannel | void {
    if (callback) {
      // Register authorization callback
      this.channelAuth.set(nameOrPattern, callback);
      return;
    }

    // Get or create SSE channel
    if (!this.sseChannels.has(nameOrPattern)) {
      if (!nameOrPattern || nameOrPattern.length > 255 || /[\r\n\0]/.test(nameOrPattern)) throw new TypeError('Invalid broadcast channel name.');
      this.sseChannels.set(nameOrPattern, new SSEChannel(nameOrPattern,
        async (cursor, limit) => this.backplane?.replay ? this.backplane.replay(nameOrPattern, cursor, limit) : this.sseChannels.get(nameOrPattern)!.localReplay(cursor, limit),
        () => this.ready(), (kind, count) => {
          if (kind === 'replay') this.streamMetrics.replayed += count;
          if (kind === 'reset') this.streamMetrics.resets++;
          if (kind === 'backpressure') this.streamMetrics.backpressureClosed += count;
        }));
    }
    return this.sseChannels.get(nameOrPattern)!;
  }

  /**
   * Authorize a user to subscribe to a private or presence channel.
   * Called from your channel authorization endpoint.
   *
   * Returns `false` if denied, `true` for private channels,
   * or a presence member object for presence channels.
   */
  async authorize(
    channelName: string,
    user: any
  ): Promise<false | true | Record<string, any>> {
    const type = channelType(channelName);

    // Public channels don't need authorization
    if (type === 'public') return true;

    // Find matching auth callback
    for (const [pattern, callback] of this.channelAuth) {
      const params = this.matchPattern(pattern, channelName);
      if (params !== null) {
        const result = await callback(user, params);
        return result;
      }
    }

    // No matching auth rule — deny by default
    return false;
  }

  /**
   * Authenticate a Pusher channel subscription.
   * Use this in your channel auth endpoint for Pusher/Soketi.
   *
   * @example
   * // src/routes/api/broadcasting/auth/+server.ts
   * export const POST: RequestHandler = async ({ request, locals }) => {
   *   if (!locals.user) return new Response('Unauthorized', { status: 401 });
   *
   *   const form = await request.formData();
   *   const socketId = form.get('socket_id') as string;
   *   const channelName = form.get('channel_name') as string;
   *
   *   const auth = await Broadcast.authenticatePusher(channelName, socketId, locals.user);
   *   if (!auth) return new Response('Forbidden', { status: 403 });
   *
   *   return new Response(JSON.stringify(auth), {
   *     headers: { 'Content-Type': 'application/json' },
   *   });
   * };
   */
  async authenticatePusher(
    channelName: string,
    socketId: string,
    user: any
  ): Promise<{ auth: string; channel_data?: string } | false> {
    if (!this.pusherDriver) {
      throw new Error('Pusher driver is not configured. Call Broadcast.configure() first.');
    }

    const type = channelType(channelName);

    // Public channels don't need auth
    if (type === 'public') return false;

    // Check authorization
    const result = await this.authorize(channelName, user);
    if (result === false) return false;

    if (type === 'presence') {
      // Presence channels need user data
      const presenceData = typeof result === 'object'
        ? { user_id: result.id ?? user.id, user_info: result }
        : { user_id: user.id, user_info: { id: user.id } };

      return this.pusherDriver.authenticate(socketId, channelName, presenceData);
    }

    // Private channel
    return this.pusherDriver.authenticate(socketId, channelName);
  }

  // ── Broadcasting Events ──

  /**
   * Create an event builder for fluent broadcasting.
   *
   * @example
   * Broadcast.event('OrderShipped', { orderId: 123 })
   *   .on('private-orders.123')
   *   .send();
   */
  event(name: string, data: any): BroadcastEventBuilder {
    return new BroadcastEventBuilder(this, name, data);
  }

  /**
   * Shorthand — get a sender for a channel.
   *
   * @example
   * Broadcast.to('private-orders.123').send('OrderShipped', { orderId: 123 });
   * Broadcast.to('notifications', userId).send('new-message', { text: 'Hello!' });
   */
  to(channelName: string, userId?: string | number): { send: (event: string, data: any) => Promise<void> } {
    return {
      send: async (event: string, data: any) => {
        await this.sendToChannel(channelName, event, data, userId);
      },
    };
  }

  /**
   * Send an event to a channel. Used internally and by the event builder.
   * Routes to the appropriate driver.
   */
  async sendToChannel(
    channelName: string,
    event: string,
    data: any,
    targetUserId?: string | number
  ): Promise<void> {
    const driverConfig = this.config.drivers[this.config.default];
    if (!driverConfig) {
      throw new Error(`Broadcast default driver "${this.config.default}" is not defined.`);
    }

    switch (driverConfig?.driver) {
      case 'pusher':
        if (!this.pusherDriver) {
          this.pusherDriver = new PusherDriver(driverConfig);
        }
        await this.pusherDriver.send(channelName, event, data);
        break;

      case 'log':
        console.log(`[Broadcast] ${channelName} → ${event}:`, JSON.stringify(data));
        break;

      case 'sse':
        assertSseEvent(event);
        const encoded = JSON.stringify(data);
        if (encoded === undefined || Buffer.byteLength(encoded) > 1_048_576) throw new RangeError('SSE payload must be JSON within 1 MiB.');
        const message: BroadcastBackplaneMessage = { id: randomUUID(), origin: this.origin, channel: channelName, event, data, targetUserId };
        if (this.backplane) {
          await this.ensureBackplaneSubscribed();
          await this.backplane.publish(message);
        }
        this.sendLocalSse(channelName, event, data, targetUserId, message.id);
        break;

      default:
        throw new Error(`Unknown broadcast driver "${(driverConfig as any).driver}".`);
    }
  }

  // ── SSE Helpers ──

  /**
   * Subscribe to an SSE channel. For private/presence channels,
   * call `authorize()` first and check the result before calling `subscribe()`.
   *
   * @example
   * // Public channel
   * return Broadcast.subscribe('updates');
   *
   * // Private channel (check auth first)
   * const allowed = await Broadcast.authorize('private-orders.123', locals.user);
   * if (!allowed) return new Response('Forbidden', { status: 403 });
   * return Broadcast.subscribe('private-orders.123', locals.user.id);
   *
   * // Presence channel (pass user info for member tracking)
   * const presenceInfo = await Broadcast.authorize('presence-chat.1', locals.user);
   * if (!presenceInfo) return new Response('Forbidden', { status: 403 });
   * return Broadcast.subscribe('presence-chat.1', locals.user.id, presenceInfo);
   */
  subscribe(
    channelName: string,
    userId?: string | number,
    userInfo?: Record<string, any>,
    options: SseStreamOptions = {}
  ): Response {
    if (this.draining) return new Response(null, { status: 503, headers: { 'Retry-After': '1', 'Cache-Control': 'no-store' } });
    const ch = this.channel(channelName) as SSEChannel;
    return ch.stream(userId, userInfo, options);
  }

  // ── Presence Helpers ──

  /**
   * Get members of a presence channel (SSE driver only)
   */
  members(channelName: string): PresenceMember[] {
    const ch = this.sseChannels.get(channelName);
    if (!ch) return [];
    return ch.getMembers();
  }

  // ── Pusher Helpers ──

  /**
   * Get the Pusher driver instance (for advanced usage)
   */
  pusher(): PusherDriver {
    if (!this.pusherDriver) {
      throw new Error('Pusher driver is not configured.');
    }
    return this.pusherDriver;
  }

  // ── Info & Cleanup ──

  /**
   * Get all active channel names
   */
  activeChannels(): string[] {
    return [...new Set([...this.sseChannels.values()].map((c) => c.name))];
  }

  /**
   * Get total subscriber count across all SSE channels
   */
  totalSubscribers(): number {
    let count = 0;
    for (const channel of this.sseChannels.values()) {
      count += channel.subscriberCount();
    }
    return count;
  }

  /**
   * Remove empty SSE channels (cleanup)
   */
  prune(): void {
    for (const [key, channel] of this.sseChannels) {
      if (channel.subscriberCount() === 0) {
        this.sseChannels.delete(key);
      }
    }
  }

  private makeBackplane(config: BroadcastBackplaneConfig): BroadcastBackplane {
    if (config.driver === 'memory') return new MemoryBroadcastBackplane();
    return new RedisBroadcastBackplane(config);
  }

  private sendLocalSse(channelName: string, event: string, data: any, targetUserId?: string | number, id?: string): void {
    (this.channel(channelName) as SSEChannel).send(event, data, targetUserId, id);
  }

  private async ensureBackplaneSubscribed(): Promise<void> {
    if (!this.backplane || this.backplaneSubscribed) return;
    if (this.subscribing) return this.subscribing;
    const backplane = this.backplane;
    this.subscribing = backplane.subscribe((message) => {
      if (message.origin === this.origin) return;
      assertSseEvent(message.event, message.id);
      this.sendLocalSse(message.channel, message.event, message.data, message.targetUserId, message.id);
    }).then(() => { if (this.backplane === backplane) this.backplaneSubscribed = true; })
      .finally(() => { if (this.backplane === backplane) this.subscribing = undefined; });
    return this.subscribing;
  }

  // ── Pattern Matching ──

  /**
   * Match a channel pattern like 'private-orders.{orderId}'
   * against a channel name like 'private-orders.123'.
   * Returns extracted params or null if no match.
   */
  private matchPattern(pattern: string, channelName: string): Record<string, string> | null {
    // Convert pattern to regex: 'private-orders.{orderId}' → /^private-orders\.([^.]+)$/
    const paramNames: string[] = [];
    const regexStr = pattern
      .replace(/[.*+?^${}()|[\]\\]/g, (match) => {
        // Don't escape our {param} placeholders
        if (match === '{' || match === '}') return match;
        return `\\${match}`;
      })
      .replace(/\\\{(\w+)\\\}/g, (_, name) => { // Fix: handle already-escaped braces
        paramNames.push(name);
        return '([^.]+)';
      })
      .replace(/\{(\w+)\}/g, (_, name) => {
        paramNames.push(name);
        return '([^.]+)';
      })
      .replace(/\\\*/g, () => {
        paramNames.push(String(paramNames.length));
        return '(.+)';
      });

    const regex = new RegExp(`^${regexStr}$`);
    const match = channelName.match(regex);

    if (!match) return null;

    const params: Record<string, string> = {};
    for (let i = 0; i < paramNames.length; i++) {
      params[paramNames[i]] = match[i + 1];
    }
    return params;
  }
}

import { singleton } from '../support/singleton.js';

/**
 * Global Broadcast singleton
 */
export const Broadcast = singleton('svelar.broadcast', () => new BroadcastManager());

export { BroadcastingController, InternalBroadcastDto, InternalBroadcastRequest, PublishInternalBroadcastAction, internalBroadcastSchema } from './Controller.js';
