import { describe, it, expect, vi } from 'vitest';
import {
  Controller,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  resource,
  type RequestEvent,
} from '../src/routing/Controller.js';

function createEvent(overrides: Partial<{
  method: string;
  body: any;
  contentType: string;
  params: Record<string, string>;
  searchParams: Record<string, string>;
  locals: Record<string, any>;
}> = {}): RequestEvent {
  const body = overrides.body;
  const contentType = overrides.contentType ?? 'application/json';
  const params = overrides.params ?? {};
  const searchParams = new URLSearchParams(overrides.searchParams ?? {});
  const locals = overrides.locals ?? {};

  return {
    request: new Request('http://localhost/test', {
      method: overrides.method ?? 'GET',
      headers: { 'Content-Type': contentType },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    url: new URL('http://localhost/test?' + searchParams.toString()),
    params,
    locals,
    getClientAddress: () => '127.0.0.1',
    cookies: {},
    platform: {},
  };
}

class TestController extends Controller {
  async index(_event: RequestEvent) {
    return this.json([{ id: 1, name: 'Alice' }]);
  }

  async show(event: RequestEvent) {
    const id = event.params.id;
    if (id === '999') throw new NotFoundError('User not found');
    return this.json({ id, name: 'Alice' });
  }

  async store(event: RequestEvent) {
    return this.created({ id: 1 });
  }

  async update(event: RequestEvent) {
    return this.json({ updated: true });
  }

  async destroy(_event: RequestEvent) {
    return this.noContent();
  }

  async textResponse() {
    return this.text('Hello World');
  }

  async htmlResponse() {
    return this.html('<h1>Hello</h1>');
  }

  async redirectResponse() {
    return this.redirect('/dashboard');
  }

  async throwUnauthorized() {
    throw new UnauthorizedError('Not logged in');
  }

  async throwForbidden() {
    throw new ForbiddenError('No access');
  }

  async throwValidation() {
    const { z } = await import('zod');
    const schema = z.object({ email: z.string().email() });
    const result = schema.safeParse({ email: 'invalid' });
    if (!result.success) throw new ValidationError(result.error);
  }

  async validateWithValibot(event: RequestEvent) {
    const v = await import('valibot');
    const data = await this.validate(event, v.object({
      email: v.pipe(v.string(), v.email('Email is invalid')),
      name: v.pipe(v.string(), v.minLength(2, 'Name is too short')),
    }));

    return this.json(data);
  }

  async returnRawData() {
    return { key: 'value' };
  }
}

describe('Controller', () => {
  const ctrl = new TestController();

  describe('handle()', () => {
    it('should bind a method to a SvelteKit handler', async () => {
      const handler = ctrl.handle('index');
      const event = createEvent();
      const res = await handler(event);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(1);
      expect(body[0].name).toBe('Alice');
    });

    it('should pass event params correctly', async () => {
      const handler = ctrl.handle('show');
      const event = createEvent({ params: { id: '5' } });
      const res = await handler(event);
      const body = await res.json();
      expect(body.id).toBe('5');
    });

    it('should throw for nonexistent method', async () => {
      const handler = ctrl.handle('nonexistent');
      const event = createEvent();
      const res = await handler(event);
      expect(res.status).toBe(500);
    });

    it('should wrap raw data return in JSON', async () => {
      const handler = ctrl.handle('returnRawData');
      const event = createEvent();
      const res = await handler(event);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.key).toBe('value');
    });
  });

  describe('response helpers', () => {
    it('should return JSON response', async () => {
      const handler = ctrl.handle('index');
      const res = await handler(createEvent());
      expect(res.headers.get('Content-Type')).toBe('application/json');
    });

    it('should return 201 Created', async () => {
      const handler = ctrl.handle('store');
      const res = await handler(createEvent({ method: 'POST' }));
      expect(res.status).toBe(201);
    });

    it('should return 204 No Content', async () => {
      const handler = ctrl.handle('destroy');
      const res = await handler(createEvent({ method: 'DELETE' }));
      expect(res.status).toBe(204);
    });

    it('should return text response', async () => {
      const handler = ctrl.handle('textResponse');
      const res = await handler(createEvent());
      expect(res.headers.get('Content-Type')).toBe('text/plain');
      expect(await res.text()).toBe('Hello World');
    });

    it('should return HTML response', async () => {
      const handler = ctrl.handle('htmlResponse');
      const res = await handler(createEvent());
      expect(res.headers.get('Content-Type')).toBe('text/html');
    });

    it('should return redirect response', async () => {
      const handler = ctrl.handle('redirectResponse');
      const res = await handler(createEvent());
      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toBe('/dashboard');
    });
  });

  describe('error handling', () => {
    it('should handle NotFoundError', async () => {
      const handler = ctrl.handle('show');
      const event = createEvent({ params: { id: '999' } });
      const res = await handler(event);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.message).toBe('User not found');
    });

    it('should handle UnauthorizedError', async () => {
      const handler = ctrl.handle('throwUnauthorized');
      const res = await handler(createEvent());
      expect(res.status).toBe(401);
    });

    it('should handle ForbiddenError', async () => {
      const handler = ctrl.handle('throwForbidden');
      const res = await handler(createEvent());
      expect(res.status).toBe(403);
    });

    it('should handle ValidationError', async () => {
      const handler = ctrl.handle('throwValidation');
      const res = await handler(createEvent());
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.message).toBe('Validation failed');
      expect(body.errors).toBeDefined();
    });

    it('should validate request bodies with Valibot schemas', async () => {
      const handler = ctrl.handle('validateWithValibot');
      const res = await handler(createEvent({ method: 'POST', body: { email: 'alice@example.com', name: 'Alice' } }));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ email: 'alice@example.com', name: 'Alice' });
    });

    it('should render Valibot validation errors as controller 422 responses', async () => {
      const handler = ctrl.handle('validateWithValibot');
      const res = await handler(createEvent({ method: 'POST', body: { email: 'bad', name: 'A' } }));

      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.errors).toEqual({
        email: ['Email is invalid'],
        name: ['Name is too short'],
      });
    });
  });
});

describe('resource() helper', () => {
  it('should create collection handlers (GET, POST)', () => {
    const handlers = resource(TestController);
    expect(handlers.GET).toBeDefined();
    expect(handlers.POST).toBeDefined();
    expect(typeof handlers.GET).toBe('function');
    expect(typeof handlers.POST).toBe('function');
  });

  it('should create single resource handlers (GET, PUT, PATCH, DELETE)', () => {
    const handlers = resource(TestController, true);
    expect(handlers.GET).toBeDefined();
    expect(handlers.PUT).toBeDefined();
    expect(handlers.PATCH).toBeDefined();
    expect(handlers.DELETE).toBeDefined();
  });

  it('should invoke the correct methods', async () => {
    const handlers = resource(TestController);
    const res = await handlers.GET(createEvent());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

describe('Error classes', () => {
  it('ValidationError should format Zod errors', async () => {
    const { z } = await import('zod');
    const result = z.object({
      email: z.string().email(),
      name: z.string().min(2),
    }).safeParse({ email: 'bad', name: 'A' });

    const err = new ValidationError(result.error!);
    expect(err.name).toBe('ValidationError');
    expect(err.message).toBe('Validation failed');
    expect(err.errors.email).toBeDefined();
    expect(err.errors.name).toBeDefined();
  });

  it('NotFoundError should default to "Not found"', () => {
    const err = new NotFoundError();
    expect(err.message).toBe('Not found');
    expect(err.name).toBe('NotFoundError');
  });

  it('UnauthorizedError should default to "Unauthorized"', () => {
    const err = new UnauthorizedError();
    expect(err.message).toBe('Unauthorized');
  });

  it('ForbiddenError should default to "Forbidden"', () => {
    const err = new ForbiddenError();
    expect(err.message).toBe('Forbidden');
  });
});
