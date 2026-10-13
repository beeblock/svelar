import { Log } from '@beeblock/svelar/logging';
import type { StripeWebhookHandler } from './StripeWebhookHandler.js';
import { Subscription } from './Subscription.js';
import { Invoice } from './Invoice.js';
import { invoiceSubscriptionId, legacyChargeInvoiceId, stripeObjectId, subscriptionDates } from './StripeApiShapes.js';

// Register default webhook handlers that sync Stripe events to the local DB.
// Call once in app.ts:
//
//   import { Stripe, registerDefaultWebhookHandlers } from '@beeblock/svelar-stripe';
//   registerDefaultWebhookHandlers(Stripe.webhooks());
export function registerDefaultWebhookHandlers(webhooks: StripeWebhookHandler): void {
  // -- Subscription events --

  webhooks.on('customer.subscription.created', safe(async (event) => {
    const stripeSub = event.data.object;
    const billableType = stripeSub.metadata?.billable_type;
    const billableId = stripeSub.metadata?.billable_id ? Number(stripeSub.metadata.billable_id) : null;
    if (!billableType || !billableId) return;

    const existing = await Subscription.findByStripeSubscriptionId(stripeSub.id);
    if (existing) return;

    const priceId = stripeSub.items?.data?.[0]?.price?.id;
    if (!priceId) return;

    await Subscription.create({
      billable_type: billableType,
      billable_id: billableId,
      name: stripeSub.metadata?.subscription_name ?? 'default',
      stripe_subscription_id: stripeSub.id,
      stripe_customer_id: typeof stripeSub.customer === 'string' ? stripeSub.customer : stripeSub.customer?.id,
      stripe_price_id: priceId,
      status: stripeSub.status,
      ...subscriptionDates(stripeSub, priceId),
      cancel_at_period_end: stripeSub.cancel_at_period_end ? 1 : 0,
    });
  }));

  webhooks.on('customer.subscription.updated', safe(async (event) => {
    const stripeSub = event.data.object;
    const existing = await Subscription.findByStripeSubscriptionId(stripeSub.id);
    if (!existing) return;

    const priceId = stripeSub.items?.data?.[0]?.price?.id;
    const dates = subscriptionDates(stripeSub, priceId);
    await existing.update({
      status: stripeSub.status,
      stripe_price_id: priceId ?? (existing as any).stripe_price_id,
      ...dates,
      current_period_start: dates.current_period_start ?? existing.getAttribute('current_period_start'),
      current_period_end: dates.current_period_end ?? existing.getAttribute('current_period_end'),
      cancel_at_period_end: stripeSub.cancel_at_period_end ? 1 : 0,
    });
  }));

  webhooks.on('customer.subscription.deleted', safe(async (event) => {
    const stripeSub = event.data.object;
    const existing = await Subscription.findByStripeSubscriptionId(stripeSub.id);
    if (!existing) return;

    await existing.update({
      status: 'canceled',
      canceled_at: new Date().toISOString(),
    });
  }));

  // -- Invoice events --

  webhooks.on('invoice.payment_succeeded', safe(async (event) => {
    await syncInvoice(event.data.object);
  }));

  webhooks.on('invoice.payment_failed', safe(async (event) => {
    await syncInvoice(event.data.object);
  }));

  webhooks.on('invoice.created', safe(async (event) => {
    await syncInvoice(event.data.object);
  }));

  webhooks.on('invoice.finalized', safe(async (event) => {
    await syncInvoice(event.data.object);
  }));

  // -- Checkout events --

  webhooks.on('checkout.session.completed', safe(async (event) => {
    const session = event.data.object;

    // For subscription mode, the customer.subscription.created handler already syncs.
    // For payment mode (one-time purchases), sync the invoice if present.
    if (session.mode === 'payment' && session.invoice) {
      const invoiceId = typeof session.invoice === 'string' ? session.invoice : session.invoice?.id;
      if (invoiceId) {
        const { Stripe } = await import('./index.js');
        const stripeInvoice = await Stripe.service().getInvoice(invoiceId);
        await syncInvoice(stripeInvoice);
      }
    }
  }));

  // -- Refund events --

  webhooks.on('charge.refunded', safe(async (event) => {
    const charge = event.data.object;
    let invoiceId = legacyChargeInvoiceId(charge);
    if (!invoiceId) {
      const paymentIntentId = stripeObjectId(charge.payment_intent);
      if (!paymentIntentId) return;
      const { Stripe } = await import('./index.js');
      const client = await Stripe.service().getClient();
      const payments = await client.invoicePayments.list({
        payment: { type: 'payment_intent', payment_intent: paymentIntentId }, status: 'paid', limit: 2,
      });
      if (payments.has_more || payments.data.length > 1) {
        throw new Error('Refund spans multiple invoice payments; reconcile invoice allocations explicitly.');
      }
      invoiceId = stripeObjectId(payments.data[0]?.invoice);
    }
    if (!invoiceId) return;

    const existing = await Invoice.findByStripeInvoiceId(invoiceId);
    if (!existing) return;

    const refunded = charge.amount_refunded ?? 0;
    const total = charge.amount ?? 0;
    if (existing.getAttribute('amount_paid') !== total) {
      throw new Error('Refund charge and invoice paid amounts differ; reconcile invoice allocations explicitly.');
    }
    await existing.update({
      status: refunded >= total ? 'refunded' : 'partially_refunded',
    });
  }));
}

// Wrap a handler so DB/network errors are logged but don't cause Stripe to retry forever.
// Returns 200 to Stripe even if local sync fails — the data can be reconciled later via syncFromStripe().
function safe(handler: (event: any) => Promise<void>): (event: any) => Promise<void> {
  return async (event: any) => {
    try {
      await handler(event);
    } catch (err: unknown) {
      // Dynamic import to avoid circular dependency at module load time
      const { Stripe } = await import('./index.js');
      if (Stripe.logging) {
        Log.error(`[svelar-stripe] Webhook handler error for ${event.type}`, {
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
      }
    }
  };
}

async function syncInvoice(stripeInvoice: any): Promise<void> {
  const stripeSubId = invoiceSubscriptionId(stripeInvoice);

  let billableType = stripeInvoice.metadata?.billable_type;
  let billableId = stripeInvoice.metadata?.billable_id ? Number(stripeInvoice.metadata.billable_id) : null;
  let subscriptionId: number | null = null;

  if (stripeSubId) {
    const sub = await Subscription.findByStripeSubscriptionId(stripeSubId);
    if (sub) {
      billableType = billableType ?? (sub as any).billable_type;
      billableId = billableId ?? (sub as any).billable_id;
      subscriptionId = (sub as any).id;
    }
  }

  if (!billableType || !billableId) return;

  const existing = await Invoice.findByStripeInvoiceId(stripeInvoice.id);
  const data = {
    billable_type: billableType,
    billable_id: billableId,
    subscription_id: subscriptionId,
    stripe_invoice_id: stripeInvoice.id,
    amount_due: stripeInvoice.amount_due ?? 0,
    amount_paid: stripeInvoice.amount_paid ?? 0,
    currency: stripeInvoice.currency ?? 'usd',
    status: stripeInvoice.status ?? 'draft',
    paid_at: stripeInvoice.status === 'paid' ? new Date().toISOString() : null,
    due_date: stripeInvoice.due_date ? new Date(stripeInvoice.due_date * 1000).toISOString() : null,
    invoice_pdf: stripeInvoice.invoice_pdf ?? null,
  };

  if (existing) {
    await existing.update(data);
  } else {
    await Invoice.create(data);
  }
}
