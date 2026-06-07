import { Model } from '@beeblock/svelar/orm';

export class Invoice extends Model {
  static table = 'invoices';
  static timestamps = true;
  static primaryKey = 'id';

  static fillable = [
    'billable_type', 'billable_id', 'subscription_id', 'stripe_invoice_id',
    'amount_due', 'amount_paid', 'currency', 'status',
    'paid_at', 'due_date', 'invoice_pdf',
  ];

  static casts: Record<string, 'string' | 'number' | 'boolean' | 'date' | 'json'> = {
    id: 'number',
    billable_id: 'number',
    subscription_id: 'number',
    amount_due: 'number',
    amount_paid: 'number',
  };

  // -- Query scopes --

  static async findByStripeInvoiceId(stripeInvoiceId: string): Promise<Invoice | null> {
    return this.where('stripe_invoice_id', stripeInvoiceId).first() as Promise<Invoice | null>;
  }

  static async allForBillable(billableType: string, billableId: number): Promise<Invoice[]> {
    return this.where('billable_type', billableType)
      .where('billable_id', billableId)
      .orderBy('created_at', 'desc')
      .get() as Promise<Invoice[]>;
  }

  static async allForSubscription(subscriptionId: number): Promise<Invoice[]> {
    return this.where('subscription_id', subscriptionId)
      .orderBy('created_at', 'desc')
      .get() as Promise<Invoice[]>;
  }

  // -- Instance status helpers --

  isPaid(): boolean { return (this as any).status === 'paid'; }
  isOpen(): boolean { return (this as any).status === 'open'; }
  isDraft(): boolean { return (this as any).status === 'draft'; }
  isVoid(): boolean { return (this as any).status === 'void'; }
  isUncollectible(): boolean { return (this as any).status === 'uncollectible'; }

  isOverdue(): boolean {
    if (!(this as any).due_date || (this as any).status === 'paid' || (this as any).status === 'void') return false;
    return new Date() > new Date((this as any).due_date);
  }

  outstandingAmount(): number {
    return (this as any).amount_due - (this as any).amount_paid;
  }

  formattedAmountDue(): string {
    return Invoice.formatCurrency((this as any).amount_due, (this as any).currency);
  }

  formattedAmountPaid(): string {
    return Invoice.formatCurrency((this as any).amount_paid, (this as any).currency);
  }

  formattedOutstanding(): string {
    return Invoice.formatCurrency(this.outstandingAmount(), (this as any).currency);
  }

  daysUntilDue(): number | null {
    if (!(this as any).due_date) return null;
    return Math.ceil((new Date((this as any).due_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  }

  private static formatCurrency(amount: number, currency: string): string {
    const symbols: Record<string, string> = {
      usd: '$', eur: '\u20ac', gbp: '\u00a3', jpy: '\u00a5',
      cad: 'C$', aud: 'A$', chf: 'CHF',
    };
    const symbol = symbols[currency?.toLowerCase()] || (currency ?? 'USD').toUpperCase();
    return `${symbol}${(amount / 100).toFixed(2)}`;
  }
}
