import { FormRequest, type RequestEvent } from '@beeblock/svelar/routing';
import { RefundSchema } from '../types.js';
import { RefundDto } from './dto.js';
import { Stripe } from '../index.js';

export interface RefundBody {
  invoiceId: string;
}

export class RefundRequest extends FormRequest {
  authorize(event: RequestEvent): Promise<boolean> {
    return Stripe.authorizeAdmin(event, 'action.billing.refund');
  }

  rules() {
    return RefundSchema;
  }

  passedValidation(data: any): RefundDto {
    return RefundDto.from(data);
  }
}
