import { z } from '@beeblock/svelar/validation';

const inputNumber = (schema: z.ZodNumber) => z.preprocess((value) => {
  if (value === '' || value === null || value === undefined) return undefined;
  if (typeof value === 'string') return Number(value);
  return value;
}, schema);

const inputBoolean = (defaultValue: boolean) => z.preprocess((value) => {
  if (value === '' || value === null || value === undefined) return defaultValue;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.toLowerCase();
    if (['1', 'true', 'on', 'yes'].includes(normalized)) return true;
    if (['0', 'false', 'off', 'no'].includes(normalized)) return false;
  }
  return value;
}, z.boolean());

// -- Stripe config --

export type StripeAdminGuard = (event: any) => boolean | Promise<boolean>;

export interface StripeConfig {
  secretKey: string;
  publishableKey: string;
  webhookSecret: string;
  adminGuard?: StripeAdminGuard;
  currency?: string;
  trialDays?: number;
  portalReturnUrl?: string;
  checkoutSuccessUrl?: string;
  checkoutCancelUrl?: string;
  logging?: boolean;
}

export interface StripePluginConfig {
  prefix?: string;
}

// -- Subscription status --

export type SubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'trialing' | 'incomplete' | 'paused';

// -- Plan interval --

export type PlanInterval = 'month' | 'year';

// -- Invoice status --

export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'void' | 'uncollectible' | 'refunded' | 'partially_refunded';

// -- DB record interfaces --

export interface SubscriptionRecord {
  id: number;
  billable_type: string;
  billable_id: number;
  name: string;
  stripe_subscription_id: string;
  stripe_customer_id: string;
  stripe_price_id: string;
  status: SubscriptionStatus;
  current_period_start: string | null;
  current_period_end: string | null;
  trial_ends_at: string | null;
  cancel_at_period_end: number;
  canceled_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface SubscriptionPlanRecord {
  id: number;
  name: string;
  stripe_price_id: string;
  stripe_product_id: string;
  price: number;
  currency: string;
  interval: PlanInterval;
  interval_count: number;
  trial_days: number;
  features: string;
  sort_order: number;
  active: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface InvoiceRecord {
  id: number;
  billable_type: string;
  billable_id: number;
  subscription_id: number | null;
  stripe_invoice_id: string;
  amount_due: number;
  amount_paid: number;
  currency: string;
  status: InvoiceStatus;
  paid_at: string | null;
  due_date: string | null;
  invoice_pdf: string | null;
  created_at: string | null;
  updated_at: string | null;
}

// -- Zod schemas --

export const SubscribeSchema = z.object({
  priceId: z.string().min(1),
  name: z.string().optional().default('default'),
  trialDays: inputNumber(z.number().int().min(0)).optional(),
});

export const CheckoutSchema = z.object({
  priceId: z.string().min(1),
  mode: z.enum(['subscription', 'payment']).default('subscription'),
  quantity: inputNumber(z.number().int().min(1)).default(1),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

export const CancelSubscriptionSchema = z.object({
  subscriptionId: z.string().min(1),
  immediately: inputBoolean(false).default(false),
});

export const RefundSchema = z.object({
  invoiceId: z.string().min(1),
});

// -- Webhook event types --

export type WebhookEventType =
  | 'customer.subscription.created'
  | 'customer.subscription.updated'
  | 'customer.subscription.deleted'
  | 'invoice.payment_succeeded'
  | 'invoice.payment_failed'
  | 'customer.created'
  | 'customer.updated'
  | 'customer.deleted'
  | 'checkout.session.completed'
  | 'invoice.created'
  | 'invoice.finalized'
  | 'charge.refunded'
  | string;

export type WebhookHandler = (event: any) => Promise<void>;
