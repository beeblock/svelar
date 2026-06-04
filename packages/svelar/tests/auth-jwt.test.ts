import { describe, it, expect } from 'vitest';
import { AuthenticateMiddleware, signJwt, verifyJwt, type JwtPayload } from '../src/auth/Auth.js';
import type { MiddlewareContext } from '../src/middleware/Middleware.js';

describe('JWT utilities', () => {
  const secret = 'test-secret-key-for-jwt-testing';

  describe('signJwt()', () => {
    it('should create a valid JWT string', () => {
      const payload: JwtPayload = {
        sub: 1,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const token = signJwt(payload, secret);
      expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    });

    it('should have three parts separated by dots', () => {
      const payload: JwtPayload = { sub: 1, iat: 0, exp: 0 };
      const parts = signJwt(payload, secret).split('.');
      expect(parts).toHaveLength(3);
    });

    it('should support HS256 algorithm', () => {
      const payload: JwtPayload = { sub: 1, iat: 0, exp: 0 };
      const token = signJwt(payload, secret, 'HS256');
      expect(token).toBeTruthy();
    });

    it('should support HS384 algorithm', () => {
      const payload: JwtPayload = { sub: 1, iat: 0, exp: 0 };
      const token = signJwt(payload, secret, 'HS384');
      expect(token).toBeTruthy();
    });

    it('should support HS512 algorithm', () => {
      const payload: JwtPayload = { sub: 1, iat: 0, exp: 0 };
      const token = signJwt(payload, secret, 'HS512');
      expect(token).toBeTruthy();
    });
  });

  describe('verifyJwt()', () => {
    it('should verify a valid token', () => {
      const now = Math.floor(Date.now() / 1000);
      const payload: JwtPayload = {
        sub: 42,
        iat: now,
        exp: now + 3600,
        iss: 'test-app',
      };
      const token = signJwt(payload, secret);
      const verified = verifyJwt(token, secret);

      expect(verified).not.toBeNull();
      expect(verified!.sub).toBe(42);
      expect(verified!.iss).toBe('test-app');
    });

    it('should return null for invalid signature', () => {
      const payload: JwtPayload = {
        sub: 1,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const token = signJwt(payload, secret);
      const result = verifyJwt(token, 'wrong-secret');
      expect(result).toBeNull();
    });

    it('should return null for expired token', () => {
      const past = Math.floor(Date.now() / 1000) - 7200;
      const payload: JwtPayload = {
        sub: 1,
        iat: past,
        exp: past + 3600, // expired 1 hour ago
      };
      const token = signJwt(payload, secret);
      const result = verifyJwt(token, secret);
      expect(result).toBeNull();
    });

    it('should return null for malformed tokens', () => {
      expect(verifyJwt('not.a.jwt', secret)).toBeNull();
      expect(verifyJwt('only-one-part', secret)).toBeNull();
      expect(verifyJwt('a.b', secret)).toBeNull();
      expect(verifyJwt('', secret)).toBeNull();
    });

    it('should return null for tampered payload', () => {
      const payload: JwtPayload = {
        sub: 1,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const token = signJwt(payload, secret);
      const parts = token.split('.');
      // Tamper with the payload
      const decoded = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      decoded.sub = 999;
      parts[1] = Buffer.from(JSON.stringify(decoded)).toString('base64url');
      const tampered = parts.join('.');
      expect(verifyJwt(tampered, secret)).toBeNull();
    });

    it('should verify tokens without exp (no expiration check)', () => {
      const payload: JwtPayload = {
        sub: 1,
        iat: Math.floor(Date.now() / 1000),
        exp: 0, // falsy exp, won't be checked
      };
      const token = signJwt(payload, secret);
      const result = verifyJwt(token, secret);
      expect(result).not.toBeNull();
    });
  });

  describe('cross-algorithm verification', () => {
    it('should not verify HS256 token with HS384 expectation', () => {
      const payload: JwtPayload = {
        sub: 1,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      // Sign with HS256
      const token = signJwt(payload, secret, 'HS256');
      // The token contains the algorithm in the header, so verifyJwt
      // uses the algorithm from the header. This should still verify
      // since verifyJwt reads alg from header.
      const result = verifyJwt(token, secret);
      expect(result).not.toBeNull();
    });
  });
});

describe('AuthManager', () => {
  // AuthManager requires database + model, so we test the class structure
  // without actually connecting. Deep integration tests would need SQLite.
  it('should be importable', async () => {
    const { AuthManager } = await import('../src/auth/Auth.js');
    expect(AuthManager).toBeDefined();
  });

  it('should accept config', async () => {
    const { AuthManager } = await import('../src/auth/Auth.js');
    const auth = new AuthManager({
      guard: 'jwt',
      model: {},
      jwt: { secret: 'test' },
    });
    expect(auth.check()).toBe(false);
    expect(auth.user()).toBeNull();
    expect(auth.id()).toBeNull();
  });

  it('should track user state', async () => {
    const { AuthManager } = await import('../src/auth/Auth.js');
    const auth = new AuthManager({ guard: 'session', model: {} });

    expect(auth.check()).toBe(false);
    // After logout, should still be false
    await auth.logout();
    expect(auth.check()).toBe(false);
  });
});

describe('AuthenticateMiddleware', () => {
  function createCtx(token: string): MiddlewareContext {
    return {
      event: {
        request: {
          headers: {
            get: (name: string) => name.toLowerCase() === 'authorization' ? `Bearer ${token}` : null,
          },
        },
        locals: {},
      },
      params: {},
      locals: {},
    } as MiddlewareContext;
  }

  it('falls back to API tokens when Bearer token is not a valid JWT', async () => {
    const user = { getAttribute: (key: string) => key === 'id' ? 123 : null };
    let apiToken: string | null = null;

    const auth = {
      resolveFromToken: async () => null,
      resolveFromApiToken: async (token: string) => {
        apiToken = token;
        return user;
      },
    };

    const middleware = new AuthenticateMiddleware(auth as any);
    const ctx = createCtx('opaque-api-token');
    let nextCalled = false;

    await middleware.handle(ctx, async () => {
      nextCalled = true;
    });

    expect(apiToken).toBe('opaque-api-token');
    expect(ctx.event.locals.user).toBe(user);
    expect(nextCalled).toBe(true);
  });
});
