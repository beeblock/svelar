import { describe, it, expect, beforeEach } from 'vitest';
import {
  GateResponse,
  AuthorizationError,
  GateManager,
  Policy,
} from '../src/auth/Gate.js';

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
  class Post {}
  class Comment {}

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

describe('Gate policies', () => {
  class Post {
    constructor(public user_id: number) {}
  }

  class Comment {
    constructor(public user_id: number) {}
  }

  class PostPolicy extends Policy {
    before(user: any) {
      if (user.role === 'admin') return true;
      return null;
    }

    viewAny() {
      return true;
    }

    create(user: any) {
      return user.role === 'editor';
    }

    update(user: any, post: Post) {
      return user.id === post.user_id;
    }

    delete(user: any, post: Post) {
      if (user.id === post.user_id) return GateResponse.allow('Owner allowed');
      return GateResponse.deny('Owner only', 403);
    }
  }

  class CommentPolicy extends Policy {
    update() {
      return false;
    }
  }

  it('checks policy abilities through model instances and class targets', async () => {
    const gate = new GateManager();
    gate.policy('Post', new PostPolicy());

    await expect(gate.allows('viewAny', { id: 7, role: 'user' }, Post)).resolves.toBe(true);
    await expect(gate.allows('create', { id: 7, role: 'editor' }, Post)).resolves.toBe(true);
    await expect(gate.denies('create', { id: 7, role: 'user' }, Post)).resolves.toBe(true);
    await expect(gate.allows('update', { id: 7, role: 'user' }, new Post(7))).resolves.toBe(true);
    await expect(gate.denies('update', { id: 8, role: 'user' }, new Post(7))).resolves.toBe(true);
  });

  it('uses the explicit target policy instead of the first policy with a matching method', async () => {
    const gate = new GateManager();
    gate.policy('Post', new PostPolicy());
    gate.policy('Comment', new CommentPolicy());

    await expect(gate.denies('update', { id: 7, role: 'user' }, new Comment(7))).resolves.toBe(true);
    await expect(gate.denies('update', { id: 7, role: 'user' })).resolves.toBe(true);
  });

  it('supports policy before hooks, GateResponse inspection, and throwing authorization errors', async () => {
    const gate = new GateManager();
    gate.policy('Post', new PostPolicy());

    await expect(gate.allows('update', { id: 1, role: 'admin' }, new Post(2))).resolves.toBe(true);

    const denied = await gate.inspect('delete', { id: 1, role: 'user' }, new Post(2));
    expect(denied.allowed).toBe(false);
    expect(denied.message).toBe('Owner only');

    await expect(gate.authorize('delete', { id: 1, role: 'user' }, new Post(2))).rejects.toMatchObject({
      message: 'Owner only',
      statusCode: 403,
    });
  });

  it('runs after callbacks for inspect, authorize, and user-scoped gates', async () => {
    const gate = new GateManager();
    gate.policy('Post', new PostPolicy());
    gate.after((_user, ability, result) => {
      if (ability === 'delete' && !result) return true;
      return undefined;
    });

    const scoped = gate.forUser({ id: 1, role: 'user' });
    await expect(scoped.allows('delete', new Post(2))).resolves.toBe(true);
    await expect(scoped.authorize('delete', new Post(2))).resolves.toBeUndefined();

    const inspected = await scoped.inspect('delete', new Post(2));
    expect(inspected.allowed).toBe(true);
  });
});
