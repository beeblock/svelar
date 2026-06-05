import { afterEach, describe, expect, it, vi } from 'vitest';
import { Broadcast } from '../src/broadcasting/index.js';
import { GeneratePdfJob } from '../src/pdf/GeneratePdfJob.js';
import { PDF } from '../src/pdf/index.js';

describe('PDF', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    PDF.configure({ driver: 'pdfkit' });
    Broadcast.configure({
      default: 'sse',
      drivers: {
        sse: { driver: 'sse' },
      },
    });
  });

  it('rejects unknown drivers during configuration', () => {
    expect(() => PDF.configure({ driver: 'invalid' as any })).toThrow('Unknown PDF driver: invalid');
  });

  it('propagates Gotenberg generation failures', async () => {
    globalThis.fetch = vi.fn(async () => new Response('conversion failed', { status: 500 })) as any;
    PDF.configure({ driver: 'gotenberg', gotenberg: { url: 'http://gotenberg.test' } });

    await expect(PDF.html('<h1>Invoice</h1>').generate()).rejects.toThrow(
      'Gotenberg error 500: conversion failed'
    );
  });

  it('propagates requested completion broadcast failures from queued PDF jobs', async () => {
    const requests: string[] = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      requests.push(String(url));
      if (String(url).includes('/forms/chromium/convert/html')) {
        return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { status: 200 });
      }
      return new Response('broadcast failed', { status: 500 });
    }) as any;

    PDF.configure({ driver: 'gotenberg', gotenberg: { url: 'http://gotenberg.test' } });
    Broadcast.configure({
      default: 'pusher',
      drivers: {
        pusher: {
          driver: 'pusher',
          key: 'app-key',
          secret: 'app-secret',
          appId: 'app-id',
          host: 'soketi.test',
          useTLS: false,
        },
      },
    });

    const job = new GeneratePdfJob({
      type: 'html',
      content: '<h1>Invoice</h1>',
      broadcastEvent: 'pdf-ready',
      broadcastChannel: 'private-pdfs.1',
    });

    await expect(job.handle()).rejects.toThrow('Pusher API error (500): broadcast failed');
    expect(requests.some((url) => url.includes('/forms/chromium/convert/html'))).toBe(true);
    expect(requests.some((url) => url.includes('/apps/app-id/events'))).toBe(true);
  });
});
