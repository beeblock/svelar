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

  isActive(): boolean { return this.status === 'active'; }
  isPastDue(): boolean { return this.status === 'past_due'; }
  isCanceled(): boolean { return this.status === 'canceled'; }
  isOnTrial(): boolean {
    return this.status === 'trialing' || (this.trialEndsAt !== null && new Date() < this.trialEndsAt);
  }
  isOnGracePeriod(): boolean { return this.cancelAtPeriodEnd && this.status !== 'canceled'; }
  isIncomplete(): boolean { return this.status === 'incomplete'; }
  isPaused(): boolean { return this.status === 'paused'; }

  daysUntilEnd(): number {
    const diffMs = this.currentPeriodEnd.getTime() - Date.now();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  }
}
