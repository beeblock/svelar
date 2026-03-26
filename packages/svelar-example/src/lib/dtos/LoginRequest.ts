import { FormRequest } from 'svelar/routing';
import { z } from 'svelar/validation';

export class LoginRequest extends FormRequest {
  rules() {
    return z.object({
      email: z.string().email(),
      password: z.string().min(1),
    });
  }
}
