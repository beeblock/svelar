// Admin billing subscriptions endpoint for @beeblock/svelar-stripe
// Copy to: src/routes/api/admin/billing/subscriptions/+server.ts

import { BillingController } from '@beeblock/svelar-stripe/server';

const ctrl = new BillingController();

export const GET = ctrl.handle('listSubscriptions');
