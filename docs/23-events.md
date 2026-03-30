# Events & Listeners

Svelar provides a Laravel-inspired event system for decoupling your application. Events represent things that happened; listeners react to them.

### Creating Events

```bash
npx svelar make:event UserRegistered
```

This generates `src/lib/events/UserRegistered.ts`:

```typescript
export class UserRegistered {
  constructor(
    public readonly user: User,
    public readonly source?: string,
  ) {}
}
```

Events are plain classes — no base class required. They carry the data that listeners need.

### Creating Listeners

```bash
npx svelar make:listener SendWelcomeEmail --event UserRegistered
```

This generates `src/lib/listeners/SendWelcomeEmail.ts`:

```typescript
import { Listener } from '@beeblock/svelar/events';
import type { UserRegistered } from '../events/UserRegistered.js';

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
import { UserRegistered } from '../../events/UserRegistered.js';
import { OrderPlaced } from '../../events/OrderPlaced.js';
import { SendWelcomeEmail } from '../../listeners/SendWelcomeEmail.js';
import { CreateUserProfile } from '../../listeners/CreateUserProfile.js';
import { NotifyWarehouse } from '../../listeners/NotifyWarehouse.js';
import { User } from '../../modules/users/User.js';
import { UserObserver } from '../../modules/users/UserObserver.js';
import { AuditObserver } from '../../modules/users/AuditObserver.js';

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
import { EventServiceProvider } from './lib/shared/providers/EventServiceProvider.js';
import { User } from './lib/modules/users/User.js';
import { Post } from './lib/modules/posts/Post.js';

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
