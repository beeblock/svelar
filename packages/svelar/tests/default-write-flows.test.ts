import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import { z } from 'zod';
import * as v from 'valibot';
import { NewCommandTemplates as T, type ValidationProvider } from '../src/cli/commands/NewCommandTemplates.js';
import { transformScaffoldFile } from '../src/cli/commands/NewCommand.js';
import { LintArchitectureCommand } from '../src/cli/commands/LintArchitectureCommand.js';
import { FormRequest, FormAuthorizationError, FormValidationError } from '../src/routing/FormRequest.js';
import { Action } from '../src/actions/index.js';
import { CrudService } from '../src/services/index.js';
import { GateManager, AuthorizationError } from '../src/auth/Gate.js';
import { Controller } from '../src/routing/Controller.js';
import { Resource } from '../src/routing/Resource.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = {
  auth: {
    User: T.userModel, UserRepository: T.userRepository, UserRegistered: T.userRegisteredEvent,
    UserResource: T.userResource, AuthService: T.authService, AuthController: T.authController,
    RegisterUserDto: T.registerUserDto, LoginDto: T.loginDto, ForgotPasswordDto: T.forgotPasswordDto,
    ResetPasswordDto: T.resetPasswordDto, OtpSendDto: T.otpSendDto, OtpVerifyDto: T.otpVerifyDto,
    LogoutDto: T.logoutDto, VerifyEmailDto: T.verifyEmailDto,
    RegisterRequest: T.registerRequest, LoginRequest: T.loginRequest, ForgotPasswordRequest: T.forgotPasswordRequest,
    ResetPasswordRequest: T.resetPasswordRequest, OtpSendRequest: T.otpSendRequest, OtpVerifyRequest: T.otpVerifyRequest,
    LogoutRequest: T.logoutRequest, VerifyEmailRequest: T.verifyEmailRequest,
    RegisterUserAction: T.registerUserAction, LoginAction: T.loginAction, ForgotPasswordAction: T.forgotPasswordAction,
    ResetPasswordAction: T.resetPasswordAction, SendOtpAction: T.sendOtpAction, VerifyOtpAction: T.verifyOtpAction,
    LogoutAction: T.logoutAction, VerifyEmailAction: T.verifyEmailAction,
  },
  posts: {
    Post: T.postModel, PostRepository: T.postRepository, PostResource: T.postResource,
    PostService: T.postService, PostController: T.postController,
    CreatePostDto: T.createPostDto, UpdatePostDto: T.updatePostDto, DeletePostDto: T.deletePostDto,
    CreatePostRequest: T.createPostRequest, UpdatePostRequest: T.updatePostRequest, DeletePostRequest: T.deletePostRequest,
    CreatePostAction: T.createPostAction, UpdatePostAction: T.updatePostAction, DeletePostAction: T.deletePostAction,
  },
};
const pages = {
  login: T.loginPageServer, register: T.registerPageServer, logout: T.logoutPageServer,
  'forgot-password': T.forgotPasswordPageServer, 'reset-password': T.resetPasswordPageServer,
  'otp-login': T.otpLoginPageServer, 'verify-email': T.verifyEmailPageServer,
};

function fixtureFiles(provider: ValidationProvider, flat: boolean): Record<string, string> {
  const files: Record<string, string> = {};
  const add = (path: string, source: string) => {
    const file = transformScaffoldFile(path, T.applyValidationProvider(T.reviewedAccess(path, source), provider), flat);
    files[file.path] = file.content;
  };
  add('src/svelar.d.ts', T.appDts());
  add('src/lib/shared/components/auth-links.ts', T.authLinkHelper());
  for (const [module, templates] of Object.entries(artifacts)) {
    for (const [name, template] of Object.entries(templates)) add(`src/lib/modules/${module}/${name}.ts`, template());
    add(`src/lib/modules/${module}/schemas.ts`, module === 'auth' ? T.authSchema(provider) : T.postSchema(provider));
  }
  files['src/app.ts'] = `export const authConfig = { appName: 'Test', otpEnabled: true, rememberEnabled: true, emailVerificationRequired: false };
export function authRedirect(url: URL): string { return url.pathname; }
`;
  for (const [name, template] of Object.entries(pages)) {
    add(`src/routes/${name}/+page.server.ts`, template());
    files[`src/routes/${name}/$types.ts`] = `export type Actions = import('@sveltejs/kit').Actions<Record<string, string>>;
export type PageServerLoad = import('@sveltejs/kit').ServerLoad<Record<string, string>>;
`;
  }
  return files;
}

function diagnostics(files: Record<string, string>): string[] {
  const root = join(packageRoot, '.virtual-default-write-flows');
  const virtual = new Map(Object.entries(files).map(([path, source]) => [join(root, path), source]));
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true, skipLibCheck: true, noEmit: true, esModuleInterop: true, types: ['node'],
    paths: { '@beeblock/svelar/*': [join(packageRoot, 'src/*/index.ts')], '$lib/*': [join(root, 'src/lib/*')] },
  };
  const host = ts.createCompilerHost(options);
  const originalRead = host.readFile.bind(host);
  const originalExists = host.fileExists.bind(host);
  const originalDirectory = host.directoryExists?.bind(host);
  host.readFile = (path) => virtual.get(path) ?? originalRead(path);
  host.fileExists = (path) => virtual.has(path) || originalExists(path);
  host.directoryExists = (path) => [...virtual.keys()].some((file) => file.startsWith(path + '/')) || !!originalDirectory?.(path);
  host.getSourceFile = (path, languageVersion) => {
    const source = host.readFile(path);
    return source === undefined ? undefined : ts.createSourceFile(path, source, languageVersion, true);
  };
  const program = ts.createProgram([...virtual.keys(), join(packageRoot, 'src/types/externals.d.ts')], options, host);
  return ts.getPreEmitDiagnostics(program).map((diagnostic) => `${diagnostic.file?.fileName}:${diagnostic.start} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`);
}

function evaluate(source: string, dependencies: Record<string, unknown>): any {
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const module = { exports: {} };
  new Function('exports', 'require', 'module', compiled.outputText)(module.exports, (name: string) => {
    if (!(name in dependencies)) throw new Error('Unbound generated import: ' + name);
    return dependencies[name];
  }, module);
  return module.exports;
}

function postHarness(provider: ValidationProvider) {
  const schemas = evaluate(T.postSchema(provider), { '@beeblock/svelar/validation': { z }, valibot: v });
  const dependencies: Record<string, any> = {
    '@beeblock/svelar/forms': { FormRequest },
    '@beeblock/svelar/routing': { Controller, Resource, FormRequest, FormAuthorizationError, FormValidationError },
    '@beeblock/svelar/actions': { Action },
    '@beeblock/svelar/services': { CrudService },
    '$lib/modules/posts/schemas.js': schemas,
  };
  const post = { id: 4, user_id: 9 };
  const repository = {
    create: vi.fn(async (data: any) => ({ ...data, id: 4 })),
    findByIdOrFail: vi.fn(async () => post),
    update: vi.fn(async (_id: string, patch: any) => ({ ...post, ...patch })),
    delete: vi.fn(async () => {}),
  };
  dependencies['$lib/modules/posts/PostRepository.js'] = { PostRepository: class { constructor() { return repository; } } };
  const gate = new GateManager();
  for (const ability of ['edit-post', 'delete-post']) gate.define(ability, (user, resource) => user.id === resource.user_id);
  const authorize = vi.spyOn(gate, 'authorize');
  dependencies['@beeblock/svelar/auth'] = { Gate: gate, AuthorizationError };
  dependencies['@beeblock/svelar/broadcasting'] = { Broadcast: { event: () => ({ on: () => ({ send: async () => {} }) }) } };
  for (const name of ['CreatePostDto', 'UpdatePostDto', 'DeletePostDto'] as const) {
    dependencies[`$lib/modules/posts/${name}.js`] = evaluate(artifacts.posts[name](), dependencies);
  }
  dependencies['$lib/modules/posts/PostService.js'] = evaluate(T.postService(), dependencies);
  const requests = Object.fromEntries(['CreatePostRequest', 'UpdatePostRequest', 'DeletePostRequest'].map((name) => {
    const exported = evaluate(artifacts.posts[name as keyof typeof artifacts.posts](), dependencies);
    dependencies[`$lib/modules/posts/${name}.js`] = exported;
    return [name, exported[name]];
  }));
  const actions = Object.fromEntries(['CreatePostAction', 'UpdatePostAction', 'DeletePostAction'].map((name) => {
    const exported = evaluate(artifacts.posts[name as keyof typeof artifacts.posts](), dependencies);
    dependencies[`$lib/modules/posts/${name}.js`] = exported;
    return [name, exported[name]];
  }));
  dependencies['$lib/modules/posts/PostResource.js'] = evaluate(T.postResource(), dependencies);
  const event = (data: Record<string, unknown>, id = '4', user: { id: number } | null = { id: 9 }) => ({
    request: new Request('https://app.example/api/posts/' + id, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }),
    url: new URL('https://app.example/api/posts/' + id), params: { id }, locals: { user },
  });
  return { requests, actions, repository, authorize, event, dependencies,
    controller: () => new (evaluate(T.postController(), dependencies).PostController)() };
}

describe.each<ValidationProvider>(['zod', 'valibot'])('Default write contracts (%s)', (provider) => {
  it('keeps FormRequest and instanceof error constructors on the same published routing entry', () => {
    for (const name of ['RegisterRequest', 'LoginRequest', 'ForgotPasswordRequest', 'ResetPasswordRequest', 'OtpSendRequest', 'OtpVerifyRequest', 'LogoutRequest', 'VerifyEmailRequest'] as const) {
      const source = artifacts.auth[name]();
      expect(source).toContain("import { FormRequest } from '@beeblock/svelar/routing'");
      expect(source).not.toContain('@beeblock/svelar/forms');
    }
    for (const name of ['CreatePostRequest', 'UpdatePostRequest', 'DeletePostRequest'] as const) {
      expect(artifacts.posts[name]()).toContain("import { FormRequest } from '@beeblock/svelar/routing'");
    }
    expect(T.verifyEmailPageServer()).toContain("import { FormValidationError } from '@beeblock/svelar/routing'");
  });

  it.each([false, true])('strictly compiles every DTO/request/action/service/controller/page (flat=%s)', (flat) => {
    expect(diagnostics(fixtureFiles(provider, flat))).toEqual([]);
  }, 60_000);

  it.each([false, true])('has zero unfiltered architecture findings in its generated workflows (flat=%s)', (flat) => {
    const root = mkdtempSync(join(packageRoot, '.test-default-write-flows-'));
    try {
      for (const [path, source] of Object.entries(fixtureFiles(provider, flat))) {
        const file = join(root, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, source);
      }
      expect(new LintArchitectureCommand().scanProject(join(root, 'src'))).toEqual([]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('makes DTOs from shared validation, narrows create data and never accepts an actor in payload', async () => {
    const h = postHarness(provider);
    const dto = await h.requests.CreatePostRequest.validate(h.event({ title: 'New post', body: 'A sufficiently long body', user_id: 88, role: 'admin' }));
    expect(dto).toBeInstanceOf(h.dependencies['$lib/modules/posts/CreatePostDto.js'].CreatePostDto);
    expect(dto).toEqual({ title: 'New post', slug: 'new-post', body: 'A sufficiently long body', published: false });
    await new h.actions.CreatePostAction({ id: 9 }).run(dto);
    expect(h.repository.create).toHaveBeenCalledWith({ ...dto, user_id: 9 });
    await expect(h.requests.CreatePostRequest.validate(h.event({ title: '!!!', body: 'A sufficiently long body' }))).rejects.toBeInstanceOf(FormValidationError);
  });

  it('binds update/delete identity to the route and checks the real service policy boundary', async () => {
    const h = postHarness(provider);
    const update = await h.requests.UpdatePostRequest.validate(h.event({ id: '999', title: 'Changed title', user_id: 88 }));
    expect(update.id).toBe('4');
    await new h.actions.UpdatePostAction({ id: 9 }).run(update);
    expect(h.repository.update).toHaveBeenCalledWith('4', { title: 'Changed title' });
    expect(h.authorize).toHaveBeenCalledWith('edit-post', { id: 9 }, { id: 4, user_id: 9 });
    await expect(new h.actions.UpdatePostAction({ id: 88 }).run(update)).rejects.toBeInstanceOf(AuthorizationError);
    const deletion = await h.requests.DeletePostRequest.validate(h.event({ id: '999' }));
    await expect(new h.actions.DeletePostAction({ id: 88 }).run(deletion)).rejects.toBeInstanceOf(AuthorizationError);
    expect(h.repository.delete).not.toHaveBeenCalled();
    await new h.actions.DeletePostAction({ id: 9 }).run(deletion);
    expect(h.repository.delete).toHaveBeenCalledWith('4');
    for (const name of ['UpdatePostRequest', 'DeletePostRequest']) {
      await expect(h.requests[name].validate(h.event({}, '4', null))).rejects.toBeInstanceOf(FormAuthorizationError);
      await expect(h.requests[name].validate(h.event({}, 'invalid'))).rejects.toBeInstanceOf(FormValidationError);
    }
  });

  it('rejects direct HTTP update/delete for a foreign actor before any persistence', async () => {
    const h = postHarness(provider);
    const controller = h.controller();
    for (const [method, data] of [['update', { title: 'Changed title' }], ['destroy', {}]] as const) {
      const response = await controller.handle(method)(h.event(data, '4', { id: 88 }));
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ data: null, meta: { message: expect.any(String) } });
    }
    expect(h.repository.update).not.toHaveBeenCalled();
    expect(h.repository.delete).not.toHaveBeenCalled();
  });
});
