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

import { z, type ZodType } from 'zod/v4';
import type { BaseIssue, BaseSchema, BaseSchemaAsync, InferOutput } from 'valibot';
import type { RequestEvent } from './Controller.js';
import { singleton } from '../support/singleton.js';

export type FormRequestSchema =
  | ZodType
  | BaseSchema<unknown, unknown, BaseIssue<unknown>>
  | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>
  | unknown;

export type InferFormRequestOutput<TSchema> =
  TSchema extends ZodType ? z.output<TSchema>
    : TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>> | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>
      ? InferOutput<TSchema>
      : unknown;

export type FormRequestValidated<TRequest> =
  TRequest extends { passedValidation(...args: any[]): infer TOutput }
    ? unknown extends Awaited<TOutput>
      ? TRequest extends { rules(): infer TSchema } ? InferFormRequestOutput<TSchema> : unknown
      : Awaited<TOutput>
    : never;

type NormalizedValidationIssue = {
  path: string;
  code: string;
  message: string;
};

type NormalizedValidationResult =
  | { success: true; data: any }
  | { success: false; issues: NormalizedValidationIssue[] };

async function parseSchema(schema: FormRequestSchema, data: unknown): Promise<NormalizedValidationResult> {
  if (schema && typeof (schema as any).safeParse === 'function') {
    const result = (schema as any).safeParse(data);

    if (result.success) {
      return { success: true, data: result.data };
    }

    return {
      success: false,
      issues: (result.error?.issues ?? []).map((issue: any) => ({
        path: issue.path?.length ? issue.path.join('.') : '_root',
        code: issue.code ?? 'invalid',
        message: issue.message ?? 'The given data was invalid.',
      })),
    };
  }

  const valibot = await import('valibot');
  const result = valibot.safeParse(schema as any, data);

  if (result.success) {
    return { success: true, data: result.output };
  }

  return {
    success: false,
    issues: (result.issues ?? []).map((issue: any) => ({
      path: Array.isArray(issue.path) && issue.path.length
        ? issue.path.map((item: any) => item.key).filter((key: any) => key !== undefined).join('.') || '_root'
        : '_root',
      code: issue.type ?? 'invalid',
      message: issue.message ?? 'The given data was invalid.',
    })),
  };
}

// ── Form Request Base ──────────────────────────────────────

export abstract class FormRequest<
  TSchema extends FormRequestSchema = FormRequestSchema,
  TOutput = InferFormRequestOutput<TSchema>,
> {
  /**
   * Define the validation rules. Return a Zod schema by default, or a Valibot schema
   * when the app was scaffolded with Valibot.
   */
  abstract rules(): TSchema;

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
  passedValidation(data: InferFormRequestOutput<TSchema>): TOutput | Promise<TOutput> {
    return data as TOutput;
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
  ): Promise<FormRequestValidated<T>> {
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
    const result = await parseSchema(schema, data);

    if (!result.success) {
      const errors: Record<string, string[]> = {};
      const customMessages = instance.messages();
      const customAttributes = instance.attributes();

      for (const issue of result.issues) {
        const path = issue.path;
        const displayPath = customAttributes[path] ?? path;

        if (!errors[displayPath]) errors[displayPath] = [];

        // Check for custom message
        const ruleKey = `${path}.${issue.code}`;
        const customMsg = customMessages[ruleKey] ?? customMessages[path];

        errors[displayPath].push(customMsg ?? issue.message);
      }

      instance.failedValidation(errors);
    }

    return instance.passedValidation((result as { success: true; data: any }).data) as Promise<FormRequestValidated<T>>;
  }
}

// ── Error Classes ──────────────────────────────────────────

const validationErrors = singleton('svelar.form-validation-errors', () => new WeakSet<object>());
const authorizationErrors = singleton('svelar.form-authorization-errors', () => new WeakSet<object>());
const validationTypes = singleton('svelar.form-validation-types', () => new WeakSet<Function>());
const authorizationTypes = singleton('svelar.form-authorization-types', () => new WeakSet<Function>());

export class FormValidationError extends Error {
  public readonly statusCode = 422;

  constructor(public readonly errors: Record<string, string[]>) {
    super('The given data was invalid.');
    this.name = 'FormValidationError';
    validationErrors.add(this);
  }

  static [Symbol.hasInstance](value: unknown): boolean {
    return value !== null && typeof value === 'object' && validationErrors.has(value)
      && (validationTypes.has(this) || Function.prototype[Symbol.hasInstance].call(this, value));
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

validationTypes.add(FormValidationError);

export class FormAuthorizationError extends Error {
  public readonly statusCode = 403;

  constructor(message: string = 'This action is unauthorized.') {
    super(message);
    this.name = 'FormAuthorizationError';
    authorizationErrors.add(this);
  }

  static [Symbol.hasInstance](value: unknown): boolean {
    return value !== null && typeof value === 'object' && authorizationErrors.has(value)
      && (authorizationTypes.has(this) || Function.prototype[Symbol.hasInstance].call(this, value));
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

authorizationTypes.add(FormAuthorizationError);
