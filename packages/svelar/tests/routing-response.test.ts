import { describe, it, expect } from 'vitest';
import {
  JsonResponse,
  RedirectResponse,
  DownloadResponse,
  StreamedResponse,
} from '../src/routing/Response.js';

describe('JsonResponse', () => {
  it('should create a JSON response with default status 200', () => {
    const res = new JsonResponse({ name: 'John' }).toResponse();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
  });

  it('should set custom status', () => {
    const res = new JsonResponse({ id: 1 }).status(201).toResponse();
    expect(res.status).toBe(201);
  });

  it('should set custom headers', () => {
    const res = new JsonResponse({})
      .header('X-Custom', 'value')
      .toResponse();
    expect(res.headers.get('X-Custom')).toBe('value');
  });

  it('should set multiple headers', () => {
    const res = new JsonResponse({})
      .headers({ 'X-A': '1', 'X-B': '2' })
      .toResponse();
    expect(res.headers.get('X-A')).toBe('1');
    expect(res.headers.get('X-B')).toBe('2');
  });

  describe('static factories', () => {
    it('should create success response', async () => {
      const res = JsonResponse.success({ ok: true });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it('should create created response', async () => {
      const res = JsonResponse.created({ id: 1 });
      expect(res.status).toBe(201);
    });

    it('should create error response', async () => {
      const res = JsonResponse.error('Not found', 404);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.message).toBe('Not found');
    });

    it('should create error with validation errors', async () => {
      const res = JsonResponse.error('Fail', 422, { email: ['Required'] });
      const body = await res.json();
      expect(body.errors.email).toEqual(['Required']);
    });

    it('should create validation error response', async () => {
      const res = JsonResponse.validationError({ name: ['Too short'] });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.message).toBe('Validation failed');
      expect(body.errors.name).toEqual(['Too short']);
    });

    it('should create no content response', () => {
      const res = JsonResponse.noContent();
      expect(res.status).toBe(204);
    });
  });
});

describe('RedirectResponse', () => {
  it('should create a 302 redirect by default', () => {
    const res = new RedirectResponse('/login').toResponse();
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/login');
  });

  it('should support custom status', () => {
    const res = new RedirectResponse('/new', 301).toResponse();
    expect(res.status).toBe(301);
  });

  it('should set custom headers', () => {
    const res = new RedirectResponse('/login')
      .header('X-Redirect-Reason', 'auth')
      .toResponse();
    expect(res.headers.get('X-Redirect-Reason')).toBe('auth');
  });

  describe('static factories', () => {
    it('should create temporary redirect', () => {
      const res = RedirectResponse.to('/dashboard');
      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toBe('/dashboard');
    });

    it('should create permanent redirect', () => {
      const res = RedirectResponse.permanent('/new-url');
      expect(res.status).toBe(301);
    });

    it('should create 307 temporary redirect', () => {
      const res = RedirectResponse.temporary('/temp');
      expect(res.status).toBe(307);
    });

    it('should redirect back using referer', () => {
      const req = new Request('http://localhost/current', {
        headers: { referer: 'http://localhost/previous' },
      });
      const res = RedirectResponse.back(req);
      expect(res.headers.get('Location')).toBe('http://localhost/previous');
    });

    it('should redirect back with fallback when no referer', () => {
      const req = new Request('http://localhost/current');
      const res = RedirectResponse.back(req, '/home');
      expect(res.headers.get('Location')).toBe('/home');
    });
  });
});

describe('DownloadResponse', () => {
  it('should create download with Content-Disposition', () => {
    const res = new DownloadResponse('file content', 'report.txt').toResponse();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="report.txt"');
    expect(res.headers.get('Content-Type')).toBe('text/plain');
  });

  it('should infer content types', () => {
    expect(new DownloadResponse('', 'data.json').toResponse().headers.get('Content-Type')).toBe('application/json');
    expect(new DownloadResponse('', 'data.csv').toResponse().headers.get('Content-Type')).toBe('text/csv');
    expect(new DownloadResponse('', 'file.pdf').toResponse().headers.get('Content-Type')).toBe('application/pdf');
    expect(new DownloadResponse('', 'image.png').toResponse().headers.get('Content-Type')).toBe('image/png');
    expect(new DownloadResponse('', 'file.unknown').toResponse().headers.get('Content-Type')).toBe('application/octet-stream');
  });

  it('should allow custom content type', () => {
    const res = new DownloadResponse('data', 'file.bin', 'application/custom').toResponse();
    expect(res.headers.get('Content-Type')).toBe('application/custom');
  });

  describe('static factories', () => {
    it('should make download from body', () => {
      const res = DownloadResponse.make('content', 'file.txt');
      expect(res.headers.get('Content-Disposition')).toContain('file.txt');
    });

    it('should make JSON download', async () => {
      const res = DownloadResponse.json({ key: 'value' }, 'data.json');
      expect(res.headers.get('Content-Type')).toBe('application/json');
      const body = await res.text();
      expect(JSON.parse(body)).toEqual({ key: 'value' });
    });

    it('should make CSV download', async () => {
      const csv = 'name,age\nAlice,30';
      const res = DownloadResponse.csv(csv);
      expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
      expect(res.headers.get('Content-Disposition')).toContain('export.csv');
    });
  });
});

describe('StreamedResponse', () => {
  it('should create SSE response', async () => {
    const res = StreamedResponse.sse(async function* () {
      yield { event: 'update', data: { count: 1 } };
      yield { data: 'hello' };
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
  });

  it('should create text stream', () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('hello'));
        controller.close();
      },
    });
    const res = StreamedResponse.text(stream);
    expect(res.headers.get('Content-Type')).toBe('text/plain');
  });

  it('should support fluent API', () => {
    const res = new StreamedResponse('body', 'text/plain')
      .status(202)
      .header('X-Custom', 'value')
      .toResponse();
    expect(res.status).toBe(202);
    expect(res.headers.get('X-Custom')).toBe('value');
  });
});
