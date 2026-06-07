import { Resource } from '@beeblock/svelar/routing';
import type { Invoice } from '../Invoice.js';

export interface InvoiceData {
  id: number;
  billableType: string;
  billableId: number;
  subscriptionId: number | null;
  stripeInvoiceId: string;
  amountDue: number;
  amountPaid: number;
  currency: string;
  status: string;
  paidAt: string | null;
  dueDate: string | null;
  invoicePdf: string | null;
  isPaid: boolean;
  isOverdue: boolean;
  formattedAmountDue: string;
  formattedAmountPaid: string;
  formattedOutstanding: string;
  createdAt: string | null;
}

export class InvoiceResource extends Resource<Invoice, InvoiceData> {
  toJSON(): InvoiceData {
    const inv = this.data;
    return {
      id: (inv as any).id,
      billableType: (inv as any).billable_type,
      billableId: (inv as any).billable_id,
      subscriptionId: (inv as any).subscription_id,
      stripeInvoiceId: (inv as any).stripe_invoice_id,
      amountDue: (inv as any).amount_due,
      amountPaid: (inv as any).amount_paid,
      currency: (inv as any).currency,
      status: (inv as any).status,
      paidAt: (inv as any).paid_at,
      dueDate: (inv as any).due_date,
      invoicePdf: (inv as any).invoice_pdf,
      isPaid: inv.isPaid(),
      isOverdue: inv.isOverdue(),
      formattedAmountDue: inv.formattedAmountDue(),
      formattedAmountPaid: inv.formattedAmountPaid(),
      formattedOutstanding: inv.formattedOutstanding(),
      createdAt: (inv as any).created_at,
    };
  }
}
