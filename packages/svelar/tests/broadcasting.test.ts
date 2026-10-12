import { describe, expect, it } from 'vitest';
import { Broadcast, type BroadcastBackplane, type BroadcastBackplaneMessage } from '../src/broadcasting/index.js';

class FakeBackplane implements BroadcastBackplane {
  published: BroadcastBackplaneMessage[] = [];
  handler: ((message: BroadcastBackplaneMessage) => void | Promise<void>) | null = null;

  async publish(message: BroadcastBackplaneMessage): Promise<void> {
    this.published.push(message);
  }

  async subscribe(handler: (message: BroadcastBackplaneMessage) => void | Promise<void>): Promise<void> {
    this.handler = handler;
  }

  async emit(message: BroadcastBackplaneMessage): Promise<void> {
    await this.handler?.(message);
  }
}

async function readChunk(response: Response): Promise<string> {
  const reader = response.body!.getReader();
  const { value } = await reader.read();
  await reader.cancel();
  return new TextDecoder().decode(value);
}

describe('Broadcasting', () => {
  it('throws when the default broadcast driver is not configured', () => {
    expect(() => Broadcast.configure({
      default: 'missing',
      drivers: {
        sse: { driver: 'sse' },
      },
    })).toThrow('Broadcast default driver "missing" is not defined');
  });

  it('throws when Pusher configuration is incomplete', () => {
    expect(() => Broadcast.configure({
      default: 'pusher',
      drivers: {
        pusher: {
          driver: 'pusher',
          key: 'app-key',
          secret: '',
          appId: '',
        },
      },
    })).toThrow('missing required Pusher config: secret, appId');
  });

  it('propagates channel authorization callback failures', async () => {
    Broadcast.configure({
      default: 'sse',
      drivers: {
        sse: { driver: 'sse' },
      },
    });
    Broadcast.channel('private-orders.{orderId}', async () => {
      throw new Error('orders lookup failed');
    });

    await expect(Broadcast.authorize('private-orders.1', { id: 1 })).rejects.toThrow('orders lookup failed');
  });

  it('delivers SSE broadcasts to subscribed channels', async () => {
    Broadcast.configure({
      default: 'sse',
      drivers: {
        sse: { driver: 'sse' },
      },
    });

    const channelName = `updates-${Date.now()}`;
    const response = Broadcast.subscribe(channelName);
    const reader = response.body!.getReader();
    await reader.read();

    await Broadcast.to(channelName).send('post-created', {
      title: 'Hello',
    });

    const { value } = await reader.read();
    await reader.cancel();
    const chunk = new TextDecoder().decode(value);
    expect(chunk).toContain('event: post-created');
    expect(chunk).toContain('"title":"Hello"');
  });

  it('sends the connected event when an SSE stream opens', async () => {
    Broadcast.configure({
      default: 'sse',
      drivers: {
        sse: { driver: 'sse' },
      },
    });

    const channelName = `connected-${Date.now()}`;
    const response = Broadcast.subscribe(channelName);
    const chunk = await readChunk(response);

    expect(chunk).toContain('event: connected');
    expect(chunk).toContain(`"channel":"${channelName}"`);
  });

  it('publishes SSE events through a backplane and consumes remote messages', async () => {
    Broadcast.configure({
      default: 'sse',
      drivers: {
        sse: { driver: 'sse' },
      },
    });
    const backplane = new FakeBackplane();
    Broadcast.useBackplane(backplane);

    const channelName = `distributed-${Date.now()}`;
    const response = Broadcast.subscribe(channelName);
    const reader = response.body!.getReader();
    await reader.read();

    await Broadcast.to(channelName).send('local-event', { ok: true });
    expect(backplane.published).toHaveLength(1);
    expect(backplane.published[0]).toMatchObject({
      channel: channelName,
      event: 'local-event',
      data: { ok: true },
    });

    await reader.read();
    await backplane.emit({
      id: 'remote-1',
      origin: 'another-process',
      channel: channelName,
      event: 'remote-event',
      data: { value: 42 },
    });

    const { value } = await reader.read();
    await reader.cancel();
    const chunk = new TextDecoder().decode(value);
    expect(chunk).toContain('event: remote-event');
    expect(chunk).toContain('"value":42');
    await Broadcast.closeBackplane();
  });
});
