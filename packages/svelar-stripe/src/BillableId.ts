export type BillableId = string | number;

/** Canonical storage/metadata identity; never parse an opaque model key as a number. */
export function normalizeBillableId(value: unknown): string {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Billable ID must be a positive safe integer or a canonical string.');
    return String(value);
  }
  if (typeof value !== 'string' || value.length === 0 || value.length > 255 || value.trim() !== value
    || /[\s\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(value)
    || ['__proto__', 'prototype', 'constructor'].includes(value)) {
    throw new Error('Billable ID must be a nonempty canonical string of at most 255 characters.');
  }
  if (/^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value) && !/^[1-9]\d*$/.test(value)) {
    // All-digit ULIDs are still opaque 128-bit identifiers, including leading zeroes.
    if (!/^[0-7][0-9]{25}$/.test(value)) throw new Error('Billable ID must not use an ambiguous numeric representation.');
  }
  return value;
}
