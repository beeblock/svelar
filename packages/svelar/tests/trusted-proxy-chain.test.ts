import { describe, expect, it } from 'vitest';
import { resolveClientIp, type MiddlewareContext } from '../src/middleware/Middleware.js';

function request(forwarded: string, remote = '10.0.0.10'): MiddlewareContext {
  return { params: {}, locals: {}, event: { getClientAddress: () => remote,
    request: new Request('https://app.example', { headers: { 'X-Forwarded-For': forwarded } }) } };
}
describe('Trusted proxy chain boundaries', () => {
  it('ignores headers from an untrusted immediate peer', async () => {
    expect(await resolveClientIp(request('198.51.100.1'), ['10.0.0.20'])).toBe('10.0.0.10');
  });
  it('stops at the real untrusted client instead of accepting a forged leftmost value', async () => {
    expect(await resolveClientIp(request('198.51.100.99, 192.0.2.40'), ['10.0.0.10'])).toBe('192.0.2.40');
  });
  it('walks explicitly trusted proxy hops and respects the maximum depth', async () => {
    const event = request('192.0.2.40, 10.0.0.20');
    expect(await resolveClientIp(event, { addresses: ['10.0.0.10', '10.0.0.20'], maxHops: 2 })).toBe('192.0.2.40');
    expect(await resolveClientIp(event, { addresses: ['10.0.0.10', '10.0.0.20'], maxHops: 1 })).toBe('10.0.0.20');
  });
  it('supports async trusted address checks and validated IPv6 chains', async () => {
    expect(await resolveClientIp(request('2001:db8::40, 2001:db8::20', '2001:db8::10'), async (address) => address === '2001:db8::10' || address === '2001:db8::20')).toBe('2001:db8::40');
  });
  it.each(['unknown, 192.0.2.40', '192.0.2.40:3000', ',192.0.2.40', Array(34).fill('192.0.2.40').join(','), 'x'.repeat(4097)])('rejects malformed or unbounded forwarded headers', async (header) => {
    expect(await resolveClientIp(request(header), ['10.0.0.10'])).toBe('10.0.0.10');
  });
  it('rejects unsafe configuration rather than accepting a partial list', async () => {
    await expect(resolveClientIp(request('192.0.2.40'), { addresses: ['10.0.0.10'], maxHops: 0 })).rejects.toThrow('maxHops');
    await expect(resolveClientIp(request('192.0.2.40'), { addresses: ['hostname'] })).rejects.toThrow('explicit IP');
  });
});
