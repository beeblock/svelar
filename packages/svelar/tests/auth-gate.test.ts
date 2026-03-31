import { describe, it, expect, beforeEach } from 'vitest';
import {
  GateResponse,
  AuthorizationError,
  Policy,
} from '../src/auth/Gate.js';

// Gate is a singleton, so we test the classes/utilities directly
// and create a fresh GateManager for isolated tests

describe('GateResponse', () => {
  describe('allow()', () => {
    it('should create an allowed response', () => {
      const r = GateResponse.allow('Access granted');
      expect(r.allowed).toBe(true);
      expect(r.message).toBe('Access granted');
    });

    it('should create allowed without message', () => {
      const r = GateResponse.allow();
      expect(r.allowed).toBe(true);
    });
  });

  describe('deny()', () => {
    it('should create a denied response with defaults', () => {
      const r = GateResponse.deny();
      expect(r.allowed).toBe(false);
      expect(r.message).toBe('This action is unauthorized.');
      expect(r.code).toBe(403);
    });

    it('should create denied with custom message and code', () => {
      const r = GateResponse.deny('Custom', 422);
      expect(r.allowed).toBe(false);
      expect(r.message).toBe('Custom');
      expect(r.code).toBe(422);
    });
  });

  describe('toResponse()', () => {
    it('should return 200 for allowed', () => {
      const res = GateResponse.allow().toResponse();
      expect(res.status).toBe(200);
    });

    it('should return error status for denied', async () => {
      const res = GateResponse.deny('Nope', 403).toResponse();
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.message).toBe('Nope');
    });
  });
});

describe('AuthorizationError', () => {
  it('should have correct defaults', () => {
    const err = new AuthorizationError();
    expect(err.message).toBe('This action is unauthorized.');
    expect(err.statusCode).toBe(403);
    expect(err.name).toBe('AuthorizationError');
  });

  it('should accept custom message and code', () => {
    const err = new AuthorizationError('No access', 401);
    expect(err.message).toBe('No access');
    expect(err.statusCode).toBe(401);
  });

  it('should convert to Response', async () => {
    const err = new AuthorizationError('Forbidden', 403);
    const res = err.toResponse();
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.message).toBe('Forbidden');
  });
});

describe('Policy', () => {
  class PostPolicy extends Policy {
    viewAny(_user: any) { return true; }
    view(_user: any, _post: any) { return true; }
    create(user: any) { return !!user; }
    update(user: any, post: any) { return user.id === post.user_id; }
    delete(user: any, post: any) {
      if (user.role === 'admin') return GateResponse.allow('Admin override');
      return user.id === post.user_id;
    }
  }

  it('should define CRUD methods', () => {
    const policy = new PostPolicy();
    expect(policy.viewAny).toBeDefined();
    expect(policy.view).toBeDefined();
    expect(policy.create).toBeDefined();
    expect(policy.update).toBeDefined();
    expect(policy.delete).toBeDefined();
  });

  it('should check ownership for update', () => {
    const policy = new PostPolicy();
    expect(policy.update!({ id: 1 }, { user_id: 1 })).toBe(true);
    expect(policy.update!({ id: 1 }, { user_id: 2 })).toBe(false);
  });

  it('should return GateResponse for admin delete', () => {
    const policy = new PostPolicy();
    const result = policy.delete!({ id: 1, role: 'admin' }, { user_id: 2 });
    expect(result).toBeInstanceOf(GateResponse);
    expect((result as GateResponse).allowed).toBe(true);
  });

  it('should check create requires user', () => {
    const policy = new PostPolicy();
    expect(policy.create!(null)).toBe(false);
    expect(policy.create!({ id: 1 })).toBe(true);
  });
});
