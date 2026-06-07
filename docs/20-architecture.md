# Architecture & Module Communication

Svelar uses a DDD-inspired modular monolith architecture. This guide covers how modules are structured, how they communicate across boundaries, and patterns to avoid.

## Module Structure

Each module in `src/lib/modules/` is a self-contained domain:

```
src/lib/modules/
├── auth/
│   ├── contracts/
│   │   └── schemas/          # Shared Zod/Valibot schemas and inferred types
│   ├── domain/
│   │   ├── models/           # ORM models
│   │   ├── events/           # Module events
│   │   ├── observers/        # Model observers
│   │   └── policies/         # Gates and policies
│   ├── application/
│   │   ├── actions/          # Single use-case classes
│   │   ├── dto/              # Validated payload objects
│   │   ├── listeners/        # Event listeners
│   │   ├── notifications/    # Notifications
│   │   └── services/         # Business/application services
│   ├── infrastructure/
│   │   └── repositories/     # Data-access repositories
│   └── interface/
│       └── http/
│           ├── controllers/  # HTTP controllers
│           ├── requests/     # FormRequest validation/authorization
│           └── resources/    # API response resources
├── billing/
│   └── ...
└── posts/
    └── ...
```

A module owns its **models, services, controllers, repositories, actions, observers, and DTOs**. Everything related to one domain lives together.

The CLI follows this layout automatically:

| Artifact | DDD path |
|---|---|
| Model | `src/lib/modules/<module>/domain/models/` |
| Event | `src/lib/modules/<module>/domain/events/` |
| Observer | `src/lib/modules/<module>/domain/observers/` |
| Policy/gates | `src/lib/modules/<module>/domain/policies/` |
| Action | `src/lib/modules/<module>/application/actions/` |
| DTO | `src/lib/modules/<module>/application/dto/` |
| Listener | `src/lib/modules/<module>/application/listeners/` |
| Notification | `src/lib/modules/<module>/application/notifications/` |
| Service | `src/lib/modules/<module>/application/services/` |
| Repository | `src/lib/modules/<module>/infrastructure/repositories/` |
| Controller | `src/lib/modules/<module>/interface/http/controllers/` |
| FormRequest | `src/lib/modules/<module>/interface/http/requests/` |
| Resource | `src/lib/modules/<module>/interface/http/resources/` |
| Contract schema | `src/lib/modules/<module>/contracts/schemas/` |

For a full resource scaffold, use `make:entity`:

```bash
npx svelar make:entity Invoice --module=billing --fields "title:string,total:number,status:enum(draft,paid)" --crud
```

This creates the model, contract schema, DTOs, requests, actions, resource, repository, service, controller, and a focused table migration using the layered module layout.

Use `$lib/...` aliases for app-owned imports across this structure:

```typescript
import { Invoice } from '$lib/modules/billing/domain/models/Invoice.js';
import { BillingAccessService } from '$lib/modules/billing/application/services/BillingAccessService.js';
import { EventServiceProvider } from '$lib/shared/providers/EventServiceProvider.js';
```

Keep relative imports for local SvelteKit conventions such as `./$types`, same-component helpers, stylesheets, or files outside `src/lib` such as `src/app.ts`.

## Module Boundaries

The most important architectural principle in Svelar is that modules must not reach into each other's internals:

```
auth/ ──✖──► billing/domain/models/Invoice       # do not reach into internals
auth/ ──✖──► billing/infrastructure/repositories # do not bypass the owner module
auth/ ──✔──► billing/application/services         # allowed public application API
auth/ ──✔──► Event system                         # side-effect communication
```

Controllers should also never be imported by another module. Controllers are HTTP adapters; reusable behavior belongs in an action, service, query, or facade.

## Cross-Module Reads vs Side Effects

Use different communication tools depending on whether the caller needs data back.

| Need | Use | Returns data? |
|---|---|---|
| "Something happened; other modules may react" | Event + listener | No |
| "Run slow/retryable work after something happened" | Event listener dispatches a queue job | No |
| "I need data owned by another module now" | Public application service/query/facade | Yes |

Events are not request/response APIs. `Event.dispatch()` returns `Promise<void>`, and listeners should not be used to answer queries.

Events are synchronous unless a listener explicitly hands work to a queue. Keep direct listeners small for immediate side effects, and dispatch queue jobs from listeners for slow, retryable, or external work.

For cross-module reads, create a narrow public service/query/facade in the owning module's `application/services` folder and return plain data from that module's `contracts` layer. Do not return the owning module's ORM models to another module.

Example: boards needs billing access information before creating a board.

```typescript
// src/lib/modules/billing/contracts/billing-access.ts
export type BillingAccess = {
  userId: number;
  plan: 'free' | 'pro' | 'team';
  canCreateBoards: boolean;
  maxBoards: number | null;
};
```

```typescript
// src/lib/modules/billing/application/services/BillingAccessService.ts
import type { BillingAccess } from '$lib/modules/billing/contracts/billing-access.js';
import { Subscription } from '$lib/modules/billing/domain/models/Subscription.js';

export class BillingAccessService {
  async forUser(userId: number): Promise<BillingAccess> {
    const subscription = await Subscription.query()
      .where('user_id', userId)
      .first();

    const plan = subscription?.plan ?? 'free';

    return {
      userId,
      plan,
      canCreateBoards: plan !== 'free',
      maxBoards: plan === 'team' ? null : 10,
    };
  }
}
```

```typescript
// src/lib/modules/boards/application/services/BoardService.ts
import { BillingAccessService } from '$lib/modules/billing/application/services/BillingAccessService.js';

const billingAccess = new BillingAccessService();

export class BoardService {
  async createBoard(dto: CreateBoardDto, user: UserLike) {
    const access = await billingAccess.forUser(user.id);

    if (!access.canCreateBoards) {
      throw new Error('Your current plan cannot create boards.');
    }

    // Continue with board creation in the boards module...
  }
}
```

This keeps `billing` responsible for billing data and rules, while `boards` depends only on a small public application API and a plain contract type.

### Why?

- **Loose coupling** — modules can be developed, tested, and refactored independently
- **Clear boundaries** — you can see all cross-module communication by looking at the `EventServiceProvider`
- **Scalability** — if billing later becomes a separate microservice, the event interface stays the same
- **Testability** — mock events instead of mocking entire modules

## Cross-Module Communication via Events

### Step 1: Module A fires an event

```typescript
// src/lib/modules/auth/application/services/AuthService.ts
import { Service } from '@beeblock/svelar/services';
import { Event } from '@beeblock/svelar/events';
import { User } from '$lib/modules/auth/domain/models/User.js';

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

Events live in the module that owns the domain fact. Cross-cutting listeners subscribe through `EventServiceProvider` instead of importing other modules directly.

```typescript
// src/lib/modules/auth/domain/events/UserRegistered.ts
import type { Model } from '@beeblock/svelar/orm';

export class UserRegistered {
  constructor(public readonly user: Model) {}
}
```

### Step 3: Module B listens for the event

```typescript
// src/lib/modules/billing/application/listeners/CreateFreePlan.ts
import { Listener } from '@beeblock/svelar/events';
import type { UserRegistered } from '$lib/modules/auth/domain/events/UserRegistered.js';
import { Invoice } from '$lib/modules/billing/domain/models/Invoice.js';

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
import { UserRegistered } from '$lib/modules/auth/domain/events/UserRegistered.js';
import { CreateFreePlan } from '$lib/modules/billing/application/listeners/CreateFreePlan.js';
import { SendWelcomeEmail } from '$lib/modules/auth/application/listeners/SendWelcomeEmail.js';
import { SyncToAnalytics } from '$lib/modules/analytics/application/listeners/SyncToAnalytics.js';

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
// src/lib/modules/orders/domain/models/Order.ts
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
// BAD — auth module directly performs a billing side effect
import { BillingService } from '$lib/modules/billing/application/services/BillingService.js';

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
