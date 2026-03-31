# Architecture & Module Communication

Svelar uses a DDD-inspired modular monolith architecture. This guide covers how modules are structured, how they communicate across boundaries, and patterns to avoid.

## Module Structure

Each module in `src/lib/modules/` is a self-contained domain:

```
src/lib/modules/
├── auth/
│   ├── User.ts              # Model
│   ├── UserObserver.ts       # Model observer
│   ├── AuthController.ts     # Controller
│   ├── AuthService.ts        # Service (business logic)
│   ├── UserRepository.ts     # Repository (data access)
│   ├── RegisterUser.ts       # Action (single use-case)
│   ├── StoreUserRequest.ts   # FormRequest DTO (validation)
│   └── UserResource.ts       # API resource (response shaping)
├── billing/
│   ├── Invoice.ts
│   ├── BillingService.ts
│   ├── InvoiceRepository.ts
│   └── CreateInvoice.ts
└── posts/
    ├── Post.ts
    ├── PostObserver.ts
    ├── PostController.ts
    ├── PostService.ts
    └── PostRepository.ts
```

A module owns its **models, services, controllers, repositories, actions, observers, and DTOs**. Everything related to one domain lives together.

## The Golden Rule: Modules Never Import Each Other

This is the most important architectural principle in Svelar:

```
auth/ ──✖──► billing/     # NEVER import across modules
auth/ ──✔──► Event system  # Always communicate through events
```

If `AuthService` needs to trigger something in `BillingService`, it **must not** import `BillingService` directly. Instead, it fires an event, and the billing module listens for it.

### Why?

- **Loose coupling** — modules can be developed, tested, and refactored independently
- **Clear boundaries** — you can see all cross-module communication by looking at the `EventServiceProvider`
- **Scalability** — if billing later becomes a separate microservice, the event interface stays the same
- **Testability** — mock events instead of mocking entire modules

## Cross-Module Communication via Events

### Step 1: Module A fires an event

```typescript
// src/lib/modules/auth/AuthService.ts
import { Service } from '@beeblock/svelar/services';
import { Event } from '@beeblock/svelar/events';
import { User } from './User.js';

export class AuthService extends Service {
  async register(data: RegisterDTO) {
    const user = await User.create({
      name: data.name,
      email: data.email,
      password: await Hash.make(data.password),
    });

    // Don't call BillingService here — fire an event instead
    await Event.dispatch(new UserRegistered(user));

    return this.ok(user);
  }
}
```

### Step 2: Define the event

Events live in `src/lib/events/` — they are **shared contracts**, not owned by any module:

```typescript
// src/lib/events/UserRegistered.ts
import type { Model } from '@beeblock/svelar/orm';

export class UserRegistered {
  constructor(public readonly user: Model) {}
}
```

### Step 3: Module B listens for the event

```typescript
// src/lib/listeners/CreateFreePlan.ts
import { Listener } from '@beeblock/svelar/events';
import type { UserRegistered } from '../events/UserRegistered.js';
import { Invoice } from '../modules/billing/Invoice.js';

export class CreateFreePlan extends Listener<UserRegistered> {
  async handle(event: UserRegistered) {
    await Invoice.create({
      user_id: event.user.getAttribute('id'),
      plan: 'free',
      amount: 0,
    });
  }
}
```

### Step 4: Wire it up in EventServiceProvider

```typescript
// src/lib/shared/providers/EventServiceProvider.ts
import { EventServiceProvider as BaseProvider } from '@beeblock/svelar/events';
import { UserRegistered } from '../../events/UserRegistered.js';
import { CreateFreePlan } from '../../listeners/CreateFreePlan.js';
import { SendWelcomeEmail } from '../../listeners/SendWelcomeEmail.js';
import { SyncToAnalytics } from '../../listeners/SyncToAnalytics.js';

export class EventServiceProvider extends BaseProvider {
  protected listen = {
    [UserRegistered.name]: [
      SendWelcomeEmail,    // auth concern
      CreateFreePlan,      // billing concern
      SyncToAnalytics,     // analytics concern
    ],
  };
}
```

Now you can see **all cross-module communication in one place**. When a user registers, three independent modules react — and none of them know about each other.

## Model Lifecycle Events (Automatic)

Every model automatically dispatches events through the `Event` system. This is the simplest form of cross-module communication:

```typescript
// No setup needed — these fire automatically
Event.listen('user.created', async (user) => {
  // billing module reacts to auth module's model
  await createFreePlan(user);
});

Event.listen('invoice.created', async (invoice) => {
  // notifications module reacts to billing module's model
  await notifyUser(invoice);
});
```

Event names follow the pattern `{modelname}.{event}` (lowercase):

| Model | Events |
|---|---|
| `User` | `user.creating`, `user.created`, `user.updating`, `user.updated`, `user.deleting`, `user.deleted` |
| `Post` | `post.creating`, `post.created`, ... |
| `Invoice` | `invoice.creating`, `invoice.created`, ... |

## Custom Domain Events

For events that don't map to model lifecycle (e.g. "order shipped", "subscription renewed"), use custom model events or standalone event classes:

### Custom Model Events

```typescript
// src/lib/modules/orders/Order.ts
export class Order extends Model {
  static table = 'orders';
  static events = ['shipped', 'cancelled', 'refunded'];

  async ship(trackingNumber: string) {
    await this.update({ status: 'shipped', tracking_number: trackingNumber });
    await this.fireEvent('shipped');
  }
}

// Listened by another module
Event.listen('order.shipped', async (order) => {
  await sendShipmentNotification(order);
  await updateInventory(order);
});
```

### Standalone Event Classes

For events not tied to a model:

```typescript
// src/lib/events/PaymentReceived.ts
export class PaymentReceived {
  constructor(
    public readonly userId: number,
    public readonly amount: number,
    public readonly currency: string,
    public readonly invoiceId: number,
  ) {}
}

// Dispatched from billing module
await Event.dispatch(new PaymentReceived(user.id, 99.99, 'USD', invoice.id));

// Listened by other modules
Event.listen(PaymentReceived, async (event) => {
  await unlockPremiumFeatures(event.userId);
  await sendReceipt(event.invoiceId);
});
```

## Shared Contracts

When multiple modules need the same data shape, define shared interfaces in `src/lib/shared/`:

```typescript
// src/lib/shared/contracts/HasOwner.ts
export interface HasOwner {
  getUserId(): number;
  getOwnerName(): string;
}

// Both auth and billing modules can implement this
// without importing each other
```

Use shared contracts for:
- **Interfaces** that multiple modules implement
- **DTOs** passed through events
- **Value objects** used across boundaries

Do **not** put module-specific code in `shared/` — only contracts and infrastructure.

## Communication Patterns Summary

| Pattern | When to Use | Example |
|---|---|---|
| **Model lifecycle events** | React to CRUD operations across modules | `user.created` → create billing profile |
| **Custom model events** | Domain-specific state changes | `order.shipped` → notify customer |
| **Event classes** | Complex payloads, typed contracts | `PaymentReceived` → unlock features |
| **Model observers** | Multiple lifecycle concerns for one model | `UserObserver` → audit, cache, sync |
| **Shared contracts** | Same interface implemented by multiple modules | `HasOwner`, `Billable` |

## Anti-Patterns to Avoid

### 1. Direct cross-module imports

```typescript
// BAD — auth module imports billing module directly
import { BillingService } from '../billing/BillingService.js';

export class AuthService extends Service {
  async register(data: RegisterDTO) {
    const user = await User.create(data);
    await new BillingService().createFreePlan(user); // Tight coupling!
  }
}
```

```typescript
// GOOD — fire an event, let billing handle itself
export class AuthService extends Service {
  async register(data: RegisterDTO) {
    const user = await User.create(data);
    await Event.dispatch(new UserRegistered(user)); // Loose coupling
  }
}
```

### 2. Circular dependencies

If Module A imports Module B and Module B imports Module A, you have a circular dependency. Events eliminate this entirely — neither module imports the other.

### 3. Fat events with too much data

```typescript
// BAD — stuffing the entire model with relations into an event
await Event.dispatch(new UserRegistered(await User.with('posts', 'invoices', 'settings').find(id)));

// GOOD — include only what listeners need
await Event.dispatch(new UserRegistered(user)); // Listeners query what they need
```

### 4. Listeners reaching back into the source module

```typescript
// BAD — billing listener imports and calls auth service
export class CreateFreePlan extends Listener<UserRegistered> {
  async handle(event: UserRegistered) {
    const authService = new AuthService(); // Don't reach back!
    await authService.assignRole(event.user, 'free');
  }
}

// GOOD — stay within your own module's boundaries
export class CreateFreePlan extends Listener<UserRegistered> {
  async handle(event: UserRegistered) {
    await Invoice.create({
      user_id: event.user.getAttribute('id'),
      plan: 'free',
      amount: 0,
    });
  }
}
```

### 5. Business logic in the EventServiceProvider

```typescript
// BAD — logic in the provider
protected listen = {
  [UserRegistered.name]: [
    async (event: any) => {
      const user = event.user;
      await Invoice.create({ user_id: user.id, plan: 'free' });
      await Mailer.sendMailable(new WelcomeEmail(user));
      await analytics.track('signup', { email: user.email });
    },
  ],
};

// GOOD — one listener per concern, logic in the listener class
protected listen = {
  [UserRegistered.name]: [CreateFreePlan, SendWelcomeEmail, SyncToAnalytics],
};
```

## Visualizing Module Communication

A well-structured Svelar app's module communication looks like this:

```
┌──────────┐     ┌──────────────────┐     ┌──────────┐
│   Auth   │────►│   Event System   │◄────│ Billing  │
│  Module  │     │                  │     │  Module  │
└──────────┘     │ UserRegistered   │     └──────────┘
                 │ PaymentReceived  │
┌──────────┐     │ OrderShipped     │     ┌──────────┐
│  Orders  │────►│ PostPublished    │◄────│  Posts   │
│  Module  │     │                  │     │  Module  │
└──────────┘     └──────────────────┘     └──────────┘
                         │
                         ▼
                 ┌──────────────────┐
                 │  Notifications   │
                 │     Module       │
                 └──────────────────┘
```

Every arrow goes **through** the event system. No module talks to another directly.

## Testing Cross-Module Communication

Events make testing straightforward:

```typescript
// Test that registering a user fires the event
import { Event } from '@beeblock/svelar/events';

test('registration fires UserRegistered event', async () => {
  const events: any[] = [];
  Event.listen('UserRegistered', (e) => events.push(e));

  await authService.register({ name: 'Jane', email: 'jane@test.com', password: 'secret' });

  expect(events).toHaveLength(1);
  expect(events[0].user.getAttribute('email')).toBe('jane@test.com');
});

// Test a listener in isolation — no need to set up the source module
test('CreateFreePlan creates invoice for new user', async () => {
  const listener = new CreateFreePlan();
  const fakeUser = User.hydrate({ id: 1, name: 'Jane', email: 'jane@test.com' });

  await listener.handle(new UserRegistered(fakeUser));

  const invoice = await Invoice.where('user_id', 1).first();
  expect(invoice.getAttribute('plan')).toBe('free');
});
```

## Pipelines (Chain of Responsibility)

While events are fire-and-forget (fan-out), **Pipelines** are sequential — data flows through a chain of steps where each step transforms it. Think of it as a conveyor belt: each station does one thing, then passes the item to the next.

```typescript
import { Pipeline } from '@beeblock/svelar/support';

const processedOrder = await Pipeline.send(order)
  .through([
    ValidateStock,
    ApplyDiscount,
    CalculateTax,
    ChargePayment,
  ])
  .thenReturn();
```

### When to Use Pipelines vs Events

| | Events | Pipelines |
|---|---|---|
| **Data flow** | Fan-out (many listeners) | Sequential (one after another) |
| **Return value** | None (fire-and-forget) | Transformed data |
| **Order** | Listeners are independent | Order is critical |
| **Halting** | Can't stop other listeners | Any pipe can halt the chain |
| **Use case** | "Notify the world" | "Process this through steps" |

### Creating Pipe Classes

Each pipe class implements a `handle(data, next)` method. Call `next(data)` to pass to the next pipe, or return early to halt:

```typescript
import type { Pipe } from '@beeblock/svelar/support';

interface OrderData {
  items: { productId: number; quantity: number; price: number }[];
  discount: number;
  tax: number;
  total: number;
  userId: number;
}

class ValidateStock implements Pipe<OrderData> {
  async handle(order: OrderData, next: (order: OrderData) => Promise<OrderData>) {
    for (const item of order.items) {
      const product = await Product.find(item.productId);
      if (product.getAttribute('stock') < item.quantity) {
        throw new Error(`Insufficient stock for product ${item.productId}`);
      }
    }
    return next(order); // Pass to next pipe
  }
}

class ApplyDiscount implements Pipe<OrderData> {
  async handle(order: OrderData, next: (order: OrderData) => Promise<OrderData>) {
    const user = await User.find(order.userId);
    if (user.getAttribute('is_premium')) {
      order.discount = 0.1; // 10% off
    }
    return next(order);
  }
}

class CalculateTax implements Pipe<OrderData> {
  async handle(order: OrderData, next: (order: OrderData) => Promise<OrderData>) {
    const subtotal = order.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const afterDiscount = subtotal * (1 - order.discount);
    order.tax = afterDiscount * 0.08; // 8% tax
    order.total = afterDiscount + order.tax;
    return next(order);
  }
}

class ChargePayment implements Pipe<OrderData> {
  async handle(order: OrderData, next: (order: OrderData) => Promise<OrderData>) {
    await PaymentGateway.charge(order.userId, order.total);
    return next(order);
  }
}
```

### Inline Pipes

For simple transformations, use inline functions instead of classes:

```typescript
const result = await Pipeline.send(userInput)
  .through([
    // Inline pipe — trim whitespace
    async (data, next) => {
      data.name = data.name.trim();
      data.email = data.email.trim().toLowerCase();
      return next(data);
    },
    // Class pipe — validate
    ValidateRegistration,
    // Inline pipe — hash password
    async (data, next) => {
      data.password = await Hash.make(data.password);
      return next(data);
    },
  ])
  .thenReturn();
```

### Adding Pipes Individually

```typescript
const pipeline = Pipeline.send(data)
  .pipe(ValidateStock)
  .pipe(ApplyDiscount)
  .pipe(CalculateTax)
  .pipe(ChargePayment);

const result = await pipeline.thenReturn();
```

### Destination Callback

Use `then()` instead of `thenReturn()` to transform the final result:

```typescript
const invoice = await Pipeline.send(order)
  .through([ValidateStock, ApplyDiscount, CalculateTax, ChargePayment])
  .then(async (processedOrder) => {
    // Final step — create the invoice from the processed order
    return Invoice.create({
      user_id: processedOrder.userId,
      total: processedOrder.total,
      tax: processedOrder.tax,
    });
  });
```

### Error Handling

Use `onCatch()` to handle errors gracefully instead of letting them bubble up:

```typescript
const result = await Pipeline.send(order)
  .through([ValidateStock, ApplyDiscount, CalculateTax, ChargePayment])
  .onCatch(async (error, order) => {
    await Log.error('Order processing failed', { error: error.message, orderId: order.id });
    // Return a fallback or re-throw
    order.status = 'failed';
    order.error = error.message;
    return order;
  })
  .thenReturn();
```

### Real-World Examples

**Content publishing pipeline:**

```typescript
const published = await Pipeline.send(post)
  .through([
    SanitizeHtml,       // Remove XSS
    ParseMarkdown,      // Convert markdown to HTML
    ExtractMetadata,    // Pull out title, description, images
    GenerateSlug,       // Create URL-friendly slug
    OptimizeImages,     // Compress embedded images
    UpdateSearchIndex,  // Add to search engine
  ])
  .thenReturn();
```

**User onboarding pipeline:**

```typescript
const user = await Pipeline.send(registrationData)
  .through([
    ValidateUniqueEmail,
    HashPassword,
    CreateUserRecord,
    AssignDefaultRole,
    CreateDefaultWorkspace,
    SendWelcomeEmail,
  ])
  .thenReturn();
```

**Data import pipeline:**

```typescript
const imported = await Pipeline.send(csvRows)
  .through([
    ValidateHeaders,
    NormalizeData,
    DeduplicateRows,
    ValidateBusinessRules,
    InsertInBatches,
    GenerateReport,
  ])
  .thenReturn();
```

### Pipelines vs Events — Using Both Together

Pipelines and events complement each other. Use pipelines for the sequential processing, then fire an event when it's done:

```typescript
// Pipeline processes the order step by step
const order = await Pipeline.send(orderData)
  .through([ValidateStock, ApplyDiscount, CalculateTax, ChargePayment])
  .thenReturn();

// Event notifies other modules that care
await Event.dispatch(new OrderCompleted(order));
// → billing module creates invoice
// → notifications module emails customer
// → analytics module tracks conversion
```

## Next Steps

- [Events & Listeners](./23-events.md) — full event system reference
- [Model Observers](./03-models-orm.md#model-observers) — observer lifecycle and custom events
- [Services & Actions](./08-services-actions-repositories.md) — where business logic lives

---

**Svelar Architecture Guide** © 2026
