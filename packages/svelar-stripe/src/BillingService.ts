import type { StripeService } from './StripeService.js';
import { Subscription } from './Subscription.js';

function periodStart(sub: any): string | null {
  const v = sub.current_period_start;
  if (!v) return null;
  return typeof v === 'number' ? new Date(v * 1000).toISOString() : new Date(v).toISOString();
}

function periodEnd(sub: any): string | null {
  const v = sub.current_period_end;
  if (!v) return null;
  return typeof v === 'number' ? new Date(v * 1000).toISOString() : new Date(v).toISOString();
}

function trialEnd(sub: any): string | null {
  const v = sub.trial_end;
  if (!v) return null;
  return typeof v === 'number' ? new Date(v * 1000).toISOString() : new Date(v).toISOString();
}

function canceledAt(sub: any): string | null {
  const v = sub.canceled_at;
  if (!v) return null;
  return typeof v === 'number' ? new Date(v * 1000).toISOString() : new Date(v).toISOString();
}

// Resolve billable Model class from Stripe registry
async function resolveBillableModel(billableType: string): Promise<any> {
  const { Stripe } = await import('./index.js');
  return Stripe.getBillableModel(billableType);
}

// High-level orchestration service for billing operations.
export class BillingService {
  constructor(private stripeService: StripeService) {}

  private async ensureCustomer(
    billableType: string,
    billableId: number,
  ): Promise<string> {
    const BillableModel = await resolveBillableModel(billableType);
    const record = await BillableModel.find(billableId);
    if (!record) throw new Error(`${billableType} #${billableId} not found`);

    if (record.stripe_customer_id) return record.stripe_customer_id;

    const customer = await this.stripeService.createCustomer({
      id: billableId,
      name: record.name,
      email: record.email,
      billableType,
    });

    // Race-safe: only set if still null
    await BillableModel.where(BillableModel.primaryKey ?? 'id', billableId)
      .whereNull('stripe_customer_id')
      .update({ stripe_customer_id: customer.id });

    // Re-read to get the winning customer ID
    const updated = await BillableModel.find(billableId);
    return updated?.stripe_customer_id ?? customer.id;
  }

  async subscribe(
    billableType: string,
    billableId: number,
    priceId: string,
    opts?: { name?: string; trialDays?: number; metadata?: Record<string, string> },
  ): Promise<Subscription> {
    const customerId = await this.ensureCustomer(billableType, billableId);
    const subName = opts?.name ?? 'default';

    const stripeSub = await this.stripeService.createSubscription(customerId, priceId, {
      trialDays: opts?.trialDays,
      metadata: {
        billable_type: billableType,
        billable_id: String(billableId),
        ...opts?.metadata,
      },
    });

    return Subscription.create({
      billable_type: billableType,
      billable_id: billableId,
      name: subName,
      stripe_subscription_id: stripeSub.id,
      stripe_customer_id: customerId,
      stripe_price_id: priceId,
      status: stripeSub.status,
      current_period_start: periodStart(stripeSub),
      current_period_end: periodEnd(stripeSub),
      trial_ends_at: trialEnd(stripeSub),
      cancel_at_period_end: stripeSub.cancel_at_period_end ? 1 : 0,
      canceled_at: canceledAt(stripeSub),
    });
  }

  async changePlan(
    subscriptionId: string,
    newPriceId: string,
    proration: 'create_prorations' | 'none' = 'create_prorations',
  ): Promise<Subscription> {
    const record = await Subscription.findByStripeSubscriptionId(subscriptionId);
    if (!record) throw new Error(`Subscription ${subscriptionId} not found`);

    const stripeSub = await this.stripeService.updateSubscription(
      subscriptionId, newPriceId, { proration },
    );

    await record.update({
      stripe_price_id: newPriceId,
      status: stripeSub.status,
      current_period_start: periodStart(stripeSub),
      current_period_end: periodEnd(stripeSub),
    });

    return record;
  }

  async cancel(
    subscriptionId: string,
    immediately: boolean = false,
  ): Promise<void> {
    const record = await Subscription.findByStripeSubscriptionId(subscriptionId);
    if (!record) throw new Error(`Subscription ${subscriptionId} not found`);

    await this.stripeService.cancelSubscription(subscriptionId, immediately);

    if (immediately) {
      await record.update({
        status: 'canceled',
        canceled_at: new Date().toISOString(),
      });
    } else {
      await record.update({
        cancel_at_period_end: 1,
      });
    }
  }

  async resume(subscriptionId: string): Promise<Subscription> {
    const record = await Subscription.findByStripeSubscriptionId(subscriptionId);
    if (!record) throw new Error(`Subscription ${subscriptionId} not found`);

    const stripeSub = await this.stripeService.resumeSubscription(subscriptionId);

    await record.update({
      cancel_at_period_end: 0,
      canceled_at: null,
      status: stripeSub.status,
    });

    return record;
  }

  async charge(
    billableType: string,
    billableId: number,
    amount: number,
    paymentMethodId: string,
    opts?: { currency?: string; metadata?: Record<string, string> },
  ): Promise<any> {
    const customerId = await this.ensureCustomer(billableType, billableId);
    return this.stripeService.createPaymentIntent(customerId, amount, paymentMethodId, opts);
  }

  async checkout(
    billableType: string,
    billableId: number,
    items: Array<{ priceId: string; quantity?: number }>,
    opts: { mode?: 'subscription' | 'payment'; successUrl: string; cancelUrl: string; trialDays?: number },
  ): Promise<any> {
    const customerId = await this.ensureCustomer(billableType, billableId);
    return this.stripeService.createCheckoutSession(
      customerId,
      items.map((i) => ({ price: i.priceId, quantity: i.quantity })),
      {
        ...opts,
        metadata: {
          billable_type: billableType,
          billable_id: String(billableId),
        },
      },
    );
  }

  async syncFromStripe(
    billableType: string,
    billableId: number,
    subName: string = 'default',
  ): Promise<Subscription> {
    const BillableModel = await resolveBillableModel(billableType);
    const record = await BillableModel.find(billableId);
    if (!record?.stripe_customer_id) {
      throw new Error(`${billableType} #${billableId} has no Stripe customer`);
    }

    const client = await this.stripeService.getClient();
    const subscriptions = await client.subscriptions.list({
      customer: record.stripe_customer_id, status: 'active', limit: 1,
    });

    if (subscriptions.data.length === 0) {
      throw new Error(`${billableType} #${billableId} has no active Stripe subscription`);
    }

    const stripeSub = subscriptions.data[0];
    const priceId = stripeSub.items.data[0]?.price?.id as string;

    const existing = await Subscription.findByStripeSubscriptionId(stripeSub.id);
    const data = {
      billable_type: billableType,
      billable_id: billableId,
      name: subName,
      stripe_subscription_id: stripeSub.id,
      stripe_customer_id: record.stripe_customer_id,
      stripe_price_id: priceId,
      status: stripeSub.status,
      current_period_start: periodStart(stripeSub),
      current_period_end: periodEnd(stripeSub),
      trial_ends_at: trialEnd(stripeSub),
      cancel_at_period_end: stripeSub.cancel_at_period_end ? 1 : 0,
      canceled_at: canceledAt(stripeSub),
    };

    if (existing) {
      await existing.update(data);
      return existing;
    }
    return Subscription.create(data);
  }
}
