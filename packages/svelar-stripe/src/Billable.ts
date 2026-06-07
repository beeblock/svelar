import { Subscription } from './Subscription.js';
import { Invoice } from './Invoice.js';

// Mixin constructor type
type Constructor = new (...args: any[]) => any;

// Interface describing the methods added by Billable
export interface BillableInstance {
  readonly _billableType: string;
  readonly _billableId: number;

  // Customer management
  createOrGetStripeCustomer(opts?: { name?: string; email?: string }): Promise<string>;

  // Subscriptions
  subscriptions(): Promise<Subscription[]>;
  subscription(name?: string): Promise<Subscription | null>;
  subscribed(name?: string): Promise<boolean>;
  onTrial(name?: string): Promise<boolean>;
  onGracePeriod(name?: string): Promise<boolean>;

  // One-time payments
  charge(amount: number, paymentMethodId: string, opts?: { currency?: string; metadata?: Record<string, string> }): Promise<any>;

  // Checkout
  checkout(
    items: Array<{ priceId: string; quantity?: number }>,
    opts: { mode?: 'subscription' | 'payment'; successUrl: string; cancelUrl: string; trialDays?: number },
  ): Promise<any>;

  // Portal
  billingPortalUrl(returnUrl: string): Promise<string>;

  // Invoices
  invoices(): Promise<Invoice[]>;
}

// Polymorphic Billable mixin — attach to any Model.
//
// Usage:
//   class User extends Billable(Model) { static table = 'users'; }
//   class Team extends Billable(Model) { static table = 'teams'; }
//
//   await user.createOrGetStripeCustomer({ name, email });
//   await user.subscribed('default');
//   await user.charge(2000, paymentMethodId);
export function Billable<TBase extends Constructor>(Base: TBase): TBase & (new (...args: any[]) => BillableInstance) {
  class BillableMixin extends Base {
    private static async _stripeManager(): Promise<any> {
      const { Stripe } = await import('./index.js');
      return Stripe;
    }

    get _billableType(): string {
      return (this.constructor as any).table || (this.constructor as any).name;
    }

    get _billableId(): number {
      return (this as any).id ?? (this as any).getAttribute?.('id');
    }

    async createOrGetStripeCustomer(opts?: { name?: string; email?: string }): Promise<string> {
      // Check if model already has stripe_customer_id in memory
      const existingId = (this as any).stripe_customer_id ?? (this as any).getAttribute?.('stripe_customer_id');
      if (existingId) return existingId;

      // Use the Model's own ORM to re-check from DB (another request may have set it)
      const ModelClass = this.constructor as any;
      const fresh = await ModelClass.find(this._billableId);
      if (fresh?.stripe_customer_id) {
        if (typeof (this as any).setAttribute === 'function') {
          (this as any).setAttribute('stripe_customer_id', fresh.stripe_customer_id);
        }
        return fresh.stripe_customer_id;
      }

      const stripe = await BillableMixin._stripeManager();
      const service = stripe.service();
      const customer = await service.createCustomer({
        id: this._billableId,
        name: opts?.name ?? (this as any).name ?? (this as any).getAttribute?.('name'),
        email: opts?.email ?? (this as any).email ?? (this as any).getAttribute?.('email'),
        billableType: this._billableType,
      });

      // Race-safe: only set if still null
      await ModelClass.where(ModelClass.primaryKey ?? 'id', this._billableId)
        .whereNull('stripe_customer_id')
        .update({ stripe_customer_id: customer.id });

      // Re-read to get the winning customer ID (may differ if we lost the race)
      const updated = await ModelClass.find(this._billableId);
      const finalId = updated?.stripe_customer_id ?? customer.id;

      if (typeof (this as any).setAttribute === 'function') {
        (this as any).setAttribute('stripe_customer_id', finalId);
      }

      return finalId;
    }

    async subscriptions(): Promise<Subscription[]> {
      return Subscription.allForBillable(this._billableType, this._billableId);
    }

    async subscription(name: string = 'default'): Promise<Subscription | null> {
      return Subscription.findByBillable(this._billableType, this._billableId, name);
    }

    async subscribed(name: string = 'default'): Promise<boolean> {
      const sub = await this.subscription(name);
      if (!sub) return false;
      return sub.isActive() || sub.isOnTrial() || sub.isOnGracePeriod();
    }

    async onTrial(name: string = 'default'): Promise<boolean> {
      const sub = await this.subscription(name);
      if (!sub) return false;
      return sub.isOnTrial();
    }

    async onGracePeriod(name: string = 'default'): Promise<boolean> {
      const sub = await this.subscription(name);
      if (!sub) return false;
      return sub.isOnGracePeriod();
    }

    async charge(
      amount: number,
      paymentMethodId: string,
      opts?: { currency?: string; metadata?: Record<string, string> },
    ): Promise<any> {
      const customerId = await this.createOrGetStripeCustomer();
      const stripe = await BillableMixin._stripeManager();
      return stripe.service().createPaymentIntent(customerId, amount, paymentMethodId, opts);
    }

    async checkout(
      items: Array<{ priceId: string; quantity?: number }>,
      opts: { mode?: 'subscription' | 'payment'; successUrl: string; cancelUrl: string; trialDays?: number },
    ): Promise<any> {
      const customerId = await this.createOrGetStripeCustomer();
      const stripe = await BillableMixin._stripeManager();
      return stripe.service().createCheckoutSession(
        customerId,
        items.map((i) => ({ price: i.priceId, quantity: i.quantity })),
        {
          ...opts,
          metadata: {
            billable_type: this._billableType,
            billable_id: String(this._billableId),
          },
        },
      );
    }

    async billingPortalUrl(returnUrl: string): Promise<string> {
      const customerId = await this.createOrGetStripeCustomer();
      const stripe = await BillableMixin._stripeManager();
      const session = await stripe.service().createPortalSession(customerId, returnUrl);
      return session.url;
    }

    async invoices(): Promise<Invoice[]> {
      return Invoice.allForBillable(this._billableType, this._billableId);
    }
  }

  return BillableMixin as unknown as TBase & (new (...args: any[]) => BillableInstance);
}
