import { FormRequest } from 'svelar/routing';
import { z } from 'svelar/validation';

export class CreatePostRequest extends FormRequest {
  rules() {
    return z.object({
      title: z.string().min(3).max(255),
      slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
      body: z.string().min(10),
      published: z.boolean().optional().default(false),
    });
  }

  authorize(event: any): boolean {
    // Only authenticated users can create posts
    return !!event.locals.user;
  }

  passedValidation(data: any) {
    // Auto-generate slug from title if not provided
    if (!data.slug) {
      data.slug = data.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    }
    return data;
  }
}
