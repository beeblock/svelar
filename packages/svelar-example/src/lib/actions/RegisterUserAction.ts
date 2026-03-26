import { Action } from 'svelar/actions';
import { AuthService } from '../services/AuthService.js';
import type { User } from '../models/User.js';
import type { ServiceResult } from 'svelar/services';

interface RegisterInput {
  name: string;
  email: string;
  password: string;
}

const authService = new AuthService();

export class RegisterUserAction extends Action<RegisterInput, ServiceResult<User>> {
  async execute(input: RegisterInput): Promise<ServiceResult<User>> {
    return authService.register(input);
  }
}
