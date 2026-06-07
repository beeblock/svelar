import { FormRequest } from '@beeblock/svelar/routing';
import { SubscribeSchema } from '../types.js';
import { SubscribeDto } from './dto.js';

export interface SubscribeBody {
  priceId: string;
  name: string;
  trialDays?: number;
}

export class SubscribeRequest extends FormRequest {
  rules() {
    return SubscribeSchema;
  }

  passedValidation(data: any): SubscribeDto {
    return SubscribeDto.from(data);
  }
}
