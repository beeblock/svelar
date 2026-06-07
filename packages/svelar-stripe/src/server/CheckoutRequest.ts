import { FormRequest } from '@beeblock/svelar/routing';
import { CheckoutSchema } from '../types.js';
import { CheckoutDto } from './dto.js';

export interface CheckoutBody {
  priceId: string;
  mode: 'subscription' | 'payment';
  quantity: number;
  successUrl: string;
  cancelUrl: string;
}

export class CheckoutRequest extends FormRequest {
  rules() {
    return CheckoutSchema;
  }

  passedValidation(data: any): CheckoutDto {
    return CheckoutDto.from(data);
  }
}
