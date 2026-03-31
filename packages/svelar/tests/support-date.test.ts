import { describe, it, expect } from 'vitest';
import {
  toDate,
  parseLocalDate,
  toLocal,
  formatDate,
  formatShortRelative,
  formatBetween,
  castDates,
  dateCaster,
  timeAgo,
} from '../src/support/date.js';

describe('toDate()', () => {
  it('should pass through Date objects', () => {
    const d = new Date(2024, 0, 15);
    expect(toDate(d)).toBe(d);
  });

  it('should convert timestamps', () => {
    const ts = 1705276800000; // 2024-01-15 00:00:00 UTC
    const d = toDate(ts);
    expect(d instanceof Date).toBe(true);
    expect(d.getTime()).toBe(ts);
  });

  it('should parse ISO strings', () => {
    const d = toDate('2024-01-15T12:00:00Z');
    expect(d instanceof Date).toBe(true);
    expect(d.getUTCHours()).toBe(12);
  });

  it('should parse date-only strings as local', () => {
    const d = toDate('2024-01-15');
    expect(d.getDate()).toBe(15);
    expect(d.getMonth()).toBe(0); // January
    expect(d.getFullYear()).toBe(2024);
  });

  it('should throw on invalid input', () => {
    expect(() => toDate('not-a-date')).toThrow('Invalid date');
    expect(() => toDate({} as any)).toThrow('Invalid date');
  });
});

describe('parseLocalDate()', () => {
  it('should parse YYYY-MM-DD as local midnight', () => {
    const d = parseLocalDate('2024-06-15');
    expect(d.getFullYear()).toBe(2024);
    expect(d.getMonth()).toBe(5); // June (0-indexed)
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });
});

describe('toLocal()', () => {
  it('should strip time component', () => {
    const d = toLocal(new Date(2024, 5, 15, 14, 30));
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getDate()).toBe(15);
  });
});

describe('formatDate()', () => {
  it('should format with default pattern', () => {
    const result = formatDate(new Date(2026, 2, 27));
    expect(result).toContain('Mar');
    expect(result).toContain('27');
    expect(result).toContain('2026');
  });

  it('should format with custom pattern', () => {
    const result = formatDate(new Date(2026, 2, 27), 'yyyy-MM-dd');
    expect(result).toBe('2026-03-27');
  });
});

describe('formatShortRelative()', () => {
  it('should format seconds', () => {
    const d = new Date(Date.now() - 30000);
    const result = formatShortRelative(d);
    expect(result).toMatch(/^\d+s$/);
  });

  it('should format minutes', () => {
    const d = new Date(Date.now() - 5 * 60000);
    const result = formatShortRelative(d);
    expect(result).toMatch(/^\d+m$/);
  });

  it('should format hours', () => {
    const d = new Date(Date.now() - 3 * 3600000);
    const result = formatShortRelative(d);
    expect(result).toMatch(/^\d+h$/);
  });

  it('should format days', () => {
    const d = new Date(Date.now() - 5 * 86400000);
    const result = formatShortRelative(d);
    expect(result).toMatch(/^\d+d$/);
  });
});

describe('formatBetween()', () => {
  it('should format distance between dates', () => {
    const start = new Date(2024, 0, 1);
    const end = new Date(2024, 0, 15);
    const result = formatBetween(start, end);
    expect(result).toContain('14');
    expect(result.toLowerCase()).toContain('day');
  });
});

describe('timeAgo()', () => {
  it('should return relative time string', () => {
    const d = new Date(Date.now() - 3600000);
    const result = timeAgo(d);
    expect(result).toContain('hour');
    expect(result).toContain('ago');
  });
});

describe('castDates()', () => {
  it('should cast date fields and add derived properties', () => {
    const obj = { id: 1, createdAt: Date.now() - 7200000, name: 'Alice' };
    const result = castDates(obj, ['createdAt']);

    expect(result.createdAt).toBeInstanceOf(Date);
    expect(result.createdAt_ago).toContain('ago');
    expect(result.createdAt_short).toMatch(/^\d+h$/);
    expect(result.createdAt_formatted).toContain('2');
    expect(result.name).toBe('Alice');
  });

  it('should skip null fields', () => {
    const obj = { id: 1, createdAt: null };
    const result = castDates(obj, ['createdAt']);
    expect(result.createdAt).toBeNull();
    expect(result.createdAt_ago).toBeUndefined();
  });
});

describe('dateCaster()', () => {
  it('should create a reusable caster', () => {
    const cast = dateCaster(['createdAt', 'updatedAt']);
    const obj = { createdAt: Date.now(), updatedAt: Date.now(), name: 'Test' };
    const result = cast(obj);
    expect(result.createdAt).toBeInstanceOf(Date);
    expect(result.updatedAt).toBeInstanceOf(Date);
    expect(result.createdAt_ago).toBeDefined();
  });
});
