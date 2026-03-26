import { Service } from 'svelar/services';
import { Hash } from 'svelar/hashing';
import { UserRepository } from '../repositories/UserRepository.js';

const userRepo = new UserRepository();

export class AuthService extends Service {
  async register(data: { name: string; email: string; password: string }) {
    // Check if email already exists
    const existing = await userRepo.findByEmail(data.email);
    if (existing) {
      return this.fail('Email already registered');
    }

    // Hash password and create user
    const hashedPassword = await Hash.make(data.password);
    const user = await userRepo.create({
      name: data.name,
      email: data.email,
      password: hashedPassword,
    });

    await this.emit({ type: 'user:registered', user });
    return this.ok(user);
  }

  async login(email: string, password: string) {
    const user = await userRepo.findByEmail(email);
    if (!user) {
      return this.fail('Invalid credentials');
    }

    const valid = await Hash.verify(password, (user as any).password);
    if (!valid) {
      return this.fail('Invalid credentials');
    }

    return this.ok(user);
  }
}
