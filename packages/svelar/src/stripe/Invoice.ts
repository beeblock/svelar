export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';

export interface InvoiceAttributes {
  id: number;
  userId: number;
  subscriptionId: number | null;
  stripeInvoiceId: string;
  amountDue: number;
  amountPaid: number;
  currency: string;
  status: InvoiceStatus;
  paidAt: Date | null;
  dueDate: Date | null;
  invoicePdf: string | null;
  createdAt: Date;
  updatedAt?: Date;
}

export class Invoice implements InvoiceAttributes {
  id: number;
  userId: number;
  subscriptionId: number | null;
  stripeInvoiceId: string;
  amountDue: number;
  amountPaid: number;
  currency: string;
  status: InvoiceStatus;
  paidAt: Date | null;
  dueDate: Date | null;
  invoicePdf: string | null;
  createdAt: Date;
  updatedAt?: Date;

  constructor(attributes: InvoiceAttributes) {
    this.id = attributes.id;
    this.userId = attributes.userId;
    this.subscriptionId = attributes.subscriptionId;
    this.stripeInvoiceId = attributes.stripeInvoiceId;
    this.amountDue = attributes.amountDue;
    this.amountPaid = attributes.amountPaid;
    this.currency = attributes.currency;
    this.status = attributes.status;
    this.paidAt = attributes.paidAt;
    this.dueDate = attributes.dueDate;
    this.invoicePdf = attributes.invoicePdf;
    this.createdAt = attributes.createdAt;
    this.updatedAt = attributes.updatedAt;
  }

  isPaid(): boolean { return this.status === 'paid'; }
  isOpen(): boolean { return this.status === 'open'; }
  isDraft(): boolean { return this.status === 'draft'; }
  isVoid(): boolean { return this.status === 'void'; }
  isUncollectible(): boolean { return this.status === 'uncollectible'; }

  isOverdue(): boolean {
    if (!this.dueDate || this.status === 'paid' || this.status === 'void') return false;
    return new Date() > this.dueDate;
  }

  outstandingAmount(): number { return this.amountDue - this.amountPaid; }

  formattedAmountDue(): string { return this.formatCurrency(this.amountDue); }
  formattedAmountPaid(): string { return this.formatCurrency(this.amountPaid); }
  formattedOutstanding(): string { return this.formatCurrency(this.outstandingAmount()); }

  daysUntilDue(): number | null {
    if (!this.dueDate) return null;
    return Math.ceil((this.dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  }

  private formatCurrency(amount: number): string {
    const symbols: Record<string, string> = {
      usd: '$', eur: '\u20ac', gbp: '\u00a3', jpy: '\u00a5',
      cad: 'C$', aud: 'A$', chf: 'CHF',
    };
    const symbol = symbols[this.currency.toLowerCase()] || this.currency.toUpperCase();
    return `${symbol}${(amount / 100).toFixed(2)}`;
  }
}
