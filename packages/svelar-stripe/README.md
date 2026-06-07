# Svelar Stripe

Stripe billing plugin for Svelar. It provides a polymorphic `Billable` mixin, Svelar ORM models, focused migrations, Stripe Checkout and Billing Portal helpers, signed webhook handling, subscription and invoice resources, and guarded admin billing endpoints.

## Install

```bash
npm install @beeblock/svelar-stripe stripe
npx svelar plugin:install @beeblock/svelar-stripe
npx svelar migrate
```

## Configure

```ts
import { env } from '@beeblock/svelar/config';
import { Stripe, registerDefaultWebhookHandlers } from '@beeblock/svelar-stripe';
import { User } from '$lib/modules/users/domain/models/User.js';

Stripe.configure({
  secretKey: env('STRIPE_SECRET_KEY'),
  publishableKey: env('STRIPE_PUBLISHABLE_KEY'),
  webhookSecret: env('STRIPE_WEBHOOK_SECRET'),
  currency: 'usd',
  adminGuard: (event) => event.locals.user?.role === 'admin',
});

Stripe.registerBillable(User);
registerDefaultWebhookHandlers(Stripe.webhooks());
```

The published admin routes deny every request until `adminGuard` is configured. The webhook route verifies the Stripe signature using the raw request body before dispatching registered handlers.

See the Svelar documentation for the full billing guide.
