import { describe, it, expect } from 'vitest';
import {
  Resource,
  ResourceResponse,
  ResourceCollectionResponse,
} from '../src/routing/Resource.js';

interface UserData {
  id: number;
  name: string;
  email: string;
}

class UserResource extends Resource<{ id: number; name: string; email: string; secret: string }, UserData> {
  toJSON(): UserData {
    return {
      id: this.data.id,
      name: this.data.name,
      email: this.data.email,
    };
  }
}

class UserWithExtras extends Resource<any, any> {
  toJSON() {
    return { id: this.data.id, name: this.data.name };
  }

  toWith() {
    return { permissions: ['read', 'write'] };
  }

  toAdditional() {
    return { version: '1.0' };
  }
}

describe('Resource', () => {
  const userData = { id: 1, name: 'Alice', email: 'alice@example.com', secret: 'hidden' };

  describe('make()', () => {
    it('should wrap a single item', async () => {
      const response = UserResource.make(userData);
      const obj = await response.toObject();
      expect(obj.data).toEqual({ id: 1, name: 'Alice', email: 'alice@example.com' });
      expect(obj.data.secret).toBeUndefined();
    });

    it('should not expose excluded fields', async () => {
      const response = UserResource.make(userData);
      const obj = await response.toObject();
      expect(obj.data).not.toHaveProperty('secret');
    });
  });

  describe('collection()', () => {
    it('should wrap multiple items', async () => {
      const users = [
        { id: 1, name: 'Alice', email: 'a@a.com', secret: 'x' },
        { id: 2, name: 'Bob', email: 'b@b.com', secret: 'y' },
      ];
      const response = UserResource.collection(users);
      const obj = await response.toObject();
      expect(obj.data).toHaveLength(2);
      expect(obj.data[0].name).toBe('Alice');
      expect(obj.data[1].name).toBe('Bob');
      expect(obj.data[0]).not.toHaveProperty('secret');
    });
  });

  describe('paginate()', () => {
    it('should wrap paginated result with meta', async () => {
      const result = {
        data: [
          { id: 1, name: 'Alice', email: 'a@a.com', secret: 'x' },
        ],
        total: 50,
        page: 1,
        perPage: 10,
        lastPage: 5,
        hasMore: true,
      };
      const response = UserResource.paginate(result);
      const obj = await response.toObject();
      expect(obj.data).toHaveLength(1);
      expect(obj.meta.total).toBe(50);
      expect(obj.meta.page).toBe(1);
      expect(obj.meta.per_page).toBe(10);
      expect(obj.meta.last_page).toBe(5);
      expect(obj.meta.has_more).toBe(true);
    });
  });
});

describe('ResourceResponse', () => {
  it('should support additional metadata', async () => {
    const response = UserResource.make({ id: 1, name: 'A', email: 'a@a.com', secret: 'x' });
    response.additional({ version: 2 });
    const obj = await response.toObject();
    expect(obj.meta.version).toBe(2);
  });

  it('should support extra data via with()', async () => {
    const response = UserResource.make({ id: 1, name: 'A', email: 'a@a.com', secret: 'x' });
    response.with({ roles: ['admin'] });
    const obj = await response.toObject();
    expect(obj.roles).toEqual(['admin']);
  });

  it('should support custom wrapper key', async () => {
    const response = UserResource.make({ id: 1, name: 'A', email: 'a@a.com', secret: 'x' });
    response.wrapper('user');
    const obj = await response.toObject();
    expect(obj.user).toBeDefined();
    expect(obj.data).toBeUndefined();
  });

  it('should unwrap with null wrapper', async () => {
    const response = UserResource.make({ id: 1, name: 'A', email: 'a@a.com', secret: 'x' });
    response.wrapper(null);
    const obj = await response.toObject();
    expect(obj.id).toBe(1);
    expect(obj.name).toBe('A');
  });

  it('should set custom status and headers', async () => {
    const response = UserResource.make({ id: 1, name: 'A', email: 'a@a.com', secret: 'x' });
    response.status(201).headers({ 'X-Custom': 'yes' });
    const res = await response.toResponse();
    expect(res.status).toBe(201);
    expect(res.headers.get('X-Custom')).toBe('yes');
  });

  it('should resolve deferred toWith and toAdditional', async () => {
    const response = UserWithExtras.make({ id: 1, name: 'Alice' });
    const obj = await response.toObject();
    expect(obj.permissions).toEqual(['read', 'write']);
    expect(obj.meta.version).toBe('1.0');
  });
});

describe('ResourceCollectionResponse', () => {
  it('should support additional metadata', async () => {
    const response = UserResource.collection([
      { id: 1, name: 'A', email: 'a@a.com', secret: 'x' },
    ]);
    response.additional({ total: 100 });
    const obj = await response.toObject();
    expect(obj.meta.total).toBe(100);
  });

  it('should support extra data via with()', async () => {
    const response = UserResource.collection([
      { id: 1, name: 'A', email: 'a@a.com', secret: 'x' },
    ]);
    response.with({ filters: { active: true } });
    const obj = await response.toObject();
    expect(obj.filters).toEqual({ active: true });
  });

  it('should toResponse correctly', async () => {
    const response = UserResource.collection([
      { id: 1, name: 'A', email: 'a@a.com', secret: 'x' },
    ]);
    const res = await response.toResponse();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    const body = await res.json();
    expect(body.data).toHaveLength(1);
  });
});
