import { z } from 'zod';

export const createPostSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters').max(255),
  body: z.string().min(10, 'Body must be at least 10 characters'),
  published: z.boolean().default(false),
});

export const updatePostSchema = z.object({
  title: z.string().min(3).max(255).optional(),
  body: z.string().min(10).optional(),
  published: z.boolean().optional(),
});

export type CreatePostSchema = typeof createPostSchema;
export type UpdatePostSchema = typeof updatePostSchema;
