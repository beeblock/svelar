import type { StripeService } from './StripeService.js';
import { normalizeBillableId } from './BillableId.js';
import type { BillableId } from './BillableId.js';

export class SyncStripeCustomerJob {
  readonly name = 'sync-stripe-customer';

  constructor(
    public billableType: string,
    public billableId: BillableId,
    public email: string,
    public userName: string,
  ) { normalizeBillableId(billableId); }

  async handle(stripeService: StripeService): Promise<void> {
    const { Stripe } = await import('./index.js');
    const BillableModel = Stripe.getBillableModel(this.billableType);
    const record = await BillableModel.find(this.billableId);
    if (!record || normalizeBillableId(record.getAttribute(BillableModel.primaryKey ?? 'id')) !== normalizeBillableId(this.billableId)) {
      throw new Error('Billable model not found for its exact primary key.');
    }
    const customer = await stripeService.createCustomer({
      id: this.billableId,
      name: this.userName,
      email: this.email,
      billableType: this.billableType,
    });

    // Race-safe: only set if still null
    await BillableModel.where(BillableModel.primaryKey ?? 'id', this.billableId)
      .whereNull('stripe_customer_id')
      .update({ stripe_customer_id: customer.id });
  }

  serialize(): string {
    return JSON.stringify({
      billableType: this.billableType,
      billableId: normalizeBillableId(this.billableId),
      email: this.email,
      name: this.userName,
    });
  }

  static restore(data: any): SyncStripeCustomerJob {
    return new SyncStripeCustomerJob(data.billableType, data.billableId, data.email, data.name);
  }
}
