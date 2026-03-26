import { FormRequest } from 'svelar/routing';
import { z } from 'svelar/validation';

export class UpdatePostRequest extends FormRequest {
  rules() {
    return z.object({
      title: z.string().min(3).max(255).optional(),
      slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
      body: z.string().min(10).optional(),
      published: z.boolean().optional(),
    });
  }

  authorize(event: any): boolean {
    return !!event.locals.user;
  }
}
