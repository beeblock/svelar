import { Model } from '@beeblock/svelar/orm';

export class Subscription extends Model {
  static table = 'subscriptions';
  static timestamps = true;
  static primaryKey = 'id';

  static fillable = [
    'billable_type', 'billable_id', 'name', 'stripe_subscription_id',
    'stripe_customer_id', 'stripe_price_id', 'status',
    'current_period_start', 'current_period_end', 'trial_ends_at',
    'cancel_at_period_end', 'canceled_at',
  ];

  static casts: Record<string, 'string' | 'number' | 'boolean' | 'date' | 'json'> = {
    id: 'number',
    billable_id: 'number',
    cancel_at_period_end: 'number',
  };

  // -- Query scopes --

  static async findByStripeSubscriptionId(stripeId: string): Promise<Subscription | null> {
    return this.where('stripe_subscription_id', stripeId).first() as Promise<Subscription | null>;
  }

  static async findByBillable(billableType: string, billableId: number, name: string = 'default'): Promise<Subscription | null> {
    return this.where('billable_type', billableType)
      .where('billable_id', billableId)
      .where('name', name)
      .first() as Promise<Subscription | null>;
  }

  static async allForBillable(billableType: string, billableId: number): Promise<Subscription[]> {
    return this.where('billable_type', billableType)
      .where('billable_id', billableId)
      .orderBy('created_at', 'desc')
      .get() as Promise<Subscription[]>;
  }

  // -- Instance status helpers --

  isActive(): boolean {
    return (this as any).status === 'active' || (this as any).status === 'trialing';
  }

  isOnTrial(): boolean {
    if ((this as any).status !== 'trialing') return false;
    if (!(this as any).trial_ends_at) return false;
    return new Date((this as any).trial_ends_at) > new Date();
  }

  isOnGracePeriod(): boolean {
    if (!(this as any).cancel_at_period_end) return false;
    if (!(this as any).current_period_end) return false;
    return new Date((this as any).current_period_end) > new Date();
  }

  isCanceled(): boolean {
    return (this as any).status === 'canceled';
  }

  isPastDue(): boolean {
    return (this as any).status === 'past_due';
  }

  daysUntilEnd(): number {
    if (!(this as any).current_period_end) return 0;
    const diff = new Date((this as any).current_period_end).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }
}
