import { Action } from 'svelar/actions';
import { PostService } from '../services/PostService.js';
import type { Post } from '../models/Post.js';

interface CreatePostInput {
  userId: number;
  title: string;
  slug?: string;
  body: string;
  published?: boolean;
}

const postService = new PostService();

export class CreatePostAction extends Action<CreatePostInput, Post> {
  async execute(input: CreatePostInput): Promise<Post> {
    const slug = input.slug || input.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    return postService.createForUser(input.userId, {
      title: input.title,
      slug,
      body: input.body,
      published: input.published ?? false,
    });
  }
}
