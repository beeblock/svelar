/**
 * Svelar Validation
 *
 * Re-exports Zod with some convenience helpers for common validation patterns.
 */

import { z } from 'zod';

// Re-export Zod for direct usage
export { z };

// ── Common Validation Rules (Laravel-like named helpers) ──

export const rules = {
  required: () => z.string().min(1, 'This field is required'),
  email: () => z.string().email('Must be a valid email address'),
  string: (min?: number, max?: number) => {
    let schema = z.string();
    if (min !== undefined) schema = schema.min(min) as any;
    if (max !== undefined) schema = schema.max(max) as any;
    return schema;
  },
  number: (min?: number, max?: number) => {
    let schema = z.number();
    if (min !== undefined) schema = schema.min(min);
    if (max !== undefined) schema = schema.max(max);
    return schema;
  },
  integer: () => z.number().int(),
  boolean: () => z.boolean(),
  date: () => z.coerce.date(),
  url: () => z.string().url(),
  uuid: () => z.string().uuid(),
  enum: <T extends [string, ...string[]]>(values: T) => z.enum(values),
  array: <T extends z.ZodTypeAny>(schema: T) => z.array(schema),
  nullable: <T extends z.ZodTypeAny>(schema: T) => schema.nullable(),
  optional: <T extends z.ZodTypeAny>(schema: T) => schema.optional(),
  confirmed: (field: string = 'password') =>
    z
      .object({
        [field]: z.string(),
        [`${field}_confirmation`]: z.string(),
      })
      .refine((data) => data[field] === data[`${field}_confirmation`], {
        message: 'Confirmation does not match',
        path: [`${field}_confirmation`],
      }),
  min: (value: number) => z.number().min(value),
  max: (value: number) => z.number().max(value),
  between: (min: number, max: number) => z.number().min(min).max(max),
  regex: (pattern: RegExp, message?: string) => z.string().regex(pattern, message),
  ip: () =>
    z.string().refine(
      (val) => {
        const parts = val.split('.');
        if (parts.length !== 4) return false;
        return parts.every((p) => {
          const n = Number(p);
          return Number.isInteger(n) && n >= 0 && n <= 255;
        });
      },
      { message: 'Must be a valid IP address' }
    ),
  json: () =>
    z.string().refine(
      (val) => {
        try {
          JSON.parse(val);
          return true;
        } catch {
          return false;
        }
      },
      { message: 'Must be valid JSON' }
    ),
};

// ── Validate helper function ───────────────────────────────

export function validate<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown
): { success: true; data: z.infer<T> } | { success: false; errors: Record<string, any> } {
  const result = schema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  }

  const errors: Record<string, any> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.length > 0 ? issue.path : ['_root'];

    // Navigate/create nested object structure
    let current = errors;
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i];
      if (!(key in current)) {
        current[key] = {};
      }
      current = current[key];
    }

    // Set the error message array at the final key
    const finalKey = path[path.length - 1];
    if (!current[finalKey]) {
      current[finalKey] = [];
    }
    current[finalKey].push(issue.message);
  }

  return { success: false, errors };
}
