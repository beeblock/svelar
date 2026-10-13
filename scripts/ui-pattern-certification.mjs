#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactEvidence, runCommand, writeEvidence } from './runtime-certification.mjs';

const script = fileURLToPath(import.meta.url);
const repository = resolve(dirname(script), '..');
const applications = resolve(repository, '../svelar-testing-area/apps');
export const defaultUiClients = join(applications, 'svelar-evolution-candidate2-ddd-zod/package.json');
export const uiPatterns = ['SearchableSelect', 'ResponsiveDialog', 'UrlTabs', 'ServerTable', 'OperationTray', 'CapabilityEditor'];

export function parseUiOptions(args) {
  const options = { clients: defaultUiClients, reportDir: resolve(repository, '../svelar-testing-area/artifacts/ui-pattern-certification'),
    timeout: 900, keepFixture: false, help: false };
  for (const arg of args) {
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--keep-fixture') options.keepFixture = true;
    else if (arg.startsWith('--clients=') || arg.startsWith('--report-dir=')) {
      const key = arg.startsWith('--clients=') ? 'clients' : 'reportDir';
      const value = arg.slice(arg.indexOf('=') + 1);
      if (!value) throw new Error('Client/report paths cannot be empty.');
      options[key] = resolve(value);
    } else if (arg.startsWith('--timeout=')) {
      const value = arg.slice(10);
      if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 1800) throw new Error('--timeout must be integer seconds in 1..1800.');
      options.timeout = Number(value);
    } else throw new Error(`Unknown UI certification option: ${arg}`);
  }
  return options;
}

export function fixtureEnvironment(base, directory, port) {
  const env = { ...base };
  for (const key of Object.keys(env)) if (/^(DB_|DATABASE_URL$|REDIS_|QUEUE_|BROADCAST_|CACHE_|MAIL_|SEARCH_|MEILISEARCH_|LOG_|APP_|INTERNAL_|SVELAR_TEST_|AGENT_BROWSER_)/.test(key)) delete env[key];
  return { ...env, CI: '1', FORCE_COLOR: '0', NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port),
    ORIGIN: `http://127.0.0.1:${port}`, APP_URL: `http://127.0.0.1:${port}`, APP_ENV: 'testing',
    APP_KEY: randomBytes(32).toString('hex'), INTERNAL_SECRET: randomBytes(32).toString('hex'),
    DB_DRIVER: 'sqlite', DB_PATH: join(directory, 'database.db'), QUEUE_DRIVER: 'memory', CACHE_DRIVER: 'memory',
    MAIL_DRIVER: 'log', LOG_VIEWER_DRIVER: 'memory', BROADCAST_BACKPLANE: 'memory', SESSION_SECURE: 'false',
  };
}

export function fixtureFiles() {
  const module = 'src/lib/modules/ui-probe';
  const alias = '$lib/modules/ui-probe';
  const pattern = '$lib/shared/components/patterns';
  return [
    { path: `${module}/contracts/schemas/ui-probe.schema.ts`, content: `import { z } from '@beeblock/svelar/validation';
export const uiProbeSchema = z.object({ mode: z.enum(['success', 'failure', 'cancel']) });
export type UiProbeInput = z.output<typeof uiProbeSchema>;
` },
    { path: `${module}/application/dto/UiProbeDto.ts`, content: `import type { UiProbeInput } from '${alias}/contracts/schemas/ui-probe.schema.js';
export class UiProbeDto {
  constructor(public readonly mode: UiProbeInput['mode']) {}
  static from(input: UiProbeInput): UiProbeDto { return new UiProbeDto(input.mode); }
}
` },
    { path: `${module}/interface/http/requests/UiProbeRequest.ts`, content: `import { FormRequest } from '@beeblock/svelar/forms';
import type { RequestEvent } from '@beeblock/svelar/routing';
import { uiProbeSchema, type UiProbeInput } from '${alias}/contracts/schemas/ui-probe.schema.js';
import { UiProbeDto } from '${alias}/application/dto/UiProbeDto.js';
import { capabilityAccess, resolveCapabilityInput } from '$lib/shared/permissions/access.server.js';
export class UiProbeRequest extends FormRequest<typeof uiProbeSchema, UiProbeDto> {
  rules() { return uiProbeSchema; }
  authorize(event: RequestEvent) { return capabilityAccess.can('action.ui-probe.create', resolveCapabilityInput(event)); }
  passedValidation(input: UiProbeInput): UiProbeDto { return UiProbeDto.from(input); }
}
` },
    { path: `${module}/application/actions/UiProbeAction.ts`, content: `import { Action } from '@beeblock/svelar/actions';
import { BackgroundOperation, type OperationRecord } from '@beeblock/svelar/operations';
import { Queue } from '@beeblock/svelar/queue';
import { ApplicationContext } from '@beeblock/svelar/support';
import { Log } from '@beeblock/svelar/logging';
import { UiProbeDto } from '${alias}/application/dto/UiProbeDto.js';
import { uiProbeSchema } from '${alias}/contracts/schemas/ui-probe.schema.js';
let worker: Promise<number> | undefined;
export class UiProbeAction extends Action<UiProbeDto, OperationRecord> {
  async execute(input: UiProbeDto): Promise<OperationRecord> {
    BackgroundOperation.register('ui.pattern.probe', { maxAttempts: 1, handle: async (execution) => {
      const payload = uiProbeSchema.parse(execution.payload);
      for (let progress = 1; progress <= 4; progress++) {
        if (execution.signal.aborted || await execution.isCancelled()) return { cancelled: true };
        await execution.report(progress);
        await new Promise<void>((resolve) => setTimeout(resolve, 750));
        if (payload.mode === 'failure' && progress === 2) throw new Error('Fixture operation failed.');
      }
      return { completed: true };
    } });
    if (!worker) {
      worker = Promise.resolve(ApplicationContext.runIsolated({}, () => Queue.work({ connection: 'memory', sleep: 0.05 })));
      void worker.catch((error: unknown) => Log.error('UI fixture worker failed', { error }));
    }
    return BackgroundOperation.dispatch('ui.pattern.probe', { mode: input.mode }, {
      label: 'UI operation ' + input.mode, total: 4, returnUrl: '/dashboard/ui-patterns',
    });
  }
}
` },
    { path: `${module}/interface/http/controllers/UiProbeController.ts`, content: `import { Controller, type RequestEvent } from '@beeblock/svelar/routing';
import { UiProbeRequest } from '${alias}/interface/http/requests/UiProbeRequest.js';
import { UiProbeAction } from '${alias}/application/actions/UiProbeAction.js';
import { capabilityAccess, resolveCapabilityInput } from '$lib/shared/permissions/access.server.js';
export class UiProbeController extends Controller {
  async index(event: RequestEvent) {
    await capabilityAccess.authorize('screen.ui-probe.view', resolveCapabilityInput(event));
    return this.json({ data: { patterns: ${JSON.stringify(uiPatterns)} }, meta: {} });
  }
  async store(event: RequestEvent) {
    const input = await UiProbeRequest.validate(event);
    const operation = await new UiProbeAction().execute(input);
    return this.json({ data: { id: operation.id }, meta: {} }, 201);
  }
}
` },
    { path: 'src/lib/testing/ui-pattern-data.ts', content: `import type { ManifestCapability, SelectOption, UrlTab, TableQuery } from '${pattern}/contracts.js';
export const options: SelectOption[] = [
  { value: 'alpha', label: 'Alpha', keywords: ['first'] }, { value: 'beta', label: 'Beta' },
  { value: 'disabled', label: 'Disabled choice', disabled: true },
];
export const tabs: UrlTab[] = [{ value: 'overview', label: 'Overview' }, { value: 'details', label: 'Details' }, { value: 'disabled', label: 'Disabled tab', disabled: true }];
export const catalog: ManifestCapability[] = [
  { name: 'screen.fixture.view', label: 'Fixture records', scope: 'team', kind: 'screen', screen: 'fixture', action: 'view', guard: 'web', group: 'Fixture', route: '/fixture', dependencies: [] },
  { name: 'action.fixture.create', label: 'Create fixture', scope: 'team', kind: 'action', screen: 'fixture', action: 'create', guard: 'web', group: 'Fixture', dependencies: ['screen.fixture.view'] },
  { name: 'action.fixture.delete', label: 'Delete fixture', scope: 'team', kind: 'action', screen: 'fixture', action: 'delete', guard: 'web', group: 'Fixture', dependencies: ['screen.fixture.view'] },
];
const fixtures = Array.from({ length: 23 }, (_, index) => ({ id: index + 1, label: 'Record ' + String(index + 1).padStart(2, '0'), detail: 'Long fixture detail '.repeat(24) }));
export function tableData(query: TableQuery) {
  const filtered = fixtures.filter((row) => row.label.toLowerCase().includes(query.search.toLowerCase()));
  if (query.sort === 'label') filtered.sort((a, b) => query.direction === 'asc' ? a.label.localeCompare(b.label) : b.label.localeCompare(a.label));
  return { rows: filtered.slice((query.page - 1) * query.perPage, query.page * query.perPage), total: filtered.length };
}
` },
    { path: 'src/routes/dashboard/ui-patterns/+page.server.ts', content: `import { capabilityAccess, resolveCapabilityInput } from '$lib/shared/permissions/access.server.js';
import { tableQuery } from '${pattern}/helpers.js';
import { tableData, options, tabs, catalog } from '$lib/testing/ui-pattern-data.js';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async (event) => {
  await capabilityAccess.authorize('screen.ui-probe.view', resolveCapabilityInput(event));
  const query = tableQuery(event.url, ['label'], 10);
  return { ...tableData(query), query, options, tabs, catalog };
};
` },
    { path: 'src/routes/dashboard/ui-patterns/+page.svelte', content: `<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { apiFetch } from '@beeblock/svelar/http';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import SearchableSelect from '${pattern}/SearchableSelect.svelte';
  import ResponsiveDialog from '${pattern}/ResponsiveDialog.svelte';
  import UrlTabs from '${pattern}/UrlTabs.svelte';
  import ServerTable from '${pattern}/ServerTable.svelte';
  import OperationTray from '${pattern}/OperationTray.svelte';
  import CapabilityEditor from '${pattern}/CapabilityEditor.svelte';
  import { tableUrl } from '${pattern}/helpers.js';
  import type { OperationSummary, TableQuery } from '${pattern}/contracts.js';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  let selection = $state<string | string[]>(''); let selectLoading = $state(false); let selectError = $state('');
  let dialogOpen = $state(false); let dialogPending = $state(false); let draft = $state(''); let accepted = $state('');
  let grants = $state<string[]>([]); let inclusions = $state<string[]>([]); let exclusions = $state<string[]>([]);
  let system = $state(false); let editorDisabled = $state(false);
  let operations = $state<OperationSummary[]>([]); let operationError = $state(''); let creating = $state(false);
  let streamEvents = $state(0); let streamReady = $state(false); let stream: EventSource | null = null;
  let active = false; let flight: Promise<void> | null = null; let refetch = false; let channel = '';
  let rejectRefresh = $state(false); let validationStatus = $state(0);
  const columns = [{ key: 'label', label: 'Record label', sortable: true, text: (row: PageData['rows'][number]) => row.label },
    { key: 'detail', label: 'Detail', truncate: true, text: (row: PageData['rows'][number]) => row.detail }];
  async function query(next: TableQuery) {
    await new Promise<void>((resolve) => setTimeout(resolve, 600));
    if (next.search === 'fail') throw new Error('Fixture query rejected.');
    await goto(tableUrl(page.url, next), { keepFocus: true, noScroll: true });
  }
  async function refresh(): Promise<void> {
    if (!active) return;
    if (rejectRefresh) throw new Error('Fixture refresh rejected.');
    if (flight) { refetch = true; return flight; }
    flight = (async () => {
      const response = await apiFetch('/api/operations', { showToast: false, headers: { 'X-Svelar-Session-Activity': 'false' } });
      if (!response.ok) throw new Error('Operations unavailable.');
      const payload = await response.json(); operations = payload.data; operationError = '';
      if (payload.meta.channel !== channel) {
        stream?.close(); channel = payload.meta.channel;
        stream = new EventSource('/api/broadcasting/' + encodeURIComponent(channel));
        stream.onopen = () => { streamReady = true; };
        stream.addEventListener('operation.changed', () => { streamEvents++; void refresh().catch(() => { operationError = 'Operations unavailable.'; }); });
      }
    })();
    try { await flight; } finally { flight = null; if (refetch && active) { refetch = false; void refresh(); } }
  }
  async function start(mode: 'success' | 'failure' | 'cancel') {
    if (creating) return; creating = true; operationError = '';
    try {
      const response = await apiFetch('/api/ui-pattern-probe', { method: 'POST', showToast: false, body: JSON.stringify({ mode }), headers: { 'Content-Type': 'application/json' } });
      if (!response.ok) throw new Error('Operation submission failed.');
      await refresh();
    } catch { operationError = 'Operation submission failed.'; } finally { creating = false; }
  }
  async function cancel(id: string) {
    const response = await apiFetch('/api/operations/' + encodeURIComponent(id) + '/cancel', { method: 'POST', showToast: false });
    if (!response.ok) throw new Error('Cancellation unavailable.'); await refresh();
  }
  async function invalidSubmission() {
    const response = await apiFetch('/api/ui-pattern-probe', { method: 'POST', showToast: false,
      body: JSON.stringify({ mode: 'invalid' }), headers: { 'Content-Type': 'application/json' } });
    validationStatus = response.status;
  }
  onMount(() => { active = true; void refresh().catch(() => { operationError = 'Operations unavailable.'; });
    return () => { active = false; stream?.close(); }; });
</script>
<svelte:head><title>UI Pattern Certification</title></svelte:head>
<main class="mx-auto min-w-0 max-w-5xl space-y-8 p-4" data-stream-ready={streamReady} data-stream-events={streamEvents}>
  <h1 class="text-xl font-semibold">UI Pattern Certification</h1>
  <section id="select-fixture" class="min-w-0 space-y-3"><h2 class="text-base font-semibold">Select</h2>
    <SearchableSelect options={data.options} bind:value={selection} label="Fixture choice" loading={selectLoading} error={selectError} onretry={() => { selectError = ''; }} />
    <output data-testid="selection">{String(selection)}</output>
    <Button onclick={() => { selectLoading = !selectLoading; }}>Toggle select loading</Button>
    <Button onclick={() => { selectError = 'Fixture choices unavailable.'; }}>Fail select</Button>
  </section>
  <section id="dialog-fixture" class="space-y-3"><h2 class="text-base font-semibold">Dialog</h2>
    <Button id="open-dialog" onclick={() => { dialogOpen = true; }}>Open fixture dialog</Button><output data-testid="accepted">{accepted}</output>
    <ResponsiveDialog bind:open={dialogOpen} title="Fixture dialog" description="Fixture record" pending={dialogPending}>
      <label for="dialog-draft">Fixture value</label><Input id="dialog-draft" bind:value={draft} disabled={dialogPending} />
      <div class="h-64"></div>
      {#snippet footer()}<Button disabled={dialogPending} onclick={async () => { dialogPending = true; await new Promise<void>((resolve) => setTimeout(resolve, 1200)); accepted = draft; dialogPending = false; dialogOpen = false; }}>Accept value</Button>
      <Button disabled={dialogPending} variant="outline" onclick={() => { draft = ''; }}>Reset value</Button>
      <Button disabled={dialogPending} variant="outline" onclick={() => { dialogOpen = false; }}>Cancel dialog</Button>{/snippet}
    </ResponsiveDialog>
  </section>
  <section id="tabs-fixture" class="min-w-0"><h2 class="text-base font-semibold">Tabs</h2>
    <UrlTabs tabs={data.tabs} label="Fixture sections">{#snippet children(tab)}<p data-testid="active-tab">{tab}</p>{/snippet}</UrlTabs>
  </section>
  <section id="table-fixture" class="min-w-0"><h2 class="text-base font-semibold">Table</h2>
    <ServerTable rows={data.rows} {columns} getRowId={(row) => row.id} query={data.query} total={data.total} label="Fixture records" onquery={query} onretry={() => query({ ...data.query, search: '', page: 1 })} />
  </section>
  <section id="editor-fixture" class="min-w-0 space-y-3"><h2 class="text-base font-semibold">Capability Editor</h2>
    <CapabilityEditor catalog={data.catalog} bind:value={grants} mode={system ? 'system' : 'custom'} defaults={['screen.fixture.view']} bind:inclusions bind:exclusions disabled={editorDisabled} />
    <output data-testid="grants">{JSON.stringify(grants)}</output><output data-testid="inclusions">{JSON.stringify(inclusions)}</output><output data-testid="exclusions">{JSON.stringify(exclusions)}</output>
    <Button onclick={() => { system = !system; }}>Toggle system profile</Button><Button onclick={() => { editorDisabled = !editorDisabled; }}>Toggle editor disabled</Button>
    <Button onclick={() => { grants = ['unavailable.capability']; system = false; }}>Inject stale fixture selection</Button>
  </section>
  <section id="operation-fixture" class="min-w-0 space-y-3"><h2 class="text-base font-semibold">Operation Fixture</h2>
    <div class="flex flex-wrap gap-2">{#each ['success', 'failure', 'cancel'] as mode}<Button disabled={creating} onclick={() => start(mode as 'success' | 'failure' | 'cancel')}>Start {mode}</Button>{/each}
      <Button onclick={() => { rejectRefresh = !rejectRefresh; }}>Toggle refresh failure</Button>
      <Button onclick={invalidSubmission}>Submit invalid fixture</Button><output data-testid="validation-status">{validationStatus}</output></div>
    <OperationTray {operations} error={operationError} onrefresh={refresh} oncancel={cancel} />
  </section>
</main>
` },
  ];
}

async function freePort() {
  const server = createServer();
  await new Promise((resolveReady, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveReady); });
  const port = server.address().port;
  await new Promise((resolveClosed, reject) => server.close(error => error ? reject(error) : resolveClosed()));
  return port;
}

async function binary(require, name, command = name) {
  const manifestPath = require.resolve(`${name}/package.json`);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[command];
  if (!bin) throw new Error(`Missing installed ${command} executable.`);
  return resolve(dirname(manifestPath), bin);
}

export async function prepareUiFixture(options, evidence, signal) {
  if (!options.clients.endsWith('package.json')) throw new Error('--clients must name an installed isolated app package.json.');
  await readFile(options.clients, 'utf8');
  const require = createRequire(options.clients);
  const cli = await binary(require, '@beeblock/svelar', 'svelar');
  const installedManifest = JSON.parse(await readFile(require.resolve('@beeblock/svelar/package.json'), 'utf8'));
  const directory = join(applications, 'svelar-ui-pattern-' + randomUUID());
  const port = await freePort(); const env = fixtureEnvironment(process.env, directory, port);
  await mkdir(applications, { recursive: true });
  const log = [];
  const run = async (label, args, cwd = directory) => {
    log.push(label);
    try { return await runCommand(process.execPath, args, { cwd, env, signal, timeoutMs: 180000 }); }
    catch (error) {
      if (label.startsWith('svelte-check')) await writeEvidence(evidence, 'typecheck.log', (error.stdout ?? '') + (error.stderr ?? ''));
      if (label.startsWith('vite build')) await writeEvidence(evidence, 'build.log', (error.stdout ?? '') + (error.stderr ?? ''));
      throw error;
    }
    finally { await writeEvidence(evidence, 'scaffold.log', log.join('\n')); }
  };
  try {
    await run('CLI new --no-install --validation=zod', [cli, 'new', directory, '--no-install', '--validation=zod'], applications);
    await symlink(join(dirname(options.clients), 'node_modules'), join(directory, 'node_modules'));
    await cp(join(dirname(options.clients), 'src/lib/components/ui'), join(directory, 'src/lib/components/ui'), { recursive: true });
    await cp(join(dirname(options.clients), 'src/lib/hooks/is-mobile.svelte.ts'), join(directory, 'src/lib/hooks/is-mobile.svelte.ts'));
    await run('CLI make:ui all --force', [cli, 'make:ui', 'all', '--force']);
    await run('CLI make:action UiProbe --dto --request --schema --module=ui-probe', [cli, 'make:action', 'UiProbe', '--dto', '--request', '--schema', '--module=ui-probe']);
    await run('CLI make:controller UiProbe --module=ui-probe --capability=ui-probe --scope=platform --screen-route=/dashboard/ui-patterns', [cli, 'make:controller', 'UiProbe', '--module=ui-probe', '--capability=ui-probe', '--scope=platform', '--screen-route=/dashboard/ui-patterns']);
    await run('CLI make:route api/ui-pattern-probe --controller=UiProbe --methods=GET,POST --module=ui-probe --capability=ui-probe --scope=platform',
      [cli, 'make:route', 'api/ui-pattern-probe', '--controller=UiProbe', '--methods=GET,POST', '--module=ui-probe', '--capability=ui-probe', '--scope=platform', '--screen-route=/dashboard/ui-patterns']);
    for (const file of fixtureFiles()) { const target = join(directory, file.path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, file.content); }
    await writeFile(join(directory, '.env'), Object.entries(env).filter(([key]) => /^(APP_|INTERNAL_|DB_|QUEUE_|CACHE_|MAIL_|LOG_|BROADCAST_|SESSION_)/.test(key)).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600 });
    await run('svelte-kit sync', [await binary(require, '@sveltejs/kit', 'svelte-kit'), 'sync']);
    const checked = await run('svelte-check --tsconfig ./tsconfig.json', [await binary(require, 'svelte-check'), '--tsconfig', './tsconfig.json']);
    await writeEvidence(evidence, 'typecheck.log', checked.stdout + checked.stderr);
    await run('CLI migrate', [cli, 'migrate']);
    await run('CLI seed:run', [cli, 'seed:run']);
    const built = await run('vite build (isolated app only)', [await binary(require, 'vite'), 'build']);
    await writeEvidence(evidence, 'build.log', built.stdout + built.stderr);
    return { directory, port, env, installedVersion: installedManifest.version };
  } catch (error) { error.fixtureDirectory = directory; throw error; }
}

async function startFixture(fixture, signal) {
  const server = spawn(process.execPath, ['build/index.js'], { cwd: fixture.directory, env: fixture.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; let closed = false;
  const exited = new Promise(resolveExit => server.once('close', (code, signal) => { closed = true; resolveExit({ code, signal }); }));
  server.stdout.on('data', data => { output += data; }); server.stderr.on('data', data => { output += data; });
  server.on('error', error => { output += error.stack; });
  async function stop() {
    if (closed) return;
    try { process.kill(-server.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    const deadline = setTimeout(() => { try { process.kill(-server.pid, 'SIGKILL'); } catch {} }, 10000);
    try { await exited; } finally { clearTimeout(deadline); }
  }
  try {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      if (closed) throw new Error('Owned fixture server exited before readiness.\n' + output);
      // A reserved port can be claimed during the build. Never authenticate
      // against HTTP alone before the owned adapter confirms its own listener.
      if (!output.includes(`Listening on http://127.0.0.1:${fixture.port}`)) {
        await new Promise(resolveWait => setTimeout(resolveWait, 100)); continue;
      }
      try { if ((await fetch(`http://127.0.0.1:${fixture.port}/login`, { signal: AbortSignal.timeout(2000) })).ok) return { stop, output: () => output }; }
      catch {}
      await new Promise(resolveWait => setTimeout(resolveWait, 100));
    }
    throw new Error('Owned fixture server did not become ready.\n' + output);
  } catch (error) { await stop(); throw error; }
}

export async function certifyUiPatterns(options) {
  const directory = join(options.reportDir, new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID());
  await mkdir(directory, { recursive: true, mode: 0o700 });
  console.log('UI pattern evidence: ' + directory);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('UI certification exceeded its overall deadline.')), options.timeout * 1000);
  const stop = () => controller.abort(new Error('UI certification interrupted.'));
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  const sessions = ['desktop', 'observer', 'mobile', 'foreign'].map(name => 'svelar-ui-' + randomUUID() + '-' + name);
  let fixture; let server; let failure; let summary; const results = [];
  const manifest = { kind: 'installed-generated-ui-patterns', status: 'running', cleanup: 'pending', patterns: uiPatterns, clients: options.clients, startedAt: new Date().toISOString() };
  const log = []; const commands = []; const opened = new Set();
  const browser = async (session, ...args) => {
    const env = { ...fixture.env, AGENT_BROWSER_DEFAULT_TIMEOUT: '10000', AGENT_BROWSER_ALLOWED_DOMAINS: '127.0.0.1', AGENT_BROWSER_IDLE_TIMEOUT_MS: '60000' };
    if (args[0] === 'open') opened.add(session);
    const safeArgs = args[0] === 'fill' && args[1].includes('password') ? [args[0], args[1], '[REDACTED]'] : args[0] === 'eval' ? ['eval', '(browser assertion)'] : args;
    commands.push(`${session}: ${safeArgs.join(' ')}`);
    await writeEvidence(directory, 'browser-commands.log', commands.join('\n'));
    try {
      const result = await runCommand('agent-browser', ['--session', session, '--json', ...args], { cwd: fixture.directory, env, signal: controller.signal, timeoutMs: 45000 });
      const parsed = JSON.parse(result.stdout); if (!parsed.success) throw new Error(JSON.stringify(parsed)); return parsed.data;
    } catch (error) { error.browserCommand = safeArgs.join(' '); throw error; }
  };
  const evaluate = async (session, expression) => (await browser(session, 'eval', '-b', Buffer.from(expression).toString('base64'))).result;
  const check = async (name, callback) => { console.log('UI browser check: ' + name); await callback(); results.push(name); log.push(name + ': passed'); await writeEvidence(directory, 'browser.log', log.join('\n')); };
  const wait = (session, expression) => browser(session, 'wait', '--fn', expression);
  const center = (session, selector) => evaluate(session, `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:"center",behavior:"instant"})`);
  async function respectRateBudget(session, reserve) {
    const budget = await evaluate(session, '(async()=>{const response=await fetch("/api/operations",{headers:{"X-Svelar-Session-Activity":"false"}});return {status:response.status,remaining:response.headers.get("X-RateLimit-Remaining"),reset:response.headers.get("X-RateLimit-Reset")}})()');
    assert.equal(budget.status, 200, 'Rate budget probe failed; no failed request is retried.');
    assert.match(budget.remaining ?? '', /^\d+$/); assert.match(budget.reset ?? '', /^\d+$/);
    if (Number(budget.remaining) >= reserve) return;
    const milliseconds = Number(budget.reset) * 1000 - Date.now() + 500;
    if (milliseconds <= 0) return;
    assert.ok(milliseconds <= 120000, 'Observed rate-limit reset exceeds the bounded workflow wait.');
    const message = `Respecting server rate budget: ${budget.remaining} remaining; waiting ${Math.ceil(milliseconds / 1000)}s before the next workflow (no retry).`;
    console.log(message); log.push(message); await writeEvidence(directory, 'browser.log', log.join('\n'));
    await new Promise((resolveWait, reject) => {
      controller.signal.throwIfAborted();
      const abort = () => { clearTimeout(timer); reject(controller.signal.reason); };
      const timer = setTimeout(() => { controller.signal.removeEventListener('abort', abort); resolveWait(); }, milliseconds);
      controller.signal.addEventListener('abort', abort, { once: true });
    });
  }
  try {
    await writeEvidence(directory, 'manifest.json', manifest);
    fixture = await prepareUiFixture(options, directory, controller.signal);
    Object.assign(manifest, { fixture: fixture.directory, port: fixture.port, installedVersion: fixture.installedVersion });
    await writeEvidence(directory, 'manifest.json', manifest);
    server = await startFixture(fixture, controller.signal);
    const base = `http://127.0.0.1:${fixture.port}`;
    async function login(session, email = 'admin@svelar.dev', password = 'admin123') {
      await browser(session, 'open', base + '/login');
      await browser(session, 'fill', 'input[name=email]', email); await browser(session, 'fill', 'input[name=password]', password);
      await browser(session, 'find', 'role', 'button', 'click', '--name', 'Sign In');
      await wait(session, 'location.pathname === "/dashboard"');
      await browser(session, 'open', base + '/dashboard/ui-patterns');
      await wait(session, 'document.querySelector("main[data-stream-ready=true]") !== null');
    }
    const [desktop, observer, mobile, foreign] = sessions;
    await login(desktop); await login(observer);
    await browser(desktop, 'set', 'viewport', '1440', '1000');
    await check('SearchableSelect keyboard search, disabled/loading/error/reset', async () => {
      await browser(desktop, 'find', 'role', 'combobox', 'click', '--name', 'Fixture choice');
      await browser(desktop, 'fill', 'input[aria-label="Search options"]', 'first');
      await browser(desktop, 'press', 'ArrowDown'); await browser(desktop, 'press', 'Enter');
      await wait(desktop, 'document.querySelector("[data-testid=selection]").textContent === "alpha"');
      await wait(desktop, '!document.querySelector("[data-slot=popover-content]")');
      await browser(desktop, 'find', 'role', 'button', 'click', '--name', 'Clear Fixture choice');
      assert.equal(await evaluate(desktop, 'document.querySelector("[data-testid=selection]").textContent'), '');
      await browser(desktop, 'find', 'role', 'button', 'click', '--name', 'Toggle select loading');
      assert.equal(await evaluate(desktop, 'document.querySelector("#select-fixture [role=combobox]").disabled'), true);
      await browser(desktop, 'find', 'role', 'button', 'click', '--name', 'Toggle select loading');
      await browser(desktop, 'find', 'role', 'button', 'click', '--name', 'Fail select');
      await browser(desktop, 'wait', '--text', 'Fixture choices unavailable.');
      await browser(desktop, 'find', 'role', 'button', 'click', '--name', 'Retry', '--exact');
      await browser(desktop, 'find', 'role', 'combobox', 'click', '--name', 'Fixture choice');
      assert.equal(await evaluate(desktop, 'document.querySelector("[data-disabled][data-value=disabled]") !== null'), true);
      await browser(desktop, 'press', 'Escape');
      await wait(desktop, '!document.querySelector("[data-slot=popover-content]")');
    });
    await check('ResponsiveDialog keyboard trap, reset, pending protection and focus restoration', async () => {
      await browser(desktop, 'click', '#open-dialog'); await browser(desktop, 'fill', '#dialog-draft', 'Accepted fixture');
      await browser(desktop, 'find', 'role', 'button', 'click', '--name', 'Reset value');
      assert.equal(await evaluate(desktop, 'document.querySelector("#dialog-draft").value'), '');
      await browser(desktop, 'fill', '#dialog-draft', 'Accepted fixture'); await browser(desktop, 'press', 'Shift+Tab');
      assert.equal(await evaluate(desktop, 'document.querySelector("[role=dialog]").contains(document.activeElement)'), true);
      await browser(desktop, 'find', 'role', 'button', 'click', '--name', 'Accept value'); await browser(desktop, 'press', 'Escape');
      assert.equal(await evaluate(desktop, 'document.querySelector("[role=dialog]") !== null'), true);
      await wait(desktop, 'document.querySelector("[data-testid=accepted]").textContent === "Accepted fixture" && !document.querySelector("[role=dialog]")');
      assert.equal(await evaluate(desktop, 'document.activeElement.id'), 'open-dialog');
      await browser(desktop, 'click', '#open-dialog'); await browser(desktop, 'find', 'role', 'button', 'click', '--name', 'Cancel dialog');
      await wait(desktop, '!document.querySelector("[role=dialog]")');
      assert.equal(await evaluate(desktop, 'document.activeElement.id'), 'open-dialog');
    });
    await check('UrlTabs URL state, reload and keyboard navigation', async () => {
      await browser(desktop, 'find', 'role', 'tab', 'click', '--name', 'Details');
      await wait(desktop, 'new URL(location.href).searchParams.get("tab") === "details"'); await browser(desktop, 'reload');
      await wait(desktop, 'document.querySelector("[role=tab][aria-selected=true]").textContent.trim() === "Details"');
      await browser(desktop, 'focus', '#tabs-fixture [role=tab][aria-selected=true]'); await browser(desktop, 'press', 'ArrowLeft'); await browser(desktop, 'press', 'Enter');
      await wait(desktop, 'new URL(location.href).searchParams.get("tab") === "overview"');
      assert.equal(await evaluate(desktop, '[...document.querySelectorAll("#tabs-fixture [role=tab]")].find(node=>node.textContent.trim()==="Disabled tab").disabled'), true);
    });
    await check('ServerTable real server URL paging, sorting, loading, errors, retry and empty state', async () => {
      await browser(desktop, 'find', 'role', 'button', 'click', '--name', 'Next page');
      assert.equal(await evaluate(desktop, 'document.querySelector("#table-fixture section").getAttribute("aria-busy")'), 'true');
      await wait(desktop, 'document.querySelector("#table-fixture").textContent.includes("Page 2 of 3")');
      await center(desktop, '#table-fixture th button');
      await browser(desktop, 'find', 'role', 'button', 'click', '--name', 'Record label');
      await wait(desktop, 'new URL(location.href).searchParams.get("sort") === "label"');
      await wait(desktop, 'document.querySelector("#table-fixture section").getAttribute("aria-busy") === "false"');
      await browser(desktop, 'fill', '#table-fixture input', 'fail'); await browser(desktop, 'press', 'Enter');
      await browser(desktop, 'wait', '--text', 'Unable to load records. Please retry.');
      await browser(desktop, 'find', 'role', 'button', 'click', '--name', 'Retry', '--exact');
      await wait(desktop, '!document.querySelector("#table-fixture [role=alert]") && document.querySelector("#table-fixture section").getAttribute("aria-busy") === "false"');
      await browser(desktop, 'fill', '#table-fixture input', 'not-found'); await browser(desktop, 'press', 'Enter');
      await browser(desktop, 'wait', '--text', 'No records.');
      await wait(desktop, 'document.querySelector("#table-fixture section").getAttribute("aria-busy") === "false"');
      await browser(desktop, 'fill', '#table-fixture input', ''); await browser(desktop, 'press', 'Enter');
      await wait(desktop, 'document.querySelector("#table-fixture").textContent.includes("23 records")');
    });
    await check('CapabilityEditor dependency grants, exclusions, disabled state and stale removal', async () => {
      await center(desktop, '#editor-fixture');
      await browser(desktop, 'find', 'label', 'Create fixture', 'click');
      await wait(desktop, 'document.querySelector("[data-testid=grants]").textContent.includes("screen.fixture.view")');
      await browser(desktop, 'find', 'label', 'Fixture records', 'click');
      assert.equal(await evaluate(desktop, 'document.querySelector("[data-testid=grants]").textContent'), '[]');
      await browser(desktop, 'find', 'role', 'button', 'click', '--name', 'Toggle system profile');
      await browser(desktop, 'find', 'label', 'Create fixture', 'click');
      assert.equal(await evaluate(desktop, 'document.querySelector("[data-testid=inclusions]").textContent'), '["action.fixture.create"]');
      await browser(desktop, 'find', 'label', 'Fixture records', 'click');
      assert.equal(await evaluate(desktop, 'document.querySelector("[data-testid=exclusions]").textContent'), '["screen.fixture.view"]');
      assert.equal(await evaluate(desktop, 'document.querySelector("[data-testid=inclusions]").textContent'), '[]');
      await browser(desktop, 'find', 'role', 'button', 'click', '--name', 'Toggle editor disabled');
      assert.equal(await evaluate(desktop, '[...document.querySelectorAll("#editor-fixture [role=checkbox]")].every(node=>node.hasAttribute("disabled"))'), true);
      await browser(desktop, 'find', 'role', 'button', 'click', '--name', 'Toggle editor disabled');
      await browser(desktop, 'find', 'role', 'button', 'click', '--name', 'Inject stale fixture selection');
      await browser(desktop, 'find', 'role', 'button', 'click', '--name', 'Remove unavailable.capability');
      assert.equal(await evaluate(desktop, 'document.querySelector("[data-testid=grants]").textContent'), '[]');
    });
    await check('OperationTray durable progress, success, failure, cancellation and cross-browser private SSE', async () => {
      await center(desktop, '#operation-fixture');
      await respectRateBudget(desktop, 40);
      await wait(observer, 'document.querySelector("main[data-stream-ready=true]") !== null');
      const previous = await evaluate(observer, 'Number(document.querySelector("main[data-stream-events]").dataset.streamEvents)');
      await browser(desktop, 'find', 'role', 'button', 'click', '--name', 'Start success');
      await wait(observer, `Number(document.querySelector("main[data-stream-events]").dataset.streamEvents) > ${previous} && document.querySelector("#operation-fixture").textContent.includes("UI operation success")`);
      await browser(observer, 'wait', '[aria-label="UI operation success progress"]');
      await wait(observer, 'document.querySelector("#operation-fixture").textContent.includes("succeeded")');
      await respectRateBudget(desktop, 30);
      await browser(desktop, 'find', 'role', 'button', 'click', '--name', 'Start failure');
      await browser(observer, 'wait', '--text', 'Fixture operation failed.');
      await respectRateBudget(desktop, 20);
      await browser(desktop, 'find', 'role', 'button', 'click', '--name', 'Start cancel');
      await browser(observer, 'wait', '[aria-label="Cancel UI operation cancel"]');
      await browser(observer, 'find', 'role', 'button', 'click', '--name', 'Cancel UI operation cancel');
      await wait(desktop, 'document.querySelector("#operation-fixture").textContent.includes("cancelled")');
      await browser(desktop, 'find', 'role', 'button', 'click', '--name', 'Toggle refresh failure');
      await browser(desktop, 'find', 'role', 'button', 'click', '--name', 'Refresh operations');
      await browser(desktop, 'wait', '--text', 'Unable to load operations. Please retry.');
      await browser(desktop, 'find', 'role', 'button', 'click', '--name', 'Toggle refresh failure');
      await browser(desktop, 'find', 'role', 'button', 'click', '--name', 'Refresh operations');
      await wait(desktop, '!document.querySelector("#operation-fixture p[role=alert]") || !document.querySelector("#operation-fixture").textContent.includes("Unable to load operations.")');
    });
    await check('Authenticated writes retain CSRF/schema enforcement and foreign actors cannot subscribe', async () => {
      await respectRateBudget(desktop, 25);
      const status = await evaluate(desktop, '(async()=>{const response=await fetch("/api/ui-pattern-probe",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:"success"})});return response.status})()');
      assert.equal(status, 419);
      await browser(desktop, 'find', 'role', 'button', 'click', '--name', 'Submit invalid fixture');
      await wait(desktop, 'document.querySelector("[data-testid=validation-status]").textContent === "422"');
      const channel = await evaluate(desktop, '(async()=>{const response=await fetch("/api/operations");return (await response.json()).meta.channel})()');
      await browser(foreign, 'open', base + '/login'); await browser(foreign, 'fill', 'input[name=email]', 'demo@svelar.dev'); await browser(foreign, 'fill', 'input[name=password]', 'password');
      await browser(foreign, 'find', 'role', 'button', 'click', '--name', 'Sign In'); await wait(foreign, 'location.pathname === "/dashboard"');
      assert.equal(await evaluate(foreign, `(async()=>{const response=await fetch('/api/broadcasting/'+encodeURIComponent(${JSON.stringify(channel)}),{signal:AbortSignal.timeout(3000)});return response.status})()`), 403);
    });
    await check('Mobile document containment, keyboard-scrollable table and constrained dialog', async () => {
      await respectRateBudget(desktop, 20);
      await login(mobile); await browser(mobile, 'set', 'viewport', '390', '844');
      await wait(mobile, 'document.querySelector("#table-fixture [data-slot=table-container]").tabIndex === 0');
      const geometry = await evaluate(mobile, `(() => {
        const nodes = ['nav', '[data-slot=tabs]', '[data-slot=tabs-list]', '[role=tabpanel]', '#table-fixture [data-slot=table-container]'];
        return { viewport: innerWidth, document: document.documentElement.scrollWidth, regions: nodes.map(selector => {
          const node = document.querySelector(selector); const box = node.getBoundingClientRect();
          return { selector, left: box.left, right: box.right, width: box.width, scrollWidth: node.scrollWidth,
            direction: getComputedStyle(node).flexDirection, attributes: Object.fromEntries(node.getAttributeNames().map(key => [key, node.getAttribute(key)])) };
        }) };
      })()`);
      await writeEvidence(directory, 'mobile-layout.json', geometry);
      assert.ok(geometry.document <= geometry.viewport + 1, `Mobile document exceeds viewport: ${JSON.stringify(geometry)}`);
      await browser(mobile, 'focus', '#table-fixture [data-slot=table-container]'); await browser(mobile, 'press', 'ArrowRight');
      await wait(mobile, 'document.querySelector("#table-fixture [data-slot=table-container]").scrollLeft > 0');
      await browser(mobile, 'screenshot', join(directory, 'mobile.png'), '--full');
      await center(mobile, '#open-dialog');
      await browser(mobile, 'click', '#open-dialog');
      assert.equal(await evaluate(mobile, '(()=>{const box=document.querySelector("[role=dialog]").getBoundingClientRect();return box.left>=0&&box.right<=innerWidth&&box.top>=0&&box.bottom<=innerHeight})()'), true);
      await browser(mobile, 'screenshot', join(directory, 'mobile-dialog.png'));
      await browser(mobile, 'press', 'Escape');
    });
    await browser(desktop, 'screenshot', join(directory, 'desktop.png'), '--full');
    for (const session of [desktop, observer, mobile]) {
      const errors = await browser(session, 'errors');
      assert.equal(Array.isArray(errors.errors), true, JSON.stringify(errors));
      assert.equal(errors.errors.length, 0, JSON.stringify(errors));
    }
    summary = { kind: manifest.kind, passed: results.length, skipped: 0, patterns: uiPatterns, checks: results, installedVersion: fixture.installedVersion, reportDirectory: directory };
  } catch (error) {
    failure = error;
    for (const session of opened) {
      try {
        const snapshot = await runCommand('agent-browser', ['--session', session, 'snapshot'], { timeoutMs: 15000 });
        await writeEvidence(directory, `${session}.snapshot.log`, snapshot.stdout + snapshot.stderr);
        const url = await runCommand('agent-browser', ['--session', session, 'get', 'url'], { timeoutMs: 15000 });
        await writeEvidence(directory, `${session}.url.log`, url.stdout);
        await runCommand('agent-browser', ['--session', session, 'screenshot', join(directory, `${session}.failure.png`)], { timeoutMs: 15000 });
      } catch {}
    }
  }
  finally {
    const errors = [];
    for (const session of opened) {
      try { await runCommand('agent-browser', ['--session', session, 'close'], { timeoutMs: 15000 }); } catch (error) { errors.push(error); }
    }
    if (server) { try { await server.stop(); await writeEvidence(directory, 'server.log', server.output()); } catch (error) { errors.push(error); } }
    const ownedDirectory = fixture?.directory ?? failure?.fixtureDirectory;
    if (ownedDirectory) manifest.fixture = ownedDirectory;
    if (ownedDirectory && !options.keepFixture) { try { await rm(ownedDirectory, { recursive: true, force: true }); } catch (error) { errors.push(error); } }
    clearTimeout(timeout); process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
    if (errors.length) failure = new AggregateError(failure ? [failure, ...errors] : errors, 'UI fixture cleanup failed.');
    manifest.cleanup = errors.length ? 'failed' : 'succeeded'; manifest.status = failure ? 'failed' : 'passed'; manifest.finishedAt = new Date().toISOString(); manifest.checks = results;
    await writeEvidence(directory, 'manifest.json', manifest);
    await writeEvidence(directory, failure ? 'failure.json' : 'summary.json', failure ? { message: failure.message, stack: failure.stack, browserCommand: failure.browserCommand, stdout: failure.stdout, stderr: failure.stderr } : summary);
  }
  if (failure) { failure.reportDirectory = directory; throw failure; }
  return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === script) {
  const options = parseUiOptions(process.argv.slice(2));
  if (options.help) console.log(`Usage: node scripts/ui-pattern-certification.mjs [--clients=/isolated/app/package.json] [--report-dir=/artifacts] [--keep-fixture] [--timeout=900]\nOptional installed-artifact gate: creates its own CLI app, reuses installed shadcn primitives/peers, typechecks/builds only that app, and runs actual desktop/mobile/cross-browser interactions with agent-browser. Never installs or builds/packs core. Default clients: ${defaultUiClients}`);
  else certifyUiPatterns(options).then(summary => console.log(JSON.stringify(summary))).catch(error => {
    console.error(redactEvidence(error.message)); if (error.reportDirectory) console.error('Preserved UI evidence: ' + error.reportDirectory); process.exitCode = 1;
  });
}
