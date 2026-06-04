/**
 * Svelar Date Utilities
 *
 * Timezone-safe date formatting, parsing, and relative time helpers.
 * Built on date-fns to avoid the classic "off by one day" bug where
 * `new Date('2024-01-15')` parses as UTC midnight and displays as
 * January 14th in negative UTC offset timezones.
 *
 * @example
 * ```ts
 * import { formatDate, formatRelative, parseLocalDate, toLocal } from '@beeblock/svelar/dates';
 *
 * // Safe date formatting (locale-aware)
 * formatDate(user.createdAt);                    // "Mar 27, 2026"
 * formatDate(user.createdAt, 'PPpp');            // "Mar 27, 2026, 2:30 PM"
 * formatDate(user.createdAt, 'PP', { locale: pt }); // "27 de mar. de 2026"
 *
 * // Relative time
 * formatRelative(Date.now() - 3600000);          // "about 1 hour ago"
 *
 * // Parse date-only strings safely (as LOCAL, not UTC)
 * parseLocalDate('2024-01-15');                   // Jan 15 00:00 LOCAL time
 *
 * // Convert any Date/timestamp to local-safe Date
 * toLocal(someUtcDate);
 * ```
 */

import {
  format as fnsFormat,
  formatDistanceToNow,
  formatDistance,
  isValid,
  parseISO,
  differenceInDays,
  differenceInHours,
  differenceInMinutes,
  differenceInSeconds,
  startOfDay,
  endOfDay,
  isToday,
  isYesterday,
  isTomorrow,
  addDays,
  addHours,
  addMinutes,
  subDays,
  subHours,
  subMinutes,
  type Locale,
} from 'date-fns';

import { enUS } from 'date-fns/locale';

// ── Types ──────────────────────────────────────────────────

export type { Locale };

export interface FormatOptions {
  /** date-fns locale object (e.g. import { pt } from 'date-fns/locale') */
  locale?: Locale;
}

export type DateInput = Date | number | string;

// ── Core Helpers ───────────────────────────────────────────

/**
 * Normalize any date input to a safe Date object.
 *
 * - Numbers (timestamps) → `new Date(ts)` (correct, timestamps are always UTC)
 * - Date objects → returned as-is
 * - ISO strings with time component → `parseISO()` (handles timezone offset)
 * - Date-only strings like '2024-01-15' → parsed as LOCAL date to avoid
 *   the off-by-one-day bug (JS natively parses these as UTC midnight)
 */
export function toDate(input: DateInput): Date {
  if (input instanceof Date) return input;

  if (typeof input === 'number') {
    // Timestamps are always ms since epoch — no timezone ambiguity
    return new Date(input);
  }

  if (typeof input === 'string') {
    const trimmed = input.trim();

    // Date-only string: YYYY-MM-DD → parse as LOCAL to avoid UTC midnight bug
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return parseLocalDate(trimmed);
    }

    // Full ISO string with time → parseISO handles timezone offsets correctly
    const parsed = parseISO(trimmed);
    if (isValid(parsed)) return parsed;

    // Fallback for other formats
    const fallback = new Date(trimmed);
    if (isValid(fallback)) return fallback;

    throw new Error(`Invalid date string: "${input}"`);
  }

  throw new Error(`Invalid date input: ${input}`);
}

/**
 * Parse a date-only string (e.g. '2024-01-15') as LOCAL midnight.
 *
 * The native `new Date('2024-01-15')` parses as UTC midnight, which causes
 * the infamous off-by-one-day bug in negative UTC offset timezones.
 * This function explicitly constructs the date from year/month/day parts
 * using the local timezone.
 */
export function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  // Month is 0-indexed in JS Date constructor
  return new Date(year, month - 1, day);
}

/**
 * Ensure a date is treated as local midnight (strips time component).
 * Useful when comparing dates without time (e.g. "is this the same day?").
 */
export function toLocal(input: DateInput): Date {
  const d = toDate(input);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// ── Formatting ─────────────────────────────────────────────

/**
 * Format a date with a date-fns pattern. Defaults to 'PP' (locale-aware medium date).
 *
 * Common patterns:
 * - 'PP'    → "Mar 27, 2026"
 * - 'PPP'   → "March 27th, 2026"
 * - 'PPpp'  → "Mar 27, 2026, 2:30:00 PM"
 * - 'p'     → "2:30 PM"
 * - 'Pp'    → "Mar 27, 2026, 2:30 PM"
 * - 'yyyy-MM-dd' → "2026-03-27"
 *
 * @see https://date-fns.org/docs/format
 */
export function formatDate(input: DateInput, pattern = 'PP', options?: FormatOptions): string {
  const date = toDate(input);
  return fnsFormat(date, pattern, { locale: options?.locale ?? enUS });
}

/**
 * Format a date as relative time from now (e.g. "about 2 hours ago", "in 3 days").
 * Uses `formatDistanceToNow` with `addSuffix: true`.
 */
export function formatRelative(input: DateInput, options?: FormatOptions): string {
  const date = toDate(input);
  return formatDistanceToNow(date, {
    addSuffix: true,
    locale: options?.locale ?? enUS,
  });
}

/**
 * Format a short relative time without suffix (e.g. "2h", "3d", "5m").
 * Useful for compact UI like tables and badges.
 */
export function formatShortRelative(input: DateInput): string {
  const date = toDate(input);
  const now = Date.now();
  const diff = Math.abs(now - date.getTime());

  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(diff / 86_400_000);
  if (days < 30) return `${days}d`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;

  const years = Math.floor(days / 365);
  return `${years}y`;
}

/**
 * Format the distance between two dates (e.g. "about 2 hours").
 */
export function formatBetween(
  start: DateInput,
  end: DateInput,
  options?: FormatOptions,
): string {
  return formatDistance(toDate(start), toDate(end), {
    locale: options?.locale ?? enUS,
  });
}

/**
 * Return a human-readable "time ago" string. Alias for `formatRelative`.
 * Inspired by Laravel's Carbon `diffForHumans()`.
 *
 * @example
 * timeAgo(user.createdAt)  // "about 2 hours ago"
 * timeAgo(post.publishedAt, { locale: pt })  // "cerca de 2 horas atrás"
 */
export function timeAgo(input: DateInput, options?: FormatOptions): string {
  return formatRelative(input, options);
}

// ── Model Date Casting ─────────────────────────────────────

/**
 * Cast date fields on a model-like object. Converts raw timestamps/strings
 * to timezone-safe Date objects and adds a `.timeAgo()` method.
 *
 * Server stores UTC → UI always shows in the user's local timezone.
 *
 * @example
 * ```ts
 * // In a server load function
 * const user = await db.query.users.findFirst({ where: eq(users.id, id) });
 *
 * return {
 *   user: castDates(user, ['createdAt', 'updatedAt', 'lastLoginAt'])
 * };
 *
 * // In the template
 * user.createdAt          // Date object (local timezone)
 * user.createdAt_ago      // "about 2 hours ago"
 * user.createdAt_short    // "2h"
 * user.createdAt_formatted // "Mar 27, 2026"
 * ```
 */
export function castDates<T extends Record<string, any>>(
  obj: T,
  dateFields: (keyof T)[],
  options?: FormatOptions,
): T & Record<string, any> {
  const result = { ...obj } as any;

  for (const field of dateFields) {
    const raw = obj[field];
    if (raw == null) continue;

    const key = String(field);
    const date = toDate(raw);
    result[key] = date;
    result[`${key}_ago`] = formatRelative(date, options);
    result[`${key}_short`] = formatShortRelative(date);
    result[`${key}_formatted`] = formatDate(date, 'PP', options);
  }

  return result;
}

/**
 * Create a reusable date caster for a specific set of fields.
 * Useful when you cast the same fields on every request.
 *
 * @example
 * ```ts
 * // Define once
 * const castUserDates = dateCaster(['createdAt', 'updatedAt', 'lastLoginAt']);
 *
 * // Use in load functions
 * return { user: castUserDates(user) };
 * ```
 */
export function dateCaster<K extends string>(fields: K[]) {
  return <T extends Record<string, any>>(obj: T, options?: FormatOptions) =>
    castDates(obj, fields as any, options);
}

// ── Comparison Helpers ─────────────────────────────────────

export { isToday, isYesterday, isTomorrow, isValid };

export {
  differenceInDays,
  differenceInHours,
  differenceInMinutes,
  differenceInSeconds,
};

// ── Manipulation ───────────────────────────────────────────

export {
  startOfDay,
  endOfDay,
  addDays,
  addHours,
  addMinutes,
  subDays,
  subHours,
  subMinutes,
};

// ── Re-exports for convenience ─────────────────────────────

export { parseISO, fnsFormat as format };
