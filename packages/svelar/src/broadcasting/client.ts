/**
 * Svelar Broadcasting — Client-Side Helper
 *
 * Provides a reactive Svelte-friendly wrapper around pusher-js for
 * real-time WebSocket communication with Soketi/Pusher, plus an SSE
 * client for the zero-dependency driver.
 *
 * @example
 * ```svelte
 * <script>
 * import { usePusher, useChannel, usePresenceChannel } from '@beeblock/svelar/broadcasting/client';
 *
 * // Initialize once (e.g. in +layout.svelte)
 * const echo = usePusher({
 *   key: 'svelar-key',
 *   wsHost: 'localhost',
 *   wsPort: 6001,
 *   forceTLS: false,
 *   authEndpoint: '/api/broadcasting/auth',
 * });
 *
 * // Subscribe to channels
 * const orders = useChannel('private-orders.123');
 * const chat = usePresenceChannel('presence-chat.5');
 *
 * // Listen for events
 * $effect(() => {
 *   orders.listen('OrderShipped', (data) => {
 *     console.log('Shipped:', data);
 *   });
 * });
 * </script>
 * ```
 *
 * @module @beeblock/svelar/broadcasting/client
 */

import Pusher from 'pusher-js';

// ── Types ──────────────────────────────────────────────────

export interface PusherOptions {
  /** Pusher/Soketi app key */
  key: string;
  /** Pusher cluster (ignored when wsHost is set) */
  cluster?: string;
  /** WebSocket host (e.g. 'localhost' for Soketi) */
  wsHost?: string;
  /** WebSocket port (e.g. 6001 for Soketi) */
  wsPort?: number;
  /** Secure WebSocket port */
  wssPort?: number;
  /** Force TLS (default: false for Soketi) */
  forceTLS?: boolean;
  /** Auth endpoint for private/presence channels */
  authEndpoint?: string;
  /** Custom auth headers */
  authHeaders?: Record<string, string>;
  /** Enable debug logging */
  debug?: boolean;
  /** Enabled transports (default: ['ws', 'wss']) */
  enabledTransports?: string[];
}

export interface ChannelInstance {
  /** Listen for an event on this channel */
  listen(event: string, callback: (data: any) => void): ChannelInstance;
  /** Stop listening for a specific event */
  stopListening(event: string): ChannelInstance;
  /** Send a client event (whisper) to other channel members */
  whisper(event: string, data: any): ChannelInstance;
  /** Unsubscribe from this channel */
  leave(): void;
  /** The raw pusher-js channel object */
  readonly raw: any;
}

export interface PresenceChannelInstance extends ChannelInstance {
  /** Called when the initial member list is received */
  here(callback: (members: any[]) => void): PresenceChannelInstance;
  /** Called when a new member joins */
  joining(callback: (member: any) => void): PresenceChannelInstance;
  /** Called when a member leaves */
  leaving(callback: (member: any) => void): PresenceChannelInstance;
}

export interface SSEChannelInstance {
  /** Listen for a named event */
  listen(event: string, callback: (data: any) => void): SSEChannelInstance;
  /** Stop listening for a specific event */
  stopListening(event: string): SSEChannelInstance;
  /** Close the SSE connection */
  close(): void;
  /** The raw EventSource object */
  readonly raw: EventSource;
}

// ── Pusher Client Wrapper ──────────────────────────────────

let _pusherInstance: any = null;
let _pusherOptions: PusherOptions | null = null;

/**
 * Initialize and return a Pusher client singleton.
 * Call this once in your root layout or app init.
 *
 * Uses the Pusher client bundled with Svelar.
 *
 * @example
 * ```svelte
 * <!-- +layout.svelte -->
 * <script>
 * import { usePusher } from '@beeblock/svelar/broadcasting/client';
 *
 * const echo = usePusher({
 *   key: 'svelar-key',
 *   wsHost: 'localhost',
 *   wsPort: 6001,
 *   forceTLS: false,
 *   authEndpoint: '/api/broadcasting/auth',
 * });
 * </script>
 * ```
 */
export function usePusher(options: PusherOptions): { disconnect: () => void; raw: any } {
  if (_pusherInstance) {
    return { disconnect: () => _pusherInstance?.disconnect(), raw: _pusherInstance };
  }

  _pusherOptions = options;

  const config: Record<string, any> = {
    cluster: options.cluster ?? 'mt1',
    authEndpoint: options.authEndpoint ?? '/api/broadcasting/auth',
  };

  if (options.wsHost) {
    config.wsHost = options.wsHost;
    config.wsPort = options.wsPort ?? 6001;
    config.wssPort = options.wssPort ?? options.wsPort ?? 6001;
    config.forceTLS = options.forceTLS ?? false;
    config.enabledTransports = options.enabledTransports ?? ['ws', 'wss'];
    config.disableStats = true;
  }

  if (options.authHeaders) {
    config.auth = { headers: options.authHeaders };
  }

  if (options.debug) {
    (Pusher as any).logToConsole = true;
  }

  _pusherInstance = new (Pusher as any)(options.key, config);

  return {
    disconnect: () => {
      _pusherInstance?.disconnect();
      _pusherInstance = null;
    },
    raw: _pusherInstance,
  };
}

/**
 * Get the current Pusher instance (must call usePusher first).
 */
export function getPusher(): any {
  if (!_pusherInstance) {
    throw new Error('Pusher not initialized. Call usePusher() first.');
  }
  return _pusherInstance;
}

/**
 * Subscribe to a channel (public or private).
 *
 * @example
 * ```svelte
 * <script>
 * import { useChannel } from '@beeblock/svelar/broadcasting/client';
 *
 * const channel = useChannel('private-orders.123');
 *
 * $effect(() => {
 *   channel.listen('OrderShipped', (data) => {
 *     console.log('Shipped!', data);
 *   });
 *
 *   return () => channel.leave();
 * });
 * </script>
 * ```
 */
export function useChannel(channelName: string): ChannelInstance {
  const pusher = getPusher();
  const channel = pusher.subscribe(channelName);

  return createChannelInstance(channel, channelName);
}

/**
 * Subscribe to a presence channel with member tracking.
 *
 * @example
 * ```svelte
 * <script>
 * import { usePresenceChannel } from '@beeblock/svelar/broadcasting/client';
 *
 * let members = $state([]);
 *
 * const chat = usePresenceChannel('presence-chat.5');
 *
 * $effect(() => {
 *   chat
 *     .here((m) => { members = m; })
 *     .joining((m) => { members = [...members, m]; })
 *     .leaving((m) => { members = members.filter(x => x.id !== m.id); })
 *     .listen('new-message', (data) => {
 *       console.log('Message:', data);
 *     });
 *
 *   return () => chat.leave();
 * });
 * </script>
 * ```
 */
export function usePresenceChannel(channelName: string): PresenceChannelInstance {
  const pusher = getPusher();

  // Ensure the channel name has the presence- prefix
  const fullName = channelName.startsWith('presence-') ? channelName : `presence-${channelName}`;
  const channel = pusher.subscribe(fullName);

  const base = createChannelInstance(channel, fullName);

  return {
    ...base,
    here(callback: (members: any[]) => void): PresenceChannelInstance {
      channel.bind('pusher:subscription_succeeded', (members: any) => {
        const list: any[] = [];
        members.each((member: any) => list.push(member.info));
        callback(list);
      });
      return this;
    },
    joining(callback: (member: any) => void): PresenceChannelInstance {
      channel.bind('pusher:member_added', (member: any) => {
        callback(member.info);
      });
      return this;
    },
    leaving(callback: (member: any) => void): PresenceChannelInstance {
      channel.bind('pusher:member_removed', (member: any) => {
        callback(member.info);
      });
      return this;
    },
  };
}

/**
 * Leave (unsubscribe from) a channel.
 */
export function leaveChannel(channelName: string): void {
  const pusher = getPusher();
  pusher.unsubscribe(channelName);
}

// ── SSE Client ─────────────────────────────────────────────

/**
 * Subscribe to an SSE channel (for the SSE broadcast driver).
 * No Soketi or Pusher server required.
 *
 * @param channelName - The channel to subscribe to
 * @param baseUrl - Base URL for the SSE endpoint (default: '/api/broadcasting')
 *
 * @example
 * ```svelte
 * <script>
 * import { useSSE } from '@beeblock/svelar/broadcasting/client';
 *
 * const channel = useSSE('private-orders.123');
 *
 * $effect(() => {
 *   channel.listen('OrderShipped', (data) => {
 *     console.log('Shipped!', data);
 *   });
 *
 *   return () => channel.close();
 * });
 * </script>
 * ```
 */
export function useSSE(channelName: string, baseUrl = '/api/broadcasting'): SSEChannelInstance {
  const url = `${baseUrl}/${encodeURIComponent(channelName)}`;
  const source = new EventSource(url);
  const listeners = new Map<string, (e: MessageEvent) => void>();

  return {
    listen(event: string, callback: (data: any) => void): SSEChannelInstance {
      const handler = (e: MessageEvent) => {
        try {
          callback(JSON.parse(e.data));
        } catch {
          callback(e.data);
        }
      };
      listeners.set(event, handler);
      source.addEventListener(event, handler);
      return this;
    },

    stopListening(event: string): SSEChannelInstance {
      const handler = listeners.get(event);
      if (handler) {
        source.removeEventListener(event, handler);
        listeners.delete(event);
      }
      return this;
    },

    close(): void {
      source.close();
      listeners.clear();
    },

    get raw(): EventSource {
      return source;
    },
  };
}

// ── Helper ─────────────────────────────────────────────────

function createChannelInstance(channel: any, channelName: string): ChannelInstance {
  return {
    listen(event: string, callback: (data: any) => void): ChannelInstance {
      channel.bind(event, callback);
      return this;
    },

    stopListening(event: string): ChannelInstance {
      channel.unbind(event);
      return this;
    },

    whisper(event: string, data: any): ChannelInstance {
      channel.trigger(`client-${event}`, data);
      return this;
    },

    leave(): void {
      if (_pusherInstance) {
        _pusherInstance.unsubscribe(channelName);
      }
    },

    get raw(): any {
      return channel;
    },
  };
}
