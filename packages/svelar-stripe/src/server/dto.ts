import type {
  CancelSubscriptionSchema,
  CheckoutSchema,
  RefundSchema,
  SubscribeSchema,
} from '../types.js';
import type { z } from '@beeblock/svelar/validation';

export class SubscribeDto {
  constructor(
    public readonly priceId: string,
    public readonly name: string,
    public readonly trialDays?: number,
  ) {}

  static from(data: z.infer<typeof SubscribeSchema>): SubscribeDto {
    return new SubscribeDto(data.priceId, data.name, data.trialDays);
  }
}

export class CheckoutDto {
  constructor(
    public readonly priceId: string,
    public readonly mode: 'subscription' | 'payment',
    public readonly quantity: number,
    public readonly successUrl: string,
    public readonly cancelUrl: string,
  ) {}

  static from(data: z.infer<typeof CheckoutSchema>): CheckoutDto {
    return new CheckoutDto(
      data.priceId,
      data.mode,
      data.quantity,
      data.successUrl,
      data.cancelUrl,
    );
  }
}

export class CancelSubscriptionDto {
  constructor(
    public readonly subscriptionId: string,
    public readonly immediately: boolean,
  ) {}

  static from(data: z.infer<typeof CancelSubscriptionSchema>): CancelSubscriptionDto {
    return new CancelSubscriptionDto(data.subscriptionId, data.immediately);
  }
}

export class RefundDto {
  constructor(public readonly invoiceId: string) {}

  static from(data: z.infer<typeof RefundSchema>): RefundDto {
    return new RefundDto(data.invoiceId);
  }
}
