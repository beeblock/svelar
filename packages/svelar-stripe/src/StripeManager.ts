import type { StripeAdminGuard, StripeConfig } from './types.js';
import { StripeService } from './StripeService.js';
import { StripeWebhookHandler } from './StripeWebhookHandler.js';
import { BillingService } from './BillingService.js';

export class StripeManager {
  private stripeService = new StripeService();
  private webhookHandler = new StripeWebhookHandler();
  private billingServiceInstance: BillingService | null = null;
  private billableRegistry = new Map<string, any>();
  private adminGuard: StripeAdminGuard | null = null;
  private _logging = true;

  configure(config: StripeConfig): void {
    this.stripeService.configure(config);
    this.adminGuard = config.adminGuard ?? null;
    if (config.logging !== undefined) this._logging = config.logging;
  }

  get logging(): boolean {
    return this._logging;
  }

  service(): StripeService {
    return this.stripeService;
  }

  webhooks(): StripeWebhookHandler {
    return this.webhookHandler;
  }

  async authorizeAdmin(event: any): Promise<boolean> {
    if (!this.adminGuard) return false;
    return Boolean(await this.adminGuard(event));
  }

  billing(): BillingService {
    if (!this.billingServiceInstance) {
      this.billingServiceInstance = new BillingService(this.stripeService);
    }
    return this.billingServiceInstance;
  }

  // Register a Model class as billable (keyed by its table name).
  //
  //   import { Stripe } from '@beeblock/svelar-stripe';
  //   Stripe.registerBillable(User);   // User.table = 'users'
  //   Stripe.registerBillable(Team);   // Team.table = 'teams'
  registerBillable(model: any): void {
    const table = model.table;
    if (!table) throw new Error('Model must have a static table property');
    this.billableRegistry.set(table, model);
  }

  // Resolve a registered billable Model class by table name.
  getBillableModel(tableName: string): any {
    const model = this.billableRegistry.get(tableName);
    if (!model) {
      throw new Error(
        `No billable model registered for table "${tableName}". ` +
        `Call Stripe.registerBillable(YourModel) in your app setup.`
      );
    }
    return model;
  }
}
