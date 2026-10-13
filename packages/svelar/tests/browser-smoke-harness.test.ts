import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import { createServer as createPortProbe } from 'node:net';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const source = ts.createSourceFile('browser-smoke.mjs', readFileSync(resolve(process.cwd(), '../../scripts/browser-smoke.mjs'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const { authUiMessages } = await import(new URL('../../../scripts/auth-ui-certification.mjs', import.meta.url).href);

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

function otpHarness(options: { action?: { type: string; status: number }; alerts?: number; alertVisible?: boolean; code?: string; meStatus?: number } = {}) {
  const functions = source.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && ['assertInvalidOtp', 'visible'].includes(node.name?.text ?? ''));
  expect(functions).toHaveLength(2);
  const alertWait = vi.fn(async () => { if (options.alertVisible === false) throw new Error('Alert is hidden'); });
  const alert = { count: vi.fn(async () => options.alerts ?? 1), waitFor: alertWait };
  const message = { waitFor: vi.fn(async () => {}) };
  const code = { inputValue: vi.fn(async () => options.code ?? '') };
  const button = { click: vi.fn(async () => {}) };
  const page = {
    waitForResponse: vi.fn(async (predicate: (response: any) => boolean) => {
      const response = (path: string, method: string) => ({ url: () => `http://127.0.0.1:5394${path}`, request: () => ({ method: () => method }) });
      expect(predicate(response('/otp-login', 'GET'))).toBe(false);
      expect(predicate(response('/api/auth/login', 'POST'))).toBe(false);
      expect(predicate(response('/otp-login?/verify', 'POST'))).toBe(true);
      return { json: async () => options.action ?? { type: 'failure', status: 401 } };
    }),
    getByRole: vi.fn((role: string, options?: { name: string }) => {
      if (role === 'alert') return alert;
      expect(role).toBe('button'); expect(options?.name).toBe('Verify & Sign In'); return button;
    }),
    getByText: vi.fn((text: string, options: { exact: boolean }) => {
      expect(text).toBe(authUiMessages.invalidOtp); expect(options).toEqual({ exact: true }); return message;
    }),
    locator: vi.fn((selector: string) => { expect(selector).toBe('input[name="code"]'); return code; }),
  };
  const browserApi = vi.fn(async (actual: unknown, path: string) => {
    expect(actual).toBe(page); expect(path).toBe('/api/auth/me'); return { status: options.meStatus ?? 401 };
  });
  const evaluate = new Function('authUiMessages', 'browserApi', `${functions.map((fn) => fn.getText(source)).join('\n')}\nreturn assertInvalidOtp;`);
  return { assertInvalidOtp: evaluate(authUiMessages, browserApi), page, alert, message, code, button, browserApi };
}

describe('Browser smoke invalid OTP contract', () => {
  it('reuses the import-safe Auth UI message and binds the assertion into the existing OTP workflow', () => {
    expect(authUiMessages.invalidOtp).toBe('Invalid or expired code');
    const imports = source.statements.filter(ts.isImportDeclaration);
    expect(imports.some((node) => node.moduleSpecifier.getText(source) === "'./auth-ui-certification.mjs'" && node.importClause?.getText(source).includes('authUiMessages'))).toBe(true);
    const workflow = source.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'runAuthPagesBrowserSmoke');
    expect(workflow?.getText(source)).toContain('await assertInvalidOtp(page)');
    expect(workflow?.getText(source)).not.toContain('Invalid or expired code. Please try again.');
  });

  it('requires the real enhanced 401 failure, exact safe message, one visible alert, cleared code and anonymous identity', async () => {
    const h = otpHarness();
    await h.assertInvalidOtp(h.page);
    expect(h.page.waitForResponse).toHaveBeenCalledOnce();
    expect(h.button.click).toHaveBeenCalledOnce();
    expect(h.message.waitFor).toHaveBeenCalledWith({ state: 'visible', timeout: 10000 });
    expect(h.alert.count).toHaveBeenCalledOnce();
    expect(h.alert.waitFor).toHaveBeenCalledWith({ state: 'visible', timeout: 10000 });
    expect(h.code.inputValue).toHaveBeenCalledOnce();
    expect(h.browserApi).toHaveBeenCalledOnce();
  });

  it.each([{ type: 'success', status: 200 }, { type: 'success', status: 401 }, { type: 'failure', status: 422 }, { type: 'failure', status: 500 }])('rejects a non-authentication action result %j', async (action) => {
    const h = otpHarness({ action });
    await expect(h.assertInvalidOtp(h.page)).rejects.toThrow('enhanced action failure with status 401');
    expect(h.browserApi).not.toHaveBeenCalled();
  });

  it.each([0, 2])('rejects %i visible alerts', async (alerts) => {
    const h = otpHarness({ alerts });
    await expect(h.assertInvalidOtp(h.page)).rejects.toThrow('exactly one visible alert');
  });

  it('rejects a hidden alert', async () => {
    const h = otpHarness({ alertVisible: false });
    await expect(h.assertInvalidOtp(h.page)).rejects.toThrow('single OTP failure alert');
  });

  it('rejects retained OTP input', async () => {
    const h = otpHarness({ code: '000000' });
    await expect(h.assertInvalidOtp(h.page)).rejects.toThrow('retained the code');
  });

  it.each([200, 403, 500])('rejects an auth/me status of %i instead of accepting a session or hiding an API failure', async (meStatus) => {
    const h = otpHarness({ meStatus });
    await expect(h.assertInvalidOtp(h.page)).rejects.toThrow('established an authenticated session');
  });
});
