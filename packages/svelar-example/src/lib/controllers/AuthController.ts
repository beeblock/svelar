import { Controller } from 'svelar/routing';
import { RegisterRequest } from '../dtos/RegisterRequest.js';
import { LoginRequest } from '../dtos/LoginRequest.js';
import { RegisterUserAction } from '../actions/RegisterUserAction.js';
import { AuthService } from '../services/AuthService.js';

const registerAction = new RegisterUserAction();
const authService = new AuthService();

export class AuthController extends Controller {
  /** POST /api/auth/register */
  async register(event: any) {
    const data = await RegisterRequest.validate(event);

    const result = await registerAction.run({
      name: data.name,
      email: data.email,
      password: data.password,
    });

    if (!result.success) {
      return this.json({ message: result.error }, 422);
    }

    // Log the user in immediately
    const user = result.data!;
    event.locals.session.set('auth_user_id', (user as any).id);
    event.locals.session.regenerateId();

    return this.created({
      message: 'Registration successful',
      user: { id: (user as any).id, name: (user as any).name, email: (user as any).email },
    });
  }

  /** POST /api/auth/login */
  async login(event: any) {
    const data = await LoginRequest.validate(event);

    const result = await authService.login(data.email, data.password);

    if (!result.success) {
      return this.json({ message: result.error }, 401);
    }

    const user = result.data!;
    event.locals.session.set('auth_user_id', (user as any).id);
    event.locals.session.regenerateId();

    return this.json({
      message: 'Login successful',
      user: { id: (user as any).id, name: (user as any).name, email: (user as any).email },
    });
  }

  /** POST /api/auth/logout */
  async logout(event: any) {
    event.locals.session.forget('auth_user_id');
    event.locals.session.regenerateId();

    return this.json({ message: 'Logged out successfully' });
  }

  /** GET /api/auth/me */
  async me(event: any) {
    const user = event.locals.user;
    if (!user) {
      return this.json({ message: 'Unauthenticated' }, 401);
    }

    return this.json({
      id: user.id,
      name: user.name,
      email: user.email,
      created_at: user.created_at,
    });
  }
}
