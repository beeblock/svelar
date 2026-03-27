/**
 * UUIDv7 & ULID generators
 *
 * UUIDv7 (RFC 9562) embeds a Unix timestamp in the first 48 bits,
 * making IDs time-sortable while remaining globally unique.
 *
 * ULID (Universally Unique Lexicographically Sortable Identifier)
 * is a 26-character Crockford Base32 string with 48-bit timestamp + 80 random bits.
 */

import { randomBytes } from 'node:crypto';

// ── UUIDv7 ──────────────────────────────────────────────────

/**
 * Generate a UUIDv7 (time-ordered UUID per RFC 9562).
 *
 * Layout (128 bits):
 *   48-bit unix_ts_ms | 4-bit version (0111) | 12-bit rand_a
 *   2-bit variant (10) | 62-bit rand_b
 */
export function uuidv7(): string {
  const now = Date.now();

  // 6 bytes of timestamp
  const tsBytes = Buffer.alloc(6);
  tsBytes.writeUIntBE(now, 0, 6);

  // 10 bytes of random data
  const rand = randomBytes(10);

  // Build 16-byte UUID
  const bytes = Buffer.alloc(16);

  // bytes 0-5: timestamp
  tsBytes.copy(bytes, 0);

  // bytes 6-7: version (0111) + 12 random bits
  bytes[6] = 0x70 | (rand[0] & 0x0f);
  bytes[7] = rand[1];

  // bytes 8-15: variant (10) + 62 random bits
  bytes[8] = 0x80 | (rand[2] & 0x3f);
  bytes[9] = rand[3];
  bytes[10] = rand[4];
  bytes[11] = rand[5];
  bytes[12] = rand[6];
  bytes[13] = rand[7];
  bytes[14] = rand[8];
  bytes[15] = rand[9];

  // Format as standard UUID string
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

// ── ULID ────────────────────────────────────────────────────

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Generate a ULID (Universally Unique Lexicographically Sortable Identifier).
 *
 * 26 characters: 10-char timestamp (48-bit ms) + 16-char randomness (80-bit).
 * Crockford Base32 encoded, naturally sortable by creation time.
 */
export function ulid(): string {
  const now = Date.now();

  // Encode 48-bit timestamp as 10 Crockford Base32 chars
  let ts = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    ts = CROCKFORD[t & 0x1f] + ts;
    t = Math.floor(t / 32);
  }

  // Encode 80 bits of randomness as 16 Crockford Base32 chars
  const rand = randomBytes(10);
  let r = '';
  for (let i = 0; i < 10; i++) {
    // Each byte contributes ~1.6 chars; we use a simpler approach:
    // split into 5-bit chunks across the byte array
    r += CROCKFORD[rand[i] & 0x1f];
  }
  // We need 16 chars of randomness, get 6 more from additional bytes
  const rand2 = randomBytes(6);
  for (let i = 0; i < 6; i++) {
    r += CROCKFORD[rand2[i] & 0x1f];
  }

  return ts + r;
}

/**
 * Check if a string is a valid UUIDv7.
 */
export function isUuidv7(value: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
}

/**
 * Check if a string is a valid ULID.
 */
export function isUlid(value: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/i.test(value);
}

/**
 * Extract the timestamp from a UUIDv7.
 */
export function uuidv7Timestamp(uuid: string): Date {
  const hex = uuid.replace(/-/g, '').slice(0, 12);
  const ms = parseInt(hex, 16);
  return new Date(ms);
}

/**
 * Extract the timestamp from a ULID.
 */
export function ulidTimestamp(id: string): Date {
  const chars = id.slice(0, 10);
  let ms = 0;
  for (const c of chars) {
    ms = ms * 32 + CROCKFORD.indexOf(c.toUpperCase());
  }
  return new Date(ms);
}
