import { describe, expect, it } from 'vitest';
import { Controller, getJsonResponseBody } from '../src/routing/index.js';

class JsonController extends Controller {
  reply(data: unknown, status = 200, headers: Record<string, string> = {}) {
    return this.json(data, status, headers);
  }
}

describe('controller JSON serialization', () => {
  it('exposes identical serialized bytes without reading the response stream', async () => {
    const response = new JsonController().reply({ data: { title: 'example' }, meta: {} }, 201, { 'X-Trace': 'abc' });
    expect(response.bodyUsed).toBe(false);
    expect(response.status).toBe(201);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(response.headers.get('X-Trace')).toBe('abc');
    const serialized = getJsonResponseBody(response);
    expect(serialized).toBe(JSON.stringify({ data: { title: 'example' }, meta: {} }, null, 2));
    expect(response.bodyUsed).toBe(false);
    expect(await response.text()).toBe(serialized);
  });

  it('runs the serializer hook before constructing the only response', async () => {
    class RedactedController extends JsonController {
      protected override serializeJson(data: unknown) {
        return JSON.stringify(data, (key, value) => key === 'password' ? '[REDACTED]' : value);
      }
    }
    const payload = { password: 'secret', data: { password: 'another-secret' } };
    const response = new RedactedController().reply(payload);
    expect(getJsonResponseBody(response)).toBe('{"password":"[REDACTED]","data":{"password":"[REDACTED]"}}');
    expect(await response.text()).toBe(getJsonResponseBody(response));
    expect(payload.password).toBe('secret');
  });

  it('preserves undefined, caller headers and serializer errors', async () => {
    const response = new JsonController().reply(undefined, 200, { 'Content-Type': 'application/custom+json' });
    expect(getJsonResponseBody(response)).toBe('');
    expect(await response.text()).toBe('');
    expect(response.headers.get('Content-Type')).toBe('application/custom+json');
    expect(() => new JsonController().reply({ value: 1n })).toThrow(TypeError);
    expect(getJsonResponseBody(new Response('{}'))).toBeUndefined();
  });
});
