import { Resource } from '@beeblock/svelar/routing';
import type { Subscription } from '../Subscription.js';

export interface SubscriptionData {
  id: number;
  billableType: string;
  billableId: number;
  name: string;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  stripePriceId: string;
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  isActive: boolean;
  isOnTrial: boolean;
  isOnGracePeriod: boolean;
  daysUntilEnd: number;
  createdAt: string | null;
}

export class SubscriptionResource extends Resource<Subscription, SubscriptionData> {
  toJSON(): SubscriptionData {
    const sub = this.data;
    return {
      id: (sub as any).id,
      billableType: (sub as any).billable_type,
      billableId: (sub as any).billable_id,
      name: (sub as any).name,
      stripeSubscriptionId: (sub as any).stripe_subscription_id,
      stripeCustomerId: (sub as any).stripe_customer_id,
      stripePriceId: (sub as any).stripe_price_id,
      status: (sub as any).status,
      currentPeriodStart: (sub as any).current_period_start,
      currentPeriodEnd: (sub as any).current_period_end,
      trialEndsAt: (sub as any).trial_ends_at,
      cancelAtPeriodEnd: (sub as any).cancel_at_period_end === 1,
      canceledAt: (sub as any).canceled_at,
      isActive: sub.isActive(),
      isOnTrial: sub.isOnTrial(),
      isOnGracePeriod: sub.isOnGracePeriod(),
      daysUntilEnd: sub.daysUntilEnd(),
      createdAt: (sub as any).created_at,
    };
  }

  // Transform a raw Stripe API subscription object (from client.subscriptions.list)
  static fromStripe(sub: any): Record<string, any> {
    return {
      id: sub.id,
      status: sub.status,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      customer: {
        id: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id,
        email: typeof sub.customer === 'object' ? sub.customer?.email : null,
        name: typeof sub.customer === 'object' ? sub.customer?.name : null,
      },
      plan: {
        nickname: sub.items?.data?.[0]?.price?.nickname ?? 'Plan',
        amount: sub.items?.data?.[0]?.price?.unit_amount ?? 0,
        currency: sub.items?.data?.[0]?.price?.currency ?? 'usd',
        interval: sub.items?.data?.[0]?.price?.recurring?.interval ?? 'month',
      },
      created: sub.created,
    };
  }
}
