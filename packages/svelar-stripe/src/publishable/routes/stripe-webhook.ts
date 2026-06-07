// Stripe webhook endpoint for @beeblock/svelar-stripe
// Copy to: src/routes/api/webhooks/stripe/+server.ts

import { StripeWebhookController } from '@beeblock/svelar-stripe/server';

const ctrl = new StripeWebhookController();

export const POST = ctrl.handle('handleWebhook');
