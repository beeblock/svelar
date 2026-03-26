import { Repository } from 'svelar/repositories';
import { Post } from '../models/Post.js';

export class PostRepository extends Repository<Post> {
  model() {
    return Post;
  }

  async findPublished(): Promise<Post[]> {
    return this.query()
      .where('published', true)
      .orderBy('created_at', 'desc')
      .get();
  }

  async findBySlug(slug: string): Promise<Post | null> {
    return this.query().where('slug', slug).first();
  }

  async findByUser(userId: number): Promise<Post[]> {
    return this.query()
      .where('user_id', userId)
      .orderBy('created_at', 'desc')
      .get();
  }
}
