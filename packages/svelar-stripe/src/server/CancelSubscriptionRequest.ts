import { FormRequest } from '@beeblock/svelar/routing';
import { CancelSubscriptionSchema } from '../types.js';
import { CancelSubscriptionDto } from './dto.js';

export interface CancelSubscriptionBody {
  subscriptionId: string;
  immediately: boolean;
}

export class CancelSubscriptionRequest extends FormRequest {
  rules() {
    return CancelSubscriptionSchema;
  }

  passedValidation(data: any): CancelSubscriptionDto {
    return CancelSubscriptionDto.from(data);
  }
}
