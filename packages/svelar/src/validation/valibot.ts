/**
 * Svelar Valibot Validation
 *
 * Re-exports Valibot with Laravel-like named validation helpers.
 */

import * as v from 'valibot';
import { isUlid, isUuidv7 } from '../support/uuid.js';

export { v };

type AnySchema = Parameters<typeof v.array>[0];

function fieldPath(issue: any): Array<string | number> {
  if (!Array.isArray(issue.path) || issue.path.length === 0) return ['_root'];
  const path = issue.path
    .map((item: any) => item.key)
    .filter((key: any) => key !== undefined);

  return path.length > 0 ? path : ['_root'];
}

function setError(errors: Record<string, any>, path: Array<string | number>, message: string): void {
  let current = errors;
  for (let i = 0; i < path.length - 1; i++) {
    const key = String(path[i]);
    if (!(key in current)) {
      current[key] = {};
    }
    current = current[key];
  }

  const finalKey = String(path[path.length - 1]);
  if (!current[finalKey]) {
    current[finalKey] = [];
  }
  current[finalKey].push(message);
}

// ── Common Validation Rules (Laravel-like named helpers) ──

export const rules = {
  required: () => v.pipe(v.string(), v.minLength(1, 'This field is required')),
  email: () => v.pipe(v.string(), v.email('Must be a valid email address')),
  string: (min?: number, max?: number) => {
    if (min !== undefined && max !== undefined) {
      return v.pipe(v.string(), v.minLength(min), v.maxLength(max));
    }
    if (min !== undefined) return v.pipe(v.string(), v.minLength(min));
    if (max !== undefined) return v.pipe(v.string(), v.maxLength(max));
    return v.string();
  },
  number: (min?: number, max?: number) => {
    if (min !== undefined && max !== undefined) {
      return v.pipe(v.number(), v.minValue(min), v.maxValue(max));
    }
    if (min !== undefined) return v.pipe(v.number(), v.minValue(min));
    if (max !== undefined) return v.pipe(v.number(), v.maxValue(max));
    return v.number();
  },
  integer: () => v.pipe(v.number(), v.integer()),
  boolean: () => v.boolean(),
  date: () => v.pipe(
    v.unknown(),
    v.transform((value) => value instanceof Date ? value : new Date(String(value))),
    v.date()
  ),
  url: () => v.pipe(v.string(), v.url()),
  uuid: () => v.pipe(v.string(), v.uuid()),
  uuidv7: () =>
    v.pipe(
      v.string(),
      v.check((value) => isUuidv7(value), 'Must be a valid UUID v7')
    ),
  ulid: () =>
    v.pipe(
      v.string(),
      v.check((value) => isUlid(value), 'Must be a valid ULID')
    ),
  enum: <T extends readonly [string, ...string[]]>(values: T) => v.picklist(values),
  array: <T extends AnySchema>(schema: T) => v.array(schema),
  nullable: <T extends AnySchema>(schema: T) => v.nullable(schema),
  optional: <T extends AnySchema>(schema: T) => v.optional(schema),
  confirmed: (field: string = 'password') =>
    v.pipe(
      v.object({
        [field]: v.string(),
        [`${field}_confirmation`]: v.string(),
      }),
      v.forward(
        v.check((data) => data[field] === data[`${field}_confirmation`], 'Confirmation does not match'),
        [`${field}_confirmation`]
      )
    ),
  min: (value: number) => v.pipe(v.number(), v.minValue(value)),
  max: (value: number) => v.pipe(v.number(), v.maxValue(value)),
  between: (min: number, max: number) => v.pipe(v.number(), v.minValue(min), v.maxValue(max)),
  regex: (pattern: RegExp, message?: string) => v.pipe(v.string(), v.regex(pattern, message)),
  ip: () => v.pipe(v.string(), v.ip()),
  json: () =>
    v.pipe(
      v.string(),
      v.check((value) => {
        try {
          JSON.parse(value);
          return true;
        } catch {
          return false;
        }
      }, 'Must be valid JSON')
    ),
};

// ── Validate helper function ───────────────────────────────

export function validate<TSchema extends AnySchema>(
  schema: TSchema,
  data: unknown
): { success: true; data: v.InferOutput<TSchema> } | { success: false; errors: Record<string, any> } {
  const result = v.safeParse(schema, data);

  if (result.success) {
    return { success: true, data: result.output };
  }

  const errors: Record<string, any> = {};
  for (const issue of result.issues) {
    setError(errors, fieldPath(issue), issue.message);
  }

  return { success: false, errors };
}
