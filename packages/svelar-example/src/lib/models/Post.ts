import { Model } from 'svelar/orm';

export class Post extends Model {
  static table = 'posts';
  static timestamps = true;
  static fillable = ['title', 'slug', 'body', 'published', 'user_id'];

  static casts = {
    published: 'boolean' as const,
    created_at: 'date' as const,
    updated_at: 'date' as const,
  };

  declare id: number;
  declare title: string;
  declare slug: string;
  declare body: string;
  declare published: boolean;
  declare user_id: number;
  declare created_at: Date;
  declare updated_at: Date;

  author() {
    return this.belongsTo(User, 'user_id');
  }
}

// Import here to avoid circular dep issues at class level
import { User } from './User.ts';
