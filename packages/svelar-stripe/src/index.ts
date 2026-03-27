/**
 * Svelar Stripe Plugin
 *
 * Complete billing and subscription management for Svelar using Stripe.
 */

// Plugin
export { StripePlugin, default } from './StripePlugin.js';

// Services
export {
  StripeService,
  getStripeService,
  type StripeConfig,
} from './StripeService.js';

export {
  SubscriptionManager,
  getSubscriptionManager,
  type SubscriptionManagerDependencies,
} from './SubscriptionManager.js';

// Models
export { Subscription, type SubscriptionAttributes, type SubscriptionStatus } from './models/Subscription.js';
export {
  SubscriptionPlan,
  type SubscriptionPlanAttributes,
  type PlanInterval,
} from './models/SubscriptionPlan.js';
export { Invoice, type InvoiceAttributes, type InvoiceStatus } from './models/Invoice.js';

// Webhook handling
export {
  StripeWebhookHandler,
  createWebhookHandler,
  type WebhookEventType,
  type WebhookHandler,
} from './webhooks/StripeWebhookHandler.js';

// Jobs
export {
  SyncStripeCustomerJob,
  createSyncStripeCustomerJob,
} from './jobs/SyncStripeCustomerJob.js';
