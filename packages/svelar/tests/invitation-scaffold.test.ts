import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import { compile } from 'svelte/compiler';
import { z } from 'zod';
import * as v from 'valibot';
import { superValidate } from 'sveltekit-superforms/server';
import { zod4, valibot } from 'sveltekit-superforms/adapters';
import { fail } from '@sveltejs/kit';
import { NewCommandTemplates as T, type ValidationProvider } from '../src/cli/commands/NewCommandTemplates.js';
import { transformScaffoldFile } from '../src/cli/commands/NewCommand.js';
import { LintArchitectureCommand } from '../src/cli/commands/LintArchitectureCommand.js';
import { Action } from '../src/actions/index.js';
import { Service } from '../src/services/index.js';
import { Repository } from '../src/repositories/index.js';
import { Model } from '../src/orm/Model.js';
import { Controller } from '../src/routing/Controller.js';
import { Resource } from '../src/routing/Resource.js';
import { FormRequest, FormAuthorizationError, FormValidationError } from '../src/routing/FormRequest.js';
import { CsrfMiddleware } from '../src/middleware/Middleware.js';
import { Teams } from '../src/teams/index.js';
import { AuthManager } from '../src/auth/Auth.js';
import { createRequestEvent } from '../src/testing/request.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const templates = {
  Invitation: T.invitationModel, InvitationRepository: T.invitationRepository, InvitationDto: T.invitationDto,
  InvitationRequest: T.invitationRequest, InvitationResource: T.invitationResource, InvitationService: T.invitationService,
  AcceptInvitationAction: T.acceptInvitationAction, DeclineInvitationAction: T.declineInvitationAction,
  InvitationController: T.invitationController,
};
function files(provider: ValidationProvider, flat: boolean) {
  const entries: Record<string, string> = {};
  const add = (path: string, content: string) => {
    const result = transformScaffoldFile(path, T.applyValidationProvider(content, provider), flat);
    entries[result.path] = result.content;
  };
  for (const [name, template] of Object.entries(templates)) add('src/lib/modules/team/' + name + '.ts', template());
  add('src/lib/modules/team/invitation.schema.ts', T.invitationSchema(provider));
  add('src/routes/invitations/[token]/+page.server.ts', T.invitationPageServer());
  for (const operation of ['preview', 'accept', 'decline'] as const) add('src/routes/api/invitations/[token]/' + (operation === 'preview' ? '' : operation + '/') + '+server.ts', T.invitationApiRoute(operation));
  entries['src/routes/invitations/[token]/$types.ts'] = "export type Actions = import('@sveltejs/kit').Actions<{ token: string }>; export type PageServerLoad = import('@sveltejs/kit').ServerLoad<{ token: string }>;";
  entries['src/app.d.ts'] = "declare namespace App { interface Locals { user: { id: string | number; email: string } | null; auth: import('@beeblock/svelar/auth').AuthManager; } }";
  return entries;
}
function check(entries: Record<string, string>) {
  const directory = join(root, '.virtual-invitation-scaffold');
  const virtual = new Map(Object.entries(entries).map(([path, source]) => [join(directory, path), source]));
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, skipLibCheck: true, noEmit: true, types: ['node'],
    esModuleInterop: true, paths: { '@beeblock/svelar/*': [join(root, 'src/*/index.ts')], '$lib/*': [join(directory, 'src/lib/*')] } };
  const host = ts.createCompilerHost(options);
  const read = host.readFile.bind(host), exists = host.fileExists.bind(host), isDirectory = host.directoryExists!.bind(host);
  host.readFile = (path) => virtual.get(path) ?? read(path);
  host.fileExists = (path) => virtual.has(path) || exists(path);
  host.directoryExists = (path) => [...virtual.keys()].some((file) => file.startsWith(path + '/')) || isDirectory(path);
  host.getSourceFile = (path, languageVersion) => {
    const source = host.readFile(path); return source === undefined ? undefined : ts.createSourceFile(path, source, languageVersion, true);
  };
  const program = ts.createProgram([...virtual.keys(), join(root, 'src/types/externals.d.ts')], options, host);
  return ts.getPreEmitDiagnostics(program).map((item) => item.file?.fileName + ': ' + ts.flattenDiagnosticMessageText(item.messageText, '\n'));
}
function evaluate(source: string, dependencies: Record<string, unknown>): any {
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  new Function('exports', 'require', 'module', compiled)(module.exports, (name: string) => {
    if (!(name in dependencies)) throw new Error('Unbound invitation import: ' + name);
    return dependencies[name];
  }, module);
  return module.exports;
}
function harness(provider: ValidationProvider) {
  const dependencies: Record<string, any> = {
    '@beeblock/svelar/routing': { Controller, Resource, FormRequest, FormAuthorizationError, FormValidationError },
    '@beeblock/svelar/actions': { Action }, '@beeblock/svelar/services': { Service },
    '@beeblock/svelar/repositories': { Repository }, '@beeblock/svelar/orm': { Model },
    '@beeblock/svelar/teams': { Teams }, '@beeblock/svelar/middleware': { CsrfMiddleware },
    '@beeblock/svelar/config': { config: { get: (_path: string, fallback: unknown) => fallback } },
    '@beeblock/svelar/validation': { z }, valibot: v,
    '@sveltejs/kit': { fail }, 'sveltekit-superforms/server': { superValidate }, 'sveltekit-superforms/adapters': { zod4, valibot },
  };
  dependencies['$lib/modules/team/invitation.schema.js'] = evaluate(T.invitationSchema(provider), dependencies);
  for (const [name, template] of Object.entries(templates)) dependencies['$lib/modules/team/' + name + '.js'] = evaluate(T.applyValidationProvider(template(), provider), dependencies);
  const controller = new dependencies['$lib/modules/team/InvitationController.js'].InvitationController();
  const event = (token: string, user: { id: string; email: string } | null, method = 'GET', csrf = true, body: unknown = {}) => createRequestEvent({
    url: 'https://app.example/invitations/' + token, params: { token }, method, body: method === 'GET' ? undefined : body,
    headers: csrf ? { Cookie: 'XSRF-TOKEN=proof', 'X-CSRF-Token': 'proof' } : { Cookie: 'XSRF-TOKEN=proof' }, locals: { user, auth: user ? { id: () => user.id } : undefined },
  });
  return { controller, event, dependencies };
}
afterEach(() => vi.restoreAllMocks());

describe.each<ValidationProvider>(['zod', 'valibot'])('Invitation scaffold (%s)', (provider) => {
  it.each([false, true])('strictly compiles all server artifacts in flat=%s', (flat) => {
    expect(check(files(provider, flat))).toEqual([]);
  }, 60_000);
  it.each([false, true])('has zero unfiltered architecture findings in flat=%s', (flat) => {
    const directory = mkdtempSync(join(root, '.test-invitation-scaffold-'));
    try {
      for (const [path, source] of Object.entries(files(provider, flat))) { const file = join(directory, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, source); }
      expect(new LintArchitectureCommand().scanProject(join(directory, 'src'))).toEqual([]);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it('compiles the Svelte 5 page with configured validation, named forms and duplicate-submit blocking', () => {
    const source = T.applyValidationProvider(T.invitationPageSvelte(), provider);
    expect(() => compile(source, { filename: 'Invitation.svelte', generate: 'server' })).not.toThrow();
    expect(source).toContain('formaction="?/decline"');
    expect(source).toContain('disabled={$submitting}');
    expect(source).not.toContain('invitation.email');
  });

  it('keeps anonymous previews readonly and reveals neither invited email nor team details', async () => {
    const h = harness(provider); const lookup = vi.spyOn(Teams, 'lookupInvitation');
    const response = await h.controller.preview(h.event(randomUUID(), null));
    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ data: { state: 'authentication_required', invitation: null }, meta: { status: 401 } });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('uses real DTO/actions/service/repository/model and rejects anonymous, wrong-email and CSRF writes', async () => {
    Teams.configure({ driver: 'memory', roles: ['owner', 'admin', 'member', 'viewer'], maxTeamsPerUser: undefined, invitationExpiryHours: 1 });
    const team = await Teams.create({ name: 'Scaffold ' + randomUUID(), ownerId: randomUUID() });
    const invitation = await Teams.invite(team.id, 'recipient@example.test', 'viewer');
    const h = harness(provider); const actor = { id: randomUUID(), email: 'recipient@example.test' };
    expect((await h.controller.accept(h.event(invitation.token, null, 'POST'))).status).toBe(401);
    expect((await h.controller.accept(h.event(invitation.token, { ...actor, email: 'foreign@example.test' }, 'POST'))).status).toBe(403);
    expect((await h.controller.accept(h.event(invitation.token, actor, 'POST', false))).status).toBe(419);
    expect((await Teams.lookupInvitation(invitation.token))!.state).toBe('pending');
    const response = await h.controller.accept(h.event(invitation.token, actor, 'POST', true, { token: randomUUID(), userId: 'attacker', email: 'attacker@example.test', role: 'owner' }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ data: { state: 'accepted', invitation: { role: 'viewer', team: { id: team.id } } }, meta: { status: 200, message: 'Invitation accepted.' } });
    expect(JSON.stringify(body)).not.toContain('recipient@example.test');
    expect(await Teams.hasRole(team.id, actor.id, 'viewer')).toBe(true);
    expect(await Teams.isMember(team.id, 'attacker')).toBe(false);
  });

  it('previews honest expired/accepted/missing states and preserves controlled page envelopes on decline', async () => {
    Teams.configure({ driver: 'memory', invitationExpiryHours: 1 });
    const team = await Teams.create({ name: 'States ' + randomUUID(), ownerId: randomUUID() });
    const actor = { id: randomUUID(), email: 'recipient@example.test' }; const h = harness(provider);
    expect((await h.controller.preview(h.event(randomUUID(), actor))).status).toBe(404);
    Teams.configure({ driver: 'memory', invitationExpiryHours: -1 });
    const expired = await Teams.invite(team.id, actor.email);
    expect((await h.controller.preview(h.event(expired.token, actor))).status).toBe(410);
    Teams.configure({ driver: 'memory', invitationExpiryHours: 1 });
    const invitation = await Teams.invite(team.id, actor.email);
    const page = await h.controller.previewPage(h.event(invitation.token, actor));
    expect(page).toMatchObject({ data: { state: 'pending' }, meta: { status: 200, form: { valid: true } } });
    expect((await Teams.lookupInvitation(invitation.token))!.state).toBe('pending');
    const result = await h.controller.declinePage(h.event(invitation.token, actor, 'POST'));
    expect(result).toMatchObject({ data: { state: 'declined' }, meta: { status: 200, form: { valid: true } } });
    expect(await Teams.lookupInvitation(invitation.token)).toBeNull();
    expect(await Teams.isMember(team.id, actor.id)).toBe(false);
    const consumed = await Teams.invite(team.id, actor.email);
    await h.controller.accept(h.event(consumed.token, actor, 'POST'));
    expect((await h.controller.preview(h.event(consumed.token, actor))).status).toBe(409);
    const repeat = await h.controller.declinePage(h.event(consumed.token, actor, 'POST'));
    expect(repeat).toMatchObject({ status: 409, data: { data: { state: 'accepted' }, meta: { status: 409 } } });
  });

  it('binds a named UUID primary key through the real configured AuthManager constructor', async () => {
    class Account extends Model { static primaryKey = 'account_uuid'; static fillable = ['account_uuid', 'email']; }
    const id = randomUUID();
    const user = new Account({ account_uuid: id, email: 'recipient@example.test' });
    expect(user.getAttribute('id')).toBeUndefined();
    vi.spyOn(Account, 'find').mockResolvedValue(user);
    const auth = new AuthManager({ guard: 'session', model: Account, audit: false });
    expect(await auth.login(user)).toBe(user);
    expect(auth.id()).toBe(id);
    Teams.configure({ driver: 'memory', invitationExpiryHours: 1 });
    const team = await Teams.create({ name: 'Named key ' + randomUUID(), ownerId: randomUUID() });
    const invitation = await Teams.invite(team.id, 'recipient@example.test', 'viewer');
    const h = harness(provider); const event = h.event(invitation.token, null, 'POST');
    event.locals.user = user; event.locals.auth = auth;
    expect((await h.controller.accept(event)).status).toBe(200);
    expect(await Teams.hasRole(team.id, id, 'viewer')).toBe(true);
  });
});
