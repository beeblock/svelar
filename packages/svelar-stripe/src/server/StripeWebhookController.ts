import { Controller } from '@beeblock/svelar/routing';
import { Log } from '@beeblock/svelar/logging';

// Webhook controller for Stripe signature verification and event dispatch.
//
// Usage:
//   // src/routes/api/webhooks/stripe/+server.ts
//   import { StripeWebhookController } from '@beeblock/svelar-stripe/server';
//   const ctrl = new StripeWebhookController();
//   export const POST = ctrl.handle('handleWebhook');

export class StripeWebhookController extends Controller {
  async handleWebhook(event: any): Promise<Response> {
    const signature = event.request.headers.get('stripe-signature');
    if (!signature) {
      return this.json({
        data: null,
        meta: {
          message: 'Missing Stripe signature',
          code: 'stripe_signature_missing',
        },
      }, 400);
    }

    const { Stripe } = await import('../index.js');
    const body = await event.request.text();
    let stripeEvent: any;

    try {
      stripeEvent = await Stripe.service().constructWebhookEvent(body, signature);
    } catch (error: unknown) {
      if (Stripe.logging) {
        Log.error('[svelar-stripe] Webhook signature verification failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      return this.json({
        data: null,
        meta: {
          message: 'Invalid Stripe signature',
          code: 'stripe_signature_invalid',
        },
      }, 400);
    }

    if (Stripe.logging) {
      Log.info(`[svelar-stripe] Webhook received: ${stripeEvent.type}`);
    }
    await Stripe.webhooks().handle(stripeEvent);

    return this.json({
      data: {
        received: true,
      },
    });
  }
}
