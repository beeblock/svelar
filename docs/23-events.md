# Events & Listeners

Svelar provides a Laravel-inspired event system for decoupling your application. Events represent things that happened; listeners react to them.

### Creating Events

```bash
npx svelar make:event UserRegistered --module=auth
```

This generates `src/lib/modules/auth/domain/events/UserRegistered.ts` (or `src/lib/events/UserRegistered.ts` in flat projects):

```typescript
export class UserRegistered {
  constructor(
    public readonly user: User,
    public readonly source?: string,
  ) {}
}
```

Events are plain classes — no base class required. They carry the data that listeners need. A constructor-only event class is valid: TypeScript public constructor properties are the event payload, and Svelar uses the class constructor name as the event name for class-based dispatch and provider mappings.

### Creating Listeners

```bash
npx svelar make:listener SendWelcomeEmail --event=UserRegistered --module=auth
```

This generates `src/lib/modules/auth/application/listeners/SendWelcomeEmail.ts` (or `src/lib/listeners/SendWelcomeEmail.ts` in flat projects):

```typescript
import { Listener } from '@beeblock/svelar/events';
import type { UserRegistered } from '$lib/modules/auth/domain/events/UserRegistered.js';

export class SendWelcomeEmail extends Listener<UserRegistered> {
  async handle(event: UserRegistered): Promise<void> {
    await Mailer.sendMailable(new WelcomeEmail(event.user));
  }

  // Optionally filter which events to handle:
  shouldHandle(event: UserRegistered): boolean {
    return event.source !== 'import'; // Skip imported users
  }
}
```

### Sync vs Queued Work

Event dispatch is **synchronous by default**: `await Event.dispatch(new UserRegistered(user))` waits for every registered listener to finish. Use this for small, important side effects that should complete before the original request finishes, such as cache invalidation, audit bookkeeping, or writing local metadata.

For expensive or retryable work, keep the listener small and dispatch a job from inside the listener:

```typescript
import { Listener } from '@beeblock/svelar/events';
import { Queue } from '@beeblock/svelar/queue';
import { SendWelcomeEmailJob } from '$lib/shared/jobs/SendWelcomeEmailJob.js';
import type { UserRegistered } from '$lib/modules/auth/domain/events/UserRegistered.js';

export class SendWelcomeEmail extends Listener<UserRegistered> {
  async handle(event: UserRegistered): Promise<void> {
    await Queue.dispatch(
      new SendWelcomeEmailJob({ userId: event.user.id }),
      { queue: 'mail' }
    );
  }
}
```

This gives you the same module-decoupling benefits while letting the queue system handle retries, backoff, worker isolation, and slow external services.

### Dispatching Events

```typescript
import { Event } from '@beeblock/svelar/events';

// Class-based event
await Event.dispatch(new UserRegistered(user));

// String-based event
await Event.emit('order.shipped', { orderId: 123, trackingNumber: 'ABC' });
```

### Inline Listeners

For quick one-offs, register listeners directly:

```typescript
import { Event } from '@beeblock/svelar/events';

// String-based
Event.listen('user.created', async (user) => {
  console.log('New user:', user.getAttribute('email'));
});

// Class-based (typed)
Event.listen(UserRegistered, async (event) => {
  await analytics.track('signup', { email: event.user.email });
});

// One-time listener
Event.once('app.booted', async () => {
  console.log('Application started');
});

// Wildcard listener (fires for every event)
Event.onAny(async (eventName, payload) => {
  console.log(`[Event] ${eventName}`, payload);
});
```

### EventServiceProvider

For production apps, register all event mappings and observers in an `EventServiceProvider`. This gives you a single place to see all event wiring.

```bash
npx svelar make:provider EventServiceProvider
```

Then extend the built-in `EventServiceProvider` base:

```typescript
// src/lib/shared/providers/EventServiceProvider.ts
import { EventServiceProvider as BaseProvider } from '@beeblock/svelar/events';
import { UserRegistered } from '$lib/modules/auth/domain/events/UserRegistered.js';
import { OrderPlaced } from '$lib/modules/orders/domain/events/OrderPlaced.js';
import { SendWelcomeEmail } from '$lib/modules/auth/application/listeners/SendWelcomeEmail.js';
import { CreateUserProfile } from '$lib/modules/auth/application/listeners/CreateUserProfile.js';
import { NotifyWarehouse } from '$lib/modules/orders/application/listeners/NotifyWarehouse.js';
import { User } from '$lib/modules/auth/domain/models/User.js';
import { UserObserver } from '$lib/modules/auth/domain/observers/UserObserver.js';
import { AuditObserver } from '$lib/modules/auth/domain/observers/AuditObserver.js';

export class EventServiceProvider extends BaseProvider {
  // Map events to their listeners
  protected listen = {
    // Class-based events (use .name for the key)
    [UserRegistered.name]: [SendWelcomeEmail, CreateUserProfile],
    [OrderPlaced.name]: [NotifyWarehouse],

    // String-based events (model lifecycle, custom, etc.)
    'user.updated': [
      async (user: any) => { await invalidateUserCache(user); },
    ],
  };

  // Map models to their observers
  protected observers = {
    [User.name]: [UserObserver, AuditObserver],
  };
}
```

Register the provider and models in your app bootstrap:

```typescript
// src/app.ts
import { Application } from '@beeblock/svelar/container';
import { EventServiceProvider as BaseProvider } from '@beeblock/svelar/events';
import { EventServiceProvider } from '$lib/shared/providers/EventServiceProvider.js';
import { User } from '$lib/modules/users/domain/models/User.js';
import { Post } from '$lib/modules/posts/domain/models/Post.js';

// Register models so observers can be attached by name
BaseProvider.registerModels(User, Post);

const app = new Application();
app.register(EventServiceProvider);
await app.bootstrap();
```

### Subscribers

Subscribers let a single class listen to multiple events:

```typescript
import { type EventDispatcher, type Subscriber } from '@beeblock/svelar/events';

export class UserEventSubscriber implements Subscriber {
  subscribe(events: EventDispatcher): void {
    events.listen('user.created', this.onCreated.bind(this));
    events.listen('user.deleted', this.onDeleted.bind(this));
    events.listen('user.updated', this.onUpdated.bind(this));
  }

  async onCreated(user: any) { /* ... */ }
  async onDeleted(user: any) { /* ... */ }
  async onUpdated(user: any) { /* ... */ }
}

// Register directly
Event.subscribe(new UserEventSubscriber());

// Or via EventServiceProvider:
protected subscribe = [UserEventSubscriber];
```

### Model Lifecycle Events

Every model automatically dispatches events through the `Event` system. See [Model Observers](./03-models-orm.md#model-observers) for the full reference.

```typescript
// These fire automatically — no setup needed
Event.listen('user.creating', async (user) => { /* before insert */ });
Event.listen('user.created', async (user) => { /* after insert */ });
Event.listen('user.updating', async (user) => { /* before update */ });
Event.listen('user.updated', async (user) => { /* after update */ });
Event.listen('user.deleting', async (user) => { /* before delete */ });
Event.listen('user.deleted', async (user) => { /* after delete */ });
```

### Removing Listeners

```typescript
// The listen() method returns an unsubscribe function
const unsubscribe = Event.listen('user.created', handler);
unsubscribe(); // Remove this specific listener

// Remove all listeners for an event
Event.forget('user.created');
Event.forget(UserRegistered); // Class-based

// Remove everything
Event.flush();

// Check if listeners exist
Event.hasListeners('user.created');     // boolean
Event.listenerCount(UserRegistered);    // number
```
