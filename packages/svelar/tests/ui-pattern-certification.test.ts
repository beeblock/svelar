import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const ui = await import(pathToFileURL(resolve(import.meta.dirname, '../../../scripts/ui-pattern-certification.mjs')).href);

describe('Installed UI pattern certification runner', () => {
  it('targets the six generated contracts and keeps the gate explicitly separate from core builds', () => {
    expect(ui.uiPatterns).toEqual(['SearchableSelect', 'ResponsiveDialog', 'UrlTabs', 'ServerTable', 'OperationTray', 'CapabilityEditor']);
    expect(ui.parseUiOptions([]).clients).toBe(ui.defaultUiClients);
    expect(ui.parseUiOptions(['--clients=./app/package.json', '--report-dir=./reports', '--keep-fixture']).clients).toBe(resolve('app/package.json'));
    expect(ui.parseUiOptions(['--keep-fixture']).keepFixture).toBe(true);
  });
  it.each(['--clients=', '--report-dir=', '--timeout=0', '--timeout=NaN', '--timeout=1801', '--no-typecheck', '--skip-sse'])('rejects unsafe or incomplete gate option %s', (flag) => {
    expect(() => ui.parseUiOptions([flag])).toThrow();
  });
  it('isolates the database, drivers, browser sessions and secrets from the client app/environment', () => {
    const env = ui.fixtureEnvironment({ DB_PATH: '/user/database', DATABASE_URL: 'postgres://production', QUEUE_DRIVER: 'redis',
      REDIS_URL: 'redis://user-redis', BROADCAST_BACKPLANE: 'redis', APP_KEY: 'user-secret', AGENT_BROWSER_SESSION: 'shared-session', PATH: '/tools' }, '/isolated', 55999);
    expect(env.DB_PATH).toBe('/isolated/database.db'); expect(env.DATABASE_URL).toBeUndefined(); expect(env.REDIS_URL).toBeUndefined();
    expect(env.QUEUE_DRIVER).toBe('memory'); expect(env.CACHE_DRIVER).toBe('memory'); expect(env.BROADCAST_BACKPLANE).toBe('memory');
    expect(env.AGENT_BROWSER_SESSION).toBeUndefined(); expect(env.APP_KEY).not.toBe('user-secret'); expect(env.APP_KEY).toHaveLength(64);
    expect(env.HOST).toBe('127.0.0.1'); expect(env.PORT).toBe('55999'); expect(env.PATH).toBe('/tools');
  });
  it('keeps writes in shared schema, authorized FormRequest, DTO, Action and thin controller bindings', () => {
    const files = ui.fixtureFiles() as Array<{ path: string; content: string }>;
    expect(new Set(files.map(file => file.path)).size).toBe(files.length);
    expect(files.every(file => !file.path.includes('..') && file.path.startsWith('src/'))).toBe(true);
    const request = files.find(file => file.path.endsWith('UiProbeRequest.ts'))!.content;
    expect(request).toContain('extends FormRequest<typeof uiProbeSchema, UiProbeDto>');
    expect(request).toContain('capabilityAccess.can'); expect(request).toContain('UiProbeDto.from');
    const controller = files.find(file => file.path.endsWith('UiProbeController.ts'))!.content;
    expect(controller).toContain('UiProbeRequest.validate(event)'); expect(controller).toContain('new UiProbeAction().execute(input)');
    expect(controller).not.toContain('BackgroundOperation.dispatch');
    const action = files.find(file => file.path.endsWith('UiProbeAction.ts'))!.content;
    expect(action).toContain('ApplicationContext.runIsolated({},'); expect(action).toContain('BackgroundOperation.dispatch');
    expect(action).not.toContain('CREATE TABLE'); expect(action).not.toContain('Connection.raw');
  });
  it('uses actual app-owned generated patterns, authenticated API/CSRF transport and realtime without polling masking SSE', () => {
    const files = ui.fixtureFiles() as Array<{ path: string; content: string }>;
    const page = files.find(file => file.path.endsWith('+page.svelte'))!.content;
    for (const pattern of ui.uiPatterns) expect(page).toContain(`/${pattern}.svelte`);
    expect(page).toContain("apiFetch('/api/ui-pattern-probe'");
    expect(page).toContain("new EventSource('/api/broadcasting/'");
    expect(page).toContain("stream.addEventListener('operation.changed'");
    expect(page).not.toContain('setInterval'); expect(page).not.toContain('csrfExcludePaths');
    const server = files.find(file => file.path.endsWith('+page.server.ts'))!.content;
    expect(server).toContain('capabilityAccess.authorize'); expect(server).toContain('tableData(query)');
  });
});
