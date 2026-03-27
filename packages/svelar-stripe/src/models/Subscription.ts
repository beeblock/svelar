/**
 * Subscription Model
 *
 * Represents a user's subscription to a billing plan.
 * This is a data interface that should be extended with your ORM.
 */

export type SubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'trialing' | 'incomplete' | 'paused';

export interface SubscriptionAttributes {
  id: number;
  userId: number;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  planId: number;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: Date | null;
  canceledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Plain TypeScript class representing a subscription
 */
export class Subscription implements SubscriptionAttributes {
  id: number;
  userId: number;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  planId: number;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: Date | null;
  canceledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;

  constructor(attributes: SubscriptionAttributes) {
    this.id = attributes.id;
    this.userId = attributes.userId;
    this.stripeSubscriptionId = attributes.stripeSubscriptionId;
    this.stripeCustomerId = attributes.stripeCustomerId;
    this.planId = attributes.planId;
    this.status = attributes.status;
    this.currentPeriodStart = attributes.currentPeriodStart;
    this.currentPeriodEnd = attributes.currentPeriodEnd;
    this.cancelAtPeriodEnd = attributes.cancelAtPeriodEnd;
    this.trialEndsAt = attributes.trialEndsAt;
    this.canceledAt = attributes.canceledAt;
    this.createdAt = attributes.createdAt;
    this.updatedAt = attributes.updatedAt;
  }

  /**
   * Check if the subscription is currently active
   */
  isActive(): boolean {
    return this.status === 'active';
  }

  /**
   * Check if the subscription is past due
   */
  isPastDue(): boolean {
    return this.status === 'past_due';
  }

  /**
   * Check if the subscription is canceled
   */
  isCanceled(): boolean {
    return this.status === 'canceled';
  }

  /**
   * Check if the subscription is in a trial period
   */
  isOnTrial(): boolean {
    return this.status === 'trialing' || (this.trialEndsAt !== null && new Date() < this.trialEndsAt);
  }

  /**
   * Check if the subscription is scheduled to cancel at period end
   */
  isOnGracePeriod(): boolean {
    return this.cancelAtPeriodEnd && this.status !== 'canceled';
  }

  /**
   * Get the number of days until the subscription ends
   */
  daysUntilEnd(): number {
    const now = new Date();
    const endDate = this.currentPeriodEnd;
    const diffMs = endDate.getTime() - now.getTime();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  }

  /**
   * Check if this is an incomplete subscription (payment required)
   */
  isIncomplete(): boolean {
    return this.status === 'incomplete';
  }

  /**
   * Check if this is a paused subscription
   */
  isPaused(): boolean {
    return this.status === 'paused';
  }
}
