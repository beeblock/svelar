import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Log, type LogProcessor } from '../src/logging/index.js';
import { LogViewer } from '../src/logging/LogViewer.js';
import * as Redaction from '../src/logging/Redaction.js';
import { ApplicationContext } from '../src/support/Context.js';

beforeEach(() => {
  Log.configure({ default: 'console', channels: { console: { driver: 'console', format: 'json' } }, viewer: { driver: 'memory' } });
  Log.clearContext();
  ApplicationContext.clear();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); ApplicationContext.clear(); Log.clearContext(); });

describe('Early logging pipeline', () => {
  it.each([false, true])('runs ordered processors before enrichment and discards without serialization (named=%s)', async (named) => {
    const order: string[] = [];
    const read = vi.fn(() => { throw new Error('must not read context'); });
    const context = { get payload() { return read(); } };
    const processors: LogProcessor[] = [
      (entry) => { order.push(entry.channel!); expect(entry.context).toBe(context); return entry; },
      () => { order.push('discard'); return null; },
      () => { throw new Error('must not run'); },
    ];
    Log.configure({ default: 'console', channels: { console: { driver: 'console' } }, processors });
    const snapshot = vi.spyOn(ApplicationContext, 'snapshot');
    const redact = vi.spyOn(Redaction, 'redactLogContext');
    if (named) await Log.channel('console').info('discarded', context);
    else await Log.info('discarded', context);
    expect(order).toEqual(['console', 'discard']);
    expect(snapshot).not.toHaveBeenCalled();
    expect(redact).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
    expect(await LogViewer.query()).toEqual([]);
  });

  it('checks channel levels and all destinations before processors or ambient context', async () => {
    const processor = vi.fn((entry) => entry);
    Log.configure({ default: 'high', processors: [processor], channels: {
      high: { driver: 'console', level: 'error' },
      off: { driver: 'null', viewer: false },
      stack: { driver: 'stack', channels: ['high', 'off'], viewer: false },
      silent: { driver: 'console', output: false, viewer: false },
    } });
    const snapshot = vi.spyOn(ApplicationContext, 'snapshot');
    await Log.info('below threshold');
    await Log.channel('off').info('no sink');
    await Log.channel('stack').info('no accepting child');
    await Log.channel('silent').info('disabled');
    await Log.channel('high').error('disabled call', {}, { output: false, viewer: false });
    expect(processor).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
  });

  it('applies sync and async processors once before viewer and framework console, without capturing global console', async () => {
    const first = vi.fn(async (entry) => ({ ...entry, message: 'processed token=hidden', context: { ...entry.context, password: 'hidden' } }));
    const second = vi.fn((entry) => { expect(entry.context.requestId).toBeUndefined(); return { ...entry, channel: 'spoofed' }; });
    Log.configure({ default: 'console', channels: { console: { driver: 'console', format: 'json' } }, processors: [first, second] });
    await ApplicationContext.run({ requestId: 'request-1' }, () => Log.channel('console').info('original', { event: 'accepted' }));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    const output = JSON.parse(vi.mocked(console.log).mock.calls[0][0] as string);
    expect(output).toMatchObject({ channel: 'console', message: 'processed token=[REDACTED]', context: { requestId: 'request-1', password: '[REDACTED]' } });
    expect((await LogViewer.query())[0]).toMatchObject(output);
    console.log('direct console');
    expect(first).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('supports viewer-only output without relabeling channel (per-call=%s)', async (perCall) => {
    Log.configure({ default: 'audit', channels: { audit: { driver: 'console', output: perCall ? undefined : false } } });
    await Log.info('audit entry', { action: 'save' }, perCall ? { output: false } : {});
    await Log.channel('audit').warn('named audit', {}, { output: false });
    expect(console.log).not.toHaveBeenCalled();
    expect((await LogViewer.query()).map((entry) => entry.channel)).toEqual(['audit', 'audit']);
  });

  it('can disable viewer capture while retaining console output and stack level rules', async () => {
    Log.configure({ default: 'stack', channels: {
      stack: { driver: 'stack', channels: ['nested'], viewer: false },
      nested: { driver: 'stack', level: 'warn', channels: ['console'] },
      console: { driver: 'console', format: 'json' },
    } });
    await Log.info('below nested level');
    await Log.warn('accepted');
    expect(console.log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(vi.mocked(console.log).mock.calls[0][0] as string).channel).toBe('stack');
    expect(await LogViewer.query()).toEqual([]);
  });

  it('allows explicit per-call overrides of the selected channel defaults', async () => {
    Log.configure({ default: 'console', channels: { console: { driver: 'console', output: false, viewer: false } } });
    await Log.info('explicit destinations', {}, { output: true, viewer: true });
    expect(console.log).toHaveBeenCalledTimes(1);
    expect(await LogViewer.query()).toHaveLength(1);
  });

  it('skips enrichment for a disabled viewer and rejects circular stacks explicitly', async () => {
    Log.configure({ default: 'null', channels: { null: { driver: 'null' } }, viewer: { driver: 'memory', enabled: false } });
    const snapshot = vi.spyOn(ApplicationContext, 'snapshot');
    await Log.info('no sink');
    expect(snapshot).not.toHaveBeenCalled();
    Log.configure({ default: 'loop', channels: { loop: { driver: 'stack', channels: ['loop'] } } });
    await expect(Log.info('cycle')).rejects.toThrow('Circular log stack');
  });

  it('propagates processor failures without unprocessed output', async () => {
    Log.configure({ default: 'console', channels: { console: { driver: 'console' } }, processors: [async () => { throw new Error('processor failure'); }] });
    await expect(Log.info('must not leak')).rejects.toThrow('processor failure');
    expect(console.log).not.toHaveBeenCalled();
    expect(await LogViewer.query()).toEqual([]);
  });

  it.each([undefined, { level: 'toString' }, { level: '__proto__' }])('rejects invalid processor results before enrichment (%j)', async (result) => {
    Log.configure({ default: 'console', channels: { console: { driver: 'console' } }, processors: [() => result as any] });
    const snapshot = vi.spyOn(ApplicationContext, 'snapshot');
    await expect(Log.info('invalid')).rejects.toThrow('Invalid log processor result');
    expect(snapshot).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
  });

  it('rechecks severity after processing without enriching when all outputs reject it', async () => {
    Log.configure({ default: 'console', channels: { console: { driver: 'console', level: 'warn', viewer: false } },
      processors: [(entry) => ({ ...entry, level: 'debug' })] });
    const snapshot = vi.spyOn(ApplicationContext, 'snapshot');
    await Log.warn('downgraded');
    expect(snapshot).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
  });
});

describe('Single safe redaction boundary', () => {
  it('processes and redacts once before both stack outputs and the viewer', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'svelar-log-pipeline-'));
    try {
      const path = join(directory, 'entries.jsonl');
      const processor = vi.fn((entry) => ({ ...entry, context: { ...entry.context, password: 'hidden' } }));
      Log.configure({ default: 'stack', processors: [processor], context: { processSecret: 'hidden' }, channels: {
        stack: { driver: 'stack', channels: ['console', 'file'] },
        console: { driver: 'console', format: 'json' }, file: { driver: 'file', path, format: 'json' },
      } });
      const redact = vi.spyOn(Redaction, 'redactLogContext');
      await ApplicationContext.run({ requestId: 'Bearer hidden' }, () => Log.info('token=hidden'));
      expect(processor).toHaveBeenCalledTimes(1);
      expect(redact).toHaveBeenCalledTimes(1);
      const file = JSON.parse((await readFile(path, 'utf8')).trim());
      expect(file).toEqual(JSON.parse(vi.mocked(console.log).mock.calls[0][0] as string));
      expect((await LogViewer.query())[0]).toMatchObject(file);
      expect(JSON.stringify(file)).not.toContain('hidden');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('normalizes configured keys once and redacts once for Log -> viewer -> console', async () => {
    const customKeys = ['Private Field', 'value.with+regex'];
    Log.configure({ default: 'console', channels: { console: { driver: 'console', format: 'json' } }, redactKeys: customKeys });
    customKeys[0] = 'changed-after-configure';
    const redact = vi.spyOn(Redaction, 'redactLogContext');
    await Log.info('Bearer hidden', { PRIVATE_FIELD: 'hidden', nested: { 'prefix-value.with+regex-suffix': 'hidden', refreshToken: 'hidden' } });
    expect(redact).toHaveBeenCalledTimes(1);
    const output = vi.mocked(console.log).mock.calls[0][0] as string;
    expect(output).not.toContain('hidden');
    const [entry] = await LogViewer.query();
    expect(entry.context.PRIVATE_FIELD).toBe('[REDACTED]');
    expect(entry.context.nested['prefix-value.with+regex-suffix']).toBe('[REDACTED]');
  });

  it('does not allow prepared snapshots or caller flags to bypass redaction', async () => {
    const input = { timestamp: new Date().toISOString(), level: 'info' as const, message: 'safe', context: { nested: { password: 'hidden', personal: 'private' } } };
    const prepared = LogViewer.prepareEntry(input);
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.context.nested)).toBe(true);
    expect(() => { prepared.context.nested.password = 'leak'; }).toThrow();
    const stricter = LogViewer.prepareEntry(prepared, ['personal']);
    expect(stricter.context.nested.personal).toBe('[REDACTED]');
    await LogViewer.addEntry({ ...prepared, context: { password: 'hidden' }, redacted: true } as typeof prepared);
    expect((await LogViewer.query())[0].context.password).toBe('[REDACTED]');
  });

  it('keeps JSON hooks, prototype keys, cycles and special values from bypassing redaction', async () => {
    const hook = vi.fn(() => ({ password: 'hidden' }));
    const context: Record<string, any> = JSON.parse('{"__proto__":{"password":"hidden"}}');
    context.toJSON = hook;
    context.amount = 4n;
    context.symbol = Symbol('token=hidden');
    context.error = new Error('token=hidden');
    context.self = context;
    await Log.info('safe', context);
    expect(hook).not.toHaveBeenCalled();
    const [entry] = await LogViewer.query();
    expect(entry.context.amount).toBe('4');
    expect(JSON.stringify(entry)).not.toContain('hidden');
    expect(entry.context.__proto__.password).toBe('[REDACTED]');
  });
});
