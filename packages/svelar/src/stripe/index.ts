import { singleton } from '../support/index.js';
import { StripeService, type StripeConfig } from './StripeService.js';
import { StripeWebhookHandler } from './StripeWebhookHandler.js';
import { SubscriptionManager, type SubscriptionManagerDependencies } from './SubscriptionManager.js';

class StripeManager {
  private stripeService = new StripeService();
  private webhookHandler = new StripeWebhookHandler();
  private subscriptionManager: SubscriptionManager | null = null;

  configure(config: StripeConfig): void {
    this.stripeService.configure(config);
  }

  service(): StripeService {
    return this.stripeService;
  }

  webhooks(): StripeWebhookHandler {
    return this.webhookHandler;
  }

  subscriptions(deps?: SubscriptionManagerDependencies): SubscriptionManager {
    if (!this.subscriptionManager) {
      if (!deps) {
        throw new Error(
          'SubscriptionManager not initialized. Call Stripe.subscriptions({ stripeService, ... }) with dependencies first.',
        );
      }
      this.subscriptionManager = new SubscriptionManager(deps);
    }
    return this.subscriptionManager;
  }

  initSubscriptions(deps: Omit<SubscriptionManagerDependencies, 'stripeService'>): SubscriptionManager {
    this.subscriptionManager = new SubscriptionManager({
      stripeService: this.stripeService,
      ...deps,
    });
    return this.subscriptionManager;
  }
}

export const Stripe = singleton<StripeManager>('svelar.stripe', () => new StripeManager());

export { StripeManager };
export { StripeService, type StripeConfig } from './StripeService.js';
export { StripeWebhookHandler, type WebhookEventType, type WebhookHandler } from './StripeWebhookHandler.js';
export { SubscriptionManager, type SubscriptionManagerDependencies } from './SubscriptionManager.js';
export { Subscription, type SubscriptionAttributes, type SubscriptionStatus } from './Subscription.js';
export { SubscriptionPlan, type SubscriptionPlanAttributes, type PlanInterval } from './SubscriptionPlan.js';
export { Invoice, type InvoiceAttributes, type InvoiceStatus } from './Invoice.js';
export { SyncStripeCustomerJob } from './SyncStripeCustomerJob.js';
