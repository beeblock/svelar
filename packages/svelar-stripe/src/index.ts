import { StripeManager } from './StripeManager.js';

// Singleton — same instance across all imports
const STRIPE_KEY = Symbol.for('svelar.stripe');
const g = globalThis as any;
if (!g[STRIPE_KEY]) {
  g[STRIPE_KEY] = new StripeManager();
}
export const Stripe: StripeManager = g[STRIPE_KEY];

export { StripeManager } from './StripeManager.js';
export { StripeService } from './StripeService.js';
export { StripeWebhookHandler } from './StripeWebhookHandler.js';
export { BillingService } from './BillingService.js';
export { Billable } from './Billable.js';
export type { BillableInstance } from './Billable.js';
export { Subscription } from './Subscription.js';
export { SubscriptionPlan } from './SubscriptionPlan.js';
export { Invoice } from './Invoice.js';
export { SyncStripeCustomerJob } from './SyncStripeCustomerJob.js';
export { registerDefaultWebhookHandlers } from './DefaultWebhookHandlers.js';
export type {
  StripeConfig,
  StripeAdminGuard,
  StripePluginConfig,
  SubscriptionStatus,
  PlanInterval,
  InvoiceStatus,
  SubscriptionRecord,
  SubscriptionPlanRecord,
  InvoiceRecord,
  WebhookEventType,
  WebhookHandler,
} from './types.js';

export {
  SubscribeSchema,
  CheckoutSchema,
  CancelSubscriptionSchema,
  RefundSchema,
} from './types.js';
