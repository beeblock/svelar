import { FormRequest, type RequestEvent } from '@beeblock/svelar/routing';
import { CancelSubscriptionSchema } from '../types.js';
import { CancelSubscriptionDto } from './dto.js';
import { Stripe } from '../index.js';

export interface CancelSubscriptionBody {
  subscriptionId: string;
  immediately: boolean;
}

export class CancelSubscriptionRequest extends FormRequest {
  authorize(event: RequestEvent): Promise<boolean> {
    return Stripe.authorizeAdmin(event, 'action.billing.cancel');
  }

  rules() {
    return CancelSubscriptionSchema;
  }

  passedValidation(data: any): CancelSubscriptionDto {
    return CancelSubscriptionDto.from(data);
  }
}
