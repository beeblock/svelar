/**
 * Invoice Model
 *
 * Represents a Stripe invoice for a user.
 * This is a data interface that should be extended with your ORM.
 */

export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';

export interface InvoiceAttributes {
  id: number;
  userId: number;
  subscriptionId: number | null;
  stripeInvoiceId: string;
  amountDue: number; // in cents
  amountPaid: number; // in cents
  currency: string;
  status: InvoiceStatus;
  paidAt: Date | null;
  dueDate: Date | null;
  invoicePdf: string | null;
  createdAt: Date;
  updatedAt?: Date;
}

/**
 * Plain TypeScript class representing an invoice
 */
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

  /**
   * Check if the invoice has been paid
   */
  isPaid(): boolean {
    return this.status === 'paid';
  }

  /**
   * Check if the invoice is overdue
   */
  isOverdue(): boolean {
    if (!this.dueDate || this.status === 'paid' || this.status === 'void') {
      return false;
    }
    return new Date() > this.dueDate;
  }

  /**
   * Check if the invoice is open (awaiting payment)
   */
  isOpen(): boolean {
    return this.status === 'open';
  }

  /**
   * Check if the invoice is a draft
   */
  isDraft(): boolean {
    return this.status === 'draft';
  }

  /**
   * Check if the invoice is voided
   */
  isVoid(): boolean {
    return this.status === 'void';
  }

  /**
   * Check if the invoice is uncollectible
   */
  isUncollectible(): boolean {
    return this.status === 'uncollectible';
  }

  /**
   * Get the outstanding amount (amount due minus amount paid)
   */
  outstandingAmount(): number {
    return this.amountDue - this.amountPaid;
  }

  /**
   * Get the formatted amount due
   */
  formattedAmountDue(): string {
    return this.formatCurrency(this.amountDue);
  }

  /**
   * Get the formatted amount paid
   */
  formattedAmountPaid(): string {
    return this.formatCurrency(this.amountPaid);
  }

  /**
   * Get the formatted outstanding amount
   */
  formattedOutstanding(): string {
    return this.formatCurrency(this.outstandingAmount());
  }

  /**
   * Get a formatted currency string
   */
  formattedAmount(): string {
    return this.formatCurrency(this.amountDue);
  }

  /**
   * Helper to format currency from cents
   */
  private formatCurrency(amount: number): string {
    const symbol = this.getCurrencySymbol(this.currency);
    const value = (amount / 100).toFixed(2);
    return `${symbol}${value}`;
  }

  /**
   * Get currency symbol for common currencies
   */
  private getCurrencySymbol(currency: string): string {
    const symbols: Record<string, string> = {
      usd: '$',
      eur: '€',
      gbp: '£',
      jpy: '¥',
      cad: 'C$',
      aud: 'A$',
      chf: 'CHF',
    };
    return symbols[currency.toLowerCase()] || currency.toUpperCase();
  }

  /**
   * Get the days until due (or days overdue if negative)
   */
  daysUntilDue(): number | null {
    if (!this.dueDate) return null;
    const now = new Date();
    const diffMs = this.dueDate.getTime() - now.getTime();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  }
}
