import { EventEmitter } from 'node:events';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { NewCommandTemplates } from '../src/cli/commands/NewCommandTemplates.js';

function shutdownHarness(failing: string[] = []) {
  const source = ts.createSourceFile('app.ts', NewCommandTemplates.appTs(), ts.ScriptTarget.Latest, true);
  const statements = source.statements.filter((statement) =>
    ts.isExpressionStatement(statement) && statement.getText(source).startsWith("process.once('sveltekit:shutdown'"));
  expect(statements).toHaveLength(1);
  const compiled = ts.transpileModule(statements[0].getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true,
  });
  expect(compiled.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error)).toEqual([]);
  const process = new EventEmitter();
  const calls: string[] = [];
  const close = (name: string) => vi.fn(async () => {
    calls.push(name);
    if (failing.includes(name)) throw new Error('private credential must not appear in the report');
  });
  const scheduler = { stop: close('scheduler') };
  const Queue = { stop: close('queue') };
  const Broadcast = { drain: close('broadcast') };
  const Cache = { close: close('cache') };
  const Connection = { disconnect: close('database') };
  const console = { error: vi.fn() };
  new Function('process', 'scheduler', 'Queue', 'Broadcast', 'Cache', 'Connection', 'console', compiled.outputText)(
    process, scheduler, Queue, Broadcast, Cache, Connection, console);
  return { process, calls, scheduler, Queue, Broadcast, Cache, Connection, console };
}

describe('generated adapter-node cache shutdown', () => {
  it('runs only after HTTP shutdown, in order, once and without a flush or forced exit', async () => {
    const harness = shutdownHarness();
    harness.process.emit('SIGTERM');
    expect(harness.calls).toEqual([]);
    harness.process.emit('sveltekit:shutdown');
    await vi.waitFor(() => expect(harness.calls).toEqual(['scheduler', 'queue', 'broadcast', 'cache', 'database']));
    harness.process.emit('sveltekit:shutdown');
    expect(harness.scheduler.stop).toHaveBeenCalledTimes(1);
    expect(harness.console.error).not.toHaveBeenCalled();
    const source = NewCommandTemplates.appTs();
    expect(source).not.toContain('Cache.flush(');
    expect(source).not.toContain('process.exit(');
  });

  it('awaits cache close before disconnecting the database', async () => {
    const harness = shutdownHarness();
    let release!: () => void;
    harness.Cache.close.mockImplementationOnce(() => new Promise<void>((accept) => { release = accept; }));
    harness.process.emit('sveltekit:shutdown');
    await vi.waitFor(() => expect(harness.Cache.close).toHaveBeenCalledTimes(1));
    expect(harness.Connection.disconnect).not.toHaveBeenCalled();
    release();
    await vi.waitFor(() => expect(harness.Connection.disconnect).toHaveBeenCalledTimes(1));
  });

  it('reports cache failure only after still awaiting database cleanup', async () => {
    const harness = shutdownHarness(['cache']);
    harness.process.emit('sveltekit:shutdown');
    await vi.waitFor(() => expect(harness.console.error).toHaveBeenCalledWith('Svelar shutdown cleanup failed:', 'cache'));
    expect(harness.calls).toEqual(['scheduler', 'queue', 'broadcast', 'cache', 'database']);
  });

  it('attempts all cleanup resources and reports every failure in deterministic order without secret causes', async () => {
    const harness = shutdownHarness(['scheduler', 'queue', 'broadcast', 'cache', 'database']);
    harness.process.emit('sveltekit:shutdown');
    await vi.waitFor(() => expect(harness.console.error).toHaveBeenCalledWith(
      'Svelar shutdown cleanup failed:', 'scheduler, queue, broadcast, cache, database'));
    expect(harness.calls).toEqual(['scheduler', 'queue', 'broadcast', 'cache', 'database']);
    expect(JSON.stringify(harness.console.error.mock.calls)).not.toContain('private credential');
  });
});
