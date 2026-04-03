# Stripe Billing

The  plugin provides Stripe billing with a polymorphic Billable mixin, subscriptions, one-time payments, checkout, invoices, refunds, and webhook handling.

## Setup

### 1. Install the Plugin

```bash
npx svelar plugin:install @beeblock/svelar-stripe
npm install stripe
```

### 2. Add Environment Variables

Add your Stripe keys to `.env`:

```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

Get these from [Stripe Dashboard](https://dashboard.stripe.com/apikeys):
- **Secret Key**: Settings > API Keys > Secret key
- **Publishable Key**: Settings > API Keys > Publishable key
- **Webhook Secret**: Developers > Webhooks > Add endpoint > Signing secret

### 3. Configure in app.ts

Add Stripe configuration and register your billable models in `src/app.ts`:

```typescript
import { Stripe } from '@beeblock/svelar-stripe';
import { User } from '$lib/models/User';

Stripe.configure({
  secretKey: process.env.STRIPE_SECRET_KEY ?? '',
  publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? '',
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  currency: 'usd',
});

// Register every model that can be billed
Stripe.registerBillable(User);
// Stripe.registerBillable(Team);   // if teams are billable too
```

`registerBillable()` tells the plugin which ORM Model corresponds to each table name, so all billing queries go through the Svelar ORM — no raw SQL.

### 4. Publish & Run Migrations

The plugin publishes migrations when installed via `plugin:install`. You can also publish them manually:

```bash
npx svelar plugin:publish @beeblock/svelar-stripe
```

Then run all migrations:

```bash
npx svelar migrate
```

This creates:
- `subscription_plans` table
- `subscriptions` table (polymorphic: `billable_type` + `billable_id`)
- `invoices` table (polymorphic: `billable_type` + `billable_id`)
- `stripe_customer_id` column on `users` table

#### Adding Billable to Other Models

The Billable mixin is **polymorphic** — any model can be billable, not just User. To make another model billable (e.g. Team, Company), duplicate the `add_stripe_customer_id_to_billable` migration and change the table name:

```typescript
// src/lib/database/migrations/XXXX_add_stripe_customer_id_to_teams.ts
import { Migration } from '@beeblock/svelar/database';

const BILLABLE_TABLE = 'teams'; // <-- your model's table

export default class AddStripeCustomerIdToTeams extends Migration {
  async up() {
    await this.schema.addColumn(BILLABLE_TABLE, (table) => {
      table.string('stripe_customer_id').nullable();
    });
  }

  async down() {
    await this.schema.dropColumn(BILLABLE_TABLE, 'stripe_customer_id');
  }
}
```

Then run `npx svelar migrate` again.

### 5. Set Up Stripe Webhook

The scaffold creates a webhook route at `/api/webhooks/stripe`. Register this URL in your Stripe Dashboard:

1. Go to [Stripe Webhooks](https://dashboard.stripe.com/webhooks)
2. Click "Add endpoint"
3. URL: `https://yourdomain.com/api/webhooks/stripe`
4. Select events to listen for (see [Webhook Events](#webhook-events))
5. Copy the signing secret to `STRIPE_WEBHOOK_SECRET`

For local development, use the Stripe CLI:

```bash
stripe listen --forward-to localhost:5173/api/webhooks/stripe
```

## Configuration Options

```typescript
Stripe.configure({
  // Required
  secretKey: process.env.STRIPE_SECRET_KEY ?? '',
  publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? '',
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',

  // Optional
  currency: 'usd',                                    // Default currency for new subscriptions
  trialDays: 14,                                       // Default trial period
  portalReturnUrl: '/dashboard/billing',               // Return URL after Stripe Portal
  checkoutSuccessUrl: '/dashboard?status=success',     // Redirect after successful checkout
  checkoutCancelUrl: '/dashboard?status=canceled',     // Redirect after canceled checkout
  logging: true,                                       // Set to false to silence all [svelar-stripe] log output
});
```

## Setting Up Products & Prices

Create products and prices in your [Stripe Dashboard](https://dashboard.stripe.com/products):

1. Go to Products > Add product
2. Set name, description
3. Add a recurring price (e.g., $9/month, $29/month, $99/month)
4. Copy the Price ID (starts with `price_`)

You can also create them via the API:

```typescript
import { Stripe } from '@beeblock/svelar-stripe';

const client = await Stripe.service().getClient();

// Create a product
const product = await client.products.create({
  name: 'Pro Plan',
  description: 'Full access to all features',
});

// Create a price for the product
const price = await client.prices.create({
  product: product.id,
  unit_amount: 2900, // $29.00 in cents
  currency: 'usd',
  recurring: { interval: 'month' },
  nickname: 'Pro Monthly',
});
```

### Seed Subscription Plans

Add plans to your database so the app knows about them:

```typescript
// src/lib/database/seeders/DatabaseSeeder.ts
import { Connection } from '@beeblock/svelar/database';

// Inside your seed method:
await Connection.raw(`INSERT INTO subscription_plans (name, stripe_price_id, stripe_product_id, price, currency, interval, trial_days, features, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
  'Pro',
  'price_xxxxx',        // Your Stripe Price ID
  'prod_xxxxx',         // Your Stripe Product ID
  2900,                 // $29.00 in cents
  'usd',
  'month',
  14,                   // 14-day trial
  '["unlimited-projects", "api-access", "priority-support"]',
  1,
]);
```

## Currencies

Stripe supports 135+ currencies. Set the default in `configure()`:

```typescript
Stripe.configure({
  // ...
  currency: 'eur',  // Euro
});
```

When creating prices, specify the currency:

```typescript
const price = await client.prices.create({
  product: product.id,
  unit_amount: 2900,
  currency: 'eur',
  recurring: { interval: 'month' },
});
```

Common currency codes: `usd`, `eur`, `gbp`, `cad`, `aud`, `jpy`, `brl`, `inr`, `mxn`.

Note: amounts are always in the smallest currency unit (cents for USD/EUR, yen for JPY).

## Customers

### Create a Customer

```typescript
import { Stripe } from '@beeblock/svelar-stripe';

const customer = await Stripe.service().createCustomer({
  id: user.id,
  name: user.name,
  email: user.email,
});

// Save the Stripe customer ID to your user
await User.query().where('id', user.id).update({
  stripe_customer_id: customer.id,
});
```

### Retrieve a Customer

```typescript
const customer = await Stripe.service().getCustomer(user.stripe_customer_id);
```

### Update a Customer

```typescript
await Stripe.service().updateCustomer(user.stripe_customer_id, {
  name: 'New Name',
  email: 'new@email.com',
});
```

## Subscriptions

### Create a Subscription

```typescript
import { Stripe } from '@beeblock/svelar-stripe';

const subscription = await Stripe.service().createSubscription(
  user.stripe_customer_id,
  'price_xxxxx',  // Stripe Price ID
  {
    trialDays: 14,
    metadata: { userId: String(user.id) },
  },
);
```

### Using SubscriptionManager

For higher-level subscription operations with database sync:

```typescript
import { Stripe } from '@beeblock/svelar-stripe';

// Initialize with repositories (do this once in app.ts)
Stripe.initSubscriptions({
  subscriptionRepository: mySubscriptionRepo,
  planRepository: myPlanRepo,
  userRepository: myUserRepo,
});

// Subscribe a user to a plan
const subscription = await Stripe.subscriptions().subscribe(userId, planId, {
  trialDays: 14,
});

// Upgrade (prorated)
await Stripe.subscriptions().upgrade(userId, newPlanId);

// Downgrade (at next billing cycle)
await Stripe.subscriptions().downgrade(userId, newPlanId);

// Cancel at end of billing period
await Stripe.subscriptions().cancel(userId);

// Cancel immediately
await Stripe.subscriptions().cancel(userId, true);

// Resume a canceled subscription
await Stripe.subscriptions().resume(userId);

// Check subscription status
const isSubscribed = await Stripe.subscriptions().isSubscribed(userId);
const isOnTrial = await Stripe.subscriptions().onTrial(userId);
const hasFeature = await Stripe.subscriptions().hasFeature(userId, 'api-access');

// Sync subscription data from Stripe
await Stripe.subscriptions().syncFromStripe(userId);
```

### Cancel a Subscription

```typescript
// Cancel at end of billing period (user keeps access until period ends)
await Stripe.service().cancelSubscription(subscriptionId, false);

// Cancel immediately (access revoked now)
await Stripe.service().cancelSubscription(subscriptionId, true);
```

### Resume a Canceled Subscription

```typescript
// Only works if subscription hasn't expired yet
await Stripe.service().resumeSubscription(subscriptionId);
```

### Update a Subscription (Change Plan)

```typescript
await Stripe.service().updateSubscription(
  subscriptionId,
  'price_new_plan',
  { proration: 'create_prorations' },  // or 'none'
);
```

## Checkout Sessions

Create a Stripe Checkout session to redirect users to Stripe's hosted payment page:

```typescript
const session = await Stripe.service().createCheckoutSession(
  user.stripe_customer_id,
  'price_xxxxx',
  'https://yourapp.com/dashboard?status=success',
  'https://yourapp.com/dashboard?status=canceled',
  {
    trialDays: 14,
    metadata: { userId: String(user.id) },
  },
);

// Redirect user to session.url
throw redirect(303, session.url!);
```

## Customer Portal

Let users manage their payment methods, view invoices, and update billing info via Stripe's hosted portal:

```typescript
const session = await Stripe.service().createPortalSession(
  user.stripe_customer_id,
  'https://yourapp.com/dashboard/billing',  // Return URL
);

throw redirect(303, session.url);
```

To enable the Customer Portal, configure it in [Stripe Dashboard > Settings > Customer portal](https://dashboard.stripe.com/settings/billing/portal).

## Invoices

```typescript
// List user's invoices
const invoices = await Stripe.service().getInvoices(user.stripe_customer_id, 10);

// Get a specific invoice
const invoice = await Stripe.service().getInvoice('in_xxxxx');
```

## Refunds

```typescript
// Refund an invoice
const refund = await Stripe.service().refundInvoice('in_xxxxx');

// Get refund details
const details = await Stripe.service().getRefund(refund.id);

// List refunds for a charge
const refunds = await Stripe.service().listRefunds('ch_xxxxx');
```

## Webhook Events

Register handlers for Stripe webhook events in `app.ts`:

```typescript
import { Stripe } from '@beeblock/svelar-stripe';

// Handle subscription changes
Stripe.webhooks()
  .on('customer.subscription.created', async (event) => {
    const subscription = event.data.object;
    console.log('New subscription:', subscription.id);
    // Sync to your database, send welcome email, etc.
  })
  .on('customer.subscription.updated', async (event) => {
    const subscription = event.data.object;
    // Update local subscription record
  })
  .on('customer.subscription.deleted', async (event) => {
    const subscription = event.data.object;
    // Mark subscription as canceled in your database
  });

// Handle payment events
Stripe.webhooks()
  .on('invoice.payment_succeeded', async (event) => {
    const invoice = event.data.object;
    // Record successful payment, unlock access
  })
  .on('invoice.payment_failed', async (event) => {
    const invoice = event.data.object;
    // Notify user, pause access, retry logic
  });

// Handle checkout completion
Stripe.webhooks()
  .on('checkout.session.completed', async (event) => {
    const session = event.data.object;
    // Fulfill the order, activate subscription
  });

// Handle refunds
Stripe.webhooks()
  .on('charge.refunded', async (event) => {
    const charge = event.data.object;
    // Update invoice status, notify user
  });
```

### Supported Event Types

| Event | When it fires |
|-------|--------------|
| `customer.subscription.created` | New subscription created |
| `customer.subscription.updated` | Subscription plan changed, status changed |
| `customer.subscription.deleted` | Subscription canceled or expired |
| `invoice.payment_succeeded` | Payment collected successfully |
| `invoice.payment_failed` | Payment attempt failed |
| `checkout.session.completed` | Customer completed checkout |
| `customer.created` | New customer created |
| `customer.updated` | Customer info updated |
| `customer.deleted` | Customer deleted |
| `invoice.created` | New invoice generated |
| `invoice.finalized` | Invoice finalized and ready for payment |
| `charge.refunded` | Charge was refunded |

You can also listen for any Stripe event type as a string.

### One-time Handlers

```typescript
Stripe.webhooks().once('checkout.session.completed', async (event) => {
  // Only fires once, then auto-removes
});
```

## Routes & Controllers

The plugin publishes route stubs when installed via `npx svelar plugin:install @beeblock/svelar-stripe`. You can also create them manually:

### API Routes

| Route | Method | Controller | Description |
|-------|--------|------------|-------------|
| `/api/webhooks/stripe` | POST | `StripeWebhookController.handleWebhook` | Webhook endpoint (CSRF excluded) |
| `/api/admin/billing/subscriptions` | GET | `BillingController.listSubscriptions` | List all subscriptions |
| `/api/admin/billing/cancel` | POST | `BillingController.cancelSubscription` | Cancel a subscription |
| `/api/admin/billing/refund` | POST | `BillingController.refundInvoice` | Refund an invoice |

These use controllers from `@beeblock/svelar-stripe/server`:

```typescript
// src/routes/api/admin/billing/subscriptions/+server.ts
import { BillingController } from '@beeblock/svelar-stripe/server';

const ctrl = new BillingController();
export const GET = ctrl.handle('listSubscriptions');
```

```typescript
// src/routes/api/webhooks/stripe/+server.ts
import { StripeWebhookController } from '@beeblock/svelar-stripe/server';

const ctrl = new StripeWebhookController();
export const POST = ctrl.handle('handleWebhook');
```

You can extend these controllers to add custom auth checks or behavior:

```typescript
import { BillingController } from '@beeblock/svelar-stripe/server';
import { Gate } from '@beeblock/svelar/auth';

class MyBillingController extends BillingController {
  async listSubscriptions(event: any) {
    if (await Gate.denies('admin-access', event.locals.user)) {
      return this.json({ message: 'Unauthorized' }, 403);
    }
    return super.listSubscriptions(event);
  }
}
```

## Products & Prices API

```typescript
// List all products
const products = await Stripe.service().listProducts();

// List all prices (optionally filtered by product)
const prices = await Stripe.service().listPrices();
const proPrices = await Stripe.service().listPrices('prod_xxxxx');
```

## Testing with Stripe CLI

For local development:

```bash
# Install Stripe CLI: https://stripe.com/docs/stripe-cli
stripe login

# Forward webhooks to your local server
stripe listen --forward-to localhost:5173/api/webhooks/stripe

# Trigger test events
stripe trigger customer.subscription.created
stripe trigger invoice.payment_succeeded
```

Use Stripe test mode keys (prefixed with `sk_test_` and `pk_test_`) during development. Test card numbers:
- **Success**: `4242 4242 4242 4242`
- **Decline**: `4000 0000 0000 0002`
- **Requires auth**: `4000 0025 0000 3155`

## Complete Example: SaaS Pricing Flow

```typescript
// 1. Configure in app.ts
Stripe.configure({
  secretKey: process.env.STRIPE_SECRET_KEY!,
  publishableKey: process.env.STRIPE_PUBLISHABLE_KEY!,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
  currency: 'usd',
});

// 2. Register webhook handlers in app.ts
Stripe.webhooks()
  .on('customer.subscription.created', async (event) => {
    const sub = event.data.object as any;
    const userId = sub.metadata?.userId;
    if (userId) {
      // Update user's subscription in your database
    }
  })
  .on('invoice.payment_failed', async (event) => {
    const invoice = event.data.object as any;
    // Send payment failed notification
  });

// 3. Pricing page — create checkout session
// src/routes/pricing/+page.server.ts
export const actions = {
  subscribe: async ({ locals }) => {
    const user = locals.user;
    const service = Stripe.service();

    // Create or get Stripe customer
    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await service.createCustomer({
        id: user.id,
        email: user.email,
        name: user.name,
      });
      customerId = customer.id;
      await User.query().where('id', user.id).update({
        stripe_customer_id: customerId,
      });
    }

    // Create checkout session
    const session = await service.createCheckoutSession(
      customerId,
      'price_xxxxx',  // Your price ID
      'https://yourapp.com/dashboard?status=success',
      'https://yourapp.com/pricing?status=canceled',
    );

    throw redirect(303, session.url!);
  },
};
```
