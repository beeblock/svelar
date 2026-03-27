/**
 * StripeService
 *
 * A facade over the Stripe SDK providing type-safe methods for
 * common billing operations.
 */

import Stripe from 'stripe';

export interface StripeConfig {
  secretKey: string;
  publishableKey: string;
  webhookSecret: string;
  currency?: string;
  trialDays?: number;
}

/**
 * Facade service for Stripe API interactions
 */
export class StripeService {
  private stripe: Stripe | null = null;
  private config: StripeConfig | null = null;
  private static instance: StripeService;

  /**
   * Get or create singleton instance
   */
  static getInstance(): StripeService {
    if (!StripeService.instance) {
      StripeService.instance = new StripeService();
    }
    return StripeService.instance;
  }

  /**
   * Configure the service with API credentials
   */
  configure(config: StripeConfig): void {
    this.config = config;
    this.stripe = new Stripe(config.secretKey, {
      apiVersion: '2024-04-10',
    });
  }

  /**
   * Get the configured Stripe client
   */
  getClient(): Stripe {
    if (!this.stripe) {
      throw new Error('StripeService not configured. Call configure() first.');
    }
    return this.stripe;
  }

  /**
   * Create a new Stripe customer
   */
  async createCustomer(user: {
    id: number | string;
    name?: string;
    email?: string;
  }): Promise<Stripe.Customer> {
    const client = this.getClient();
    return client.customers.create({
      email: user.email,
      name: user.name || undefined,
      metadata: {
        userId: String(user.id),
      },
    });
  }

  /**
   * Update a Stripe customer
   */
  async updateCustomer(
    customerId: string,
    data: Stripe.CustomerUpdateParams,
  ): Promise<Stripe.Customer> {
    const client = this.getClient();
    return client.customers.update(customerId, data);
  }

  /**
   * Delete a Stripe customer
   */
  async deleteCustomer(customerId: string): Promise<void> {
    const client = this.getClient();
    await client.customers.del(customerId);
  }

  /**
   * Retrieve a customer
   */
  async getCustomer(customerId: string): Promise<Stripe.Customer> {
    const client = this.getClient();
    return client.customers.retrieve(customerId);
  }

  /**
   * Create a subscription
   */
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
    const client = this.getClient();

    const params: Stripe.SubscriptionCreateParams = {
      customer: customerId,
      items: [{ price: priceId }],
      metadata: opts?.metadata,
      collection_method: opts?.collectionMethod || 'charge_automatically',
    };

    if (opts?.trialDays) {
      params.trial_period_days = opts.trialDays;
    }

    if (opts?.daysUntilDue) {
      params.days_until_due = opts.daysUntilDue;
    }

    return client.subscriptions.create(params);
  }

  /**
   * Get a subscription
   */
  async getSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    const client = this.getClient();
    return client.subscriptions.retrieve(subscriptionId);
  }

  /**
   * Cancel a subscription
   */
  async cancelSubscription(
    subscriptionId: string,
    immediately: boolean = false,
  ): Promise<Stripe.Subscription> {
    const client = this.getClient();
    return client.subscriptions.update(subscriptionId, {
      cancel_at_period_end: !immediately,
    });
  }

  /**
   * Delete (immediately cancel) a subscription
   */
  async deleteSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    const client = this.getClient();
    return client.subscriptions.del(subscriptionId);
  }

  /**
   * Resume a canceled subscription
   */
  async resumeSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    const client = this.getClient();
    return client.subscriptions.update(subscriptionId, {
      cancel_at_period_end: false,
    });
  }

  /**
   * Update a subscription (change plan, etc.)
   */
  async updateSubscription(
    subscriptionId: string,
    newPriceId: string,
    opts?: {
      proration?: 'create_prorations' | 'none';
      metadata?: Record<string, string>;
    },
  ): Promise<Stripe.Subscription> {
    const client = this.getClient();
    const subscription = await client.subscriptions.retrieve(subscriptionId);

    if (!subscription.items.data[0]) {
      throw new Error('Subscription has no items');
    }

    return client.subscriptions.update(subscriptionId, {
      items: [
        {
          id: subscription.items.data[0].id,
          price: newPriceId,
        },
      ],
      proration_behavior: opts?.proration || 'create_prorations',
      metadata: opts?.metadata,
    });
  }

  /**
   * Get invoices for a customer
   */
  async getInvoices(
    customerId: string,
    limit: number = 10,
  ): Promise<Stripe.Invoice[]> {
    const client = this.getClient();
    const response = await client.invoices.list({
      customer: customerId,
      limit,
    });
    return response.data;
  }

  /**
   * Get a specific invoice
   */
  async getInvoice(invoiceId: string): Promise<Stripe.Invoice> {
    const client = this.getClient();
    return client.invoices.retrieve(invoiceId);
  }

  /**
   * Create a checkout session
   */
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
    const client = this.getClient();

    const params: Stripe.Checkout.SessionCreateParams = {
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: opts?.metadata,
    };

    if (opts?.trialDays) {
      params.subscription_data = {
        trial_period_days: opts.trialDays,
      };
    }

    return client.checkout.sessions.create(params);
  }

  /**
   * Create a billing portal session
   */
  async createPortalSession(
    customerId: string,
    returnUrl: string,
  ): Promise<Stripe.BillingPortal.Session> {
    const client = this.getClient();
    return client.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
  }

  /**
   * Construct and verify a webhook event
   */
  constructWebhookEvent(
    body: string | Buffer,
    signature: string,
  ): Stripe.Event {
    if (!this.config) {
      throw new Error('StripeService not configured');
    }

    const client = this.getClient();
    return client.webhooks.constructEvent(
      body,
      signature,
      this.config.webhookSecret,
    );
  }

  /**
   * List prices for a product
   */
  async listPrices(
    productId?: string,
    limit: number = 100,
  ): Promise<Stripe.Price[]> {
    const client = this.getClient();

    const params: Stripe.PriceListParams = {
      limit,
      expand: ['data.product'],
    };

    if (productId) {
      params.product = productId;
    }

    const response = await client.prices.list(params);
    return response.data;
  }

  /**
   * List products
   */
  async listProducts(limit: number = 100): Promise<Stripe.Product[]> {
    const client = this.getClient();
    const response = await client.products.list({ limit });
    return response.data;
  }

  /**
   * Refund an invoice
   */
  async refundInvoice(invoiceId: string): Promise<Stripe.Refund> {
    const client = this.getClient();
    const invoice = await client.invoices.retrieve(invoiceId);

    if (!invoice.charge) {
      throw new Error('Invoice has no associated charge');
    }

    return client.refunds.create({
      charge: invoice.charge as string,
    });
  }

  /**
   * Get a refund
   */
  async getRefund(refundId: string): Promise<Stripe.Refund> {
    const client = this.getClient();
    return client.refunds.retrieve(refundId);
  }

  /**
   * List refunds for a charge
   */
  async listRefunds(chargeId: string): Promise<Stripe.Refund[]> {
    const client = this.getClient();
    const response = await client.refunds.list({ charge: chargeId });
    return response.data;
  }
}

// Export singleton instance getter
export function getStripeService(): StripeService {
  return StripeService.getInstance();
}
