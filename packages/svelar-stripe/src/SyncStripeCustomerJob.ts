import type { StripeService } from './StripeService.js';

export class SyncStripeCustomerJob {
  readonly name = 'sync-stripe-customer';

  constructor(
    public billableType: string,
    public billableId: number,
    public email: string,
    public userName: string,
  ) {}

  async handle(stripeService: StripeService): Promise<void> {
    const customer = await stripeService.createCustomer({
      id: this.billableId,
      name: this.userName,
      email: this.email,
      billableType: this.billableType,
    });

    // Resolve the registered Model class and use ORM
    const { Stripe } = await import('./index.js');
    const BillableModel = Stripe.getBillableModel(this.billableType);

    // Race-safe: only set if still null
    await BillableModel.where(BillableModel.primaryKey ?? 'id', this.billableId)
      .whereNull('stripe_customer_id')
      .update({ stripe_customer_id: customer.id });
  }

  serialize(): string {
    return JSON.stringify({
      billableType: this.billableType,
      billableId: this.billableId,
      email: this.email,
      name: this.userName,
    });
  }

  static restore(data: any): SyncStripeCustomerJob {
    return new SyncStripeCustomerJob(data.billableType, data.billableId, data.email, data.name);
  }
}
