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
import { capabilityAccess, resolveCapabilityInput } from '$lib/shared/permissions/access.server.js';

Stripe.configure({
  secretKey: env('STRIPE_SECRET_KEY'),
  publishableKey: env('STRIPE_PUBLISHABLE_KEY'),
  webhookSecret: env('STRIPE_WEBHOOK_SECRET'),
  currency: 'usd',
  adminGuard: async (event, capability) => {
    const input = resolveCapabilityInput(event);
    return input !== null && await capabilityAccess.can(capability, input);
  },
});

Stripe.registerBillable(User);
registerDefaultWebhookHandlers(Stripe.webhooks());
```

## Billable Identifiers

`Billable(Model)` reads the model's configured `primaryKey` with `getAttribute`; it supports positive safe integer IDs and canonical string IDs, including UUID v7, ULID, and custom-named primary keys. Register each billable model by its distinct table name. Billing service and queued customer-sync inputs accept `string | number`; numeric `1` and string `'1'` identify the same owner. Empty, ambiguous numeric, whitespace/control-containing, reserved prototype, and over-255-character IDs are rejected rather than coerced.

The plugin's initial alpha migrations store polymorphic `billable_id` as `VARCHAR(255)` without a foreign key to a host table. Subscription and invoice primary keys, and the invoice-to-subscription foreign key, remain integers. Subscription/invoice resources return canonical string `billableId` values. Exact string ownership checks also apply on case/accent-insensitive host databases. Caller metadata cannot replace the reserved billable identity; invoice events linked to a local subscription use that subscription's owner rather than editable invoice metadata.

Before running migrations, adapt the published `add_stripe_customer_id_to_billable` migration for each registered host table. Existing alpha installations with integer `billable_id` columns must run an app-owned focused data-preserving migration to `VARCHAR(255)` before accepting UUID/ULID owners; changing this package's initial migration does not alter an already migrated database. Do not add a polymorphic foreign key to a differently typed host primary key.

The published admin routes require request-local Core Auth with an authenticated user, then deny every request until `adminGuard` returns boolean `true` for the requested capability. A forged `locals.user` without Core Auth is insufficient. The example uses the generated app's server-only capability resolver, which preserves trusted team/platform scope and API-key permission ceilings; adapt its import to your app layout.

Register these capabilities in your app permission manifest with the intended scope and assign grants through seeders or your permission-management flow:

- `screen.billing.view` for listing subscriptions.
- `action.billing.cancel` for cancelling a subscription.
- `action.billing.refund` for refunding an invoice.

Do not treat a team role named `admin` as global billing authority. Cancel/refund FormRequests independently enforce the same operation capability. Keep the app's session and CSRF middleware enabled for browser writes.

The webhook route verifies the Stripe signature using the raw request body before dispatching registered handlers; it does not use the admin capability guard.

See the Svelar documentation for the full billing guide.
