/**
 * SyncStripeCustomerJob
 *
 * Queue job that syncs a user's information to Stripe
 * (creates or updates customer record).
 */

import { StripeService } from '../StripeService.js';

/**
 * Job to sync user information to Stripe
 */
export class SyncStripeCustomerJob {
  readonly name = 'sync-stripe-customer';

  /**
   * Create a new sync job
   */
  constructor(
    public userId: number,
    public email: string,
    public name: string,
  ) {}

  /**
   * Handle the job execution
   */
  async handle(): Promise<void> {
    const stripeService = StripeService.getInstance();

    try {
      const customer = await stripeService.createCustomer({
        id: this.userId,
        name: this.name,
        email: this.email,
      });

      // In a real app, you would update the user record with the Stripe customer ID
      // This is left to the application to implement based on their ORM

      console.log(`Synced user ${this.userId} to Stripe customer ${customer.id}`);
    } catch (error) {
      console.error(`Failed to sync user ${this.userId} to Stripe:`, error);
      throw error;
    }
  }

  /**
   * Serialize the job for storage in the queue
   */
  serialize(): string {
    return JSON.stringify({
      userId: this.userId,
      email: this.email,
      name: this.name,
    });
  }

  /**
   * Restore the job from serialized data
   */
  static restore(data: any): SyncStripeCustomerJob {
    return new SyncStripeCustomerJob(data.userId, data.email, data.name);
  }

  /**
   * Get a display name for this job
   */
  toString(): string {
    return `SyncStripeCustomerJob (user: ${this.userId}, email: ${this.email})`;
  }
}

/**
 * Factory function to create a sync job
 */
export function createSyncStripeCustomerJob(
  userId: number,
  email: string,
  name: string,
): SyncStripeCustomerJob {
  return new SyncStripeCustomerJob(userId, email, name);
}
