import { describe, it, expect } from 'vitest';
import {
  FormRequest,
  FormValidationError,
  FormAuthorizationError,
} from '../src/routing/FormRequest.js';
import { z } from 'zod';
import * as v from 'valibot';

describe('FormValidationError', () => {
  it('should store errors and have correct status', () => {
    const err = new FormValidationError({ email: ['Required', 'Must be valid'] });
    expect(err.statusCode).toBe(422);
    expect(err.name).toBe('FormValidationError');
    expect(err.message).toBe('The given data was invalid.');
    expect(err.errors.email).toEqual(['Required', 'Must be valid']);
  });

  it('should convert to Response', async () => {
    const err = new FormValidationError({ name: ['Too short'] });
    const res = err.toResponse();
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.errors.name).toEqual(['Too short']);
  });
});

describe('FormAuthorizationError', () => {
  it('should have correct defaults', () => {
    const err = new FormAuthorizationError();
    expect(err.statusCode).toBe(403);
    expect(err.name).toBe('FormAuthorizationError');
    expect(err.message).toBe('This action is unauthorized.');
  });

  it('should accept custom message', () => {
    const err = new FormAuthorizationError('Not allowed');
    expect(err.message).toBe('Not allowed');
  });

  it('should convert to Response', async () => {
    const err = new FormAuthorizationError('Forbidden');
    const res = err.toResponse();
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.message).toBe('Forbidden');
  });
});

describe('FormRequest', () => {
  class CreateUserRequest extends FormRequest {
    rules() {
      return z.object({
        name: z.string().min(2),
        email: z.string().email(),
      });
    }

    messages() {
      return {
        'name.too_small': 'Name is too short',
      };
    }
  }

  class UnauthorizedRequest extends FormRequest {
    rules() {
      return z.object({ name: z.string() });
    }

    authorize() {
      return false;
    }
  }

  class TransformingRequest extends FormRequest {
    rules() {
      return z.object({ name: z.string() });
    }

    passedValidation(data: any) {
      return { ...data, name: data.name.toUpperCase() };
    }
  }

  class ValibotCreateUserRequest extends FormRequest {
    rules() {
      return v.object({
        name: v.pipe(v.string(), v.minLength(2, 'Name is too short')),
        email: v.pipe(v.string(), v.email('Email is invalid')),
      });
    }
  }

  function createEvent(body: any, contentType = 'application/json') {
    return {
      request: new Request('http://localhost/test', {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body: JSON.stringify(body),
      }),
      url: new URL('http://localhost/test'),
      params: {},
      locals: {},
      getClientAddress: () => '127.0.0.1',
      cookies: {},
      platform: {},
    } as any;
  }

  it('should validate valid data', async () => {
    const event = createEvent({ name: 'Alice', email: 'alice@example.com' });
    const data = await CreateUserRequest.validate(event);
    expect(data.name).toBe('Alice');
    expect(data.email).toBe('alice@example.com');
  });

  it('should throw FormValidationError for invalid data', async () => {
    const event = createEvent({ name: 'A', email: 'not-email' });
    try {
      await CreateUserRequest.validate(event);
      expect.unreachable('Should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(FormValidationError);
      expect(err.errors).toBeDefined();
    }
  });

  it('should throw FormAuthorizationError when unauthorized', async () => {
    const event = createEvent({ name: 'Test' });
    try {
      await UnauthorizedRequest.validate(event);
      expect.unreachable('Should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(FormAuthorizationError);
    }
  });

  it('should transform data after validation', async () => {
    const event = createEvent({ name: 'alice' });
    const data = await TransformingRequest.validate(event);
    expect(data.name).toBe('ALICE');
  });

  it('should validate Valibot schemas', async () => {
    const event = createEvent({ name: 'Alice', email: 'alice@example.com' });
    const data = await ValibotCreateUserRequest.validate(event);

    expect(data).toEqual({ name: 'Alice', email: 'alice@example.com' });
  });

  it('should normalize Valibot field validation errors', async () => {
    const event = createEvent({ name: 'A', email: 'not-email' });

    await expect(ValibotCreateUserRequest.validate(event)).rejects.toMatchObject({
      errors: {
        name: ['Name is too short'],
        email: ['Email is invalid'],
      },
    });
  });

  it('should merge query params, route params, and body', async () => {
    class MergeRequest extends FormRequest {
      rules() {
        return z.object({
          name: z.string(),
          id: z.string().optional(),
          page: z.string().optional(),
        });
      }
    }

    const event = {
      request: new Request('http://localhost/test?page=2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Alice' }),
      }),
      url: new URL('http://localhost/test?page=2'),
      params: { id: '42' },
      locals: {},
      getClientAddress: () => '127.0.0.1',
      cookies: {},
      platform: {},
    } as any;

    const data = await MergeRequest.validate(event);
    expect(data.name).toBe('Alice');
    expect(data.id).toBe('42');
    expect(data.page).toBe('2');
  });
});
