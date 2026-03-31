import { StripeService } from './StripeService.js';

export class SyncStripeCustomerJob {
  readonly name = 'sync-stripe-customer';

  constructor(
    public userId: number,
    public email: string,
    public userName: string,
  ) {}

  async handle(stripeService: StripeService): Promise<void> {
    const customer = await stripeService.createCustomer({
      id: this.userId,
      name: this.userName,
      email: this.email,
    });
    console.log(`Synced user ${this.userId} to Stripe customer ${customer.id}`);
  }

  serialize(): string {
    return JSON.stringify({ userId: this.userId, email: this.email, name: this.userName });
  }

  static restore(data: any): SyncStripeCustomerJob {
    return new SyncStripeCustomerJob(data.userId, data.email, data.name);
  }
}
