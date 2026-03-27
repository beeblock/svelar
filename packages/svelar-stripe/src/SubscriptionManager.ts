/**
 * SubscriptionManager
 *
 * High-level business logic for managing subscriptions.
 * Coordinates between the app, the database, and Stripe.
 */

import { StripeService } from './StripeService.js';
import { Subscription } from './models/Subscription.js';
import { SubscriptionPlan } from './models/SubscriptionPlan.js';

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

/**
 * High-level subscription management
 */
export class SubscriptionManager {
  private stripeService: StripeService;
  private deps: SubscriptionManagerDependencies;
  private static instance: SubscriptionManager;

  constructor(deps: SubscriptionManagerDependencies) {
    this.stripeService = deps.stripeService;
    this.deps = deps;
  }

  /**
   * Get or create singleton instance
   */
  static getInstance(deps?: SubscriptionManagerDependencies): SubscriptionManager {
    if (!SubscriptionManager.instance && deps) {
      SubscriptionManager.instance = new SubscriptionManager(deps);
    }
    if (!SubscriptionManager.instance) {
      throw new Error('SubscriptionManager not initialized');
    }
    return SubscriptionManager.instance;
  }

  /**
   * Subscribe a user to a plan
   */
  async subscribe(
    userId: number,
    planId: number,
    opts?: {
      trialDays?: number;
      metadata?: Record<string, string>;
    },
  ): Promise<Subscription> {
    // Get user and plan
    const user = await this.deps.userRepository?.findById(userId);
    if (!user) {
      throw new Error(`User ${userId} not found`);
    }

    const plan = await this.deps.planRepository?.findById(planId);
    if (!plan) {
      throw new Error(`Plan ${planId} not found`);
    }

    let stripeCustomerId = user.stripe_customer_id;

    // Create Stripe customer if not exists
    if (!stripeCustomerId) {
      const customer = await this.stripeService.createCustomer({
        id: userId,
        name: user.name,
        email: user.email,
      });
      stripeCustomerId = customer.id;

      // Update user with Stripe customer ID
      await this.deps.userRepository?.update(userId, {
        stripe_customer_id: stripeCustomerId,
      });
    }

    // Create subscription in Stripe
    const stripeSubscription = await this.stripeService.createSubscription(
      stripeCustomerId,
      plan.stripePriceId,
      {
        trialDays: opts?.trialDays || plan.trialDays,
        metadata: {
          userId: String(userId),
          planId: String(planId),
          ...opts?.metadata,
        },
      },
    );

    // Create subscription record in database
    const subscription = await this.deps.subscriptionRepository?.create({
      user_id: userId,
      stripe_subscription_id: stripeSubscription.id,
      stripe_customer_id: stripeCustomerId,
      plan_id: planId,
      status: stripeSubscription.status,
      current_period_start: new Date(stripeSubscription.current_period_start * 1000),
      current_period_end: new Date(stripeSubscription.current_period_end * 1000),
      trial_ends_at: stripeSubscription.trial_end
        ? new Date(stripeSubscription.trial_end * 1000)
        : null,
      cancel_at_period_end: stripeSubscription.cancel_at_period_end,
      canceled_at: stripeSubscription.canceled_at
        ? new Date(stripeSubscription.canceled_at * 1000)
        : null,
    });

    if (!subscription) {
      throw new Error('Failed to create subscription record');
    }

    return subscription;
  }

  /**
   * Upgrade a user to a different plan
   */
  async upgrade(userId: number, newPlanId: number): Promise<Subscription> {
    const currentSubscription = await this.deps.subscriptionRepository?.findByUserId(userId);
    if (!currentSubscription) {
      throw new Error(`User ${userId} has no active subscription`);
    }

    const newPlan = await this.deps.planRepository?.findById(newPlanId);
    if (!newPlan) {
      throw new Error(`Plan ${newPlanId} not found`);
    }

    // Update subscription in Stripe with proration
    const stripeSubscription = await this.stripeService.updateSubscription(
      currentSubscription.stripeSubscriptionId,
      newPlan.stripePriceId,
      { proration: 'create_prorations' },
    );

    // Update subscription record
    const updated = await this.deps.subscriptionRepository?.update(currentSubscription.id, {
      plan_id: newPlanId,
      status: stripeSubscription.status,
      current_period_start: new Date(stripeSubscription.current_period_start * 1000),
      current_period_end: new Date(stripeSubscription.current_period_end * 1000),
    });

    if (!updated) {
      throw new Error('Failed to update subscription record');
    }

    return updated;
  }

  /**
   * Downgrade a user to a different plan (at period end)
   */
  async downgrade(userId: number, newPlanId: number): Promise<Subscription> {
    const currentSubscription = await this.deps.subscriptionRepository?.findByUserId(userId);
    if (!currentSubscription) {
      throw new Error(`User ${userId} has no active subscription`);
    }

    const newPlan = await this.deps.planRepository?.findById(newPlanId);
    if (!newPlan) {
      throw new Error(`Plan ${newPlanId} not found`);
    }

    // Update subscription in Stripe without proration (at period end)
    const stripeSubscription = await this.stripeService.updateSubscription(
      currentSubscription.stripeSubscriptionId,
      newPlan.stripePriceId,
      { proration: 'none' },
    );

    // Update subscription record
    const updated = await this.deps.subscriptionRepository?.update(currentSubscription.id, {
      plan_id: newPlanId,
      status: stripeSubscription.status,
    });

    if (!updated) {
      throw new Error('Failed to update subscription record');
    }

    return updated;
  }

  /**
   * Cancel a user's subscription
   */
  async cancel(userId: number, immediately: boolean = false): Promise<void> {
    const subscription = await this.deps.subscriptionRepository?.findByUserId(userId);
    if (!subscription) {
      throw new Error(`User ${userId} has no active subscription`);
    }

    const stripeSubscription = await this.stripeService.cancelSubscription(
      subscription.stripeSubscriptionId,
      immediately,
    );

    // Update subscription record
    if (immediately) {
      await this.deps.subscriptionRepository?.update(subscription.id, {
        status: 'canceled',
        canceled_at: new Date(),
      });
    } else {
      await this.deps.subscriptionRepository?.update(subscription.id, {
        cancel_at_period_end: true,
      });
    }
  }

  /**
   * Resume a canceled subscription
   */
  async resume(userId: number): Promise<Subscription> {
    const subscription = await this.deps.subscriptionRepository?.findByUserId(userId);
    if (!subscription) {
      throw new Error(`User ${userId} has no subscription`);
    }

    const stripeSubscription = await this.stripeService.resumeSubscription(
      subscription.stripeSubscriptionId,
    );

    // Update subscription record
    const updated = await this.deps.subscriptionRepository?.update(subscription.id, {
      cancel_at_period_end: false,
      canceled_at: null,
      status: stripeSubscription.status,
    });

    if (!updated) {
      throw new Error('Failed to update subscription record');
    }

    return updated;
  }

  /**
   * Check if user is subscribed (optionally to a specific plan)
   */
  async isSubscribed(userId: number, planId?: number): Promise<boolean> {
    const subscription = await this.deps.subscriptionRepository?.findByUserId(userId);

    if (!subscription) {
      return false;
    }

    if (!subscription.isActive()) {
      return false;
    }

    if (planId && subscription.planId !== planId) {
      return false;
    }

    return true;
  }

  /**
   * Check if user is on a trial
   */
  async onTrial(userId: number): Promise<boolean> {
    const subscription = await this.deps.subscriptionRepository?.findByUserId(userId);
    if (!subscription) {
      return false;
    }
    return subscription.isOnTrial();
  }

  /**
   * Check if user's plan includes a feature
   */
  async hasFeature(userId: number, feature: string): Promise<boolean> {
    const subscription = await this.deps.subscriptionRepository?.findByUserId(userId);
    if (!subscription) {
      return false;
    }

    const plan = await this.deps.planRepository?.findById(subscription.planId);
    if (!plan) {
      return false;
    }

    return plan.hasFeature(feature);
  }

  /**
   * Sync a user's subscription from Stripe
   */
  async syncFromStripe(userId: number): Promise<Subscription> {
    const user = await this.deps.userRepository?.findById(userId);
    if (!user || !user.stripe_customer_id) {
      throw new Error(`User ${userId} not found or has no Stripe customer`);
    }

    // Get active subscriptions from Stripe
    const client = this.stripeService.getClient();
    const subscriptions = await client.subscriptions.list({
      customer: user.stripe_customer_id,
      status: 'active',
      limit: 1,
    });

    if (subscriptions.data.length === 0) {
      throw new Error(`User ${userId} has no active Stripe subscription`);
    }

    const stripeSubscription = subscriptions.data[0];
    const priceId = (stripeSubscription.items.data[0]?.price?.id) as string;
    const plan = await this.deps.planRepository?.findByStripePriceId(priceId);

    if (!plan) {
      throw new Error(`No plan found for Stripe price ${priceId}`);
    }

    // Create or update local subscription
    let subscription = await this.deps.subscriptionRepository?.findByStripeSubscriptionId(
      stripeSubscription.id,
    );

    const data = {
      user_id: userId,
      stripe_subscription_id: stripeSubscription.id,
      stripe_customer_id: user.stripe_customer_id,
      plan_id: plan.id,
      status: stripeSubscription.status,
      current_period_start: new Date(stripeSubscription.current_period_start * 1000),
      current_period_end: new Date(stripeSubscription.current_period_end * 1000),
      trial_ends_at: stripeSubscription.trial_end
        ? new Date(stripeSubscription.trial_end * 1000)
        : null,
      cancel_at_period_end: stripeSubscription.cancel_at_period_end,
      canceled_at: stripeSubscription.canceled_at
        ? new Date(stripeSubscription.canceled_at * 1000)
        : null,
    };

    if (subscription) {
      subscription = await this.deps.subscriptionRepository?.update(subscription.id, data);
    } else {
      subscription = await this.deps.subscriptionRepository?.create(data);
    }

    if (!subscription) {
      throw new Error('Failed to sync subscription');
    }

    return subscription;
  }
}

export function getSubscriptionManager(
  deps?: SubscriptionManagerDependencies,
): SubscriptionManager {
  return SubscriptionManager.getInstance(deps);
}
