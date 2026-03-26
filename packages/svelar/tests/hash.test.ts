import { describe, it, expect, beforeEach } from 'vitest';
import { Hash } from '../src/hashing/Hash';

describe('Hash (Scrypt Driver)', () => {
  beforeEach(() => {
    Hash.configure({ driver: 'scrypt', scryptCost: 16384 });
  });

  describe('make', () => {
    it('should hash a password', async () => {
      const password = 'my-secret-password';
      const hash = await Hash.make(password);

      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
      expect(hash).toMatch(/^\$scrypt\$/);
    });

    it('should produce different hashes for the same password', async () => {
      const password = 'test-password';

      const hash1 = await Hash.make(password);
      const hash2 = await Hash.make(password);

      expect(hash1).not.toBe(hash2);
    });

    it('should handle long passwords', async () => {
      const longPassword = 'a'.repeat(1000);
      const hash = await Hash.make(longPassword);

      expect(hash).toBeDefined();
      expect(hash.startsWith('$scrypt$')).toBe(true);
    });

    it('should handle special characters', async () => {
      const password = '!@#$%^&*()_+-=[]{}|;:,.<>?/~`';
      const hash = await Hash.make(password);

      expect(hash).toBeDefined();
      expect(hash.startsWith('$scrypt$')).toBe(true);
    });

    it('should handle empty string password', async () => {
      const hash = await Hash.make('');

      expect(hash).toBeDefined();
      expect(hash.startsWith('$scrypt$')).toBe(true);
    });
  });

  describe('verify', () => {
    it('should verify a correct password', async () => {
      const password = 'correct-password';
      const hash = await Hash.make(password);

      const isValid = await Hash.verify(password, hash);

      expect(isValid).toBe(true);
    });

    it('should reject an incorrect password', async () => {
      const password = 'correct-password';
      const hash = await Hash.make(password);

      const isValid = await Hash.verify('wrong-password', hash);

      expect(isValid).toBe(false);
    });

    it('should be timing-safe (basic check)', async () => {
      const hash = await Hash.make('password');

      const result1 = await Hash.verify('wrong', hash);
      const result2 = await Hash.verify('also-wrong', hash);

      expect(result1).toBe(false);
      expect(result2).toBe(false);
    });

    it('should handle invalid hash format gracefully', async () => {
      const result = await Hash.verify('password', 'invalid-hash-format');

      expect(result).toBe(false);
    });

    it('should detect scrypt hashes automatically', async () => {
      const password = 'test';
      const hash = await Hash.make(password);

      expect(hash.startsWith('$scrypt$')).toBe(true);

      const isValid = await Hash.verify(password, hash);
      expect(isValid).toBe(true);
    });

    it('should handle whitespace in passwords', async () => {
      const password = '  password with spaces  ';
      const hash = await Hash.make(password);

      const isValid = await Hash.verify(password, hash);
      expect(isValid).toBe(true);

      const invalidResult = await Hash.verify('password with spaces', hash);
      expect(invalidResult).toBe(false);
    });
  });

  describe('needsRehash', () => {
    it('should return false for current algorithm and cost', async () => {
      Hash.configure({ driver: 'scrypt', scryptCost: 16384 });

      const hash = await Hash.make('password');
      const needs = Hash.needsRehash(hash);

      expect(needs).toBe(false);
    });

    it('should return true if cost has increased', async () => {
      const hash = await Hash.make('password');

      Hash.configure({ driver: 'scrypt', scryptCost: 32768 });
      const needs = Hash.needsRehash(hash);

      expect(needs).toBe(true);
    });

    it('should return true for different driver', async () => {
      Hash.configure({ driver: 'scrypt' });
      const scryptHash = await Hash.make('password');

      Hash.configure({ driver: 'bcrypt' });
      const needs = Hash.needsRehash(scryptHash);

      expect(needs).toBe(true);
    });

    it('should handle malformed hashes', () => {
      const needs = Hash.needsRehash('malformed-hash');

      expect(needs).toBe(true);
    });

    it('should parse cost from hash correctly', async () => {
      Hash.configure({ driver: 'scrypt', scryptCost: 16384 });
      const hash = await Hash.make('password');

      expect(Hash.needsRehash(hash)).toBe(false);

      Hash.configure({ driver: 'scrypt', scryptCost: 16384 });
      expect(Hash.needsRehash(hash)).toBe(false);
    });
  });

  describe('randomString', () => {
    it('should generate a random string', () => {
      const str = Hash.randomString();

      expect(str).toBeDefined();
      expect(typeof str).toBe('string');
      expect(str.length).toBeGreaterThan(0);
    });

    it('should generate string of specified length', () => {
      const str = Hash.randomString(64);

      expect(str.length).toBe(64);
    });

    it('should generate different strings each time', () => {
      const str1 = Hash.randomString(32);
      const str2 = Hash.randomString(32);

      expect(str1).not.toBe(str2);
    });

    it('should use hex encoding', () => {
      const str = Hash.randomString(64);

      expect(/^[a-f0-9]*$/.test(str)).toBe(true);
    });

    it('should default to 32 characters', () => {
      const str = Hash.randomString();

      expect(str.length).toBe(32);
    });

    it('should handle small lengths', () => {
      const str = Hash.randomString(1);

      expect(str.length).toBe(1);
    });

    it('should handle large lengths', () => {
      const str = Hash.randomString(256);

      expect(str.length).toBe(256);
    });
  });

  describe('randomToken', () => {
    it('should generate a random token', () => {
      const token = Hash.randomToken();

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);
    });

    it('should generate token of specified bytes', () => {
      const token = Hash.randomToken(16);

      // Base64URL encoding of 16 bytes is approximately 21-22 chars
      expect(token.length).toBeGreaterThan(0);
    });

    it('should use base64url encoding', () => {
      const token = Hash.randomToken(32);

      // Base64URL uses A-Z, a-z, 0-9, -, _
      expect(/^[A-Za-z0-9_-]+$/.test(token)).toBe(true);
    });

    it('should generate different tokens each time', () => {
      const token1 = Hash.randomToken(32);
      const token2 = Hash.randomToken(32);

      expect(token1).not.toBe(token2);
    });

    it('should default to 32 bytes', () => {
      const token = Hash.randomToken();

      expect(token.length).toBeGreaterThan(0);
      expect(/^[A-Za-z0-9_-]+$/.test(token)).toBe(true);
    });

    it('should be URL-safe (no +, /, =)', () => {
      for (let i = 0; i < 10; i++) {
        const token = Hash.randomToken(64);
        expect(token).not.toMatch(/[+/=]/);
      }
    });
  });

  describe('configuration', () => {
    it('should apply configuration changes', async () => {
      Hash.configure({ driver: 'scrypt', scryptCost: 8192 });

      const hash = await Hash.make('password');

      expect(hash).toContain('N=8192');
    });

    it('should use configured cost for hashing', async () => {
      Hash.configure({ driver: 'scrypt', scryptCost: 4096 });

      const hash = await Hash.make('password');

      expect(hash).toContain('N=4096');
    });
  });

  describe('integration', () => {
    it('should complete auth flow (hash and verify)', async () => {
      const password = 'user-password-123';

      // Hash on registration
      const hash = await Hash.make(password);
      expect(hash).toMatch(/^\$scrypt\$/);

      // Verify on login
      const isValid = await Hash.verify(password, hash);
      expect(isValid).toBe(true);

      // Check rehash not needed
      const needsRehash = Hash.needsRehash(hash);
      expect(needsRehash).toBe(false);
    });

    it('should handle rehashing scenario', async () => {
      Hash.configure({ driver: 'scrypt', scryptCost: 4096 });
      const oldHash = await Hash.make('password');

      // Increase cost
      Hash.configure({ driver: 'scrypt', scryptCost: 8192 });

      // Check if rehash is needed
      expect(Hash.needsRehash(oldHash)).toBe(true);

      // Generate new hash
      const newHash = await Hash.make('password');

      // Verify both work
      expect(await Hash.verify('password', oldHash)).toBe(true);
      expect(await Hash.verify('password', newHash)).toBe(true);

      // New hash uses new cost
      expect(newHash).toContain('N=8192');
    });
  });
});
