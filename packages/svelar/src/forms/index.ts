/**
 * Svelar Forms Integration
 *
 * Bridges sveltekit-superforms with Svelar's validation layer.
 * Provides helpers for creating forms with Zod or Valibot schemas and server-side validation.
 *
 * @module @beeblock/svelar/forms
 *
 * @example
 * ```ts
 * // +page.server.ts
 * import { createFormAction, loadForm } from '@beeblock/svelar/forms';
 * import { z } from 'zod';
 *
 * const schema = z.object({ title: z.string().min(3), body: z.string().min(10) });
 *
 * export const load = async (event) => ({
 *   form: await loadForm(schema),
 * });
 *
 * export const actions = {
 *   default: createFormAction(schema, async (data, event) => {
 *     await Post.create(data);
 *   }),
 * };
 * ```
 */

import { z } from 'zod/v4';
import type { SuperValidated } from 'sveltekit-superforms';
import type * as v from 'valibot';

// Re-export FormRequest so `import { FormRequest } from '@beeblock/svelar/forms'` works
export { FormRequest, FormValidationError, FormAuthorizationError } from '../routing/FormRequest.js';

// ── Types ──────────────────────────────────────────────────

export type { z };

export type ValidationAdapter = 'zod' | 'zod4' | 'valibot';

export interface FormActionOptions {
  /** Native Zod 4 by default. The legacy 'zod' option name also selects Zod 4. */
  adapter?: ValidationAdapter;
  /** Redirect URL on success */
  redirectTo?: string;
  /** Custom error message on failure */
  errorMessage?: string;
  /** Whether to reset form after success (default: true) */
  resetOnSuccess?: boolean;
}

async function superformsAdapter(schema: unknown, adapter: ValidationAdapter = 'zod4') {
  const adapters = await import('sveltekit-superforms/adapters');
  return adapter === 'valibot'
    ? adapters.valibot(schema as any)
    : adapters.zod4(schema as any);
}

async function parseSchema(schema: unknown, data: unknown, adapter: ValidationAdapter = 'zod4') {
  if (adapter === 'valibot') {
    const valibot = await import('valibot');
    return valibot.safeParse(schema as any, data);
  }

  return (schema as z.ZodType).safeParse(data);
}

function validationErrors(result: any): Record<string, string[]> {
  const errors: Record<string, string[]> = {};

  if (result.error instanceof z.ZodError) {
    return z.flattenError(result.error).fieldErrors as Record<string, string[]>;
  }

  for (const issue of result.issues ?? []) {
    const path = Array.isArray(issue.path) && issue.path.length
      ? issue.path.map((item: any) => item.key).filter((key: any) => key !== undefined).join('.') || '_root'
      : '_root';

    if (!errors[path]) errors[path] = [];
    errors[path].push(issue.message ?? 'The given data was invalid.');
  }

  return errors;
}

// ── Form Helpers ──────────────────────────────────────────

/**
 * Creates a server-side form action handler with Zod or Valibot validation.
 * Compatible with sveltekit-superforms.
 *
 * @example
 * ```ts
 * import { createFormAction } from '@beeblock/svelar/forms';
 * import { createPostSchema } from '$lib/schemas/post';
 *
 * export const actions = {
 *   default: createFormAction(createPostSchema, async (data, event) => {
 *     const user = event.locals.user;
 *     await Post.create({ ...data, user_id: user.id });
 *   }),
 * };
 * ```
 */
export function createFormAction<TSchema extends z.ZodType<Record<string, unknown>>>(
  schema: TSchema,
  handler: (data: z.output<TSchema>, event: any) => Promise<void | Record<string, any>>,
  options?: FormActionOptions & { adapter?: 'zod' | 'zod4' },
): (event: any) => Promise<any>;
export function createFormAction<TSchema extends v.GenericSchema<unknown, Record<string, unknown>>>(
  schema: TSchema,
  handler: (data: v.InferOutput<TSchema>, event: any) => Promise<void | Record<string, any>>,
  options: FormActionOptions & { adapter: 'valibot' },
): (event: any) => Promise<any>;
export function createFormAction<TData = any>(
  schema: unknown,
  handler: (data: TData, event: any) => Promise<void | Record<string, any>>,
  options: FormActionOptions = {},
) {
  return async (event: any) => {
    // Dynamically import superforms to avoid hard dependency
    const { superValidate, fail, message } = await import('sveltekit-superforms');

    const form = await superValidate(event, await superformsAdapter(schema, options.adapter));

    if (!form.valid) {
      return fail(400, { form });
    }

    try {
      const result = await handler(form.data as TData, event);

      if (options.redirectTo) {
        const { redirect } = await import('@sveltejs/kit');
        throw redirect(303, options.redirectTo);
      }

      return result ?? { form };
    } catch (error: any) {
      // Re-throw redirects
      if (error?.status >= 300 && error?.status < 400) throw error;

      return message(form, options.errorMessage || error.message || 'An error occurred', {
        status: error.status || 400,
      });
    }
  };
}

/**
 * Load an empty form for a given schema.
 * Use this in SvelteKit `load` functions.
 *
 * @example
 * ```ts
 * export const load = async () => ({
 *   form: await loadForm(mySchema),
 * });
 * ```
 */
export function loadForm<TSchema extends z.ZodType<Record<string, unknown>>>(
  schema: TSchema,
  data?: Record<string, unknown>,
  adapter?: 'zod' | 'zod4',
): Promise<SuperValidated<z.output<TSchema>>>;
export function loadForm<TSchema extends v.GenericSchema<unknown, Record<string, unknown>>>(
  schema: TSchema,
  data: Record<string, unknown> | undefined,
  adapter: 'valibot',
): Promise<SuperValidated<v.InferOutput<TSchema>>>;
export async function loadForm(
  schema: unknown,
  data?: Record<string, unknown>,
  adapter: ValidationAdapter = 'zod4',
) {
  const { superValidate } = await import('sveltekit-superforms');

  return superValidate(data ?? null, await superformsAdapter(schema, adapter));
}

/**
 * Validate form data against a Zod or Valibot schema (server-side).
 * Returns the validated data or throws a FormValidationError.
 *
 * @example
 * ```ts
 * const data = await validateForm(event, createPostSchema);
 * ```
 */
export function validateForm<TSchema extends z.ZodType>(
  event: any,
  schema: TSchema,
  adapter?: 'zod' | 'zod4',
): Promise<z.output<TSchema>>;
export function validateForm<TSchema extends v.GenericSchema>(
  event: any,
  schema: TSchema,
  adapter: 'valibot',
): Promise<v.InferOutput<TSchema>>;
export async function validateForm<TData = any>(
  event: any,
  schema: unknown,
  adapter: ValidationAdapter = 'zod4',
): Promise<TData> {
  const formData = await event.request.formData();
  const raw: Record<string, any> = {};

  for (const [key, value] of formData.entries()) {
    raw[key] = value;
  }

  const result = await parseSchema(schema, raw, adapter);

  if (!result.success) {
    const { FormValidationError } = await import('../routing/FormRequest.js');
    throw new FormValidationError(validationErrors(result));
  }

  return ((result as any).data ?? (result as any).output) as TData;
}
