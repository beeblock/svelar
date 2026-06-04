/**
 * Svelar Forms Integration
 *
 * Bridges sveltekit-superforms with Svelar's validation layer.
 * Provides helpers for creating forms with Zod schemas and server-side validation.
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

import { z } from 'zod';

// Re-export FormRequest so `import { FormRequest } from '@beeblock/svelar/forms'` works
export { FormRequest, FormValidationError, FormAuthorizationError } from '../routing/FormRequest.js';

// ── Types ──────────────────────────────────────────────────

export type { z };

export interface FormActionOptions<T extends z.ZodTypeAny> {
  /** Redirect URL on success */
  redirectTo?: string;
  /** Custom error message on failure */
  errorMessage?: string;
  /** Whether to reset form after success (default: true) */
  resetOnSuccess?: boolean;
}

// ── Form Helpers ──────────────────────────────────────────

/**
 * Creates a server-side form action handler with Zod validation.
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
export function createFormAction<T extends z.ZodTypeAny>(
  schema: T,
  handler: (data: z.infer<T>, event: any) => Promise<void | Record<string, any>>,
  options: FormActionOptions<T> = {},
) {
  return async (event: any) => {
    // Dynamically import superforms to avoid hard dependency
    const { superValidate, fail, message } = await import('sveltekit-superforms');
    const { zod } = await import('sveltekit-superforms/adapters');

    const form = await superValidate(event, zod(schema as any));

    if (!form.valid) {
      return fail(400, { form });
    }

    try {
      const result = await handler(form.data as z.infer<T>, event);

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
export async function loadForm<T extends z.ZodTypeAny>(schema: T, data?: Partial<z.infer<T>>) {
  const { superValidate } = await import('sveltekit-superforms');
  const { zod } = await import('sveltekit-superforms/adapters');

  return superValidate(data ?? null, zod(schema as any));
}

/**
 * Validate form data against a Zod schema (server-side).
 * Returns the validated data or throws a FormValidationError.
 *
 * @example
 * ```ts
 * const data = await validateForm(event, createPostSchema);
 * ```
 */
export async function validateForm<T extends z.ZodTypeAny>(
  event: any,
  schema: T,
): Promise<z.infer<T>> {
  const formData = await event.request.formData();
  const raw: Record<string, any> = {};

  for (const [key, value] of formData.entries()) {
    raw[key] = value;
  }

  const result = schema.safeParse(raw);

  if (!result.success) {
    const { FormValidationError } = await import('../routing/FormRequest.js');
    throw new FormValidationError(result.error.flatten().fieldErrors as Record<string, string[]>);
  }

  return result.data;
}
