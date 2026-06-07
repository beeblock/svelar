import { Controller } from '@beeblock/svelar/routing';
import { CancelSubscriptionRequest } from './CancelSubscriptionRequest.js';
import { RefundRequest } from './RefundRequest.js';
import { SubscriptionResource } from './SubscriptionResource.js';

// Admin billing controller for Stripe operations.
//
// Usage:
//   // src/routes/api/admin/billing/subscriptions/+server.ts
//   import { BillingController } from '@beeblock/svelar-stripe/server';
//   const ctrl = new BillingController();
//   export const GET = ctrl.handle('listSubscriptions');

export class BillingController extends Controller {
  private async getStripeManager(): Promise<any> {
    const { Stripe } = await import('../index.js');
    return Stripe;
  }

  private async getStripe(): Promise<any> {
    const manager = await this.getStripeManager();
    return manager.service();
  }

  private async authorizeAdmin(event: any): Promise<Response | null> {
    const manager = await this.getStripeManager();
    if (await manager.authorizeAdmin(event)) return null;

    return this.json({
      data: null,
      meta: {
        message: 'Forbidden',
        code: 'stripe_admin_forbidden',
      },
    }, 403);
  }

  async listSubscriptions(event: any): Promise<Response> {
    const forbidden = await this.authorizeAdmin(event);
    if (forbidden) return forbidden;

    const requestedLimit = Number(event.url.searchParams.get('limit') ?? '25');
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(100, Math.max(1, requestedLimit))
      : 25;
    const startingAfter = event.url.searchParams.get('starting_after') ?? undefined;

    const stripe = await this.getStripe();
    const client = await stripe.getClient();
    const subs = await client.subscriptions.list({
      limit,
      starting_after: startingAfter,
      expand: ['data.customer'],
    });

    const data = subs.data.map((sub: any) => SubscriptionResource.fromStripe(sub));
    return this.json({
      data: {
        subscriptions: data,
      },
      meta: {
        hasMore: subs.has_more,
      },
    });
  }

  async cancelSubscription(event: any): Promise<Response> {
    const forbidden = await this.authorizeAdmin(event);
    if (forbidden) return forbidden;

    const data = await CancelSubscriptionRequest.validate(event);

    const stripe = await this.getStripe();
    const sub = await stripe.cancelSubscription(data.subscriptionId, data.immediately);

    return this.json({
      data: {
        subscription: {
          id: sub.id,
          status: sub.status,
          cancelAtPeriodEnd: sub.cancel_at_period_end,
        },
      },
      meta: {
        message: 'Subscription cancellation requested',
      },
    });
  }

  async refundInvoice(event: any): Promise<Response> {
    const forbidden = await this.authorizeAdmin(event);
    if (forbidden) return forbidden;

    const data = await RefundRequest.validate(event);

    const stripe = await this.getStripe();
    const refund = await stripe.refundInvoice(data.invoiceId);

    return this.json({
      data: {
        refund: {
          id: refund.id,
          amount: refund.amount,
          status: refund.status,
        },
      },
      meta: {
        message: 'Invoice refund requested',
      },
    });
  }
}
