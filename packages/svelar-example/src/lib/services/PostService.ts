import { CrudService } from 'svelar/services';
import { Repository } from 'svelar/repositories';
import { PostRepository } from '../repositories/PostRepository.js';
import type { Post } from '../models/Post.js';

const postRepo = new PostRepository();

export class PostService extends CrudService<Post> {
  protected repository(): Repository<Post> {
    return postRepo;
  }

  async findPublished(): Promise<Post[]> {
    return postRepo.findPublished();
  }

  async findByUser(userId: number): Promise<Post[]> {
    return postRepo.findByUser(userId);
  }

  async createForUser(userId: number, data: any): Promise<Post> {
    return postRepo.create({
      ...data,
      user_id: userId,
    });
  }
}
