import { mkdirSync, mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LintArchitectureCommand } from '../src/cli/commands/LintArchitectureCommand';

let root: string;
let cwd: string;
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const write = (path: string, content: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); };
const lint = () => new LintArchitectureCommand().scanProject(join(root, 'src'));

beforeEach(() => { cwd = process.cwd(); root = mkdtempSync(join(packageRoot, '.test-lint-architecture-')); mkdirSync(join(root, 'src')); });
afterEach(() => { process.chdir(cwd); rmSync(root, { recursive: true, force: true }); vi.restoreAllMocks(); });

describe('AST architecture rules', () => {
  it('detects aliased model/QueryBuilder persistence in routes and services with exact lines', () => {
    write('src/lib/models/User.ts', "import { Model as Base } from '@beeblock/svelar/orm'; export class User extends Base {}\n");
    write('src/routes/api/users/+server.ts', "import { User as Account } from '$lib/models/User.js';\nexport async function POST() {\n  const user = await Account.find(1);\n  await user.save();\n  return new Response('ok');\n}\n");
    write('src/lib/services/Bad.ts', "import { QueryBuilder as Q } from '@beeblock/svelar/orm';\nconst query = new Q('users');\nexport const run = () => query.where('id', 1).update({name:'bad'});\n");
    const findings = lint();
    expect(findings).toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'thin-routes', file: 'src/routes/api/users/+server.ts', line: 3 }), expect.objectContaining({ rule: 'repository-persistence', file: 'src/lib/services/Bad.ts', line: 3 })]));
    expect(findings.find((finding) => finding.rule === 'controller-flow')).toBeDefined();
  });

  it('does not mistake Map/Cache/HTTP methods, comments or strings for persistence or runtime DDL', () => {
    write('src/lib/util.ts', `import { Cache } from '@beeblock/svelar/cache';
import { Http } from '@beeblock/svelar/http';
// Connection.raw('CREATE TABLE example'); new QueryBuilder('users').insert({});
const example = 'query.delete(); schema.createTable(); fetch(method: POST)';
const values = new Map(); values.delete('a');
Cache.put('x', 1); Http.delete('https://external.test/item');
export { example };
`);
    expect(lint()).toEqual([]);
  });

  it('allows persistence in model/repository classes and migrations, but not runtime DDL', () => {
    write('src/lib/Account.ts', "import { Model, QueryBuilder } from '@beeblock/svelar/orm'; export class Account extends Model { load(){ return new QueryBuilder('accounts').get(); } }\n");
    write('src/lib/repositories/AccountRepository.ts', "import { QueryBuilder } from '@beeblock/svelar/orm'; export const save = () => new QueryBuilder('accounts').insert({});\n");
    write('src/lib/database/migrations/create_accounts.ts', "import { Schema, Connection } from '@beeblock/svelar/database'; Schema.create('accounts', () => {}); Connection.raw('CREATE TABLE accounts (id int)');\n");
    write('src/lib/services/BadSchema.ts', "import { Schema as S, Connection as C } from '@beeblock/svelar/database';\nS.create('runtime', () => {});\nC.raw('ALTER TABLE runtime ADD COLUMN bad text');\n");
    const findings = lint();
    expect(findings.filter((finding) => finding.rule === 'no-runtime-ddl')).toHaveLength(2);
    expect(findings.some((finding) => finding.file.includes('migrations/'))).toBe(false);
    expect(findings.some((finding) => finding.file === 'src/lib/Account.ts')).toBe(false);
    expect(findings.some((finding) => finding.file.includes('repositories/'))).toBe(false);
  });

  it('does not let unrelated DTO/Request/schema files satisfy an incomplete action workflow', () => {
    write('src/lib/modules/orders/application/actions/CreateOrderAction.ts', "import { Action } from '@beeblock/svelar/actions'; export class CreateOrderAction extends Action { execute(input: unknown) { return input; } }\n");
    write('src/lib/modules/other/application/dto/OtherDto.ts', 'export class OtherDto {}');
    write('src/lib/modules/other/interface/http/requests/OtherRequest.ts', "import { FormRequest } from '@beeblock/svelar/validation'; export class OtherRequest extends FormRequest {}\n");
    write('src/lib/modules/other/contracts/schemas/other.schema.ts', 'export const otherSchema = {};');
    expect(lint()).toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'write-flow', file: 'src/lib/modules/orders/application/actions/CreateOrderAction.ts', message: expect.stringContaining('FormRequest, DTO') })]));
  });

  it('accepts a linked Request -> DTO -> action -> repository workflow in flat and DDD layouts', () => {
    for (const [prefix, dtoDir, requestDir, actionDir, controllerDir, schemaDir] of [
      ['src/lib', 'dtos', 'dtos', 'actions', 'controllers', 'schemas'],
      ['src/lib/modules/posts', 'application/dto', 'interface/http/requests', 'application/actions', 'interface/http/controllers', 'contracts/schemas'],
    ]) {
      write(`${prefix}/${schemaDir}/post.schema.ts`, 'export const postSchema = {};');
      write(`${prefix}/${dtoDir}/CreatePostDto.ts`, 'export class CreatePostDto {}');
      write(`${prefix}/${requestDir}/CreatePostRequest.ts`, `import { FormRequest } from '@beeblock/svelar/validation'; import { CreatePostDto } from '${relativeDir(requestDir, dtoDir)}/CreatePostDto.js'; import { postSchema } from '${relativeDir(requestDir, schemaDir)}/post.schema.js'; export class CreatePostRequest extends FormRequest { rules(){return postSchema;} passedValidation(){return new CreatePostDto();} }`);
      write(`${prefix}/${actionDir}/CreatePostAction.ts`, `import { Action } from '@beeblock/svelar/actions'; import type { CreatePostDto } from '${relativeDir(actionDir, dtoDir)}/CreatePostDto.js'; export class CreatePostAction extends Action { execute(input: CreatePostDto){ return input; } }`);
      write(`${prefix}/${controllerDir}/PostController.ts`, `import { Controller } from '@beeblock/svelar/routing'; import { CreatePostRequest } from '${relativeDir(controllerDir, requestDir)}/CreatePostRequest.js'; import { CreatePostAction } from '${relativeDir(controllerDir, actionDir)}/CreatePostAction.js'; export class PostController extends Controller { async store(event: unknown){const input=await new CreatePostRequest().validate(event); return new CreatePostAction().execute(input);} }`);
    }
    expect(lint().filter((finding) => finding.rule === 'write-flow')).toEqual([]);
  });

  it('detects a controller write without an action and a page action missing all input layers', () => {
    write('src/lib/controllers/UserController.ts', "import { Controller } from '@beeblock/svelar/routing'; export class UserController extends Controller { async update(event: any){ return event.request.json(); } }\n");
    write('src/routes/settings/+page.server.ts', 'export const actions = { save: async (event: any) => { return event.request.formData(); } };\n');
    const findings = lint().filter((finding) => finding.rule === 'write-flow');
    expect(findings).toHaveLength(2);
    expect(findings.every((finding) => finding.message.includes('action'))).toBe(true);
  });

  it('checks each bare browser mutation despite an apiFetch alias elsewhere, and skips server/external/CSRF calls', () => {
    write('src/lib/Form.svelte', `<script lang="ts">
import { apiFetch as safe } from '@beeblock/svelar/http';
async function save() {
 await safe('/api/safe', {method:'POST'});
 await fetch('/api/unsafe', {method:'PATCH'});
 await window.fetch('/api/delete', {method:'DELETE'});
 await fetch('https://external.test/api', {method:'POST'});
 await fetch('/api/guarded', {method:'POST',headers:{'X-CSRF-Token':'token'}});
}
</script><button onclick={save}>Save</button>`);
    write('src/routes/+page.server.ts', "export const load = async ({fetch}: any) => fetch('/api/server', {method:'POST'});\n");
    write('src/lib/custom.svelte', '<script>async function save(fetch) {return fetch("/api/custom", {method:"POST"});}</script>');
    expect(lint().filter((finding) => finding.rule === 'csrf-api-fetch')).toHaveLength(2);
  });

  it('recognizes direct, array, default, barrel and namespace job registrations reachable from app bootstrap', () => {
    write('src/lib/jobs/One.ts', "import { Job as BaseJob } from '@beeblock/svelar/queue'; export class One extends BaseJob {}\n");
    write('src/lib/jobs/Two.ts', "import { Job } from '@beeblock/svelar/queue'; export default class Two extends Job {}\n");
    write('src/lib/jobs/index.ts', "export { One as First } from './One.js'; export { default as Second } from './Two.js';\n");
    write('src/app.ts', "import * as queues from '@beeblock/svelar/queue'; import * as jobs from '$lib/jobs/index.js'; import Other from '$lib/jobs/Two.js'; import { ProcessSearchOutboxJob } from '@beeblock/svelar/search'; const batch=[jobs.First, Other]; queues.Queue.registerAll([...batch, ProcessSearchOutboxJob]);\n");
    expect(lint().filter((finding) => finding.rule.includes('job'))).toEqual([]);
  });

  it('flags unregistered app jobs without assuming directory discovery or counting shadowed/unreachable registration', () => {
    write('src/lib/shared/jobs/Missing.ts', "import { Job } from '@beeblock/svelar/queue'; export class Missing extends Job {}\n");
    write('src/app.ts', "import { Queue } from '@beeblock/svelar/queue'; import { Missing } from '$lib/shared/jobs/Missing.js'; export function bad(Queue: any){Queue.register(Missing);} \n");
    write('src/lib/unreachable.ts', "import { Queue as Q } from '@beeblock/svelar/queue'; import { Missing } from './shared/jobs/Missing.js'; Q.register(Missing);\n");
    expect(lint()).toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'unregistered-job', file: 'src/lib/shared/jobs/Missing.ts' })]));
  });

  it('reports unknown registration honestly for dynamic bootstrap arrays', () => {
    write('src/lib/jobs/Maybe.ts', "import { Job } from '@beeblock/svelar/queue'; export class Maybe extends Job {}\n");
    write('src/app.ts', "import { Queue } from '@beeblock/svelar/queue'; Queue.registerAll(discoverCustomJobs());\n");
    expect(lint().map((finding) => finding.rule)).toContain('job-registration-unknown');
  });

  it('does not count a registration function declaration as an executed app bootstrap registration', () => {
    write('src/lib/jobs/Maybe.ts', "import { Job } from '@beeblock/svelar/queue'; export class Maybe extends Job {}\n");
    write('src/app.ts', "import { Queue } from '@beeblock/svelar/queue'; import { Maybe } from '$lib/jobs/Maybe.js'; export function later(){Queue.register(Maybe);}\n");
    expect(lint().map((finding) => finding.rule)).toContain('job-registration-unknown');
  });

  it('does not borrow a valid controller method request/schema for a different write action', () => {
    write('src/lib/actions/CreateBadAction.ts', "import { Action } from '@beeblock/svelar/actions'; export class CreateBadAction extends Action { execute(input:unknown){return input;} }");
    write('src/lib/dtos/OtherDto.ts', 'export class OtherDto {}');
    write('src/lib/schemas/other.schema.ts', 'export const otherSchema={};');
    write('src/lib/dtos/OtherRequest.ts', "import { FormRequest } from '@beeblock/svelar/validation'; import { OtherDto } from './OtherDto.js'; import { otherSchema } from '../schemas/other.schema.js'; export class OtherRequest extends FormRequest { rules(){return otherSchema;} passedValidation(){return new OtherDto();} }");
    write('src/lib/controllers/MixedController.ts', "import { Controller } from '@beeblock/svelar/routing'; import { CreateBadAction } from '../actions/CreateBadAction.js'; import { OtherRequest } from '../dtos/OtherRequest.js'; export class MixedController extends Controller { create(input:unknown){return new CreateBadAction().execute(input);} async other(event:unknown){return new OtherRequest().validate(event);} }");
    expect(lint()).toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'write-flow', file: 'src/lib/actions/CreateBadAction.ts', message: expect.stringContaining('FormRequest, DTO') })]));
  });

  it('detects typed model field writes and constant/template runtime SQL DDL, not search index APIs', () => {
    write('src/lib/models/User.ts', "import { Model } from '@beeblock/svelar/orm'; export class User extends Model {}\n");
    write('src/lib/services/Bad.ts', "import { User } from '../models/User.js'; import { Connection as C } from '@beeblock/svelar/database'; import { Search } from '@beeblock/svelar/search'; export class Bad { constructor(private user:User){} save(){return this.user.save();} } const sql='CREATE TABLE bad(id int)';\nC.raw(sql);\nC.raw(`ALTER TABLE ${table} ADD COLUMN name text`);\nSearch.createIndex('catalog');\n");
    const findings = lint();
    expect(findings.filter((finding) => finding.rule === 'repository-persistence')).toHaveLength(1);
    expect(findings.filter((finding) => finding.rule === 'no-runtime-ddl')).toHaveLength(2);
  });

  it('reports a large route handler, syntax and symlink boundaries rather than a false clean result', () => {
    write('src/routes/api/large/+server.ts', `export async function POST(){${Array.from({ length: 30 }, (_, index) => `const v${index}=${index};`).join('\n')} return new Response('ok');}`);
    write('src/lib/broken.ts', 'export const broken = ;');
    symlinkSync(join(root, 'src/lib/broken.ts'), join(root, 'src/lib/link.ts'));
    expect(lint().map((finding) => finding.rule)).toEqual(expect.arrayContaining(['thin-routes', 'source-syntax', 'source-boundary']));
  });

  it('supports an explicit capability-audit integration hook and stable JSON failure semantics', async () => {
    write('src/lib/value.ts', 'export const value=1;');
    const command = new LintArchitectureCommand();
    const audit = vi.fn(() => [{ file: 'src/app.ts', line: 1, severity: 'warning' as const, rule: 'capability-required', message: 'Example capability unavailable' }]);
    expect(command.scanProject(join(root, 'src'), { auditCapabilities: audit })).toHaveLength(1);
    expect(audit).toHaveBeenCalledWith({ root, files: ['src/lib/value.ts'] });
    write('src/lib/Form.svelte', '<script>async function save(){return fetch("/api/write",{method:"POST"});}</script><button onclick={save}>Save</button>');
    process.chdir(root);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(command.handle([], { json: true })).resolves.toBeUndefined();
    expect(JSON.parse(log.mock.calls[0][0]).warnings).toBe(1);
    await expect(command.handle([], { warnings: true, json: true })).rejects.toThrow('Architecture lint failed');
  });

  it('checks fat read handlers without requiring write-specific Request/DTO/action layers', () => {
    write('src/routes/api/read/+server.ts', `export async function GET(){${Array.from({ length: 30 }, (_, index) => `const v${index}=${index};`).join('\n')} return new Response('ok');}`);
    expect(lint().map((finding) => finding.rule)).toEqual(['thin-routes']);
  });

  it('audits named route exports and prefixed controller/action write methods', () => {
    write('src/routes/api/named/+server.ts', 'const save = async (event: any) => event.request.json(); export { save as POST };');
    write('src/lib/controllers/UserController.ts', "import { Controller } from '@beeblock/svelar/routing'; export class UserController extends Controller { updateRole(event: any){return event.request.json();} }");
    write('src/lib/actions/RevokeTokenAction.ts', "import { Action } from '@beeblock/svelar/actions'; export class RevokeTokenAction extends Action { execute(input:unknown){return input;} }");
    const findings = lint();
    expect(findings.filter((finding) => finding.rule === 'write-flow')).toHaveLength(3);
    expect(findings.find((finding) => finding.rule === 'controller-flow')?.file).toBe('src/routes/api/named/+server.ts');
  });
});

function relativeDir(from: string, to: string): string {
  const path = posix.relative(from, to);
  return !path ? '.' : path.startsWith('.') ? path : `./${path}`;
}
