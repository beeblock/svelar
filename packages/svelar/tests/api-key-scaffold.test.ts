import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import { compile } from 'svelte/compiler';
import * as svelteServer from 'svelte/internal/server';
import { render } from 'svelte/server';
import { get, writable } from 'svelte/store';
import * as kit from '@sveltejs/kit';
import * as superforms from 'sveltekit-superforms/server';
import * as adapters from 'sveltekit-superforms/adapters';
import type { ClientValidationAdapter } from 'sveltekit-superforms/adapters';
import { z } from 'zod';
import * as v from 'valibot';
import { Action } from '../src/actions/index.js';
import { ApiKeys, type ApiKeyRecord } from '../src/api-keys/index.js';
import { Cache } from '../src/cache/index.js';
import { NewCommandTemplates as T, type ValidationProvider } from '../src/cli/commands/NewCommandTemplates.js';
import { Connection } from '../src/database/Connection.js';
import { svelarCoreMigrations } from '../src/database/CoreMigrations.js';
import { Migrator } from '../src/database/Migration.js';
import { FormRequest } from '../src/routing/FormRequest.js';
import { ApplicationContext } from '../src/support/Context.js';

type CreateDto = { name: string; permissions: string[] };
type RevokeDto = { keyId: string };
type TestUser = { id: number; name: string; email: string };
type TestEvent = { request: Request; url: URL; locals: { user: TestUser | null } };
type KeyForm = {
  id: string;
  valid: boolean;
  posted: boolean;
  data: Record<string, string>;
  errors: Record<string, string[]>;
  message?: string;
};
type Payload = {
  data: { plainTextKey?: string; keyId?: string; revoked?: boolean } | null;
  meta: { form: KeyForm; message?: string | null };
  createKeyForm?: KeyForm;
  revokeKeyForm?: KeyForm;
};
type PageData = {
  user: TestUser;
  apiKeys: Array<Pick<ApiKeyRecord, 'id' | 'name' | 'prefix' | 'permissions' | 'createdAt' | 'lastUsedAt'>>;
  createKeyForm: KeyForm;
  revokeKeyForm: KeyForm;
  loadError: string | null;
};
type PageModule = {
  load(event: TestEvent): Promise<PageData>;
  actions: Record<'create' | 'revoke', (event: TestEvent) => Promise<Payload | kit.ActionFailure<Payload>>>;
};
type Dtos = {
  CreateApiKeyDto: { from(input: { name: string; permissions: string }): CreateDto };
  RevokeApiKeyDto: { from(input: RevokeDto): RevokeDto };
};
type KeyActions = {
  CreateApiKeyAction: new () => Action<{ userId: string | number; dto: CreateDto }, { plainTextKey: string; record: ApiKeyRecord }>;
  RevokeApiKeyAction: new () => Action<{ userId: string | number; dto: RevokeDto }, boolean>;
};

function evaluate<T>(source: string, dependencies: Record<string, unknown>): T {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  expect(compiled.diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)).toEqual([]);
  const module = { exports: {} };
  new Function('exports', 'require', 'module', compiled.outputText)(module.exports, (id: string) => {
    if (!(id in dependencies)) throw new Error(`Unbound generated import: ${id}`);
    return dependencies[id];
  }, module);
  return module.exports as T;
}

let nextUserId = 91000;
function harness(provider: ValidationProvider) {
  const dependencies: Record<string, unknown> = {
    '@beeblock/svelar/validation': { z },
    '@beeblock/svelar/validation/valibot': { v },
    valibot: v,
    '@beeblock/svelar/forms': { FormRequest },
    '@beeblock/svelar/actions': { Action },
    '@beeblock/svelar/api-keys': { ApiKeys },
    '@sveltejs/kit': kit,
    'sveltekit-superforms': superforms,
    'sveltekit-superforms/adapters': adapters,
  };
  dependencies['./api-key.schema.js'] = evaluate(T.apiKeySchema(provider), dependencies);
  const dtos = evaluate<Dtos>(T.apiKeyDtos(), dependencies);
  dependencies['./ApiKeyDtos.js'] = dtos;
  dependencies['$lib/modules/api-keys/ApiKeyRequests.js'] = evaluate(T.apiKeyRequests(), dependencies);
  const actions = evaluate<KeyActions>(T.apiKeyActions(), dependencies);
  dependencies['$lib/modules/api-keys/ApiKeyActions.js'] = actions;
  const page = evaluate<PageModule>(T.applyValidationProvider(T.apiKeysPageServer(), provider), dependencies);
  const user = (): TestUser => ({ id: ++nextUserId, name: 'Key owner', email: `user-${nextUserId}@example.com` });
  const event = (actor: TestUser | null, fields: Record<string, string> = {}): TestEvent => {
    const url = new URL('https://app.example/api-keys');
    return { url, locals: { user: actor }, request: new Request(url, { method: 'POST', body: new URLSearchParams(fields) }) };
  };
  return { page, actions, dtos, user, event };
}

function payload(result: Payload | kit.ActionFailure<Payload>): Payload {
  return 'status' in result ? result.data : result;
}

beforeEach(async () => {
  ApiKeys.configure({ driver: 'memory', prefix: 'sk_scaffold_' });
  Cache.configure({ default: 'memory', stores: { memory: { driver: 'memory' } } });
  await Cache.flush();
  ApplicationContext.clear();
});

afterEach(async () => {
  vi.restoreAllMocks();
  ApiKeys.configure({ driver: 'memory', prefix: 'sk_' });
  await Cache.flush();
  ApplicationContext.clear();
});

describe.each<ValidationProvider>(['zod', 'valibot'])('API-key scaffold (%s)', (provider) => {
  it('executes generated typed actions and requires the owner to revoke', async () => {
    const h = harness(provider);
    const owner = h.user();
    const other = h.user();
    const result = await new h.actions.CreateApiKeyAction().run({ userId: owner.id, dto: h.dtos.CreateApiKeyDto.from({ name: 'Deploy key', permissions: 'read, write' }) });
    expect(result.record).toMatchObject({ userId: owner.id, name: 'Deploy key', permissions: ['read', 'write'] });
    expect(result.record.key).not.toBe(result.plainTextKey);
    const revoke = new h.actions.RevokeApiKeyAction();
    const dto = h.dtos.RevokeApiKeyDto.from({ keyId: result.record.id });
    await expect(revoke.run({ userId: other.id, dto })).resolves.toBe(false);
    await expect(ApiKeys.validate(result.plainTextKey)).resolves.toMatchObject({ id: result.record.id });
    await expect(revoke.run({ userId: owner.id, dto })).resolves.toBe(true);
    await expect(ApiKeys.validate(result.plainTextKey)).resolves.toBeNull();
    await expect(revoke.run({ userId: owner.id, dto })).resolves.toBe(false);
    expect(T.apiKeyActions()).toContain('record: ApiKeyRecord');
    expect(T.apiKeyActions()).not.toMatch(/\bany\b|ApiKeys\.revoke\(/);
  });

  it.each(['memory', 'database'] as const)('denies a forged direct POST and keeps the foreign key active (%s)', async (driver) => {
    const h = harness(provider);
    const owner = h.user();
    const attacker = h.user();
    let root: string | undefined;
    try {
      if (driver === 'database') {
        root = await mkdtemp(join(tmpdir(), 'svelar-api-key-scaffold-'));
        await Connection.disconnect();
        Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: join(root, 'database.sqlite') } } });
        await new Migrator().fresh(svelarCoreMigrations());
        ApiKeys.configure({ driver: 'database', prefix: 'sk_scaffold_' });
      }
      const foreign = await ApiKeys.create({ name: 'Foreign key', userId: owner.id });
      const revoke = vi.spyOn(ApiKeys, 'revokeForUser');
      const denied = await h.page.actions.revoke(h.event(attacker, { keyId: foreign.record.id, userId: String(owner.id) }));
      expect(denied).toMatchObject({ status: 403, data: { data: null, meta: { message: 'This API key cannot be revoked.' } } });
      const deniedPayload = payload(denied);
      expect(deniedPayload.meta.form).toBe(deniedPayload.revokeKeyForm);
      expect(deniedPayload.meta.form.data).toEqual({ keyId: foreign.record.id });
      expect(revoke).toHaveBeenCalledWith(foreign.record.id, attacker.id);
      await expect(ApiKeys.validate(foreign.plainTextKey)).resolves.toMatchObject({ id: foreign.record.id });
      const missing = await h.page.actions.revoke(h.event(attacker, { keyId: 'missing-key' }));
      expect(missing).toMatchObject({ status: 403 });
      expect(payload(missing).meta.message).toBe(deniedPayload.meta.message);
      const allowed = await h.page.actions.revoke(h.event(owner, { keyId: foreign.record.id, userId: String(attacker.id) }));
      expect(allowed).toMatchObject({ data: { revoked: true, keyId: foreign.record.id }, meta: { message: 'API key revoked.' } });
      expect(payload(allowed).meta.form).toBe(payload(allowed).revokeKeyForm);
      await expect(ApiKeys.validate(foreign.plainTextKey)).resolves.toBeNull();
      expect(await h.page.actions.revoke(h.event(owner, { keyId: foreign.record.id }))).toMatchObject({ status: 403 });
    } finally {
      if (root) {
        await Connection.disconnect();
        await rm(root, { recursive: true, force: true });
      }
    }
  });

  it('creates for locals only and never includes the stored hash in page responses', async () => {
    const h = harness(provider);
    const owner = h.user();
    const other = h.user();
    const result = await h.page.actions.create(h.event(owner, { name: 'My key', permissions: 'read', userId: String(other.id) }));
    const body = payload(result);
    expect(body.meta.form).toBe(body.createKeyForm);
    expect(body.data?.plainTextKey).toMatch(/^sk_scaffold_/);
    expect(body.meta.message).toBe('API key created.');
    const record = await ApiKeys.validate(body.data!.plainTextKey!);
    expect(record?.userId).toBe(owner.id);
    const loaded = await h.page.load(h.event(owner));
    expect(loaded.apiKeys.map((key) => key.id)).toContain(record?.id);
    expect(JSON.stringify(result)).not.toContain(record!.key);
    expect(JSON.stringify(loaded)).not.toContain(record!.key);
    expect(JSON.stringify(loaded)).not.toContain(body.data!.plainTextKey!);
  });

  it.each(['create', 'revoke'] as const)('returns authorization and validation failures with the matching form (%s)', async (name) => {
    const h = harness(provider);
    const create = vi.spyOn(ApiKeys, 'create');
    const revoke = vi.spyOn(ApiKeys, 'revokeForUser');
    const denied = await h.page.actions[name](h.event(null, { name: 'My key', permissions: 'read', keyId: 'key-id' }));
    expect(denied).toMatchObject({ status: 403, data: { data: null, meta: { message: 'This action is unauthorized.' } } });
    const invalid = await h.page.actions[name](h.event(h.user()));
    expect(invalid).toMatchObject({ status: 422 });
    for (const result of [denied, invalid]) {
      const body = payload(result);
      expect(body.meta.form).toBe(name === 'create' ? body.createKeyForm : body.revokeKeyForm);
    }
    expect(create).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
  });

  it.each(['create', 'revoke'] as const)('keeps service failure feedback generic and preserves the form (%s)', async (name) => {
    const h = harness(provider);
    vi.spyOn(ApiKeys, name === 'create' ? 'create' : 'revokeForUser').mockRejectedValueOnce(new Error('SQL credentials secret-sentinel'));
    const result = await h.page.actions[name](h.event(h.user(), { name: 'My key', permissions: 'read', keyId: 'key-id' }));
    expect(result).toMatchObject({ status: 503, data: { data: null } });
    const body = payload(result);
    expect(body.meta.form).toBe(name === 'create' ? body.createKeyForm : body.revokeKeyForm);
    expect(body.meta.message).toContain('Please try again.');
    expect(JSON.stringify(result)).not.toMatch(/SQL|credentials|secret-sentinel/);
  });

  it('redirects null users before reading keys and does not turn unavailable data into an empty success', async () => {
    const h = harness(provider);
    const list = vi.spyOn(ApiKeys, 'listForUser');
    await expect(h.page.load(h.event(null))).rejects.toMatchObject({ status: 302, location: '/login' });
    expect(list).not.toHaveBeenCalled();
    list.mockRejectedValueOnce(new Error('connection secret-sentinel'));
    const result = await h.page.load(h.event(h.user()));
    expect(result.loadError).toContain('temporarily unavailable');
    expect(JSON.stringify(result)).not.toContain('secret-sentinel');
  });
});

type EnhancedResult = { type: 'success' | 'failure' | 'error'; data?: Payload };
type FormOptions = {
  validators: ClientValidationAdapter<Record<string, string>>;
  onSubmit?(input: { formData: FormData }): void;
  onResult(input: { result: EnhancedResult }): void;
  onError(): void;
};
type View = { generatedKey: string; feedback: string; failed: boolean; revoking: boolean; showCreateForm: boolean; keyId: string };
type ClientModule = {
  options: FormOptions[];
  view(): View;
};

function clientSchemas(provider: ValidationProvider) {
  return evaluate(T.apiKeySchema(provider), { '@beeblock/svelar/validation': { z }, valibot: v });
}

function clientScript(data: PageData, form?: Payload, provider: ValidationProvider = 'zod'): ClientModule {
  const source = T.applyValidationProvider(T.apiKeysPageSvelte(), provider);
  const script = source.slice(source.indexOf('>') + 1, source.indexOf('</script>'));
  const options: FormOptions[] = [];
  const runes = "import { props, identity } from './test-runes.js';\nimport { get } from 'svelte/store';\nconst $props = () => props;\nconst $state = identity;\nconst $derived = identity;\nconst $effect = () => {};\nconst $revokeKeyForm = props.form?.revokeKeyForm?.data ?? props.data.revokeKeyForm.data;\n";
  const module = evaluate<Omit<ClientModule, 'options'>>(runes + script + '\nexport function view() { return { generatedKey, feedback, failed, revoking: get(revoking), showCreateForm, keyId: $revokeKeyForm.keyId }; }\n', {
    './test-runes.js': { props: { data, form }, identity: <T>(value: T) => value },
    'svelte/store': { get },
    'sveltekit-superforms/adapters': adapters,
    '$lib/modules/api-keys/api-key.schema.js': clientSchemas(provider),
    'sveltekit-superforms': { superForm: (initial: KeyForm, value: FormOptions) => {
      options.push(value);
      return { form: writable(initial.data), errors: writable(initial.errors), submitting: writable(false) };
    } },
    '@beeblock/svelar/ui': {},
  });
  return { ...module, options };
}

function renderPage(data: PageData, form?: Payload, provider: ValidationProvider = 'zod'): string {
  const children = (renderer: unknown, props: { children?: (renderer: unknown) => void }) => props.children?.(renderer);
  const compiled = compile(T.applyValidationProvider(T.apiKeysPageSvelte(), provider), { generate: 'server', filename: 'api-keys-page.svelte' });
  const components = Object.fromEntries(['Button', 'Badge', 'Card', 'CardHeader', 'CardTitle', 'CardContent', 'Input', 'Label', 'Alert'].map((name) => [name, children]));
  const module = evaluate<{ default: Parameters<typeof render>[0] }>(compiled.js.code, {
    'svelte/internal/server': svelteServer,
    'sveltekit-superforms/adapters': adapters,
    '$lib/modules/api-keys/api-key.schema.js': clientSchemas(provider),
    'sveltekit-superforms': { superForm: (initial: KeyForm) => ({ form: writable(initial.data), errors: writable(initial.errors), submitting: writable(false) }) },
    '@beeblock/svelar/ui': components,
  });
  return render(module.default, { props: { data, form } }).body;
}

describe.each<ValidationProvider>(['zod', 'valibot'])('API-key page result rendering (%s)', (provider) => {
  it('keeps initial errors empty and validates both client forms with the backend contracts', async () => {
    const h = harness(provider);
    const owner = h.user();
    const data = await h.page.load(h.event(owner));
    expect(data.createKeyForm).toMatchObject({ posted: false, errors: {}, data: { name: '', permissions: 'read' } });
    expect(data.revokeKeyForm).toMatchObject({ posted: false, errors: {}, data: { keyId: '' } });
    const client = clientScript(data, undefined, provider);
    expect(client.options).toHaveLength(2);
    expect(client.options.every((options) => options.validators.superFormValidationLibrary === (provider === 'zod' ? 'zod4' : 'valibot'))).toBe(true);
    const invalid = await client.options[0].validators.validate({ name: '', permissions: 'read' });
    expect(invalid.success).toBe(false);
    const serverInvalid = payload(await h.page.actions.create(h.event(owner, { name: '', permissions: 'read' })));
    if (!invalid.success) expect(invalid.issues[0].message).toBe(serverInvalid.meta.form.errors.name[0]);
    await expect(client.options[0].validators.validate({ name: 'My key', permissions: 'read' })).resolves.toMatchObject({ success: true });
    await expect(client.options[1].validators.validate({ keyId: '' })).resolves.toMatchObject({ success: false });
    const formData = new FormData();
    formData.set('keyId', 'selected-key');
    client.options[1].onSubmit!({ formData });
    expect(client.view().keyId).toBe('selected-key');
    await expect(client.options[1].validators.validate({ keyId: client.view().keyId })).resolves.toMatchObject({ success: true });
    expect(T.apiKeysPageSvelte()).not.toContain('novalidate');
    expect(T.apiKeysPageSvelte()).toContain('disabled={$revoking}');
  });

  it('consumes enhanced creation and owner/foreign revoke results without leaking errors', async () => {
    const h = harness(provider);
    const owner = h.user();
    const attacker = h.user();
    const data = await h.page.load(h.event(owner));
    const client = clientScript(data, undefined, provider);
    const created = payload(await h.page.actions.create(h.event(owner, { name: 'New key', permissions: 'read' })));
    client.options[0].onResult({ result: { type: 'success', data: created } });
    expect(client.view()).toMatchObject({ generatedKey: created.data!.plainTextKey, feedback: 'API key created.', failed: false, showCreateForm: false });

    const denied = payload(await h.page.actions.revoke(h.event(attacker, { keyId: created.data!.keyId! })));
    client.options[1].onResult({ result: { type: 'failure', data: denied } });
    expect(client.view()).toMatchObject({ feedback: 'This API key cannot be revoked.', failed: true, revoking: false });
    await expect(ApiKeys.validate(created.data!.plainTextKey!)).resolves.toMatchObject({ id: created.data!.keyId });

    const allowed = payload(await h.page.actions.revoke(h.event(owner, { keyId: created.data!.keyId! })));
    client.options[1].onResult({ result: { type: 'success', data: allowed } });
    expect(client.view()).toMatchObject({ feedback: 'API key revoked.', failed: false, revoking: false });
    await expect(ApiKeys.validate(created.data!.plainTextKey!)).resolves.toBeNull();
    client.options[1].onError();
    expect(client.view()).toMatchObject({ feedback: 'Unable to revoke this API key right now. Please try again.', failed: true, revoking: false });
    client.options[0].onError();
    expect(client.view().feedback).toBe('Unable to create an API key right now. Please try again.');
  });

  it('renders a successful non-enhanced creation from data and an inline 403 from meta', async () => {
    const h = harness(provider);
    const owner = h.user();
    const data = await h.page.load(h.event(owner));
    const created = payload(await h.page.actions.create(h.event(owner, { name: 'New key', permissions: 'read' })));
    expect(renderPage(data, created, provider)).toContain(created.data!.plainTextKey);
    const denied = payload(await h.page.actions.revoke(h.event(owner, { keyId: 'missing-key' })));
    expect(renderPage(data, denied, provider)).toContain('This API key cannot be revoked.');
    expect(T.apiKeysPageSvelte()).not.toMatch(/actionData\.(?:plainTextKey|error)|\bany\b/);
  });
});
