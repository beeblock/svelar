// Admin billing refund endpoint for @beeblock/svelar-stripe
// Copy to: src/routes/api/admin/billing/refund/+server.ts

import { BillingController } from '@beeblock/svelar-stripe/server';

const ctrl = new BillingController();

export const POST = ctrl.handle('refundInvoice');
