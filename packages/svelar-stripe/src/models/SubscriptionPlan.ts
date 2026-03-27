/**
 * SubscriptionPlan Model
 *
 * Represents a billing plan that users can subscribe to.
 * Synced with Stripe products and prices.
 * This is a data interface that should be extended with your ORM.
 */

export type PlanInterval = 'month' | 'year';

export interface SubscriptionPlanAttributes {
  id: number;
  name: string;
  stripePriceId: string;
  stripeProductId: string;
  price: number; // in cents
  currency: string;
  interval: PlanInterval;
  intervalCount: number;
  trialDays: number;
  features: string[]; // JSON array of feature strings
  sortOrder: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Plain TypeScript class representing a subscription plan
 */
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

  /**
   * Check if this plan is currently active
   */
  isActive(): boolean {
    return this.active;
  }

  /**
   * Get the monthly price (if interval is yearly, calculate monthly equivalent)
   */
  monthlyPrice(): number {
    if (this.interval === 'month') {
      return this.price / 100; // Convert from cents
    }
    // For yearly, divide by 12 months
    return (this.price / 100) / 12;
  }

  /**
   * Get the yearly price (if interval is monthly, calculate yearly equivalent)
   */
  yearlyPrice(): number {
    if (this.interval === 'year') {
      return this.price / 100; // Convert from cents
    }
    // For monthly, multiply by 12 months
    return (this.price / 100) * 12;
  }

  /**
   * Check if this plan includes a specific feature
   */
  hasFeature(feature: string): boolean {
    return this.features.includes(feature);
  }

  /**
   * Get the formatted price string (e.g., "$9.99/month")
   */
  formattedPrice(): string {
    const priceStr = (this.price / 100).toFixed(2);
    const intervalStr = this.intervalCount > 1
      ? `${this.intervalCount} ${this.interval}s`
      : this.interval;

    return `${this.currency.toUpperCase()} ${priceStr}/${intervalStr}`;
  }

  /**
   * Get human-readable interval string
   */
  intervalLabel(): string {
    if (this.intervalCount > 1) {
      return `Every ${this.intervalCount} ${this.interval}s`;
    }
    return `Every ${this.interval}`;
  }

  /**
   * Get the trial period label
   */
  trialLabel(): string {
    if (this.trialDays === 0) {
      return 'No trial';
    }
    return `${this.trialDays} day${this.trialDays !== 1 ? 's' : ''} free trial`;
  }
}
