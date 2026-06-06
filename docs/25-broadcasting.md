# Broadcasting

Real-time event broadcasting with public, private, and presence channels. Soketi (a self-hosted Pusher-compatible WebSocket server) is the default driver and ships in the Docker Compose setup out of the box.

### Quick Start

```bash
# 1. Scaffold everything: routes, config, client initialization
npx svelar make:broadcasting

# 2. Start Soketi (included in docker-compose)
docker compose up -d soketi
```

The `make:broadcasting` command creates:

- `src/routes/api/broadcasting/auth/+server.ts` — Pusher/Soketi channel auth endpoint
- `src/routes/api/broadcasting/[channel]/+server.ts` — SSE streaming endpoint (fallback driver)
- `src/lib/broadcasting.ts` — Client-side initialization (import in your layout)
- `config/broadcasting.ts` — Server-side config (Soketi enabled by default)

Flags: `--sse` (SSE routes only), `--pusher` (Pusher/Soketi routes only), `--force` (overwrite).

### Server-Side Configuration

The generated `config/broadcasting.ts` uses Soketi by default:

```typescript
import { env } from '@beeblock/svelar/config';

export default {
  default: env('BROADCAST_DRIVER', 'pusher'),
  drivers: {
    pusher: {
      driver: 'pusher',
      key: env('PUSHER_KEY', 'svelar-key'),
      secret: env('PUSHER_SECRET', 'svelar-secret'),
      appId: env('PUSHER_APP_ID', 'svelar-app'),
      host: env('PUSHER_HOST', 'localhost'),   // 'soketi' in Docker
      port: env<number>('PUSHER_PORT', 6001),
      useTLS: false,
    },
    sse: { driver: 'sse' },
    log: { driver: 'log' },
  },
};
```

Load it in `src/app.ts`:

```typescript
import { Broadcast } from '@beeblock/svelar/broadcasting';
import broadcastingConfig from '../config/broadcasting.js';

Broadcast.configure(broadcastingConfig);
```

The configured `default` driver must exist in `drivers`. Pusher/Soketi drivers must include `key`, `secret`, and `appId`; missing driver config fails during `Broadcast.configure()` instead of falling back to SSE.

In Docker Compose the app gets `PUSHER_HOST=soketi` automatically, so Soketi works without any `.env` changes.

### Client-Side Setup

The generated `src/lib/broadcasting.ts` initializes the Pusher connection:

```typescript
import { usePusher } from '@beeblock/svelar/broadcasting/client';

export const echo = usePusher({
  key: import.meta.env.VITE_PUSHER_KEY ?? 'svelar-key',
  wsHost: import.meta.env.VITE_PUSHER_HOST ?? 'localhost',
  wsPort: Number(import.meta.env.VITE_PUSHER_PORT ?? 6001),
  forceTLS: false,
  authEndpoint: '/api/broadcasting/auth',
});

export { useChannel, usePresenceChannel, leaveChannel } from '@beeblock/svelar/broadcasting/client';
```

Import it in your root layout:

```svelte
<!-- src/routes/+layout.svelte -->
<script>
  import '$lib/broadcasting';
</script>
```

### Subscribing to Channels (Client-Side)

Svelar provides reactive helpers that wrap pusher-js with a clean, chainable API:

```svelte
<script>
  import { useChannel, usePresenceChannel } from '$lib/broadcasting';

  // Private channel
  const orders = useChannel('private-orders.123');
  orders.listen('OrderShipped', (data) => {
    console.log('Shipped:', data);
  });

  // Presence channel with member tracking
  let members = $state([]);

  const chat = usePresenceChannel('presence-chat.5');
  chat
    .here((m) => { members = m; })
    .joining((m) => { members = [...members, m]; })
    .leaving((m) => { members = members.filter(x => x.id !== m.id); })
    .listen('new-message', (data) => {
      console.log(data.text);
    });

  // Whisper (client events) — e.g. typing indicators
  function onTyping() {
    chat.whisper('typing', { name: 'Alice' });
  }
</script>

<p>Online: {members.length}</p>
```

Clean up when the component unmounts:

```svelte
<script>
  import { onDestroy } from 'svelte';
  import { useChannel, leaveChannel } from '$lib/broadcasting';

  const channel = useChannel('private-orders.123');
  channel.listen('OrderShipped', handleShipped);

  onDestroy(() => leaveChannel('private-orders.123'));
</script>
```

### SSE Client

For the SSE driver, use `useSSE` instead — no Soketi or Pusher server required:

```svelte
<script>
  import { useSSE } from '@beeblock/svelar/broadcasting/client';

  const channel = useSSE('private-orders.123');
  channel.listen('OrderShipped', (data) => {
    console.log('Shipped!', data);
  });

  onDestroy(() => channel.close());
</script>
```

### Channel Types

Svelar supports three channel types, determined by the channel name prefix:

**Public channels** — anyone can subscribe, no authorization needed:

```typescript
Broadcast.to('updates').send('new-post', { title: 'Hello World' });
```

**Private channels** — prefixed with `private-`, require user authorization:

```typescript
Broadcast.to('private-orders.123').send('OrderShipped', { trackingId: 'XYZ' });
```

**Presence channels** — prefixed with `presence-`, require authorization + track who's online:

```typescript
Broadcast.to('presence-chat.5').send('new-message', { text: 'Hello!' });
```

### Channel Authorization

Generate a channel authorization file:

```bash
npx svelar make:channel Order
npx svelar make:channel Chat --presence
```

This creates files in `src/lib/shared/channels/` for DDD apps or `src/lib/channels/` for flat apps. Generated channel callbacks deny access by default; add your model, team, or permission lookup before returning `true` or presence member data. Register them in `src/app.ts`:

```typescript
import { Broadcast } from '@beeblock/svelar/broadcasting';

// Private channel — return true/false
Broadcast.channel('private-orders.{orderId}', async (user, { orderId }) => {
  const order = await Order.findOrFail(orderId);
  return order.user_id === user.id;
});

// Presence channel — return false to deny, or user info object
Broadcast.channel('presence-chat.{roomId}', async (user, { roomId }) => {
  const room = await ChatRoom.findOrFail(roomId);
  if (!room.hasMember(user.id)) return false;
  return { id: user.id, name: user.name, avatar: user.avatar };
});
```

The scaffolded auth route at `src/routes/api/broadcasting/auth/+server.ts` handles Pusher/Soketi channel authentication automatically — it calls `Broadcast.authenticatePusher()` which checks your registered channel callbacks and generates the HMAC-SHA256 signature pusher-js expects.

### Broadcasting Events (Server-Side)

Two ways to broadcast from your server code:

```typescript
import { Broadcast } from '@beeblock/svelar/broadcasting';

// Shorthand — send to a channel directly
await Broadcast.to('private-orders.123').send('OrderShipped', { orderId: 123 });

// Fluent builder — for multiple channels
await Broadcast.event('OrderShipped', { orderId: 123 })
  .on('private-orders.123')
  .on('notifications')
  .send();

// Send to a specific user within a channel
Broadcast.to('notifications', userId).send('new-message', { text: 'Hello!' });
```

### Presence Channel Members

With the SSE driver, you can query who's online server-side:

```typescript
const members = Broadcast.members('presence-chat.5');
// → [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]
```

### Soketi in Docker

Soketi is included in the default Docker Compose generated by `make:docker`. The app service automatically gets `PUSHER_HOST=soketi` and `PUSHER_PORT=6001`, and the Soketi service uses the same credentials from your `.env`. Set them before starting Docker:

```bash
PUSHER_KEY=your-production-key
PUSHER_SECRET=your-production-secret
PUSHER_APP_ID=your-app-id
```

And expose the same key to the client via Vite env vars:

```bash
VITE_PUSHER_KEY=your-production-key
VITE_PUSHER_HOST=your-soketi-host.com
VITE_PUSHER_PORT=6001
```
