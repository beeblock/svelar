import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';
import { v } from '../src/validation/valibot.js';
import { MakeEntityCommand } from '../src/cli/commands/MakeEntityCommand.js';
import { MakeResourceCommand } from '../src/cli/commands/MakeResourceCommand.js';
import { Connection } from '../src/database/Connection.js';
import { createRequestEvent } from '../src/testing/request.js';
import type { RequestEvent } from '../src/routing/Controller.js';

const fields = 'title:string,quantity:integer,total:number,active:boolean,dueAt:date,status:enum(draft,published),summary:text?,rating:number?,retries:integer?,visible:boolean?,archivedAt:date?,category:enum(normal,urgent)?';
const optionalFields = ['summary', 'rating', 'retries', 'visible', 'archivedAt', 'category'];
const dueAt = '2030-06-15T09:30:00.000Z';
const sourceRoot = resolve('src');
const packageRoot = process.cwd();

function validInput(): Record<string, unknown> {
  return { title: 'Invoice', quantity: 2, total: 12.5, active: false, dueAt, status: 'draft' };
}

function request(input: Record<string, unknown>, format: 'json' | 'form' = 'json', params: Record<string, string> = {}, authenticated = true): RequestEvent {
  const event = createRequestEvent({
    url: 'http://svelar.test/invoices', method: params.id ? 'PATCH' : 'POST', params,
    locals: authenticated ? { user: { id: 1 } } : {},
  });
  const body = format === 'json' ? JSON.stringify(input) : new URLSearchParams(
    Object.entries(input).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]),
  );
  event.request = new Request(event.url, {
    method: params.id ? 'PATCH' : 'POST',
    headers: { 'Content-Type': format === 'json' ? 'application/json' : 'application/x-www-form-urlencoded' },
    body,
  });
  return event;
}

function artifact(root: string, ddd: boolean, flat: string, layered: string, file: string): string {
  return join(root, 'src/lib', ddd ? `modules/billing/${layered}` : flat, file);
}

async function generate(root: string, validation: string, ddd: boolean, name = 'Invoice', crud = true): Promise<void> {
  await writeFile(join(root, 'svelar.validation.json'), JSON.stringify({ validation }));
  if (ddd) await mkdir(join(root, 'src/lib/modules'), { recursive: true });
  const cwd = process.cwd();
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    process.chdir(root);
    await new MakeEntityCommand().handle([name], { module: 'billing', fields: name === 'Invoice' ? fields : 'title:string', crud, controller: `${name}Api` });
    if (name === 'Invoice') {
      await new MakeResourceCommand().handle(['InvoiceSummary'], { module: 'billing', model: name, collection: true });
    }
  } finally {
    process.chdir(cwd);
    log.mockRestore();
  }
}

async function loadGenerated(root: string, ddd: boolean, name = 'Invoice') {
  const lower = name.toLowerCase();
  const modules = [
    artifact(root, ddd, 'schemas', 'contracts/schemas', `${lower}.schema.ts`),
    artifact(root, ddd, 'models', 'domain/models', `${name}.ts`),
    artifact(root, ddd, 'dtos', 'application/dto', `${name}Dtos.ts`),
    artifact(root, ddd, 'dtos', 'interface/http/requests', `${name}Requests.ts`),
    artifact(root, ddd, 'actions', 'application/actions', `${name}Actions.ts`),
    artifact(root, ddd, 'services', 'application/services', `${name}Service.ts`),
    artifact(root, ddd, 'repositories', 'infrastructure/repositories', `${name}Repository.ts`),
    artifact(root, ddd, 'resources', 'interface/http/resources', `${name}Resource.ts`),
    artifact(root, ddd, 'controllers', 'interface/http/controllers', `${name}ApiController.ts`),
    ...(name === 'Invoice' ? [
      artifact(root, ddd, 'resources', 'interface/http/resources', 'InvoiceSummaryCollectionResource.ts'),
    ] : []),
  ];
  const migrations = join(root, 'src/lib/database/migrations');
  const migration = (await readdir(migrations)).find((file) => file.endsWith(`_create_${lower}s_table.ts`))!;
  const output = join(root, `${lower}-runtime.mjs`);
  await build({
    stdin: {
      contents: modules.map((file) => `export * from ${JSON.stringify(file)};`).join('\n')
        + `\nexport { default as EntityMigration } from ${JSON.stringify(join(migrations, migration))};`,
      resolveDir: root, loader: 'ts',
    },
    outfile: output,
    alias: { '$lib': join(root, 'src/lib'), '@beeblock/svelar': sourceRoot },
    bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external', logLevel: 'silent',
  });
  return import(pathToFileURL(output).href);
}

function compileGenerated(root: string): string {
  const config = ts.readConfigFile(join(packageRoot, 'tsconfig.json'), ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, packageRoot);
  const program = ts.createProgram({
    rootNames: [...ts.sys.readDirectory(root, ['.ts']), join(sourceRoot, 'types/externals.d.ts')],
    options: {
      ...parsed.options,
      noEmit: true,
      strict: true,
      rootDir: undefined,
      outDir: undefined,
      paths: { '$lib/*': [join(root, 'src/lib/*')], '@beeblock/svelar/*': [join(sourceRoot, '*')] },
    },
  });
  return ts.formatDiagnostics(ts.getPreEmitDiagnostics(program), {
    getCanonicalFileName: (file) => file,
    getCurrentDirectory: () => packageRoot,
    getNewLine: () => '\n',
  });
}

describe.each([
  { validation: 'zod', ddd: false },
  { validation: 'valibot', ddd: false },
  { validation: 'zod', ddd: true },
  { validation: 'valibot', ddd: true },
])('make:entity runtime ($validation, DDD=$ddd)', ({ validation, ddd }) => {
  let root: string;
  let generated: Awaited<ReturnType<typeof loadGenerated>>;

  function parse(schema: unknown, input: unknown): { success: boolean; output?: unknown } {
    if (validation === 'valibot') return v.safeParse(schema as Parameters<typeof v.safeParse>[0], input);
    const result = (schema as { safeParse(input: unknown): { success: boolean; data?: unknown } }).safeParse(input);
    return { success: result.success, output: result.data };
  }

  beforeAll(async () => {
    root = await mkdtemp(join(packageRoot, '.test-entity-runtime-'));
    await generate(root, validation, ddd);
    generated = await loadGenerated(root, ddd);
  });

  beforeEach(async () => {
    await Connection.disconnect();
    Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: ':memory:' } } });
    await new generated.EntityMigration().up();
  });

  afterAll(async () => {
    await Connection.disconnect();
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('typechecks the generated readonly DTOs, model results, schemas and async collection contracts', async () => {
    const from = (flat: string, layered: string, file: string) => JSON.stringify(artifact(root, ddd, flat, layered, file));
    await writeFile(join(root, 'generated-contracts.ts'), `import type { Invoice } from ${from('models', 'domain/models', 'Invoice.js')};
import type { CreateInvoiceInput, InvoiceData, UpdateInvoiceInput } from ${from('schemas', 'contracts/schemas', 'invoice.schema.js')};
import { CreateInvoiceDto, UpdateInvoiceDto } from ${from('dtos', 'application/dto', 'InvoiceDtos.js')};
import { CreateInvoiceAction, UpdateInvoiceAction } from ${from('actions', 'application/actions', 'InvoiceActions.js')};
import { InvoiceResource } from ${from('resources', 'interface/http/resources', 'InvoiceResource.js')};
import { InvoiceSummaryCollectionResource } from ${from('resources', 'interface/http/resources', 'InvoiceSummaryCollectionResource.js')};

export async function create(input: CreateInvoiceInput): Promise<InvoiceData> {
  const model: Invoice = await new CreateInvoiceAction().run(CreateInvoiceDto.from(input));
  const timestamp: Date = model.created_at;
  timestamp.toISOString();
  const data = new InvoiceResource(model).toJSON();
  const dueAt: string = data.dueAt;
  const archivedAt: string | null = data.archivedAt;
  dueAt.toUpperCase();
  archivedAt?.toUpperCase();
  return data;
}

export async function update(id: number, input: UpdateInvoiceInput): Promise<Invoice> {
  return new UpdateInvoiceAction().run(UpdateInvoiceDto.from(id, input));
}

export function response(items: Invoice[]): Promise<Response> {
  return InvoiceSummaryCollectionResource.make(items, { total: items.length }).toResponse();
}

export function object(items: Invoice[]): Promise<Record<string, unknown>> {
  return InvoiceSummaryCollectionResource.make(items).toObject();
}
`);
    expect(compileGenerated(root)).toBe('');
  }, 60_000);

  it('returns asynchronous collection responses and objects with preserved metadata', async () => {
    const invoice = await new generated.CreateInvoiceAction().run(await generated.CreateInvoiceRequest.validate(request(validInput())));
    const collection = generated.InvoiceSummaryCollectionResource.make([invoice], { total: 1, page: 1 });
    const responsePromise = collection.toResponse();
    expect(responsePromise).toBeInstanceOf(Promise);
    const response = await responsePromise;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [{ id: invoice.id }], meta: { total: 1, page: 1 } });
    const objectPromise = collection.toObject();
    expect(objectPromise).toBeInstanceOf(Promise);
    expect(await objectPromise).toEqual({ data: [{ id: invoice.id }], meta: { total: 1, page: 1 } });
    expect(await generated.InvoiceSummaryCollectionResource.make([]).toObject()).toEqual({ data: [] });
    const source = await readFile(artifact(root, ddd, 'resources', 'interface/http/resources', 'InvoiceSummaryCollectionResource.ts'), 'utf8');
    expect(source).toContain('toResponse(): Promise<Response>');
    expect(source).toContain('toObject(): Promise<Record<string, unknown>>');
    expect(source).not.toContain('any');
    expect(source).not.toContain('@ts-');
  });

  it.each(['json', 'form'] as const)('executes the generated schema/request/DTO/action/service/repository/model/resource flow for %s', async (format) => {
    const dto = await generated.CreateInvoiceRequest.validate(request(validInput(), format));
    expect(dto).toBeInstanceOf(generated.CreateInvoiceDto);
    expect(dto.quantity).toBe(2);
    expect(dto.total).toBe(12.5);
    expect(dto.active).toBe(false);
    expect(dto.dueAt).toBeInstanceOf(Date);
    expect(parse(generated.createInvoiceSchema, validInput()).output).toMatchObject({ active: false, dueAt: new Date(dueAt) });
    const invoice = await new generated.CreateInvoiceAction().run(dto);
    expect(invoice).toBeInstanceOf(generated.Invoice);
    expect(invoice.active).toBe(false);
    expect(invoice.created_at).toBeInstanceOf(Date);
    expect(invoice.updated_at).toBeInstanceOf(Date);
    const stored = await new generated.InvoiceRepository().findByIdOrFail(invoice.id);
    expect(stored.quantity).toBe(2);
    expect(stored.total).toBe(12.5);
    expect(stored.active).toBe(false);
    expect(stored.dueAt.toISOString()).toBe(dueAt);
    for (const field of optionalFields) expect(stored[field]).toBeNull();
    const response = await generated.InvoiceResource.make(stored).toResponse();
    const { data } = await response.json();
    expect(data).toMatchObject({ quantity: 2, total: 12.5, active: false, dueAt, summary: null, rating: null, retries: null, visible: null, archivedAt: null, category: null });
    expect(typeof data.created_at).toBe('string');
    expect(typeof data.updated_at).toBe('string');
    expect(parse(generated.invoiceSchema, data).success).toBe(true);
    expect(new generated.InvoiceResource(stored).toJSON().dueAt).toBe(dueAt);
  });

  it.each(['json', 'form'] as const)('rejects fractional integer values before persistence for %s', async (format) => {
    for (const quantity of [1.5, '1.5']) {
      const input = { ...validInput(), quantity };
      expect(parse(generated.createInvoiceSchema, input).success).toBe(false);
      await expect(generated.CreateInvoiceRequest.validate(request(input, format))).rejects.toMatchObject({ statusCode: 422, errors: { quantity: expect.any(Array) } });
    }
    expect(await new generated.InvoiceRepository().count()).toBe(0);
  });

  it('normalizes only explicit boolean values without JavaScript truthiness', async () => {
    for (const [input, expected] of [[false, false], ['false', false], ['off', false], ['0', false], [0, false], [true, true], ['true', true], ['on', true], ['1', true], [1, true]]) {
      const data = { ...validInput(), active: input };
      expect(parse(generated.createInvoiceSchema, data).output).toMatchObject({ active: expected });
      const dto = await generated.CreateInvoiceRequest.validate(request(data));
      const invoice = await new generated.CreateInvoiceAction().run(dto);
      expect((await new generated.InvoiceRepository().findByIdOrFail(invoice.id)).active).toBe(expected);
    }
  });

  it.each(['json', 'form'] as const)('rejects invalid boolean values for %s instead of converting them to false or true', async (format) => {
    for (const active of ['invalid', '', ' ', 'yes', 'no', '2', 'FALSE', 2, {}, []]) {
      const input = { ...validInput(), active };
      expect(parse(generated.createInvoiceSchema, input).success).toBe(false);
      await expect(generated.CreateInvoiceRequest.validate(request(input, format))).rejects.toMatchObject({ statusCode: 422, errors: { active: expect.any(Array) } });
    }
    await expect(generated.CreateInvoiceRequest.validate(request({ ...validInput(), active: null }))).rejects.toMatchObject({ statusCode: 422 });
    expect(await new generated.InvoiceRepository().count()).toBe(0);
  });

  it.each(['json', 'form'] as const)('rejects blank numeric strings for required and optional fields for %s', async (format) => {
    for (const field of ['quantity', 'total', 'rating', 'retries']) {
      for (const value of ['', '   ']) {
        const input = { ...validInput(), [field]: value };
        expect(parse(generated.createInvoiceSchema, input).success).toBe(false);
        await expect(generated.CreateInvoiceRequest.validate(request(input, format))).rejects.toMatchObject({ statusCode: 422, errors: { [field]: expect.any(Array) } });
      }
    }
    expect(await new generated.InvoiceRepository().count()).toBe(0);
  });

  it('rejects nonnumeric, boolean, array, object and nonfinite number inputs in the shared schema', () => {
    for (const total of [null, true, false, [], [1], {}, 'Infinity', Infinity, -Infinity, NaN, 'not a number']) {
      expect(parse(generated.createInvoiceSchema, { ...validInput(), total }).success).toBe(false);
    }
    expect(parse(generated.createInvoiceSchema, { ...validInput(), total: '0', quantity: '0' }).output).toMatchObject({ total: 0, quantity: 0 });
    expect(parse(generated.createInvoiceSchema, { ...validInput(), retries: 1.25 }).success).toBe(false);
  });

  it('validates dates and serializes required/nullable dates as ISO strings at the resource boundary', async () => {
    for (const value of ['', 'invalid', null, 0, false, [], new Date(NaN)]) {
      expect(parse(generated.createInvoiceSchema, { ...validInput(), dueAt: value }).success).toBe(false);
    }
    const archivedAt = '2031-01-02T03:04:05.000Z';
    const dto = await generated.CreateInvoiceRequest.validate(request({ ...validInput(), archivedAt }));
    const invoice = await new generated.CreateInvoiceAction().run(dto);
    const stored = await new generated.InvoiceService().find(invoice.id);
    expect(stored.archivedAt).toBeInstanceOf(Date);
    expect(new generated.InvoiceResource(stored).toJSON()).toMatchObject({ dueAt, archivedAt });
    expect(parse(generated.invoiceSchema, new generated.InvoiceResource(stored).toJSON()).success).toBe(true);
  });

  it('accepts explicit null optional fields and preserves null through the database and response contract', async () => {
    const input = { ...validInput(), ...Object.fromEntries(optionalFields.map((field) => [field, null])) };
    const dto = await generated.CreateInvoiceRequest.validate(request(input));
    for (const field of optionalFields) expect(dto[field]).toBeNull();
    const invoice = await new generated.CreateInvoiceAction().run(dto);
    const stored = await new generated.InvoiceRepository().findByIdOrFail(invoice.id);
    const data = new generated.InvoiceResource(stored).toJSON();
    for (const field of optionalFields) expect(data[field]).toBeNull();
    expect(parse(generated.invoiceSchema, data).success).toBe(true);
  });

  it.each(['json', 'form'] as const)('preserves omitted fields in partial updates while accepting false and zero for %s', async (format) => {
    const created = await new generated.CreateInvoiceAction().run(await generated.CreateInvoiceRequest.validate(request({
      ...validInput(), active: true, summary: 'Keep', rating: 3, retries: 2, visible: true,
    })));
    const dto = await generated.UpdateInvoiceRequest.validate(request({ active: false, total: 0, visible: false, retries: 0 }, format, { id: String(created.id) }));
    expect(dto).toBeInstanceOf(generated.UpdateInvoiceDto);
    expect(dto.id).toBe(created.id);
    expect(dto.active).toBe(false);
    expect(dto.summary).toBeUndefined();
    await new generated.UpdateInvoiceAction().run(dto);
    const stored = await new generated.InvoiceRepository().findByIdOrFail(created.id);
    expect(stored.active).toBe(false);
    expect(stored.total).toBe(0);
    expect(stored.title).toBe('Invoice');
    expect(stored.summary).toBe('Keep');
    expect(stored.rating).toBe(3);
    expect(stored.visible).toBe(false);
    expect(stored.retries).toBe(0);
    expect(parse(generated.invoiceSchema, new generated.InvoiceResource(stored).toJSON()).success).toBe(true);
  });

  it('clears optional fields with explicit null without changing unrelated columns', async () => {
    const created = await new generated.CreateInvoiceAction().run(await generated.CreateInvoiceRequest.validate(request({
      ...validInput(), summary: 'Clear', rating: 4, retries: 1, visible: false, archivedAt: dueAt, category: 'urgent',
    })));
    const changes = Object.fromEntries(optionalFields.map((field) => [field, null]));
    const dto = await generated.UpdateInvoiceRequest.validate(request(changes, 'json', { id: String(created.id) }));
    await new generated.UpdateInvoiceAction().run(dto);
    const stored = await new generated.InvoiceRepository().findByIdOrFail(created.id);
    for (const field of optionalFields) expect(stored[field]).toBeNull();
    expect(stored.title).toBe('Invoice');
  });

  it('requires positive integer route IDs for update/delete and deletes through the generated action', async () => {
    for (const id of ['1.5', '0', '-1', '', ' ', 'abc', 'Infinity']) {
      expect(parse(generated.invoiceIdSchema, id).success).toBe(false);
      await expect(generated.UpdateInvoiceRequest.validate(request({}, 'json', { id }))).rejects.toMatchObject({ statusCode: 422, errors: { id: expect.any(Array) } });
      await expect(generated.DeleteInvoiceRequest.validate(request({}, 'json', { id }))).rejects.toMatchObject({ statusCode: 422 });
    }
    const created = await new generated.CreateInvoiceAction().run(await generated.CreateInvoiceRequest.validate(request(validInput())));
    const dto = await generated.DeleteInvoiceRequest.validate(request({}, 'json', { id: String(created.id) }));
    expect(dto).toBeInstanceOf(generated.DeleteInvoiceDto);
    await new generated.DeleteInvoiceAction().run(dto);
    expect(await new generated.InvoiceRepository().findById(created.id)).toBeNull();
  });

  it('rejects unauthenticated create/update/delete requests before persistence', async () => {
    for (const Request of [generated.CreateInvoiceRequest, generated.UpdateInvoiceRequest, generated.DeleteInvoiceRequest]) {
      await expect(Request.validate(request(validInput(), 'json', { id: '1' }, false))).rejects.toMatchObject({ statusCode: 403 });
    }
    expect(await new generated.InvoiceRepository().count()).toBe(0);
  });

  it('runs the custom generated controller with typed action results and a consistent response envelope', async () => {
    const controller = new generated.InvoiceApiController();
    const createdResponse = await controller.store(request(validInput()));
    expect(createdResponse.status).toBe(201);
    const { data } = await createdResponse.json();
    expect(data.active).toBe(false);
    expect(parse(generated.invoiceSchema, data).success).toBe(true);
    const updatedResponse = await controller.update(request({ title: 'Updated' }, 'json', { id: String(data.id) }));
    expect((await updatedResponse.json()).data.title).toBe('Updated');
    expect((await (await controller.index(request({}))).json()).data).toHaveLength(1);
    expect((await controller.destroy(request({}, 'json', { id: String(data.id) }))).status).toBe(204);
    const controllerSource = await readFile(artifact(root, ddd, 'controllers', 'interface/http/controllers', 'InvoiceApiController.ts'), 'utf8');
    const actionSource = await readFile(artifact(root, ddd, 'actions', 'application/actions', 'InvoiceActions.ts'), 'utf8');
    expect(controllerSource).not.toContain(' as any');
    expect(actionSource).not.toContain('Promise<unknown>');
    expect(actionSource).toContain('Action<CreateInvoiceDto, Invoice>');
  });

  it('retains create-only service correctness and migration idempotence', async () => {
    await generate(root, validation, ddd, 'Draft', false);
    await generate(root, validation, ddd, 'Draft', false);
    const migrations = (await readdir(join(root, 'src/lib/database/migrations'))).filter((file) => file.endsWith('_create_drafts_table.ts'));
    expect(migrations).toHaveLength(1);
    const draft = await loadGenerated(root, ddd, 'Draft');
    expect(compileGenerated(root)).toBe('');
    await new draft.EntityMigration().up();
    const dto = await draft.CreateDraftRequest.validate(request({ title: 'Create only' }));
    const item = await new draft.CreateDraftAction().run(dto);
    expect(item).toBeInstanceOf(draft.Draft);
    expect(new draft.DraftResource(await new draft.DraftService().find(item.id)).toJSON().title).toBe('Create only');
    const service = await readFile(artifact(root, ddd, 'services', 'application/services', 'DraftService.ts'), 'utf8');
    expect(service).not.toContain('UpdateDraftDto');
    expect(service).not.toContain('async update(');
  }, 60_000);
});
