import { describe, it, expect } from 'vitest';
import {
  uuidv7,
  ulid,
  isUuidv7,
  isUlid,
  uuidv7Timestamp,
  ulidTimestamp,
} from '../src/support/uuid.js';

describe('UUIDv7', () => {
  it('should generate valid UUIDv7 format', () => {
    const id = uuidv7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('should generate unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => uuidv7()));
    expect(ids.size).toBe(100);
  });

  it('should be time-sortable', async () => {
    const id1 = uuidv7();
    // Wait 2ms to ensure different timestamp
    await new Promise(r => setTimeout(r, 2));
    const id2 = uuidv7();
    // Compare timestamp portions (first 8 chars of UUID = first 32 bits of timestamp)
    expect(id1.slice(0, 8) <= id2.slice(0, 8)).toBe(true);
  });

  it('should have version 7 nibble', () => {
    const id = uuidv7();
    expect(id[14]).toBe('7');
  });

  it('should have correct variant bits', () => {
    const id = uuidv7();
    const variantChar = id[19];
    expect(['8', '9', 'a', 'b']).toContain(variantChar);
  });
});

describe('isUuidv7()', () => {
  it('should validate correct UUIDv7', () => {
    const id = uuidv7();
    expect(isUuidv7(id)).toBe(true);
  });

  it('should reject UUIDv4', () => {
    expect(isUuidv7('550e8400-e29b-41d4-a716-446655440000')).toBe(false);
  });

  it('should reject invalid strings', () => {
    expect(isUuidv7('not-a-uuid')).toBe(false);
    expect(isUuidv7('')).toBe(false);
  });
});

describe('uuidv7Timestamp()', () => {
  it('should extract timestamp close to now', () => {
    const before = Date.now();
    const id = uuidv7();
    const after = Date.now();
    const ts = uuidv7Timestamp(id);
    expect(ts.getTime()).toBeGreaterThanOrEqual(before);
    expect(ts.getTime()).toBeLessThanOrEqual(after);
  });
});

describe('ULID', () => {
  it('should generate 26-character ULID', () => {
    const id = ulid();
    expect(id).toHaveLength(26);
  });

  it('should only use Crockford Base32 characters', () => {
    const id = ulid();
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('should generate unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => ulid()));
    expect(ids.size).toBe(100);
  });

  it('should be lexicographically sortable by time', async () => {
    const id1 = ulid();
    // Wait 2ms to ensure different timestamp
    await new Promise(r => setTimeout(r, 2));
    const id2 = ulid();
    // Compare only the timestamp portion (first 10 chars)
    expect(id1.slice(0, 10) <= id2.slice(0, 10)).toBe(true);
  });
});

describe('isUlid()', () => {
  it('should validate correct ULID', () => {
    const id = ulid();
    expect(isUlid(id)).toBe(true);
  });

  it('should reject invalid strings', () => {
    expect(isUlid('short')).toBe(false);
    expect(isUlid('not-a-valid-ulid-!!!!!!!!!')).toBe(false);
  });
});

describe('ulidTimestamp()', () => {
  it('should extract timestamp close to now', () => {
    const before = Date.now();
    const id = ulid();
    const after = Date.now();
    const ts = ulidTimestamp(id);
    expect(ts.getTime()).toBeGreaterThanOrEqual(before);
    expect(ts.getTime()).toBeLessThanOrEqual(after);
  });
});
