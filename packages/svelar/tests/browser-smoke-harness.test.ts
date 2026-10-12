import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import { createServer as createPortProbe } from 'node:net';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const source = ts.createSourceFile('browser-smoke.mjs', readFileSync(resolve(process.cwd(), '../../scripts/browser-smoke.mjs'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);

function harness(serverScript = 'smoke:serve') {
  const child = Object.assign(new EventEmitter(), {
    pid: 1234, exitCode: null as number | null, signalCode: null as string | null,
    stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn(),
  });
  const spawn = vi.fn(() => child);
  const process = { env: { EXISTING: 'preserved' }, stdout: { write: vi.fn() }, stderr: { write: vi.fn() }, kill: vi.fn(), exit: vi.fn() };
  const functions = source.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && ['startServer', 'stopServer', 'fail', 'assertPortAvailable'].includes(node.name?.text ?? ''));
  expect(functions).toHaveLength(4);
  const evaluate = new Function('spawn', 'process', 'serverScript', 'appDir', 'appEnv', 'port', 'baseUrl', 'setTimeout', 'createPortProbe',
    `${functions.map((fn) => fn.getText(source)).join('\n')}\nreturn { startServer, stopServer, fail, assertPortAvailable };`);
  const helpers = evaluate(spawn, process, serverScript, '/test/app', { APP_NAME: 'Test' }, 5394, 'http://127.0.0.1:5394', (fn: () => void) => fn(), createPortProbe);
  return { child, spawn, process, helpers };
}

describe('Browser smoke process isolation', () => {
  it('rejects an occupied port without spawning or stopping the existing server', async () => {
    const occupied = createPortProbe();
    await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', resolve));
    try {
      const address = occupied.address();
      if (!address || typeof address === 'string') throw new Error('Missing test server address');
      const { helpers, spawn, process } = harness();
      await expect(helpers.assertPortAvailable(address.port)).rejects.toThrow('No existing server was stopped');
      expect(occupied.listening).toBe(true);
      expect(spawn).not.toHaveBeenCalled();
      expect(process.kill).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve, reject) => occupied.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('closes its availability probe before starting a server', async () => {
    await expect(harness().helpers.assertPortAvailable(0)).resolves.toBeUndefined();
  });

  it('overrides a hardcoded Vite script port and enforces strict port binding', () => {
    const { helpers, spawn, child } = harness();
    expect(helpers.startServer()).toBe(child);
    expect(spawn).toHaveBeenCalledWith('npm', ['run', 'smoke:serve', '--', '--port', '5394', '--strictPort'], expect.objectContaining({
      cwd: '/test/app', detached: true,
      env: expect.objectContaining({ EXISTING: 'preserved', APP_NAME: 'Test', APP_URL: 'http://127.0.0.1:5394', PORT: '5394', HOST: '127.0.0.1', ORIGIN: 'http://127.0.0.1:5394' }),
    }));
  });

  it('uses environment ports without appending Vite options to production servers', () => {
    const { helpers, spawn } = harness('smoke:serve:prod');
    helpers.startServer();
    expect(spawn.mock.calls[0][1]).toEqual(['run', 'smoke:serve:prod']);
  });

  it('throws failures so the owning finally block can clean up its server', async () => {
    const { helpers, process } = harness();
    const server = helpers.startServer();
    await expect((async () => {
      try { helpers.fail('Startup timeout'); }
      finally { await helpers.stopServer(server); }
    })()).rejects.toThrow('Startup timeout');
    expect(process.exit).not.toHaveBeenCalled();
    expect(process.kill.mock.calls).toEqual([[-1234, 'SIGTERM'], [-1234, 'SIGKILL']]);
  });

  it('does not escalate a server that already exited after graceful shutdown', async () => {
    const { helpers, process, child } = harness();
    child.signalCode = 'SIGTERM';
    await helpers.stopServer(child);
    expect(process.kill.mock.calls).toEqual([[-1234, 'SIGTERM']]);
  });
});
