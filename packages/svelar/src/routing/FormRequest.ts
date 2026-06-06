/**
 * Svelar Form Request
 *
 * Dedicated validation classes for complex request validation.
 * Inspired by Laravel's Form Request.
 *
 * @example
 * ```ts
 * import { FormRequest } from '@beeblock/svelar/forms';
 * import { z } from '@beeblock/svelar/validation';
 *
 * class CreateUserRequest extends FormRequest {
 *   rules() {
 *     return z.object({
 *       name: z.string().min(2).max(100),
 *       email: z.string().email(),
 *       password: z.string().min(8),
 *       password_confirmation: z.string(),
 *     }).refine(data => data.password === data.password_confirmation, {
 *       message: 'Passwords do not match',
 *       path: ['password_confirmation'],
 *     });
 *   }
 *
 *   authorize(event: RequestEvent): boolean {
 *     return true; // Or check event.locals.user
 *   }
 *
 *   messages() {
 *     return {
 *       'name.min': 'Name must be at least 2 characters',
 *     };
 *   }
 * }
 *
 * // In a controller:
 * const data = await CreateUserRequest.validate(event);
 * ```
 */

import { z, type ZodTypeAny } from 'zod';
import type { RequestEvent } from './Controller.js';

// ── Form Request Base ──────────────────────────────────────

export abstract class FormRequest {
  /**
   * Define the validation rules (return a Zod schema)
   */
  abstract rules(): ZodTypeAny;

  /**
   * Determine if the user is authorized to make this request.
   * Override to add authorization logic.
   */
  authorize(event: RequestEvent): boolean | Promise<boolean> {
    return true;
  }

  /**
   * Custom error messages (optional override).
   * Keys are 'field.rule' format.
   */
  messages(): Record<string, string> {
    return {};
  }

  /**
   * Custom attribute names for error messages (optional).
   */
  attributes(): Record<string, string> {
    return {};
  }

  /**
   * Transform data after validation (optional).
   */
  passedValidation(data: any): any {
    return data;
  }

  /**
   * Called when validation fails (optional override).
   * By default throws a Response.
   */
  failedValidation(errors: Record<string, string[]>): never {
    throw new FormValidationError(errors);
  }

  /**
   * Called when authorization fails (optional override).
   */
  failedAuthorization(): never {
    throw new FormAuthorizationError();
  }

  /**
   * Parse request body based on content type
   */
  protected async parseBody(event: RequestEvent): Promise<any> {
    const contentType = event.request.headers.get('content-type') ?? '';

    if (contentType.includes('application/json')) {
      return event.request.json();
    }

    if (
      contentType.includes('multipart/form-data') ||
      contentType.includes('application/x-www-form-urlencoded')
    ) {
      const formData = await event.request.formData();
      return Object.fromEntries(formData as any);
    }

    // Fall back to query params
    return Object.fromEntries(event.url.searchParams);
  }

  /**
   * Validate a request using this FormRequest class.
   * Static factory method for convenience.
   */
  static async validate<T extends FormRequest>(
    this: new () => T,
    event: RequestEvent
  ): Promise<z.infer<ReturnType<T['rules']>>> {
    const instance = new this();

    // Authorization check
    const authorized = await instance.authorize(event);
    if (!authorized) {
      instance.failedAuthorization();
    }

    // Parse body
    const body = await instance.parseBody(event);

    // Merge body + params + query
    const data = {
      ...Object.fromEntries(event.url.searchParams),
      ...event.params,
      ...body,
    };

    // Validate
    const schema = instance.rules();
    const result = schema.safeParse(data);

    if (!result.success) {
      const errors: Record<string, string[]> = {};
      const customMessages = instance.messages();
      const customAttributes = instance.attributes();

      for (const issue of result.error.issues) {
        const path = issue.path.join('.');
        const displayPath = customAttributes[path] ?? path;

        if (!errors[displayPath]) errors[displayPath] = [];

        // Check for custom message
        const ruleKey = `${path}.${issue.code}`;
        const customMsg = customMessages[ruleKey] ?? customMessages[path];

        errors[displayPath].push(customMsg ?? issue.message);
      }

      instance.failedValidation(errors);
    }

    return instance.passedValidation(result.data);
  }
}

// ── Error Classes ──────────────────────────────────────────

export class FormValidationError extends Error {
  public readonly statusCode = 422;

  constructor(public readonly errors: Record<string, string[]>) {
    super('The given data was invalid.');
    this.name = 'FormValidationError';
  }

  toResponse(): Response {
    return new Response(
      JSON.stringify({
        message: this.message,
        errors: this.errors,
      }),
      {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

export class FormAuthorizationError extends Error {
  public readonly statusCode = 403;

  constructor(message: string = 'This action is unauthorized.') {
    super(message);
    this.name = 'FormAuthorizationError';
  }

  toResponse(): Response {
    return new Response(
      JSON.stringify({ message: this.message }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
