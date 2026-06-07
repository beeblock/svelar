import { FormRequest } from '@beeblock/svelar/routing';
import { RefundSchema } from '../types.js';
import { RefundDto } from './dto.js';

export interface RefundBody {
  invoiceId: string;
}

export class RefundRequest extends FormRequest {
  rules() {
    return RefundSchema;
  }

  passedValidation(data: any): RefundDto {
    return RefundDto.from(data);
  }
}
