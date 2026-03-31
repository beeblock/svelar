export type PlanInterval = 'month' | 'year';

export interface SubscriptionPlanAttributes {
  id: number;
  name: string;
  stripePriceId: string;
  stripeProductId: string;
  price: number;
  currency: string;
  interval: PlanInterval;
  intervalCount: number;
  trialDays: number;
  features: string[];
  sortOrder: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class SubscriptionPlan implements SubscriptionPlanAttributes {
  id: number;
  name: string;
  stripePriceId: string;
  stripeProductId: string;
  price: number;
  currency: string;
  interval: PlanInterval;
  intervalCount: number;
  trialDays: number;
  features: string[];
  sortOrder: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;

  constructor(attributes: SubscriptionPlanAttributes) {
    this.id = attributes.id;
    this.name = attributes.name;
    this.stripePriceId = attributes.stripePriceId;
    this.stripeProductId = attributes.stripeProductId;
    this.price = attributes.price;
    this.currency = attributes.currency;
    this.interval = attributes.interval;
    this.intervalCount = attributes.intervalCount;
    this.trialDays = attributes.trialDays;
    this.features = attributes.features;
    this.sortOrder = attributes.sortOrder;
    this.active = attributes.active;
    this.createdAt = attributes.createdAt;
    this.updatedAt = attributes.updatedAt;
  }

  isActive(): boolean { return this.active; }

  monthlyPrice(): number {
    const base = this.price / 100;
    return this.interval === 'month' ? base : base / 12;
  }

  yearlyPrice(): number {
    const base = this.price / 100;
    return this.interval === 'year' ? base : base * 12;
  }

  hasFeature(feature: string): boolean { return this.features.includes(feature); }

  formattedPrice(): string {
    const priceStr = (this.price / 100).toFixed(2);
    const intervalStr = this.intervalCount > 1
      ? `${this.intervalCount} ${this.interval}s`
      : this.interval;
    return `${this.currency.toUpperCase()} ${priceStr}/${intervalStr}`;
  }

  intervalLabel(): string {
    return this.intervalCount > 1
      ? `Every ${this.intervalCount} ${this.interval}s`
      : `Every ${this.interval}`;
  }

  trialLabel(): string {
    return this.trialDays === 0
      ? 'No trial'
      : `${this.trialDays} day${this.trialDays !== 1 ? 's' : ''} free trial`;
  }
}
