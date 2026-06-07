import { Plugin } from '@beeblock/svelar/plugins';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const distDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = dirname(distDir);
const pub = join(packageRoot, 'src', 'publishable');

export class SvelarStripePlugin extends Plugin {
  readonly name = 'svelar-stripe';
  readonly version = '0.1.0';
  readonly description = 'Stripe billing plugin for Svelar — subscriptions, one-time payments, checkout, invoices, webhooks, and polymorphic Billable mixin';

  publishables() {
    return {
      migrations: [
        { source: join(pub, 'migrations/add_stripe_customer_id_to_billable.ts'), dest: 'src/lib/database/migrations/add_stripe_customer_id_to_billable.ts', type: 'migration' as const },
        { source: join(pub, 'migrations/create_subscription_plans.ts'), dest: 'src/lib/database/migrations/create_subscription_plans.ts', type: 'migration' as const },
        { source: join(pub, 'migrations/create_subscriptions.ts'), dest: 'src/lib/database/migrations/create_subscriptions.ts', type: 'migration' as const },
        { source: join(pub, 'migrations/create_invoices.ts'), dest: 'src/lib/database/migrations/create_invoices.ts', type: 'migration' as const },
      ],
      routes: [
        { source: join(pub, 'routes/stripe-webhook.ts'), dest: 'src/routes/api/webhooks/stripe/+server.ts', type: 'asset' as const },
        { source: join(pub, 'routes/billing-subscriptions.ts'), dest: 'src/routes/api/admin/billing/subscriptions/+server.ts', type: 'asset' as const },
        { source: join(pub, 'routes/billing-cancel.ts'), dest: 'src/routes/api/admin/billing/cancel/+server.ts', type: 'asset' as const },
        { source: join(pub, 'routes/billing-refund.ts'), dest: 'src/routes/api/admin/billing/refund/+server.ts', type: 'asset' as const },
      ],
    };
  }
}
