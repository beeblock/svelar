function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
}

export function stripeObjectId(value: unknown): string | undefined {
  if (typeof value === 'string' && value) return value;
  const id = record(value)?.id;
  return typeof id === 'string' && id ? id : undefined;
}

function timestamp(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function subscriptionDates(value: unknown, priceId?: string): {
  current_period_start: string | null;
  current_period_end: string | null;
  trial_ends_at: string | null;
  canceled_at: string | null;
} {
  const subscription = record(value);
  const items = record(subscription?.items)?.data;
  const primary = Array.isArray(items)
    ? items.find((item: unknown) => !priceId || stripeObjectId(record(item)?.price) === priceId)
    : undefined;
  const item = record(primary);
  // Older webhook endpoints may still deliver subscription-level periods.
  return {
    current_period_start: timestamp(item?.current_period_start ?? subscription?.current_period_start),
    current_period_end: timestamp(item?.current_period_end ?? subscription?.current_period_end),
    trial_ends_at: timestamp(subscription?.trial_end),
    canceled_at: timestamp(subscription?.canceled_at),
  };
}

export function invoiceSubscriptionId(value: unknown): string | undefined {
  const invoice = record(value);
  const details = record(record(invoice?.parent)?.subscription_details);
  return stripeObjectId(details?.subscription) ?? stripeObjectId(invoice?.subscription);
}

export function legacyChargeInvoiceId(value: unknown): string | undefined {
  return stripeObjectId(record(value)?.invoice);
}
