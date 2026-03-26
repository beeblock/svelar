/**
 * Svelar Hashing
 *
 * Password hashing with bcrypt and argon2 support.
 * Falls back to a built-in scrypt implementation for zero-dependency usage.
 *
 * @example
 * ```ts
 * import { Hash } from 'svelar';
 *
 * const hashed = await Hash.make('my-password');
 * const valid = await Hash.verify('my-password', hashed);
 * ```
 */

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// ── Types ──────────────────────────────────────────────────

export type HashDriver = 'scrypt' | 'bcrypt' | 'argon2';

export interface HashConfig {
  driver: HashDriver;
  /** scrypt: CPU/memory cost (default: 16384) */
  scryptCost?: number;
  /** bcrypt: rounds (default: 12) */
  bcryptRounds?: number;
}

// ── Scrypt Implementation (zero-dependency) ────────────────

async function scryptHash(password: string, cost: number = 16384): Promise<string> {
  const salt = randomBytes(16);
  const keyLength = 64;

  const derived = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, keyLength, { N: cost, r: 8, p: 1 }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });

  // Format: $scrypt$N=cost$salt$hash
  return `$scrypt$N=${cost}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

async function scryptVerify(password: string, hash: string): Promise<boolean> {
  const parts = hash.split('$');
  // $scrypt$N=cost$salt$hash → ['', 'scrypt', 'N=cost', 'salt', 'hash']
  if (parts.length !== 5 || parts[1] !== 'scrypt') return false;

  const cost = parseInt(parts[2].replace('N=', ''), 10);
  const salt = Buffer.from(parts[3], 'base64');
  const expected = Buffer.from(parts[4], 'base64');
  const keyLength = expected.length;

  const derived = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, keyLength, { N: cost, r: 8, p: 1 }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });

  return timingSafeEqual(derived, expected);
}

// ── Hash Manager ───────────────────────────────────────────

class HashManager {
  private config: HashConfig = {
    driver: 'scrypt',
    scryptCost: 16384,
    bcryptRounds: 12,
  };

  /**
   * Configure the hash manager
   */
  configure(config: Partial<HashConfig>): void {
    Object.assign(this.config, config);
  }

  /**
   * Hash a plain text value
   */
  async make(value: string): Promise<string> {
    switch (this.config.driver) {
      case 'scrypt':
        return scryptHash(value, this.config.scryptCost);

      case 'bcrypt': {
        try {
          const bcrypt = await import('bcrypt');
          return bcrypt.default.hash(value, this.config.bcryptRounds ?? 12);
        } catch {
          throw new Error(
            'bcrypt driver requires the "bcrypt" package. Install it: npm install bcrypt'
          );
        }
      }

      case 'argon2': {
        try {
          const argon2 = await import('argon2');
          return argon2.default.hash(value);
        } catch {
          throw new Error(
            'argon2 driver requires the "argon2" package. Install it: npm install argon2'
          );
        }
      }

      default:
        throw new Error(`Unsupported hash driver: ${this.config.driver}`);
    }
  }

  /**
   * Verify a plain text value against a hash
   */
  async verify(value: string, hash: string): Promise<boolean> {
    // Auto-detect driver from hash format
    if (hash.startsWith('$scrypt$')) {
      return scryptVerify(value, hash);
    }

    if (hash.startsWith('$2b$') || hash.startsWith('$2a$') || hash.startsWith('$2y$')) {
      try {
        const bcrypt = await import('bcrypt');
        return bcrypt.default.compare(value, hash);
      } catch {
        throw new Error('bcrypt package required to verify bcrypt hashes.');
      }
    }

    if (hash.startsWith('$argon2')) {
      try {
        const argon2 = await import('argon2');
        return argon2.default.verify(hash, value);
      } catch {
        throw new Error('argon2 package required to verify argon2 hashes.');
      }
    }

    return false;
  }

  /**
   * Check if a hash needs to be rehashed (e.g. cost parameter changed)
   */
  needsRehash(hash: string): boolean {
    if (this.config.driver === 'scrypt' && hash.startsWith('$scrypt$')) {
      const costMatch = hash.match(/N=(\d+)/);
      if (costMatch) {
        return parseInt(costMatch[1], 10) !== this.config.scryptCost;
      }
    }

    if (this.config.driver === 'bcrypt' && (hash.startsWith('$2b$') || hash.startsWith('$2a$'))) {
      const roundsMatch = hash.match(/\$2[aby]\$(\d+)\$/);
      if (roundsMatch) {
        return parseInt(roundsMatch[1], 10) !== this.config.bcryptRounds;
      }
    }

    // Different driver = needs rehash
    if (this.config.driver === 'scrypt' && !hash.startsWith('$scrypt$')) return true;
    if (this.config.driver === 'bcrypt' && !hash.startsWith('$2')) return true;
    if (this.config.driver === 'argon2' && !hash.startsWith('$argon2')) return true;

    return false;
  }

  /**
   * Generate a random string (useful for tokens, API keys)
   */
  randomString(length: number = 32): string {
    return randomBytes(Math.ceil(length / 2))
      .toString('hex')
      .slice(0, length);
  }

  /**
   * Generate a random token (URL-safe base64)
   */
  randomToken(bytes: number = 32): string {
    return randomBytes(bytes).toString('base64url');
  }
}

/**
 * Global Hash singleton.
 */
import { singleton } from '../support/singleton.js';

export const Hash = singleton('svelar.hash', () => new HashManager());
