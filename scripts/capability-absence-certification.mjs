#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, readdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lockedArtifact, managedProcess, stopManagedProcess, waitUntil } from './operational-browser-fixtures.mjs';
import { redactEvidence, runCommand, writeEvidence } from './runtime-certification.mjs';
import { fixtureEnvironment } from './ui-pattern-certification.mjs';

const script = fileURLToPath(import.meta.url);
const repository = resolve(dirname(script), '..');
const applications = resolve(repository, '../svelar-testing-area/apps');
export const receiptLabel = 'test-owned frontend + CLI-generated backend';
export const capabilityResource = 'capability-proof';
export const fixturePage = '/dashboard/capability-proof';
export const fixtureApi = '/api/capability-proof';
export const commands = Object.freeze(['create', 'update', 'delete']);

export function parseCapabilityOptions(args) {
  const options = { clients: join(applications, 'svelar-smoke-ddd/package.json'),
    reportDir: resolve(repository, '../svelar-testing-area/artifacts/capability-absence'),
    expectedSha256: undefined, validation: 'zod', certify: false, help: false };
  for (const arg of args) {
    if (arg === '--certify') options.certify = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--clients=') || arg.startsWith('--report-dir=')) {
      const value = arg.slice(arg.indexOf('=') + 1);
      if (!value) throw new Error('Client/report paths cannot be empty.');
      options[arg.startsWith('--clients=') ? 'clients' : 'reportDir'] = resolve(value);
    } else if (arg.startsWith('--expected-core-sha256=')) {
      const value = arg.slice('--expected-core-sha256='.length);
      if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error('--expected-core-sha256 requires a 64-character hexadecimal SHA-256.');
      options.expectedSha256 = value.toLowerCase();
    } else if (arg.startsWith('--validation=')) {
      options.validation = arg.slice(13);
      if (!['zod', 'valibot'].includes(options.validation)) throw new Error('Validation must be zod or valibot.');
    } else throw new Error(`Unknown capability certification option: ${arg}`);
  }
  if (!options.clients.endsWith('/package.json')) throw new Error('--clients must name an installed app package.json.');
  return options;
}

export function capabilityReceiptIdentity(packagePath, manifest, artifact) {
  if (manifest?.name !== '@beeblock/svelar' || typeof manifest.version !== 'string' || !manifest.version.trim()) {
    throw new Error('The physical installed package must identify @beeblock/svelar and its version.');
  }
  if (!/^[a-f0-9]{64}$/.test(artifact?.sha256 ?? '')) throw new Error('Verified artifact SHA-256 is required.');
  return { label: `${receiptLabel}, actual installed ${manifest.name}@${manifest.version} (sha256:${artifact.sha256})`,
    installed: { name: manifest.name, version: manifest.version, packagePath, artifact,
      dependencyClosure: 'Read-only reuse of the client physical installed node_modules; no fixture npm install.' } };
}

export function generatorCommands(directory, validation) {
  const decision = [`--capability=${capabilityResource}`, '--scope=platform', `--screen-route=${fixturePage}`];
  return [
    ['new', directory, '--no-install', `--validation=${validation}`],
    ['make:entity', 'CapabilityRecord', '--module=capability-proof', '--fields=title:string', '--crud', ...decision],
    ['make:route', 'api/capability-proof', '--controller=CapabilityRecord', '--module=capability-proof', '--resource', ...decision],
    ['make:seeder', 'CapabilityAbsenceSeeder'],
    ['make:factory', 'CapabilityActor', '--model=User', '--module=auth'],
    ['make:factory', 'CapabilityRecord', '--model=CapabilityRecord', '--module=capability-proof'],
    ['make:command', 'CapabilityState', '--command=app:capability-state'],
  ];
}

export function assertActionPresentation(presentation, privileged) {
  assert.equal(presentation.ready, true, 'The protected screen must actually load.');
  assert.ok(presentation.records > 0, 'A real persisted row must expose row commands for the privileged control.');
  for (const command of commands) {
    assert.ok(Number.isSafeInteger(presentation.buttons?.[command]));
    if (privileged) assert.ok(presentation.buttons[command] > 0, `Privileged ${command} control must exist.`);
    else assert.equal(presentation.buttons[command], 0, `Reader ${command} control must be absent, not hidden or disabled.`);
  }
  assert.ok(presentation.documentWidth <= presentation.viewportWidth + 1, 'The screen must not overflow the viewport.');
}

export function capabilityFixtureFiles(validation = 'zod') {
  if (!['zod', 'valibot'].includes(validation)) throw new Error('Unknown fixture validation provider.');
  const module = '$lib/modules/capability-proof';
  const adapter = validation === 'zod' ? 'zod4' : 'valibot';
  const clientAdapter = `${adapter}Client`;
  const parseRecords = validation === 'zod' ? 'capabilityRecordSchema.array().parse(body.data)' : 'v.parse(v.array(capabilityRecordSchema), body.data)';
  return [
    { path: 'src/lib/factories/CapabilityActorFactory.ts', content: `import { Factory } from '@beeblock/svelar/testing';
import { Hash } from '@beeblock/svelar/hashing';
import { User } from '$lib/modules/auth/domain/models/User.js';

export class CapabilityActorFactory extends Factory<User> {
  model() { return User; }
  async definition() {
    const password = process.env.CAPABILITY_PROOF_PASSWORD;
    if (!password) throw new Error('Fixture credentials are required.');
    return { name: 'Capability actor', role: 'user', password: await Hash.make(password) };
  }
}
` },
    { path: 'src/lib/factories/CapabilityRecordFactory.ts', content: `import { Factory } from '@beeblock/svelar/testing';
import { CapabilityRecord } from '${module}/domain/models/CapabilityRecord.js';

export class CapabilityRecordFactory extends Factory<CapabilityRecord> {
  model() { return CapabilityRecord; }
  definition() { return { title: 'Persisted capability record' }; }
}
` },
    { path: 'src/lib/database/seeders/CapabilityAbsenceSeeder.ts', content: `import { Seeder } from '@beeblock/svelar/database';
import { Permissions, PermissionProfiles } from '@beeblock/svelar/permissions';
import { permissionManifest } from '$lib/shared/permissions/manifest.js';
import { CapabilityActorFactory } from '$lib/factories/CapabilityActorFactory.js';
import { CapabilityRecordFactory } from '$lib/factories/CapabilityRecordFactory.js';

export class CapabilityAbsenceSeeder extends Seeder {
  async run(): Promise<void> {
    const owner = process.env.CAPABILITY_PROOF_OWNER;
    if (!owner) throw new Error('Fixture owner is required.');
    await Permissions.syncCapabilities();
    const factory = new CapabilityActorFactory();
    const profiles = new PermissionProfiles(permissionManifest).forPlatform();
    for (const kind of ['reader', 'writer'] as const) {
      const email = process.env[kind === 'reader' ? 'CAPABILITY_PROOF_READER_EMAIL' : 'CAPABILITY_PROOF_WRITER_EMAIL'];
      if (!email) throw new Error('Fixture email is required.');
      const user = await factory.create({ name: 'Capability ' + kind, email });
      const role = await Permissions.createRole({ name: 'capability-' + kind + '-' + owner, guard: permissionManifest.guard });
      await profiles.setCustom(role.id, kind === 'reader' ? ['screen.capability-proof.view'] :
        ['screen.capability-proof.view', 'action.capability-proof.create', 'action.capability-proof.update', 'action.capability-proof.delete']);
      await Permissions.global().assignRole('User', user.getAttribute('id'), role.id);
    }
    await new CapabilityRecordFactory().create();
  }
}
` },
    { path: 'src/lib/shared/commands/CapabilityStateCommand.ts', content: `import { Command } from '@beeblock/svelar/cli';
import { CapabilityRecordRepository } from '${module}/infrastructure/repositories/CapabilityRecordRepository.js';

export class CapabilityStateCommand extends Command {
  name = 'app:capability-state';
  description = 'Read the isolated capability fixture state';
  async handle(): Promise<void> {
    await this.bootstrap();
    const records = await new CapabilityRecordRepository().all();
    this.log('CAPABILITY_STATE:' + JSON.stringify(records.map(record => record.getAttributes()).sort((a, b) => Number(a.id) - Number(b.id))));
  }
}
` },
    { path: 'src/routes/dashboard/capability-proof/+page.server.ts', content: `import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { superValidate } from 'sveltekit-superforms';
import { ${adapter} } from 'sveltekit-superforms/adapters';
import { capabilityAccess, resolveCapabilityInput } from '$lib/shared/permissions/access.server.js';
import { CapabilityRecordService } from '${module}/application/services/CapabilityRecordService.js';
import { CapabilityRecordResource } from '${module}/interface/http/resources/CapabilityRecordResource.js';
import { createCapabilityRecordSchema, updateCapabilityRecordSchema } from '${module}/contracts/schemas/capability-record.schema.js';
import type { CapabilityRecordData } from '${module}/contracts/schemas/capability-record.schema.js';

export const load: PageServerLoad = capabilityAccess.guardLayout(async (event) => {
  const input = resolveCapabilityInput(event);
  if (!input) error(401, 'Authentication required.');
  const items = await new CapabilityRecordService().list();
  const response = await CapabilityRecordResource.collection(items).toResponse();
  const envelope = await response.json() as { data: CapabilityRecordData[] };
  return { records: envelope.data, capabilities: await capabilityAccess.snapshot(input),
    createForm: await superValidate(${adapter}(createCapabilityRecordSchema)),
    updateForm: await superValidate(${adapter}(updateCapabilityRecordSchema)) };
}, resolveCapabilityInput);
` },
    { path: 'src/routes/dashboard/capability-proof/+page.svelte', content: `<script lang="ts">
  import { untrack } from 'svelte';
  import type { PageData } from './$types';
  import { superForm } from 'sveltekit-superforms';
  import { ${clientAdapter} } from 'sveltekit-superforms/adapters';
  import { capabilityClient } from '@beeblock/svelar/permissions/client';
  import { apiFetch } from '@beeblock/svelar/http';
  ${validation === 'valibot' ? "import { v } from '@beeblock/svelar/validation/valibot';" : ''}
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import Plus from '@lucide/svelte/icons/plus';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import { capabilityRecordSchema, createCapabilityRecordSchema, updateCapabilityRecordSchema } from '${module}/contracts/schemas/capability-record.schema.js';
  import type { CapabilityRecordData } from '${module}/contracts/schemas/capability-record.schema.js';

  let { data }: { data: PageData } = $props();
  const access = $derived(capabilityClient(data.capabilities));
  const createState = superForm(untrack(() => data.createForm), { validators: ${clientAdapter}(createCapabilityRecordSchema) });
  const updateState = superForm(untrack(() => data.updateForm), { validators: ${clientAdapter}(updateCapabilityRecordSchema) });
  const { form: createForm, errors: createErrors } = createState;
  const { form: updateForm, errors: updateErrors } = updateState;
  let records = $state<CapabilityRecordData[]>(untrack(() => data.records));
  let pending = $state(false);
  let feedback = $state('');
  let failure = $state('');
  let editing = $state<number | null>(null);
  let deleting = $state<number | null>(null);

  async function refresh() {
    const response = await apiFetch('${fixtureApi}', { showToast: false });
    if (!response.ok) throw new Error('Unable to reload records.');
    const body = await response.json();
    records = ${parseRecords};
  }
  async function mutate(method: 'POST' | 'PUT' | 'DELETE', id: number | null, body?: unknown) {
    if (pending) return;
    pending = true; feedback = ''; failure = '';
    try {
      const response = await apiFetch('${fixtureApi}' + (id === null ? '' : '/' + id), {
        method, showToast: false, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (!response.ok) {
        failure = response.status === 403 ? 'You do not have permission for this command.' : 'Unable to save. Please try again.';
        return;
      }
      await refresh();
      feedback = method === 'POST' ? 'Record created.' : method === 'PUT' ? 'Record updated.' : 'Record deleted.';
      if (method === 'POST') createState.reset();
      editing = null; deleting = null;
    } catch { failure = 'The request could not be completed.'; }
    finally { pending = false; }
  }
  async function create(event: SubmitEvent) {
    event.preventDefault();
    if (pending || !access.can('action.capability-proof.create')) return;
    const form = await createState.validateForm({ update: true });
    if (form.valid) await mutate('POST', null, form.data);
  }
  async function update(event: SubmitEvent) {
    event.preventDefault();
    if (pending || editing === null || !access.can('action.capability-proof.update')) return;
    const form = await updateState.validateForm({ update: true });
    if (form.valid) await mutate('PUT', editing, form.data);
  }
</script>

<main data-testid="capability-screen" data-ready="true" aria-busy={pending} class="mx-auto max-w-3xl space-y-6 p-4">
  <h1 class="text-2xl font-semibold">Capability records</h1>
  {#if access.can('action.capability-proof.create')}
    <form onsubmit={create} class="space-y-2">
      <Label for="record-title">Title</Label>
      <Input id="record-title" name="title" bind:value={$createForm.title} disabled={pending} aria-invalid={$createErrors.title ? 'true' : undefined} />
      {#if $createErrors.title}<p data-testid="title-error" class="text-sm text-red-700">{$createErrors.title[0]}</p>{/if}
      <Button type="submit" data-capability-action="create" disabled={pending}><Plus size={16} />{pending ? 'Saving...' : 'Create record'}</Button>
    </form>
  {/if}
  {#if feedback}<p role="status" data-testid="feedback">{feedback}</p>{/if}
  {#if failure}<p role="alert">{failure}</p>{/if}
  <ul class="divide-y">
    {#each records as record (record.id)}
      <li data-record-id={record.id} class="flex min-w-0 flex-wrap items-center justify-between gap-3 py-3">
        <span data-testid="record-title" class="min-w-0 break-words">{record.title}</span>
        <div class="flex flex-wrap gap-2">
          {#if access.can('action.capability-proof.update')}
            <Button type="button" variant="outline" data-capability-action="update" disabled={pending} onclick={() => { editing = record.id; $updateForm.title = record.title; }}><Pencil size={16} />Edit</Button>
          {/if}
          {#if access.can('action.capability-proof.delete')}
            <Button type="button" variant="destructive" data-capability-action="delete" disabled={pending} onclick={() => { deleting = record.id; }}><Trash2 size={16} />Delete</Button>
          {/if}
        </div>
      </li>
    {:else}<li>No records.</li>{/each}
  </ul>
  {#if editing !== null && access.can('action.capability-proof.update')}
    <form onsubmit={update} class="space-y-2">
      <Label for="update-title">Updated title</Label>
      <Input id="update-title" bind:value={$updateForm.title} disabled={pending} aria-invalid={$updateErrors.title ? 'true' : undefined} />
      {#if $updateErrors.title}<p class="text-sm text-red-700">{$updateErrors.title[0]}</p>{/if}
      <Button type="submit" data-testid="save-update" disabled={pending}>Save</Button>
      <Button type="button" variant="outline" disabled={pending} onclick={() => { editing = null; }}>Cancel</Button>
    </form>
  {/if}
  {#if deleting !== null && access.can('action.capability-proof.delete')}
    <div role="alertdialog" tabindex="-1" aria-labelledby="delete-title" class="space-y-3 border-t pt-4">
      <h2 id="delete-title" class="text-lg font-semibold">Delete this record?</h2>
      <Button type="button" variant="destructive" data-testid="confirm-delete" disabled={pending} onclick={() => { if (deleting !== null) void mutate('DELETE', deleting); }}>Delete record</Button>
      <Button type="button" variant="outline" data-testid="cancel-delete" disabled={pending} onclick={() => { deleting = null; }}>Cancel</Button>
    </div>
  {/if}
</main>
` },
  ];
}

async function binary(require, name, command = name) {
  const manifestPath = require.resolve(`${name}/package.json`);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[command];
  if (!bin) throw new Error(`Missing installed ${command} executable.`);
  return resolve(dirname(manifestPath), bin);
}

async function hashes(directory, prefix = '') {
  const result = {};
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    const relative = join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Source fixture must not contain symlinks.');
    if (entry.isDirectory()) Object.assign(result, await hashes(directory, relative));
    else result[relative] = createHash('sha256').update(await readFile(join(directory, relative))).digest('hex');
  }
  return result;
}

async function freePort() {
  const server = createServer();
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const port = server.address().port;
  await new Promise((done, reject) => server.close(error => error ? reject(error) : done()));
  if ([5330, 5798].includes(port)) return freePort();
  return port;
}

export async function prepareCapabilityFixture(options, report, signal) {
  const source = await realpath(dirname(options.clients));
  const require = createRequire(join(source, 'package.json'));
  const packagePath = await realpath(require.resolve('@beeblock/svelar/package.json'));
  if (!packagePath.startsWith(join(source, 'node_modules/@beeblock/svelar/'))) throw new Error('Core must be physically installed, not a workspace/source alias.');
  const artifact = await lockedArtifact(source, JSON.parse(await readFile(join(source, 'package-lock.json'), 'utf8')), options.expectedSha256);
  const identity = capabilityReceiptIdentity(packagePath, JSON.parse(await readFile(packagePath, 'utf8')), artifact);
  const cli = await binary(require, '@beeblock/svelar', 'svelar');
  const owner = randomUUID();
  const directory = join(applications, 'svelar-capability-absence-' + owner);
  const port = await freePort();
  const base = { ...process.env };
  for (const key of Object.keys(base)) if (/^(AUTH_|SESSION_|CAPABILITY_PROOF_)/.test(key)) delete base[key];
  const env = { ...fixtureEnvironment(base, directory, port), CAPABILITY_PROOF_OWNER: owner,
    CAPABILITY_PROOF_PASSWORD: randomBytes(24).toString('base64url'),
    CAPABILITY_PROOF_READER_EMAIL: `reader-${owner}@example.test`, CAPABILITY_PROOF_WRITER_EMAIL: `writer-${owner}@example.test` };
  const transcript = [];
  const run = async (label, args) => {
    transcript.push(label);
    try {
      const result = await runCommand(process.execPath, args, { cwd: directory, env, signal, timeoutMs: 180000 });
      await writeEvidence(report, `${label}.log`, result.stdout + result.stderr);
      return result;
    } catch (error) { await writeEvidence(report, `${label}.log`, (error.stdout ?? '') + (error.stderr ?? '') + '\n' + error.message); throw error; }
    finally { await writeEvidence(report, 'commands.json', transcript); }
  };
  await mkdir(applications, { recursive: true });
  await writeEvidence(report, 'ownership.json', { owner, directory, port, source, expectedCoreSha256: options.expectedSha256 ?? null, ...identity });
  const scaffold = generatorCommands(directory, options.validation);
  transcript.push('generator-0');
  const created = await runCommand(process.execPath, [cli, ...scaffold[0]], { cwd: applications, env, signal, timeoutMs: 30000 });
  await writeEvidence(report, 'generator-0.log', created.stdout + created.stderr);
  await writeEvidence(report, 'generator-commands.json', scaffold);
  await symlink(join(source, 'node_modules'), join(directory, 'node_modules'));
  for (const [index, args] of scaffold.slice(1).entries()) await run(`generator-${index + 1}`, [cli, ...args]);
  const generated = await hashes(join(directory, 'src'));
  await writeEvidence(report, 'cli-generated-sources.json', generated);
  await cp(join(source, 'src/lib/components/ui'), join(directory, 'src/lib/components/ui'), { recursive: true });
  await cp(join(source, 'src/lib/hooks/is-mobile.svelte.ts'), join(directory, 'src/lib/hooks/is-mobile.svelte.ts'));
  for (const file of capabilityFixtureFiles(options.validation)) {
    await mkdir(dirname(join(directory, file.path)), { recursive: true });
    await writeFile(join(directory, file.path), file.content);
  }
  const packageJson = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  packageJson.dependencies['@beeblock/svelar'] = 'file:' + artifact.path;
  await writeFile(join(directory, 'package.json'), JSON.stringify(packageJson, null, 2) + '\n');
  await writeFile(join(directory, '.env'), Object.entries(env).filter(([key]) => /^(APP_|INTERNAL_|DB_|QUEUE_|CACHE_|MAIL_|LOG_|BROADCAST_|SESSION_|CAPABILITY_PROOF_)/.test(key))
    .map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600 });
  const evidence = { ...identity, status: 'prepared-not-certified', directory, port, validation: options.validation,
    expectedCoreSha256: options.expectedSha256 ?? null,
    testOwnedFiles: capabilityFixtureFiles(options.validation).map(file => file.path), generatedSources: generated,
    acceptance: { readerButtons: 'DOM count exactly zero, including hidden/disabled nodes', writerButtons: 'DOM count greater than zero',
      mutations: ['POST create', 'PUT update', 'DELETE destroy'], csrf: 'Valid same-session cookie/header; missing CSRF negative control',
      persistence: 'Complete ORM table snapshot unchanged after each denied mutation', viewports: ['1440x1000', '390x844'] },
    notClaimed: ['Automatic generated CRUD frontend', 'Operations console must hide its intentionally disabled controls', 'Browser/type/build success before --certify'] };
  await writeEvidence(report, 'preparation.json', evidence);
  await writeFile(join(directory, 'CAPABILITY-PROOF-TIMELINE.md'), '# Capability Absence Fixture\n\n' + identity.label + '\n\n1. CLI new --no-install and capability-protected entity/routes.\n2. CLI seed/factories/state-command, then test-owned implementations and frontend.\n3. Prepared only. No typecheck, build, migrations, seed or browser proof yet.\n');
  return { directory, env, port, run, cli, require, evidence };
}

export async function certifyCapabilityAbsence(options) {
  const report = join(options.reportDir, new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID());
  await mkdir(report, { recursive: true, mode: 0o700 });
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(new Error('Capability acceptance exceeded 10 minutes.')), 600000);
  const interrupt = () => controller.abort(new Error('Capability acceptance interrupted.'));
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  let fixture; let server; let failure;
  const sessions = new Set(); const checks = [];
  const receipt = { label: receiptLabel, status: 'preparing', report, checks, plannedChecks: 12, skipped: options.certify ? 0 : null };
  try {
    fixture = await prepareCapabilityFixture(options, report, controller.signal);
    receipt.fixture = fixture.directory; receipt.label = fixture.evidence.label; receipt.installed = fixture.evidence.installed;
    receipt.expectedCoreSha256 = fixture.evidence.expectedCoreSha256;
    if (!options.certify) { receipt.status = 'prepared-not-certified'; return receipt; }
    await fixture.run('sync', [await binary(fixture.require, '@sveltejs/kit', 'svelte-kit'), 'sync']);
    await fixture.run('typecheck', [await binary(fixture.require, 'svelte-check'), '--tsconfig', './tsconfig.json', '--fail-on-warnings']);
    await fixture.run('architecture', [fixture.cli, 'lint:architecture']);
    await fixture.run('migrate', [fixture.cli, 'migrate']);
    await fixture.run('seed', [fixture.cli, 'seed:run', '--class=CapabilityAbsenceSeeder']);
    await fixture.run('build', [await binary(fixture.require, 'vite'), 'build']);
    let stateRead = 0;
    const state = async () => {
      const output = await fixture.run('state-' + ++stateRead, [fixture.cli, 'app:capability-state']);
      const line = output.stdout.split('\n').find(value => value.startsWith('CAPABILITY_STATE:'));
      assert.ok(line, 'Read-only CLI state receipt missing.');
      return JSON.parse(line.slice('CAPABILITY_STATE:'.length));
    };
    server = managedProcess(process.execPath, ['build/index.js'], { cwd: fixture.directory, env: fixture.env });
    await waitUntil(async () => {
      controller.signal.throwIfAborted();
      if (server.settled) throw new Error('Owned fixture server exited: ' + server.output);
      if (!server.output.includes(`Listening on http://127.0.0.1:${fixture.port}`)) return false;
      return (await fetch(`http://127.0.0.1:${fixture.port}/login`, { signal: AbortSignal.timeout(2000) })).ok;
    });
    await runCommand('agent-browser', ['skills', 'get', 'core'], { timeoutMs: 15000, signal: controller.signal });
    const browserLog = [];
    const browser = async (session, ...args) => {
      sessions.add(session);
      const safeArgs = args[0] === 'eval' ? ['eval', '(browser assertion)'] :
        args[0] === 'fill' && args[1].includes('password') ? ['fill', args[1], '[REDACTED]'] : args;
      const command = `${session}: ${safeArgs.join(' ')}`;
      browserLog.push(command);
      await writeEvidence(report, 'browser-commands.log', browserLog.join('\n'));
      try {
        const result = await runCommand('agent-browser', ['--session', session, '--json', ...args], {
          cwd: fixture.directory, env: { ...fixture.env, AGENT_BROWSER_ALLOWED_DOMAINS: '127.0.0.1', AGENT_BROWSER_DEFAULT_TIMEOUT: '10000' },
          timeoutMs: 45000, signal: controller.signal });
        const parsed = JSON.parse(result.stdout);
        assert.equal(parsed.success, true, 'Browser command failed.');
        return parsed.data;
      } catch (error) { error.browserCommand = command; throw error; }
    };
    const evaluate = async (session, expression) => (await browser(session, 'eval', '-b', Buffer.from(expression).toString('base64'))).result;
    const presentation = session => evaluate(session, `({ready:!!document.querySelector('[data-testid="capability-screen"][data-ready="true"]'),
      records:document.querySelectorAll('[data-record-id]').length,
      buttons:Object.fromEntries(${JSON.stringify(commands)}.map(action=>[action,document.querySelectorAll('[data-capability-action="'+action+'"]').length])),
      documentWidth:document.documentElement.scrollWidth,viewportWidth:innerWidth})`);
    const base = `http://127.0.0.1:${fixture.port}`;
    const reader = 'svelar-capability-reader-' + randomUUID(), writer = 'svelar-capability-writer-' + randomUUID();
    for (const [session, email] of [[reader, fixture.env.CAPABILITY_PROOF_READER_EMAIL], [writer, fixture.env.CAPABILITY_PROOF_WRITER_EMAIL]]) {
      await browser(session, 'open', base + '/login');
      await browser(session, 'fill', 'input[name=email]', email);
      await browser(session, 'fill', 'input[name=password]', fixture.env.CAPABILITY_PROOF_PASSWORD);
      await browser(session, 'find', 'role', 'button', 'click', '--name', 'Sign In');
      await browser(session, 'wait', '--fn', 'location.pathname === "/dashboard"');
      await browser(session, 'open', base + fixturePage);
      await browser(session, 'wait', '--fn', '!!document.querySelector("[data-testid=capability-screen]")');
    }
    for (const [width, height] of [[1440, 1000], [390, 844]]) {
      for (const [session, privileged] of [[reader, false], [writer, true]]) {
        await browser(session, 'set', 'viewport', String(width), String(height));
        const actual = await presentation(session); assertActionPresentation(actual, privileged);
        checks.push({ name: `${privileged ? 'writer' : 'reader'}-${width}-presentation`, ...actual });
        await browser(session, 'screenshot', join(report, `${privileged ? 'writer' : 'reader'}-${width}.png`));
      }
    }
    const original = await state(); assert.equal(original.length, 1);
    const snapshot = createHash('sha256').update(JSON.stringify(original)).digest('hex');
    for (const [method, path, payload] of [['POST', fixtureApi, { title: 'Unauthorized create' }],
      ['PUT', fixtureApi + '/' + original[0].id, { title: 'Unauthorized update' }], ['DELETE', fixtureApi + '/' + original[0].id, undefined]]) {
      const result = await evaluate(reader, `(async()=>{const cookie=document.cookie.split('; ').find(x=>x.startsWith('XSRF-TOKEN='));
        if(!cookie) throw new Error('Missing same-session CSRF cookie');
        const response=await fetch(${JSON.stringify(path)},{method:${JSON.stringify(method)},headers:{'Content-Type':'application/json','X-CSRF-Token':decodeURIComponent(cookie.slice(11))},
          ${payload ? 'body:' + JSON.stringify(JSON.stringify(payload)) + ',' : ''}credentials:'same-origin'});
        return {status:response.status,body:await response.json()}})()`);
      assert.equal(result.status, 403, 'Authenticated valid-CSRF write must be forbidden, not 401/419/404.');
      assert.deepEqual(await state(), original, 'Denied write changed persisted attributes or timestamps.');
      checks.push({ name: `reader-${method}-403-unchanged`, status: result.status, unchangedTableSha256: snapshot });
    }
    const noCsrf = await evaluate(writer, `(async()=>{const response=await fetch('${fixtureApi}',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"title":"Missing CSRF"}'});return response.status})()`);
    assert.equal(noCsrf, 419, 'Granted users still require CSRF.'); assert.deepEqual(await state(), original);
    checks.push({ name: 'writer-missing-csrf-rejected', status: noCsrf });
    // Generated string rules allow empty values; exercise a type violation without changing those rules.
    const invalid = await evaluate(writer, `(async()=>{const cookie=document.cookie.split('; ').find(x=>x.startsWith('XSRF-TOKEN='));
      if(!cookie) throw new Error('Missing same-session CSRF cookie');
      const response=await fetch('${fixtureApi}',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':decodeURIComponent(cookie.slice(11))},body:'{"title":123}'});
      return {status:response.status,body:await response.json()}})()`);
    assert.equal(invalid.status, 422, 'A granted valid-CSRF request with a real schema type violation must fail validation.');
    assert.ok(Array.isArray(invalid.body.errors?.title) && invalid.body.errors.title.length > 0, 'The generated FormRequest must identify the invalid title field.');
    assert.deepEqual(await state(), original);
    checks.push({ name: 'generated-shared-schema-invalid-type-422-unchanged', status: invalid.status, validationFields: Object.keys(invalid.body.errors), unchangedTableSha256: snapshot });
    await evaluate(writer, `(()=>{window.__capabilityBusy={seen:false,disabled:false};
      const screen=document.querySelector('[data-testid=capability-screen]');
      const observer=new MutationObserver(()=>{if(screen.getAttribute('aria-busy')==='true'){
        window.__capabilityBusy.seen=true;window.__capabilityBusy.disabled=document.querySelector('[data-capability-action=create]').disabled}});
      observer.observe(screen,{attributes:true,attributeFilter:['aria-busy']});window.__capabilityBusyObserver=observer})()`);
    await browser(writer, 'fill', '#record-title', 'Granted create');
    await browser(writer, 'click', '[data-capability-action=create]');
    await browser(writer, 'wait', '--fn', 'document.querySelector("[data-testid=feedback]")?.textContent === "Record created."');
    const created = await state(); assert.equal(created.length, 2); assert.ok(created.some(record => record.title === 'Granted create'));
    assert.equal(await evaluate(writer, 'document.querySelector("#record-title").value'), '');
    const busy = await evaluate(writer, '(()=>{window.__capabilityBusyObserver.disconnect();return window.__capabilityBusy})()');
    assert.deepEqual(busy, { seen: true, disabled: true }, 'An actual command must expose loading and disable duplicate submission.');
    checks.push({ name: 'writer-create-persisted-loading-feedback-reset', busy });
    await browser(writer, 'click', `[data-record-id="${original[0].id}"] [data-capability-action=update]`);
    await browser(writer, 'fill', '#update-title', 'Granted update');
    await browser(writer, 'click', '[data-testid=save-update]');
    await browser(writer, 'wait', '--fn', 'document.querySelector("[data-testid=feedback]")?.textContent === "Record updated."');
    const updated = await state(); assert.equal(updated.find(record => record.id === original[0].id)?.title, 'Granted update');
    checks.push({ name: 'writer-update-persisted-feedback' });
    await browser(writer, 'click', `[data-record-id="${original[0].id}"] [data-capability-action=delete]`);
    await browser(writer, 'click', '[data-testid=cancel-delete]'); assert.deepEqual(await state(), updated);
    await browser(writer, 'click', `[data-record-id="${original[0].id}"] [data-capability-action=delete]`);
    await browser(writer, 'click', '[data-testid=confirm-delete]');
    await browser(writer, 'wait', '--fn', 'document.querySelector("[data-testid=feedback]")?.textContent === "Record deleted."');
    const deleted = await state(); assert.equal(deleted.length, 1); assert.equal(deleted.some(record => record.id === original[0].id), false);
    checks.push({ name: 'writer-delete-confirm-cancel-persisted-feedback' });
    for (const session of [reader, writer]) {
      const errors = await browser(session, 'errors'); assert.deepEqual(errors.errors, []);
    }
    assert.equal(checks.length, 12, 'Every planned acceptance check must execute.');
    receipt.status = 'passed';
    await writeFile(join(fixture.directory, 'CAPABILITY-PROOF-TIMELINE.md'), '# Capability Absence Fixture\n\n' + receipt.label + '\n\nCLI scaffold -> shared-schema frontend -> typecheck/architecture -> migrate/seeder -> production build -> desktop/mobile DOM checks -> valid-CSRF forbidden writes + unchanged DB -> granted CRUD.\n\nEvidence: ' + report + '\n');
  } catch (error) { failure = error; receipt.status = 'failed'; await writeEvidence(report, 'failure.json', { message: error.message, stack: error.stack, browserCommand: error.browserCommand, stdout: error.stdout, stderr: error.stderr }); }
  finally {
    const cleanupErrors = [];
    for (const session of sessions) {
      if (failure) {
        try {
          const snapshot = await runCommand('agent-browser', ['--session', session, 'snapshot'], { timeoutMs: 15000 });
          await writeEvidence(report, `${session}.snapshot.log`, snapshot.stdout + snapshot.stderr);
          await runCommand('agent-browser', ['--session', session, 'screenshot', join(report, `${session}.failure.png`)], { timeoutMs: 15000 });
        } catch {}
      }
      try { await runCommand('agent-browser', ['--session', session, 'close'], { timeoutMs: 15000 }); } catch (error) { cleanupErrors.push(error); }
    }
    if (server) {
      try { await stopManagedProcess(server); } catch (error) { cleanupErrors.push(error); }
      await writeEvidence(report, 'server.log', server.output);
    }
    clearTimeout(deadline); process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
    receipt.cleanup = cleanupErrors.length ? 'failed' : 'owned-processes-stopped-fixture-and-evidence-preserved';
    if (cleanupErrors.length) { failure = new AggregateError(failure ? [failure, ...cleanupErrors] : cleanupErrors, 'Capability acceptance cleanup failed.'); receipt.status = 'failed'; }
    await writeEvidence(report, 'receipt.json', receipt);
  }
  if (failure) { failure.reportDirectory = report; throw failure; }
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === script) {
  const options = parseCapabilityOptions(process.argv.slice(2));
  if (options.help) console.log('Usage: node scripts/capability-absence-certification.mjs [--clients=/installed/app/package.json] [--expected-core-sha256=<64-hex>] [--validation=zod|valibot] [--report-dir=/artifacts] [--certify]\nAlways verifies the physical client lockfile tarball integrity and derives the installed version/SHA. The optional expected SHA pins an additional immutable artifact identity. Default: lightweight CLI source preparation only. --certify explicitly enables isolated typecheck/build/migrations/browser gates. No installs, core builds/packs, existing-app mutations or operations UX changes.');
  else certifyCapabilityAbsence(options).then(receipt => console.log(JSON.stringify(receipt))).catch(error => {
    console.error(redactEvidence(error.message)); if (error.reportDirectory) console.error('Preserved capability evidence: ' + error.reportDirectory); process.exitCode = 1;
  });
}
