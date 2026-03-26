import { Repository } from 'svelar/repositories';
import { User } from '../models/User.js';

export class UserRepository extends Repository<User> {
  model() {
    return User;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.query().where('email', email).first();
  }

  async findWithPosts(id: number): Promise<User | null> {
    return this.query().with('posts').find(id);
  }
}
