import type Stripe from 'stripe';
import type { StripeConfig } from './types.js';
import { stripeObjectId } from './StripeApiShapes.js';

export class StripeService {
  private stripe: Stripe | null = null;
  private config: StripeConfig | null = null;

  configure(config: StripeConfig): void {
    this.config = config;
    this.stripe = null;
  }

  getConfig(): StripeConfig {
    if (!this.config) {
      throw new Error('StripeService not configured. Call Stripe.configure() in app.ts first.');
    }
    return this.config;
  }

  async getClient(): Promise<Stripe> {
    if (!this.stripe) {
      if (!this.config) {
        throw new Error('StripeService not configured. Call Stripe.configure() in app.ts first.');
      }
      const { default: StripeSDK } = await import('stripe');
      this.stripe = new StripeSDK(this.config.secretKey);
    }
    return this.stripe;
  }

  async createCustomer(opts: {
    id: number | string;
    name?: string;
    email?: string;
    billableType?: string;
    metadata?: Record<string, string>;
  }): Promise<Stripe.Customer> {
    const client = await this.getClient();
    return client.customers.create({
      email: opts.email,
      name: opts.name || undefined,
      metadata: {
        billable_type: opts.billableType ?? 'users',
        billable_id: String(opts.id),
        ...opts.metadata,
      },
    });
  }

  async updateCustomer(
    customerId: string,
    data: Stripe.CustomerUpdateParams,
  ): Promise<Stripe.Customer> {
    const client = await this.getClient();
    return client.customers.update(customerId, data);
  }

  async deleteCustomer(customerId: string): Promise<void> {
    const client = await this.getClient();
    await client.customers.del(customerId);
  }

  async getCustomer(customerId: string): Promise<Stripe.Customer> {
    const client = await this.getClient();
    const customer = await client.customers.retrieve(customerId);
    if (customer.deleted) throw new Error(`Stripe customer ${customerId} has been deleted`);
    return customer;
  }

  async createSubscription(
    customerId: string,
    priceId: string,
    opts?: {
      trialDays?: number;
      metadata?: Record<string, string>;
      collectionMethod?: 'send_invoice' | 'charge_automatically';
      daysUntilDue?: number;
    },
  ): Promise<Stripe.Subscription> {
    const client = await this.getClient();
    const params: Stripe.SubscriptionCreateParams = {
      customer: customerId,
      items: [{ price: priceId }],
      metadata: opts?.metadata,
      collection_method: opts?.collectionMethod || 'charge_automatically',
    };
    if (opts?.trialDays) params.trial_period_days = opts.trialDays;
    if (opts?.daysUntilDue) params.days_until_due = opts.daysUntilDue;
    return client.subscriptions.create(params);
  }

  async getSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    const client = await this.getClient();
    return client.subscriptions.retrieve(subscriptionId);
  }

  async cancelSubscription(
    subscriptionId: string,
    immediately: boolean = false,
  ): Promise<Stripe.Subscription> {
    const client = await this.getClient();
    if (immediately) {
      return client.subscriptions.cancel(subscriptionId);
    }
    return client.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });
  }

  async resumeSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    const client = await this.getClient();
    return client.subscriptions.update(subscriptionId, {
      cancel_at_period_end: false,
    });
  }

  async updateSubscription(
    subscriptionId: string,
    newPriceId: string,
    opts?: {
      proration?: 'create_prorations' | 'none';
      metadata?: Record<string, string>;
    },
  ): Promise<Stripe.Subscription> {
    const client = await this.getClient();
    const subscription = await client.subscriptions.retrieve(subscriptionId);
    if (!subscription.items.data[0]) {
      throw new Error('Subscription has no items');
    }
    return client.subscriptions.update(subscriptionId, {
      items: [{ id: subscription.items.data[0].id, price: newPriceId }],
      proration_behavior: opts?.proration || 'create_prorations',
      metadata: opts?.metadata,
    });
  }

  async getInvoices(
    customerId: string,
    limit: number = 10,
  ): Promise<Stripe.Invoice[]> {
    const client = await this.getClient();
    const response = await client.invoices.list({ customer: customerId, limit });
    return response.data;
  }

  async getInvoice(invoiceId: string): Promise<Stripe.Invoice> {
    const client = await this.getClient();
    return client.invoices.retrieve(invoiceId);
  }

  async createCheckoutSession(
    customerId: string,
    items: Array<{ price: string; quantity?: number }>,
    opts: {
      mode?: 'subscription' | 'payment';
      successUrl: string;
      cancelUrl: string;
      trialDays?: number;
      metadata?: Record<string, string>;
    },
  ): Promise<Stripe.Checkout.Session> {
    const client = await this.getClient();
    const mode = opts.mode || 'subscription';
    const params: Stripe.Checkout.SessionCreateParams = {
      customer: customerId,
      line_items: items.map((i) => ({ price: i.price, quantity: i.quantity ?? 1 })),
      mode,
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
      metadata: opts.metadata,
    };
    if (mode === 'subscription') {
      params.subscription_data = {
        metadata: opts.metadata,
      };
      if (opts.trialDays) {
        params.subscription_data.trial_period_days = opts.trialDays;
      }
    }
    return client.checkout.sessions.create(params);
  }

  async createPaymentIntent(
    customerId: string,
    amount: number,
    paymentMethodId: string,
    opts?: {
      currency?: string;
      metadata?: Record<string, string>;
    },
  ): Promise<Stripe.PaymentIntent> {
    const client = await this.getClient();
    const config = this.getConfig();
    return client.paymentIntents.create({
      customer: customerId,
      amount,
      currency: opts?.currency || config.currency || 'usd',
      payment_method: paymentMethodId,
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      metadata: opts?.metadata,
    });
  }

  async createPortalSession(
    customerId: string,
    returnUrl: string,
  ): Promise<Stripe.BillingPortal.Session> {
    const client = await this.getClient();
    return client.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
  }

  async constructWebhookEvent(
    body: string | Buffer,
    signature: string,
  ): Promise<Stripe.Event> {
    if (!this.config) {
      throw new Error('StripeService not configured');
    }
    const client = await this.getClient();
    return client.webhooks.constructEvent(body, signature, this.config.webhookSecret);
  }

  async listPrices(
    productId?: string,
    limit: number = 100,
  ): Promise<Stripe.Price[]> {
    const client = await this.getClient();
    const params: Stripe.PriceListParams = { limit, expand: ['data.product'] };
    if (productId) params.product = productId;
    const response = await client.prices.list(params);
    return response.data;
  }

  async listProducts(limit: number = 100): Promise<Stripe.Product[]> {
    const client = await this.getClient();
    const response = await client.products.list({ limit });
    return response.data;
  }

  async refundInvoice(invoiceId: string): Promise<Stripe.Refund> {
    const client = await this.getClient();
    const payments = await client.invoicePayments.list({ invoice: invoiceId, status: 'paid', limit: 2 });
    if (payments.has_more || payments.data.length > 1) {
      throw new Error('Invoice has multiple payments; review and refund individual payments explicitly.');
    }
    const paid = payments.data[0];
    if (!paid || !Number.isSafeInteger(paid.amount_paid) || paid.amount_paid === null || paid.amount_paid <= 0) {
      throw new Error('Invoice has no refundable paid payment.');
    }
    const payment = paid.payment;
    const params: Stripe.RefundCreateParams = { amount: paid.amount_paid };
    if (payment.type === 'payment_intent') params.payment_intent = stripeObjectId(payment.payment_intent);
    else if (payment.type === 'charge') params.charge = stripeObjectId(payment.charge);
    if (!params.payment_intent && !params.charge) {
      throw new Error('Invoice payment is not a refundable Stripe charge or PaymentIntent.');
    }
    return client.refunds.create(params);
  }

  async getRefund(refundId: string): Promise<Stripe.Refund> {
    const client = await this.getClient();
    return client.refunds.retrieve(refundId);
  }

  async listRefunds(chargeId: string): Promise<Stripe.Refund[]> {
    const client = await this.getClient();
    const response = await client.refunds.list({ charge: chargeId });
    return response.data;
  }
}
