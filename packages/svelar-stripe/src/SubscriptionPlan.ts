import { Model } from '@beeblock/svelar/orm';

export class SubscriptionPlan extends Model {
  static table = 'subscription_plans';
  static timestamps = true;
  static primaryKey = 'id';

  static fillable = [
    'name', 'stripe_price_id', 'stripe_product_id', 'price', 'currency',
    'interval', 'interval_count', 'trial_days', 'features', 'sort_order', 'active',
  ];

  static casts: Record<string, 'string' | 'number' | 'boolean' | 'date' | 'json'> = {
    id: 'number',
    price: 'number',
    interval_count: 'number',
    trial_days: 'number',
    sort_order: 'number',
    active: 'number',
  };

  // -- Query scopes --

  static async findByStripePriceId(stripePriceId: string): Promise<SubscriptionPlan | null> {
    return this.where('stripe_price_id', stripePriceId).first() as Promise<SubscriptionPlan | null>;
  }

  static async active(): Promise<SubscriptionPlan[]> {
    return this.where('active', 1).orderBy('sort_order').orderBy('name').get() as Promise<SubscriptionPlan[]>;
  }

  static async allPlans(): Promise<SubscriptionPlan[]> {
    return this.query().orderBy('sort_order').orderBy('name').get() as Promise<SubscriptionPlan[]>;
  }

  // -- Instance helpers --

  isActive(): boolean {
    return (this as any).active === 1;
  }

  getFeatures(): string[] {
    try {
      const raw = (this as any).features;
      return typeof raw === 'string' ? JSON.parse(raw) : (raw ?? []);
    } catch {
      return [];
    }
  }

  hasFeature(feature: string): boolean {
    return this.getFeatures().includes(feature);
  }

  monthlyPrice(): number {
    const base = (this as any).price / 100;
    return (this as any).interval === 'month' ? base : base / 12;
  }

  yearlyPrice(): number {
    const base = (this as any).price / 100;
    return (this as any).interval === 'year' ? base : base * 12;
  }

  formattedPrice(): string {
    const priceStr = ((this as any).price / 100).toFixed(2);
    const intervalStr = (this as any).interval_count > 1
      ? `${(this as any).interval_count} ${(this as any).interval}s`
      : (this as any).interval;
    return `${((this as any).currency as string).toUpperCase()} ${priceStr}/${intervalStr}`;
  }

  intervalLabel(): string {
    return (this as any).interval_count > 1
      ? `Every ${(this as any).interval_count} ${(this as any).interval}s`
      : `Every ${(this as any).interval}`;
  }

  trialLabel(): string {
    const days = (this as any).trial_days;
    return days === 0
      ? 'No trial'
      : `${days} day${days !== 1 ? 's' : ''} free trial`;
  }
}
