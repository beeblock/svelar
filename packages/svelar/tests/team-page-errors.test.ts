import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import * as kit from '@sveltejs/kit';
import { superValidate } from 'sveltekit-superforms/server';
import { zod4, valibot } from 'sveltekit-superforms/adapters';
import { z } from 'zod';
import * as v from 'valibot';
import { NewCommandTemplates as T, type ValidationProvider } from '../src/cli/commands/NewCommandTemplates.js';
import { transformScaffoldFile } from '../src/cli/commands/NewCommand.js';
import { ErrorHandler } from '../src/errors/Handler.js';
import { Log } from '../src/logging/index.js';
import { ApplicationContext } from '../src/support/Context.js';

const operations = [
  { name: 'invite', stem: 'InviteTeamMember', schema: 'inviteTeamMemberSchema', form: 'inviteForm', id: 'invite-team-member', fallback: 'Failed to send invitation', feedback: { invited: 'recipient@example.test' } },
  { name: 'updateRole', stem: 'UpdateTeamMemberRole', schema: 'updateTeamMemberRoleSchema', form: 'updateRoleForm', id: 'update-team-role', fallback: 'Failed to update role', feedback: {} },
  { name: 'removeMember', stem: 'RemoveTeamMember', schema: 'removeTeamMemberSchema', form: 'removeMemberForm', id: 'remove-team-member', fallback: 'Failed to remove member', feedback: { removed: true } },
  { name: 'cancelInvitation', stem: 'CancelTeamInvitation', schema: 'cancelTeamInvitationSchema', form: 'cancelInvitationForm', id: 'cancel-team-invitation', fallback: 'Failed to cancel invitation', feedback: { cancelled: true } },
  { name: 'updateTeam', stem: 'UpdateTeam', schema: 'updateTeamSchema', form: 'updateTeamForm', id: 'update-team', fallback: 'Failed to update team', feedback: { updated: true } },
] as const;
const fields = { teamId: 'team-proof', email: 'recipient@example.test', role: 'member', userId: 'member-proof', invitationId: 'invitation-proof', name: 'Proof team' };
const secret = 'AUDIT_ONLY_SECRET:postgres://fixture:secret@db.invalid/private_table';
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function evaluate(source: string, dependencies: Record<string, unknown>): any {
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const module = { exports: {} };
  new Function('exports', 'require', 'module', compiled.outputText)(module.exports, (id: string) => {
    if (!(id in dependencies)) throw new Error('Unbound team-page import: ' + id);
    return dependencies[id];
  }, module);
  return module.exports;
}

function harness(provider: ValidationProvider, flat: boolean) {
  const dependencies: Record<string, unknown> = {
    '@sveltejs/kit': kit, '@beeblock/svelar/errors': { ErrorHandler },
    '@beeblock/svelar/validation': { z }, valibot: v,
    '@beeblock/svelar/teams': { Teams: {} },
    'sveltekit-superforms': { superValidate }, 'sveltekit-superforms/adapters': { zod4, valibot },
  };
  const schemas = evaluate(T.teamSchema(provider), dependencies);
  const runs = Object.fromEntries(operations.map((op) => [op.name, vi.fn<(data: unknown) => Promise<void>>().mockResolvedValue(undefined)]));
  const requests = Object.fromEntries(operations.map((op) => [op.stem + 'Request', class {
    rules() { return schemas[op.schema]; }
    authorize(event: { locals: { user?: unknown } }) { return !!event.locals.user; }
    passedValidation(data: unknown) { return data; }
  }]));
  const actions = Object.fromEntries(operations.map((op) => [op.stem + 'Action', class {
    run(data: unknown) { return runs[op.name](data); }
  }]));
  const source = transformScaffoldFile('src/routes/dashboard/team/+page.server.ts', T.applyValidationProvider(T.teamPageServer(), provider), flat).content;
  const parsed = ts.createSourceFile('page.ts', source, ts.ScriptTarget.Latest, true);
  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const id = statement.moduleSpecifier.text;
    if (id.endsWith('/TeamRequests.js')) dependencies[id] = requests;
    if (id.endsWith('/TeamActions.js')) dependencies[id] = actions;
  }
  const page = evaluate(source, dependencies);
  const event = () => ({
    locals: { user: { id: 1 } }, url: new URL('https://app.example/dashboard/team'),
    request: new Request('https://app.example/dashboard/team', { method: 'POST', body: new URLSearchParams(fields) }),
  });
  return { page, runs, event };
}

beforeEach(() => {
  ApplicationContext.clear();
  vi.spyOn(Log, 'error').mockResolvedValue(undefined);
});
afterEach(() => { vi.restoreAllMocks(); ApplicationContext.clear(); });

describe.each<ValidationProvider>(['zod', 'valibot'])('team page errors (%s)', (provider) => {
  describe.each([false, true])('flat=%s', (flat) => {
    it.each(operations)('reports $name failures without leaking secrets and keeps its form', async (op) => {
      const h = harness(provider, flat);
      const event = h.event();
      const failure = new Error(secret);
      const report = vi.fn(async (_error: unknown) => {});
      ErrorHandler.bindForRequest(event, new ErrorHandler({ debug: false, report }));
      h.runs[op.name].mockRejectedValue(failure);
      const result = await h.page.actions[op.name](event);
      expect(result).toMatchObject({ status: 500, data: { data: null, error: op.fallback, meta: { message: op.fallback } } });
      expect(result.data.meta.form).toBe(result.data[op.form]);
      expect(result.data[op.form]).toMatchObject({ valid: true, id: op.id, posted: true, message: op.fallback });
      expect(result.data[op.form].data).toMatchObject(op.name === 'cancelInvitation' ? { invitationId: fields.invitationId } : { teamId: fields.teamId });
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(report).toHaveBeenCalledOnce();
      expect(report.mock.calls[0][0]).toBe(failure);
      expect(Log.error).toHaveBeenCalledOnce();
    });

    for (const kind of ['http', 'redirect'] as const) {
      it.each(operations)(`preserves native ${kind} control flow in $name`, async (op) => {
        const h = harness(provider, flat);
        const event = h.event();
        const report = vi.fn();
        const render = vi.fn();
        ErrorHandler.bindForRequest(event, new ErrorHandler({ debug: false, report, render }));
        let control: unknown;
        try { if (kind === 'http') kit.error(409, 'Controlled conflict'); else kit.redirect(303, '/dashboard/team'); }
        catch (error) { control = error; }
        h.runs[op.name].mockRejectedValue(control);
        await expect(h.page.actions[op.name](event)).rejects.toBe(control);
        expect(report).not.toHaveBeenCalled();
        expect(render).not.toHaveBeenCalled();
        expect(Log.error).not.toHaveBeenCalled();
      });
    }

    it.each(operations)('keeps $name success feedback and the matching Superforms result', async (op) => {
      const h = harness(provider, flat);
      const result = await h.page.actions[op.name](h.event());
      expect(result).toMatchObject({ success: true, ...op.feedback });
      expect(result.data).toBeDefined();
      expect(result.meta.form).toBe(result[op.form]);
      expect(result.meta.form).toMatchObject({ valid: true, id: op.id, posted: true });
      expect(h.runs[op.name]).toHaveBeenCalledOnce();
      expect(Log.error).not.toHaveBeenCalled();
    });

    it('awaits the configured reporter and renderer without parsing or exposing its response', async () => {
      const h = harness(provider, flat);
      const event = h.event();
      let release!: () => void;
      let entered!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const reporting = new Promise<void>((resolve) => { entered = resolve; });
      const response = new Response(secret, { status: 502, headers: { 'Content-Type': 'text/plain' } });
      const json = vi.spyOn(response, 'json');
      const text = vi.spyOn(response, 'text');
      const report = vi.fn(async () => { entered(); await gate; });
      const render = vi.fn(async () => response);
      ErrorHandler.bindForRequest(event, new ErrorHandler({ debug: false, report, render }));
      h.runs.invite.mockRejectedValue(new Error(secret));
      let settled = false;
      const pending = h.page.actions.invite(event).then((result: unknown) => { settled = true; return result; });
      try {
        await reporting;
        expect(settled).toBe(false);
        expect(render).not.toHaveBeenCalled();
      } finally { release(); }
      const result = await pending;
      expect(settled).toBe(true);
      expect(render).toHaveBeenCalledOnce();
      expect(json).not.toHaveBeenCalled();
      expect(text).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(result).toMatchObject({ status: 500, data: { error: operations[0].fallback } });
    });

    it.each([null, secret, { message: secret }])('sanitizes non-Error thrown values (%j)', async (value) => {
      const h = harness(provider, flat);
      const event = h.event();
      ErrorHandler.bindForRequest(event, new ErrorHandler({ debug: false }));
      h.runs.invite.mockRejectedValue(value);
      const result = await h.page.actions.invite(event);
      expect(result.status).toBe(500);
      expect(result.data.error).toBe(operations[0].fallback);
      expect(result.data.inviteForm).toBe(result.data.meta.form);
      expect(JSON.stringify(result)).not.toContain(secret);
    });
  });

  it.each([false, true])('strictly compiles the page with its existing schemas/requests/actions (flat=%s)', (flat) => {
    const directory = join(packageRoot, '.virtual-team-page-errors');
    const entries = [
      ['src/routes/dashboard/team/+page.server.ts', T.teamPageServer()],
      ['src/lib/modules/team/team.schema.ts', T.teamSchema(provider)],
      ['src/lib/modules/team/TeamDtos.ts', T.teamDtos()],
      ['src/lib/modules/team/TeamRequests.ts', T.teamRequests()],
      ['src/lib/modules/team/TeamActions.ts', T.teamActions()],
    ].map(([path, source]) => transformScaffoldFile(path, T.applyValidationProvider(source, provider), flat));
    entries.push({ path: 'src/routes/dashboard/team/$types.ts', content: "export type { Actions } from '@sveltejs/kit'; export type PageServerLoad = import('@sveltejs/kit').ServerLoad;" });
    entries.push({ path: 'src/app.d.ts', content: 'declare namespace App { interface Locals { user: { id: number } | null; } }' });
    const virtual = new Map(entries.map(({ path, content }) => [join(directory, path), content]));
    const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true, skipLibCheck: true, noEmit: true, types: ['node'], esModuleInterop: true,
      paths: { '@beeblock/svelar/*': [join(packageRoot, 'src/*/index.ts')], '$lib/*': [join(directory, 'src/lib/*')] } };
    const host = ts.createCompilerHost(options);
    const read = host.readFile.bind(host), exists = host.fileExists.bind(host), isDirectory = host.directoryExists!.bind(host);
    host.readFile = (path) => virtual.get(path) ?? read(path);
    host.fileExists = (path) => virtual.has(path) || exists(path);
    host.directoryExists = (path) => [...virtual.keys()].some((file) => file.startsWith(path + '/')) || isDirectory(path);
    host.getSourceFile = (path, languageVersion) => { const source = host.readFile(path); return source === undefined ? undefined : ts.createSourceFile(path, source, languageVersion, true); };
    const program = ts.createProgram([...virtual.keys(), join(packageRoot, 'src/types/externals.d.ts')], options, host);
    expect(ts.getPreEmitDiagnostics(program).map((item) => item.file?.fileName + ': ' + ts.flattenDiagnosticMessageText(item.messageText, '\n'))).toEqual([]);
  }, 60_000);
});
