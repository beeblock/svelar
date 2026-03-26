import { FormRequest } from 'svelar/routing';
import { z } from 'svelar/validation';

export class RegisterRequest extends FormRequest {
  rules() {
    return z.object({
      name: z.string().min(2).max(100),
      email: z.string().email(),
      password: z.string().min(8),
      password_confirmation: z.string(),
    }).refine((data) => data.password === data.password_confirmation, {
      message: 'Passwords do not match',
      path: ['password_confirmation'],
    });
  }

  messages() {
    return {
      'name.too_small': 'Name must be at least 2 characters',
      'email.invalid_string': 'Please enter a valid email address',
      'password.too_small': 'Password must be at least 8 characters',
    };
  }
}
