/**
 * Locale-aware date helpers for the example app.
 *
 * Wraps svelar/dates with automatic paraglide locale detection.
 * Server stores UTC timestamps — these functions always display
 * dates in the user's local timezone.
 */

import {
  formatDate as svelarFormat,
  formatRelative as svelarRelative,
  formatShortRelative,
  timeAgo as svelarTimeAgo,
  castDates as svelarCastDates,
  dateCaster as svelarDateCaster,
  toDate,
  type DateInput,
  type FormatOptions,
} from 'svelar/dates';

import { getLocale } from '$lib/paraglide/runtime';
import { enUS, pt, es } from 'date-fns/locale';

/** Map paraglide locale codes to date-fns Locale objects */
const localeMap: Record<string, Locale> = {
  en: enUS,
  pt: pt,
  es: es,
};

function getDateLocale(): Locale {
  return localeMap[getLocale()] ?? enUS;
}

/**
 * Format a UTC timestamp or Date as a locale-aware date string.
 * Always displays in the user's local timezone.
 *
 * @example
 * formatDate(1711540200000)        // "Mar 27, 2024" (en) / "27 de mar. de 2024" (pt)
 * formatDate(1711540200000, 'PPp') // "Mar 27, 2024, 2:30 PM"
 */
export function formatDate(input: DateInput, pattern = 'PP'): string {
  return svelarFormat(input, pattern, { locale: getDateLocale() });
}

/**
 * Format as relative time from now, locale-aware.
 *
 * @example
 * formatRelative(Date.now() - 7200000) // "about 2 hours ago" / "cerca de 2 horas atrás"
 */
export function formatRelative(input: DateInput): string {
  return svelarRelative(input, { locale: getDateLocale() });
}

/**
 * Human-readable "time ago" — alias for formatRelative.
 * Inspired by Laravel Carbon's `diffForHumans()`.
 *
 * @example
 * timeAgo(user.createdAt) // "about 2 hours ago"
 */
export function timeAgo(input: DateInput): string {
  return svelarTimeAgo(input, { locale: getDateLocale() });
}

/**
 * Cast date fields on a model object with automatic locale.
 * Adds `_ago`, `_short`, `_formatted` computed fields.
 *
 * @example
 * const user = castDates(rawUser, ['createdAt', 'updatedAt']);
 * user.createdAt_ago       // "about 2 hours ago"
 * user.createdAt_short     // "2h"
 * user.createdAt_formatted // "Mar 27, 2026"
 */
export function castDates<T extends Record<string, any>>(
  obj: T,
  dateFields: (keyof T)[],
): T & Record<string, any> {
  return svelarCastDates(obj, dateFields, { locale: getDateLocale() });
}

/**
 * Create a reusable date caster for a specific set of fields.
 *
 * @example
 * const castUserDates = dateCaster(['createdAt', 'updatedAt']);
 * return { user: castUserDates(rawUser) };
 */
export function dateCaster<K extends string>(fields: K[]) {
  return <T extends Record<string, any>>(obj: T) =>
    svelarCastDates(obj, fields as any, { locale: getDateLocale() });
}

/**
 * Format as compact relative time (e.g. "2h", "3d", "5m").
 * Language-independent — uses short suffixes.
 */
export { formatShortRelative } from 'svelar/dates';

/**
 * Re-export toDate for direct use when needed.
 */
export { toDate } from 'svelar/dates';
