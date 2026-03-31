import type { StripeService } from './StripeService.js';
import type { Subscription } from './Subscription.js';
import type { SubscriptionPlan } from './SubscriptionPlan.js';

function periodStart(sub: any): Date {
  const v = sub.current_period_start;
  return typeof v === 'number' ? new Date(v * 1000) : new Date(v);
}

function periodEnd(sub: any): Date {
  const v = sub.current_period_end;
  return typeof v === 'number' ? new Date(v * 1000) : new Date(v);
}

function trialEnd(sub: any): Date | null {
  const v = sub.trial_end;
  if (!v) return null;
  return typeof v === 'number' ? new Date(v * 1000) : new Date(v);
}

function canceledAt(sub: any): Date | null {
  const v = sub.canceled_at;
  if (!v) return null;
  return typeof v === 'number' ? new Date(v * 1000) : new Date(v);
}

export interface SubscriptionManagerDependencies {
  stripeService: StripeService;
  subscriptionRepository?: {
    findByUserId(userId: number): Promise<Subscription | null>;
    findByStripeSubscriptionId(id: string): Promise<Subscription | null>;
    create(data: any): Promise<Subscription>;
    update(id: number, data: any): Promise<Subscription>;
    delete(id: number): Promise<void>;
  };
  planRepository?: {
    findById(id: number): Promise<SubscriptionPlan | null>;
    findByStripePriceId(id: string): Promise<SubscriptionPlan | null>;
    all(): Promise<SubscriptionPlan[]>;
  };
  userRepository?: {
    findById(id: number): Promise<any>;
    update(id: number, data: any): Promise<any>;
  };
}

export class SubscriptionManager {
  private stripeService: StripeService;
  private deps: SubscriptionManagerDependencies;

  constructor(deps: SubscriptionManagerDependencies) {
    this.stripeService = deps.stripeService;
    this.deps = deps;
  }

  async subscribe(
    userId: number,
    planId: number,
    opts?: { trialDays?: number; metadata?: Record<string, string> },
  ): Promise<Subscription> {
    const user = await this.deps.userRepository?.findById(userId);
    if (!user) throw new Error(`User ${userId} not found`);

    const plan = await this.deps.planRepository?.findById(planId);
    if (!plan) throw new Error(`Plan ${planId} not found`);

    let stripeCustomerId = user.stripe_customer_id;
    if (!stripeCustomerId) {
      const customer = await this.stripeService.createCustomer({
        id: userId, name: user.name, email: user.email,
      });
      stripeCustomerId = customer.id;
      await this.deps.userRepository?.update(userId, { stripe_customer_id: stripeCustomerId });
    }

    const stripeSub = await this.stripeService.createSubscription(stripeCustomerId, plan.stripePriceId, {
      trialDays: opts?.trialDays || plan.trialDays,
      metadata: { userId: String(userId), planId: String(planId), ...opts?.metadata },
    });

    const subscription = await this.deps.subscriptionRepository?.create({
      user_id: userId,
      stripe_subscription_id: stripeSub.id,
      stripe_customer_id: stripeCustomerId,
      plan_id: planId,
      status: stripeSub.status,
      current_period_start: periodStart(stripeSub),
      current_period_end: periodEnd(stripeSub),
      trial_ends_at: trialEnd(stripeSub),
      cancel_at_period_end: stripeSub.cancel_at_period_end,
      canceled_at: canceledAt(stripeSub),
    });

    if (!subscription) throw new Error('Failed to create subscription record');
    return subscription;
  }

  async upgrade(userId: number, newPlanId: number): Promise<Subscription> {
    const current = await this.deps.subscriptionRepository?.findByUserId(userId);
    if (!current) throw new Error(`User ${userId} has no active subscription`);

    const newPlan = await this.deps.planRepository?.findById(newPlanId);
    if (!newPlan) throw new Error(`Plan ${newPlanId} not found`);

    const stripeSub = await this.stripeService.updateSubscription(
      current.stripeSubscriptionId, newPlan.stripePriceId, { proration: 'create_prorations' },
    );

    const updated = await this.deps.subscriptionRepository?.update(current.id, {
      plan_id: newPlanId,
      status: stripeSub.status,
      current_period_start: periodStart(stripeSub),
      current_period_end: periodEnd(stripeSub),
    });

    if (!updated) throw new Error('Failed to update subscription record');
    return updated;
  }

  async downgrade(userId: number, newPlanId: number): Promise<Subscription> {
    const current = await this.deps.subscriptionRepository?.findByUserId(userId);
    if (!current) throw new Error(`User ${userId} has no active subscription`);

    const newPlan = await this.deps.planRepository?.findById(newPlanId);
    if (!newPlan) throw new Error(`Plan ${newPlanId} not found`);

    const stripeSub = await this.stripeService.updateSubscription(
      current.stripeSubscriptionId, newPlan.stripePriceId, { proration: 'none' },
    );

    const updated = await this.deps.subscriptionRepository?.update(current.id, {
      plan_id: newPlanId, status: stripeSub.status,
    });

    if (!updated) throw new Error('Failed to update subscription record');
    return updated;
  }

  async cancel(userId: number, immediately: boolean = false): Promise<void> {
    const subscription = await this.deps.subscriptionRepository?.findByUserId(userId);
    if (!subscription) throw new Error(`User ${userId} has no active subscription`);

    await this.stripeService.cancelSubscription(subscription.stripeSubscriptionId, immediately);

    if (immediately) {
      await this.deps.subscriptionRepository?.update(subscription.id, {
        status: 'canceled', canceled_at: new Date(),
      });
    } else {
      await this.deps.subscriptionRepository?.update(subscription.id, {
        cancel_at_period_end: true,
      });
    }
  }

  async resume(userId: number): Promise<Subscription> {
    const subscription = await this.deps.subscriptionRepository?.findByUserId(userId);
    if (!subscription) throw new Error(`User ${userId} has no subscription`);

    const stripeSub = await this.stripeService.resumeSubscription(subscription.stripeSubscriptionId);

    const updated = await this.deps.subscriptionRepository?.update(subscription.id, {
      cancel_at_period_end: false, canceled_at: null, status: stripeSub.status,
    });

    if (!updated) throw new Error('Failed to update subscription record');
    return updated;
  }

  async isSubscribed(userId: number, planId?: number): Promise<boolean> {
    const subscription = await this.deps.subscriptionRepository?.findByUserId(userId);
    if (!subscription || !subscription.isActive()) return false;
    if (planId && subscription.planId !== planId) return false;
    return true;
  }

  async onTrial(userId: number): Promise<boolean> {
    const subscription = await this.deps.subscriptionRepository?.findByUserId(userId);
    return subscription ? subscription.isOnTrial() : false;
  }

  async hasFeature(userId: number, feature: string): Promise<boolean> {
    const subscription = await this.deps.subscriptionRepository?.findByUserId(userId);
    if (!subscription) return false;
    const plan = await this.deps.planRepository?.findById(subscription.planId);
    return plan ? plan.hasFeature(feature) : false;
  }

  async syncFromStripe(userId: number): Promise<Subscription> {
    const user = await this.deps.userRepository?.findById(userId);
    if (!user || !user.stripe_customer_id) {
      throw new Error(`User ${userId} not found or has no Stripe customer`);
    }

    const client = await this.stripeService.getClient();
    const subscriptions = await client.subscriptions.list({
      customer: user.stripe_customer_id, status: 'active', limit: 1,
    });

    if (subscriptions.data.length === 0) {
      throw new Error(`User ${userId} has no active Stripe subscription`);
    }

    const stripeSub = subscriptions.data[0];
    const priceId = stripeSub.items.data[0]?.price?.id as string;
    const plan = await this.deps.planRepository?.findByStripePriceId(priceId);
    if (!plan) throw new Error(`No plan found for Stripe price ${priceId}`);

    let subscription = await this.deps.subscriptionRepository?.findByStripeSubscriptionId(stripeSub.id);

    const data = {
      user_id: userId,
      stripe_subscription_id: stripeSub.id,
      stripe_customer_id: user.stripe_customer_id,
      plan_id: plan.id,
      status: stripeSub.status,
      current_period_start: periodStart(stripeSub),
      current_period_end: periodEnd(stripeSub),
      trial_ends_at: trialEnd(stripeSub),
      cancel_at_period_end: stripeSub.cancel_at_period_end,
      canceled_at: canceledAt(stripeSub),
    };

    if (subscription) {
      subscription = await this.deps.subscriptionRepository?.update(subscription.id, data);
    } else {
      subscription = await this.deps.subscriptionRepository?.create(data);
    }

    if (!subscription) throw new Error('Failed to sync subscription');
    return subscription;
  }
}
