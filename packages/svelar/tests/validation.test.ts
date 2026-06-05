import { describe, it, expect } from 'vitest';
import { rules, validate, z } from '../src/validation/index';
import { ulid, uuidv7 } from '../src/support/uuid';

describe('Validation', () => {
  describe('rules.required', () => {
    it('should validate required string', () => {
      const schema = z.object({ name: rules.required() });

      const validResult = schema.safeParse({ name: 'John' });
      expect(validResult.success).toBe(true);

      const invalidResult = schema.safeParse({ name: '' });
      expect(invalidResult.success).toBe(false);
    });
  });

  describe('rules.email', () => {
    it('should validate email format', () => {
      const schema = z.object({ email: rules.email() });

      expect(schema.safeParse({ email: 'user@example.com' }).success).toBe(true);
      expect(schema.safeParse({ email: 'invalid-email' }).success).toBe(false);
    });
  });

  describe('rules.string', () => {
    it('should validate string without constraints', () => {
      const schema = z.object({ text: rules.string() });

      expect(schema.safeParse({ text: 'hello' }).success).toBe(true);
      expect(schema.safeParse({ text: '' }).success).toBe(true);
    });

    it('should validate string with min length', () => {
      const schema = z.object({ password: rules.string(8) });

      expect(schema.safeParse({ password: 'password123' }).success).toBe(true);
      expect(schema.safeParse({ password: 'short' }).success).toBe(false);
    });

    it('should validate string with min and max length', () => {
      const schema = z.object({ code: rules.string(3, 5) });

      expect(schema.safeParse({ code: 'ABC' }).success).toBe(true);
      expect(schema.safeParse({ code: 'ABCD' }).success).toBe(true);
      expect(schema.safeParse({ code: 'AB' }).success).toBe(false);
      expect(schema.safeParse({ code: 'ABCDEF' }).success).toBe(false);
    });
  });

  describe('rules.number', () => {
    it('should validate numbers', () => {
      const schema = z.object({ count: rules.number() });

      expect(schema.safeParse({ count: 42 }).success).toBe(true);
      expect(schema.safeParse({ count: 0 }).success).toBe(true);
      expect(schema.safeParse({ count: -5 }).success).toBe(true);
    });

    it('should validate number with min', () => {
      const schema = z.object({ age: rules.number(0) });

      expect(schema.safeParse({ age: 18 }).success).toBe(true);
      expect(schema.safeParse({ age: -1 }).success).toBe(false);
    });

    it('should validate number with min and max', () => {
      const schema = z.object({ rating: rules.number(0, 5) });

      expect(schema.safeParse({ rating: 3 }).success).toBe(true);
      expect(schema.safeParse({ rating: 5 }).success).toBe(true);
      expect(schema.safeParse({ rating: 6 }).success).toBe(false);
    });
  });

  describe('rules.integer', () => {
    it('should validate integers only', () => {
      const schema = z.object({ count: rules.integer() });

      expect(schema.safeParse({ count: 42 }).success).toBe(true);
      expect(schema.safeParse({ count: 3.14 }).success).toBe(false);
    });
  });

  describe('rules.boolean', () => {
    it('should validate boolean values', () => {
      const schema = z.object({ active: rules.boolean() });

      expect(schema.safeParse({ active: true }).success).toBe(true);
      expect(schema.safeParse({ active: false }).success).toBe(true);
      expect(schema.safeParse({ active: 'true' }).success).toBe(false);
    });
  });

  describe('rules.date', () => {
    it('should validate and coerce dates', () => {
      const schema = z.object({ date: rules.date() });

      expect(schema.safeParse({ date: new Date() }).success).toBe(true);
      expect(schema.safeParse({ date: '2024-01-01' }).success).toBe(true);
      expect(schema.safeParse({ date: 'invalid' }).success).toBe(false);
    });
  });

  describe('rules.url', () => {
    it('should validate URL format', () => {
      const schema = z.object({ website: rules.url() });

      expect(schema.safeParse({ website: 'https://example.com' }).success).toBe(true);
      expect(schema.safeParse({ website: 'not-a-url' }).success).toBe(false);
    });
  });

  describe('rules.uuid', () => {
    it('should validate UUID format', () => {
      const schema = z.object({ id: rules.uuid() });

      const validUUID = '550e8400-e29b-41d4-a716-446655440000';
      expect(schema.safeParse({ id: validUUID }).success).toBe(true);
      expect(schema.safeParse({ id: 'not-a-uuid' }).success).toBe(false);
    });
  });

  describe('rules.uuidv7', () => {
    it('should validate UUID v7 format', () => {
      const schema = z.object({ id: rules.uuidv7() });

      expect(schema.safeParse({ id: uuidv7() }).success).toBe(true);
      expect(schema.safeParse({ id: '550e8400-e29b-41d4-a716-446655440000' }).success).toBe(false);
      expect(schema.safeParse({ id: 'not-a-uuid' }).success).toBe(false);
    });
  });

  describe('rules.ulid', () => {
    it('should validate ULID format', () => {
      const schema = z.object({ id: rules.ulid() });

      expect(schema.safeParse({ id: ulid() }).success).toBe(true);
      expect(schema.safeParse({ id: '550e8400-e29b-41d4-a716-446655440000' }).success).toBe(false);
      expect(schema.safeParse({ id: 'not-a-ulid' }).success).toBe(false);
    });
  });

  describe('rules.enum', () => {
    it('should validate enum values', () => {
      const schema = z.object({ role: rules.enum(['admin', 'user', 'guest']) });

      expect(schema.safeParse({ role: 'admin' }).success).toBe(true);
      expect(schema.safeParse({ role: 'user' }).success).toBe(true);
      expect(schema.safeParse({ role: 'invalid' }).success).toBe(false);
    });
  });

  describe('rules.array', () => {
    it('should validate array of values', () => {
      const schema = z.object({ tags: rules.array(rules.string()) });

      expect(schema.safeParse({ tags: ['tag1', 'tag2'] }).success).toBe(true);
      expect(schema.safeParse({ tags: ['tag1'] }).success).toBe(true);
      expect(schema.safeParse({ tags: [1, 2] }).success).toBe(false);
    });

    it('should validate array of numbers', () => {
      const schema = z.object({ ids: rules.array(rules.number()) });

      expect(schema.safeParse({ ids: [1, 2, 3] }).success).toBe(true);
      expect(schema.safeParse({ ids: [1, 'two', 3] }).success).toBe(false);
    });
  });

  describe('rules.nullable', () => {
    it('should allow null values', () => {
      const schema = z.object({ middle_name: rules.nullable(rules.string()) });

      expect(schema.safeParse({ middle_name: 'John' }).success).toBe(true);
      expect(schema.safeParse({ middle_name: null }).success).toBe(true);
    });
  });

  describe('rules.optional', () => {
    it('should allow undefined values', () => {
      const schema = z.object({ nickname: rules.optional(rules.string()) });

      expect(schema.safeParse({ nickname: 'Johnny' }).success).toBe(true);
      expect(schema.safeParse({}).success).toBe(true);
    });
  });

  describe('rules.confirmed', () => {
    it('should validate password confirmation', () => {
      const schema = rules.confirmed('password');

      expect(
        schema.safeParse({
          password: 'secret123',
          password_confirmation: 'secret123',
        }).success
      ).toBe(true);

      expect(
        schema.safeParse({
          password: 'secret123',
          password_confirmation: 'different',
        }).success
      ).toBe(false);
    });

    it('should work with custom field name', () => {
      const schema = rules.confirmed('passphrase');

      expect(
        schema.safeParse({
          passphrase: 'phrase123',
          passphrase_confirmation: 'phrase123',
        }).success
      ).toBe(true);
    });
  });

  describe('rules.min', () => {
    it('should validate minimum number value', () => {
      const schema = z.object({ age: rules.min(18) });

      expect(schema.safeParse({ age: 18 }).success).toBe(true);
      expect(schema.safeParse({ age: 25 }).success).toBe(true);
      expect(schema.safeParse({ age: 17 }).success).toBe(false);
    });
  });

  describe('rules.max', () => {
    it('should validate maximum number value', () => {
      const schema = z.object({ age: rules.max(65) });

      expect(schema.safeParse({ age: 65 }).success).toBe(true);
      expect(schema.safeParse({ age: 50 }).success).toBe(true);
      expect(schema.safeParse({ age: 66 }).success).toBe(false);
    });
  });

  describe('rules.between', () => {
    it('should validate value in range', () => {
      const schema = z.object({ rating: rules.between(1, 5) });

      expect(schema.safeParse({ rating: 3 }).success).toBe(true);
      expect(schema.safeParse({ rating: 1 }).success).toBe(true);
      expect(schema.safeParse({ rating: 5 }).success).toBe(true);
      expect(schema.safeParse({ rating: 0 }).success).toBe(false);
      expect(schema.safeParse({ rating: 6 }).success).toBe(false);
    });
  });

  describe('rules.regex', () => {
    it('should validate regex pattern', () => {
      const schema = z.object({ username: rules.regex(/^[a-z0-9_]+$/) });

      expect(schema.safeParse({ username: 'john_doe123' }).success).toBe(true);
      expect(schema.safeParse({ username: 'john-doe' }).success).toBe(false);
      expect(schema.safeParse({ username: 'John123' }).success).toBe(false);
    });

    it('should support custom error message', () => {
      const schema = z.object({
        code: rules.regex(/^[A-Z]{3}$/, 'Code must be 3 uppercase letters'),
      });

      const result = schema.safeParse({ code: 'abc' });
      expect(result.success).toBe(false);
    });
  });

  describe('rules.ip', () => {
    it('should validate IP addresses', () => {
      const schema = z.object({ ip: rules.ip() });

      expect(schema.safeParse({ ip: '192.168.1.1' }).success).toBe(true);
      expect(schema.safeParse({ ip: '10.0.0.1' }).success).toBe(true);
      expect(schema.safeParse({ ip: '255.255.255.255' }).success).toBe(true);

      expect(schema.safeParse({ ip: '256.1.1.1' }).success).toBe(false);
      expect(schema.safeParse({ ip: '192.168.1' }).success).toBe(false);
      expect(schema.safeParse({ ip: 'not-an-ip' }).success).toBe(false);
    });
  });

  describe('rules.json', () => {
    it('should validate JSON strings', () => {
      const schema = z.object({ data: rules.json() });

      expect(schema.safeParse({ data: '{"key": "value"}' }).success).toBe(true);
      expect(schema.safeParse({ data: '[]' }).success).toBe(true);
      expect(schema.safeParse({ data: '{"invalid": json}' }).success).toBe(false);
      expect(schema.safeParse({ data: 'not json' }).success).toBe(false);
    });
  });

  describe('validate helper function', () => {
    it('should return success with valid data', () => {
      const schema = z.object({
        name: rules.required(),
        email: rules.email(),
      });

      const result = validate(schema, {
        name: 'John',
        email: 'john@example.com',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          name: 'John',
          email: 'john@example.com',
        });
      }
    });

    it('should return errors with invalid data', () => {
      const schema = z.object({
        name: rules.required(),
        email: rules.email(),
      });

      const result = validate(schema, {
        name: '',
        email: 'invalid-email',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors).toHaveProperty('name');
        expect(result.errors).toHaveProperty('email');
        expect(Array.isArray(result.errors.name)).toBe(true);
        expect(Array.isArray(result.errors.email)).toBe(true);
      }
    });

    it('should format error paths correctly', () => {
      const schema = z.object({
        user: z.object({
          email: rules.email(),
        }),
      });

      const result = validate(schema, {
        user: {
          email: 'bad-email',
        },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors).toHaveProperty('user.email');
      }
    });

    it('should handle multiple errors for single field', () => {
      const schema = z.object({
        password: rules.string(8, 20),
      });

      const result = validate(schema, {
        password: 'short',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(Array.isArray(result.errors.password)).toBe(true);
        expect(result.errors.password.length).toBeGreaterThan(0);
      }
    });
  });

  describe('integration - complex validation', () => {
    it('should validate a user registration form', () => {
      const schema = z.object({
        name: rules.required(),
        email: rules.email(),
        password: rules.string(8),
        password_confirmation: rules.string(8),
        age: rules.between(18, 120),
        role: rules.enum(['user', 'admin']),
      });

      const validData = {
        name: 'John Doe',
        email: 'john@example.com',
        password: 'secure123',
        password_confirmation: 'secure123',
        age: 25,
        role: 'user',
      };

      const result = validate(schema, validData);
      expect(result.success).toBe(true);
    });

    it('should validate an API request payload', () => {
      const schema = z.object({
        title: rules.required(),
        description: rules.string(10, 1000),
        tags: rules.array(rules.string()),
        published: rules.boolean(),
        metadata: rules.json(),
      });

      const result = validate(schema, {
        title: 'My Post',
        description: 'A detailed description of my post',
        tags: ['tech', 'programming'],
        published: true,
        metadata: '{"views": 100}',
      });

      expect(result.success).toBe(true);
    });

    it('should handle form submission with errors', () => {
      const schema = z.object({
        username: rules.regex(/^[a-z0-9_]{3,20}$/),
        email: rules.email(),
        website: rules.nullable(rules.url()),
      });

      const result = validate(schema, {
        username: 'ab', // Too short
        email: 'not-email', // Invalid
        website: null, // Valid - nullable
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(Object.keys(result.errors).length).toBe(2);
      }
    });
  });
});
