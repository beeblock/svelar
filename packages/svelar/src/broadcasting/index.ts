/**
 * Svelar Broadcasting
 *
 * Real-time event broadcasting via Server-Sent Events (SSE).
 * No external dependencies — works with SvelteKit's streaming responses.
 *
 * @example
 * ```ts
 * // Server: src/routes/api/events/+server.ts
 * import { Broadcast } from 'svelar/broadcasting';
 *
 * export const GET: RequestHandler = async ({ locals }) => {
 *   return Broadcast.channel('notifications', locals.user.id).stream();
 * };
 *
 * // Server: broadcast from anywhere
 * Broadcast.to('notifications', userId).send('new-message', { text: 'Hello!' });
 *
 * // Client: Svelte component
 * const events = new EventSource('/api/events');
 * events.addEventListener('new-message', (e) => {
 *   const data = JSON.parse(e.data);
 * });
 * ```
 */

// ── Types ──────────────────────────────────────────────────

export interface BroadcastEvent {
  event: string;
  data: any;
  id?: string;
}

type Subscriber = {
  controller: ReadableStreamDefaultController;
  userId?: string | number;
};

// ── Channel ────────────────────────────────────────────────

class BroadcastChannel {
  private subscribers: Subscriber[] = [];
  readonly name: string;
  private userId?: string | number;

  constructor(name: string, userId?: string | number) {
    this.name = name;
    this.userId = userId;
  }

  /**
   * Create an SSE streaming response for this channel
   */
  stream(): Response {
    const channel = this;

    const stream = new ReadableStream({
      start(controller) {
        // Send initial connection event
        const initData = `event: connected\ndata: ${JSON.stringify({ channel: channel.name })}\n\n`;
        controller.enqueue(new TextEncoder().encode(initData));

        // Register subscriber
        const subscriber: Subscriber = { controller, userId: channel.userId };
        channel.subscribers.push(subscriber);
      },
      cancel() {
        // Remove subscriber on disconnect
        channel.subscribers = channel.subscribers.filter(
          (s) => s.userId !== channel.userId
        );
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  /**
   * Send an event to all subscribers in this channel
   */
  send(event: string, data: any, targetUserId?: string | number): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\nid: ${Date.now()}\n\n`;
    const encoded = new TextEncoder().encode(payload);

    for (const subscriber of this.subscribers) {
      // If targeting a specific user, only send to them
      if (targetUserId !== undefined && subscriber.userId !== targetUserId) {
        continue;
      }

      try {
        subscriber.controller.enqueue(encoded);
      } catch {
        // Subscriber disconnected — will be cleaned up
      }
    }
  }

  /**
   * Get the number of active subscribers
   */
  subscriberCount(): number {
    return this.subscribers.length;
  }

  /**
   * Send to a specific user in this channel
   */
  toUser(userId: string | number): { send: (event: string, data: any) => void } {
    return {
      send: (event: string, data: any) => this.send(event, data, userId),
    };
  }
}

// ── Broadcast Manager ──────────────────────────────────────

class BroadcastManager {
  private channels = new Map<string, BroadcastChannel>();

  /**
   * Get or create a channel (optionally bound to a user for subscribing)
   */
  channel(name: string, userId?: string | number): BroadcastChannel {
    const key = userId ? `${name}:${userId}` : name;

    if (!this.channels.has(key)) {
      this.channels.set(key, new BroadcastChannel(name, userId));
    }

    return this.channels.get(key)!;
  }

  /**
   * Send to all subscribers on a channel
   */
  to(channelName: string, userId?: string | number): { send: (event: string, data: any) => void } {
    return {
      send: (event: string, data: any) => {
        // Broadcast to all channel instances matching the name
        for (const [key, channel] of this.channels) {
          if (channel.name === channelName) {
            channel.send(event, data, userId);
          }
        }
      },
    };
  }

  /**
   * Get all active channel names
   */
  activeChannels(): string[] {
    return [...new Set([...this.channels.values()].map((c) => c.name))];
  }

  /**
   * Get total subscriber count across all channels
   */
  totalSubscribers(): number {
    let count = 0;
    for (const channel of this.channels.values()) {
      count += channel.subscriberCount();
    }
    return count;
  }

  /**
   * Remove empty channels (cleanup)
   */
  prune(): void {
    for (const [key, channel] of this.channels) {
      if (channel.subscriberCount() === 0) {
        this.channels.delete(key);
      }
    }
  }
}

import { singleton } from '../support/singleton.js';

/**
 * Global Broadcast singleton
 */
export const Broadcast = singleton('svelar.broadcast', () => new BroadcastManager());
