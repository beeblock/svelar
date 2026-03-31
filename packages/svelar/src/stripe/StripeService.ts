import type Stripe from 'stripe';

export interface StripeConfig {
  secretKey: string;
  publishableKey: string;
  webhookSecret: string;
  currency?: string;
  trialDays?: number;
  portalReturnUrl?: string;
  checkoutSuccessUrl?: string;
  checkoutCancelUrl?: string;
}

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
      this.stripe = new StripeSDK(this.config.secretKey, {
        apiVersion: '2024-04-10' as any,
      });
    }
    return this.stripe;
  }

  async createCustomer(user: {
    id: number | string;
    name?: string;
    email?: string;
  }): Promise<Stripe.Customer> {
    const client = await this.getClient();
    return client.customers.create({
      email: user.email,
      name: user.name || undefined,
      metadata: { userId: String(user.id) },
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
    return customer as Stripe.Customer;
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
    return client.subscriptions.update(subscriptionId, {
      cancel_at_period_end: !immediately,
    });
  }

  async deleteSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    const client = await this.getClient();
    return client.subscriptions.cancel(subscriptionId);
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
    priceId: string,
    successUrl: string,
    cancelUrl: string,
    opts?: {
      trialDays?: number;
      metadata?: Record<string, string>;
    },
  ): Promise<Stripe.Checkout.Session> {
    const client = await this.getClient();
    const params: Stripe.Checkout.SessionCreateParams = {
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: opts?.metadata,
    };
    if (opts?.trialDays) {
      params.subscription_data = { trial_period_days: opts.trialDays };
    }
    return client.checkout.sessions.create(params);
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
    const invoice = await client.invoices.retrieve(invoiceId) as any;
    const chargeId = invoice.charge ?? invoice.payment_intent;
    if (!chargeId) {
      throw new Error('Invoice has no associated charge or payment intent');
    }
    return client.refunds.create({ charge: String(chargeId) });
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
