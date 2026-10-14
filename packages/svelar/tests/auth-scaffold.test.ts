import { afterEach, describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import { compile } from 'svelte/compiler';
import * as svelteServer from 'svelte/internal/server';
import { render } from 'svelte/server';
import { get, writable } from 'svelte/store';
import * as kit from '@sveltejs/kit';
import * as superforms from 'sveltekit-superforms/server';
import * as adapters from 'sveltekit-superforms/adapters';
import { z } from 'zod';
import * as v from 'valibot';
import { NewCommandTemplates as T, type ValidationProvider } from '../src/cli/commands/NewCommandTemplates.js';
import { AuthManager } from '../src/auth/Auth.js';
import { authFailurePresentation } from '../src/auth/Presentation.js';
import { Hash } from '../src/hashing/Hash.js';
import { ThrottleMiddleware } from '../src/middleware/Middleware.js';
import { Controller } from '../src/routing/Controller.js';
import { Resource } from '../src/routing/Resource.js';
import { FormRequest, FormAuthorizationError, FormValidationError } from '../src/routing/FormRequest.js';
import { Action } from '../src/actions/index.js';
import { Service } from '../src/services/index.js';
import { Session } from '../src/session/Session.js';

// Execute generated code with its real validation/HTTP contracts and bounded app dependencies.
function evaluate(source: string, dependencies: Record<string, any>): any {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  expect(compiled.diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)).toEqual([]);
  const module = { exports: {} };
  const require = (id: string) => {
    if (!(id in dependencies)) throw new Error(`Unbound generated import: ${id}`);
    return dependencies[id];
  };
  new Function('exports', 'require', 'module', compiled.outputText)(module.exports, require, module);
  return module.exports;
}

function authSettings(config: any): any {
  const source = ts.createSourceFile('app.ts', T.appTs(), ts.ScriptTarget.Latest, true);
  const selected = source.statements.filter((statement) =>
    (ts.isVariableStatement(statement) && statement.declarationList.declarations.some((declaration) => declaration.name.getText(source) === 'authConfig'))
    || (ts.isFunctionDeclaration(statement) && statement.name?.text === 'authRedirect'));
  expect(selected).toHaveLength(2);
  return evaluate("import { config } from '@beeblock/svelar/config';\n" + selected.map((statement) => statement.getText(source)).join('\n'), {
    '@beeblock/svelar/config': { config },
  });
}

function harness(provider: ValidationProvider, settings: Record<string, any> = {}) {
  vi.stubEnv('RATE_LIMIT_STORE', 'memory');
  vi.stubEnv('AUTH_OTP_ENABLED', 'false');
  const values = new Map<string, any>(Object.entries({ 'app.name': 'Acme Workspace', ...settings }));
  const config = { get: (key: string, fallback: any) => values.has(key) ? values.get(key) : fallback };
  const app = authSettings(config);
  const schemas = evaluate(T.authSchema(provider), {
    '@beeblock/svelar/validation': { z },
    '@beeblock/svelar/validation/valibot': { v },
  });
  const dependencies: Record<string, any> = {
    '@sveltejs/kit': kit,
    'sveltekit-superforms': superforms,
    'sveltekit-superforms/adapters': adapters,
    '@beeblock/svelar/forms': { FormRequest, FormValidationError },
    '@beeblock/svelar/routing': { Controller, Resource, FormRequest, FormAuthorizationError, FormValidationError },
    '@beeblock/svelar/config': { config },
    '@beeblock/svelar/middleware': { ThrottleMiddleware },
    '@beeblock/svelar/auth': { authFailurePresentation },
    '@beeblock/svelar/actions': { Action },
    '@beeblock/svelar/services': { Service },
    '@beeblock/svelar/hashing': { Hash },
    '@beeblock/svelar/events': { Event: { dispatch: vi.fn(async () => {}) } },
    './schemas.js': schemas,
    '$lib/modules/auth/schemas': schemas,
    '$lib/modules/auth/schemas.js': schemas,
    '$lib/shared/components/auth-links.js': evaluate(T.authLinkHelper(), {}),
    '../../app.js': app,
  };
  const dtoTemplates = {
    RegisterUserDto: T.registerUserDto, LoginDto: T.loginDto,
    ForgotPasswordDto: T.forgotPasswordDto, ResetPasswordDto: T.resetPasswordDto,
    OtpSendDto: T.otpSendDto, OtpVerifyDto: T.otpVerifyDto,
    LogoutDto: T.logoutDto, VerifyEmailDto: T.verifyEmailDto,
  };
  for (const [name, template] of Object.entries(dtoTemplates)) {
    dependencies[`./${name}.js`] = dependencies[`$lib/modules/auth/${name}.js`] = evaluate(template(), dependencies);
  }
  const requestTemplates = {
    RegisterRequest: T.registerRequest,
    LoginRequest: T.loginRequest,
    ForgotPasswordRequest: T.forgotPasswordRequest,
    ResetPasswordRequest: T.resetPasswordRequest,
    OtpSendRequest: T.otpSendRequest,
    OtpVerifyRequest: T.otpVerifyRequest,
    LogoutRequest: T.logoutRequest,
    VerifyEmailRequest: T.verifyEmailRequest,
  };
  for (const [name, template] of Object.entries(requestTemplates)) {
    const request = evaluate(template(), dependencies);
    dependencies[`./${name}.js`] = request;
    dependencies[`$lib/modules/auth/${name}`] = request;
    dependencies[`$lib/modules/auth/${name}.js`] = request;
  }
  const users = {
    findByEmail: vi.fn(async (_email: string): Promise<any> => ({ id: 7 })),
    create: vi.fn(async (_input: any): Promise<any> => null),
  };
  class UserRepository { findByEmail = users.findByEmail; create = users.create; }
  dependencies['$lib/modules/auth/UserRepository.js'] = { UserRepository };
  dependencies['$lib/modules/auth/UserRegistered.js'] = { UserRegistered: class { constructor(readonly user: unknown) {} } };
  const service = evaluate(T.authService(), dependencies);
  const registration = vi.spyOn(service.AuthService.prototype, 'register');
  dependencies['./AuthService.js'] = service;
  dependencies['$lib/modules/auth/AuthService.js'] = service;
  const actionTemplates = {
    RegisterUserAction: T.registerUserAction, LoginAction: T.loginAction, LogoutAction: T.logoutAction,
    ForgotPasswordAction: T.forgotPasswordAction, ResetPasswordAction: T.resetPasswordAction,
    SendOtpAction: T.sendOtpAction, VerifyOtpAction: T.verifyOtpAction, VerifyEmailAction: T.verifyEmailAction,
  };
  for (const [name, template] of Object.entries(actionTemplates)) {
    dependencies[`./${name}.js`] = dependencies[`$lib/modules/auth/${name}`] = dependencies[`$lib/modules/auth/${name}.js`] = evaluate(template(), dependencies);
  }
  dependencies['$lib/modules/auth/UserResource.js'] = evaluate(T.userResource(), dependencies);
  const page = (template: () => string) => evaluate(T.applyValidationProvider(template(), provider), dependencies);
  const event = (fields: Record<string, string> = {}, path = '/login') => {
    const url = new URL(path, 'https://app.example');
    const body = new URLSearchParams(fields);
    return {
      request: new Request(url, { method: 'POST', body }),
      url,
      params: {},
      getClientAddress: () => '192.0.2.1',
      locals: {
        user: null,
        session: new Session('before-login'),
        auth: {
          attempt: vi.fn(async (_dto: any, _session: any): Promise<any> => null),
          login: vi.fn(async (_user: any, _session: any): Promise<any> => null),
          failureReason: vi.fn(() => 'invalid_credentials'),
          logout: vi.fn(async (_session: any) => {}),
          sendPasswordReset: vi.fn(async (_email: string) => false),
          resetPassword: vi.fn(async (_token: string, _email: string, _password: string) => false),
          sendOtp: vi.fn(async (_email: string) => false),
          attemptOtp: vi.fn(async (_email: string, _code: string, _session: any): Promise<any> => null),
          verifyEmail: vi.fn(async (_token: string, _id: string) => false),
          sendVerificationEmail: vi.fn(async (_user: any) => {}),
        },
      },
    };
  };
  return { page, event, schemas, app, values, config, dependencies, registration, users,
    controller: () => new (evaluate(T.authController(), dependencies).AuthController)() };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe.each<ValidationProvider>(['zod', 'valibot'])('Production auth scaffold (%s)', (provider) => {
  it('loads configured branding and does not expose config secrets', async () => {
    const h = harness(provider, { 'auth.otp.enabled': true, 'auth.jwt.secret': 'not-public' });
    for (const template of [T.loginPageServer, T.registerPageServer, T.forgotPasswordPageServer, T.resetPasswordPageServer, T.otpLoginPageServer, T.verifyEmailPageServer]) {
      const data = await h.page(template).load(h.event({}, '/login?token=reset-token&email=user%40example.com&reset=success'));
      expect(data.appName).toBe('Acme Workspace');
      expect(JSON.stringify(data)).not.toContain('not-public');
    }
    const login = await h.page(T.loginPageServer).load(h.event({}, '/login?reset=success'));
    expect(login).toMatchObject({ otpEnabled: true, passwordReset: true });
    expect(T.envExample()).toContain('AUTH_OTP_ENABLED=false');
  });

  it('returns inline invalid-credentials feedback with no reflected password', async () => {
    const h = harness(provider);
    const event = h.event({ email: 'user@example.com', password: 'wrong-secret' });
    const result = await h.page(T.loginPageServer).actions.default(event);
    expect(result).toMatchObject({ status: 401, data: { form: { message: 'Invalid email or password.', data: { email: 'user@example.com', password: '' } } } });
    expect(JSON.stringify(result)).not.toContain('wrong-secret');
    expect(event.locals.auth.attempt).toHaveBeenCalledWith({ email: 'user@example.com', password: 'wrong-secret' }, event.locals.session, { remember: false });
    expect(event.locals.session.id).toBe('before-login');
    expect(event.locals.session.has('auth_user_id')).toBe(false);
  });

  it('redacts secrets on validation and rate-limit failures', async () => {
    const h = harness(provider);
    const login = h.page(T.loginPageServer);
    const invalid = await login.actions.default(h.event({ email: 'invalid', password: 'secret-sentinel' }));
    expect(invalid.status).toBe(400);
    expect(invalid.data.form.errors.email).toHaveLength(1);
    expect(invalid.data.form.data.password).toBe('');
    for (let i = 0; i < 4; i++) await login.actions.default(h.event({ email: 'user@example.com', password: 'secret-sentinel' }));
    const blockedEvent = h.event({ email: 'user@example.com', password: 'secret-sentinel' });
    const blocked = await login.actions.default(blockedEvent);
    expect(blocked.status).toBe(429);
    expect(JSON.stringify(blocked)).not.toContain('secret-sentinel');
    expect(blockedEvent.locals.auth.attempt).not.toHaveBeenCalled();

    for (const template of [T.registerPageServer, T.resetPasswordPageServer]) {
      const result = await h.page(template).actions.default(h.event({ email: 'invalid', password: 'secret-sentinel', password_confirmation: 'confirmation-sentinel' }));
      expect(result.status).toBe(400);
      expect(result.data.form.data.password).toBe('');
      expect(result.data.form.data.password_confirmation).toBe('');
      expect(JSON.stringify(result)).not.toMatch(/secret-sentinel|confirmation-sentinel/);
    }
  });

  it('uses the existing registration action with a narrowed DTO and clears both passwords', async () => {
    const h = harness(provider);
    const result = await h.page(T.registerPageServer).actions.default(h.event({ name: 'Test User', email: 'user@example.com', password: 'password-sentinel', password_confirmation: 'password-sentinel', role: 'admin' }));
    expect(h.registration).toHaveBeenCalledWith({ name: 'Test User', email: 'user@example.com', password: 'password-sentinel' });
    expect(result.data.form.errors.email).toEqual(['Email already registered']);
    expect(result.data.form.data.password).toBe('');
    expect(result.data.form.data.password_confirmation).toBe('');
    expect(JSON.stringify(result)).not.toContain('password-sentinel');
  });

  it('clears reset passwords while passing the submitted secret to the auth API', async () => {
    const h = harness(provider);
    const event = h.event({ token: 'reset-token', email: 'user@example.com', password: 'password-sentinel', password_confirmation: 'password-sentinel' });
    const result = await h.page(T.resetPasswordPageServer).actions.default(event);
    expect(event.locals.auth.resetPassword).toHaveBeenCalledWith('reset-token', 'user@example.com', 'password-sentinel');
    expect(result.status).toBe(400);
    expect(result.data.form.message).toContain('Invalid or expired reset link');
    expect(JSON.stringify(result)).not.toContain('password-sentinel');
    const validEvent = h.event({ token: 'reset-token', email: 'user@example.com', password: 'password-sentinel', password_confirmation: 'password-sentinel' });
    validEvent.locals.auth.resetPassword.mockResolvedValue(true);
    await expect(h.page(T.resetPasswordPageServer).actions.default(validEvent)).rejects.toMatchObject({ status: 303, location: '/login?reset=success' });
  });

  it('uses the request-local auth manager and rotates the real session on successful login', async () => {
    const h = harness(provider);
    Hash.configure({ driver: 'scrypt' });
    const password = await Hash.make('valid-password');
    const user = { getAttribute: (key: string) => ({ id: 42, email: 'user@example.com', password })[key as 'id' | 'email' | 'password'] };
    const auth = new AuthManager({ guard: 'session', model: { where: () => ({ first: async () => user }) } });
    const event = h.event({ email: 'user@example.com', password: 'valid-password' }, '/login?redirectTo=%2Fbilling%3Ftab%3Dinvoices');
    event.locals.auth = auth.fork() as any;
    await expect(h.page(T.loginPageServer).actions.default(event)).rejects.toMatchObject({ status: 303, location: '/billing?tab=invoices' });
    expect(event.locals.session.get('auth_user_id')).toBe(42);
    expect(event.locals.session.id).not.toBe('before-login');
    expect(auth.user()).toBeNull();
    expect((event.locals.auth as any).user()).toBe(user);
  });

  it('uses configured registration verification and internal redirects', async () => {
    const h = harness(provider, { 'auth.emailVerification.required': true, 'auth.redirectTo': '/workspace' });
    const user = { id: 7, name: 'Test User', email: 'user@example.com' };
    h.users.findByEmail.mockResolvedValue(null);
    h.users.create.mockResolvedValue(user);
    const event = h.event({ name: 'Test User', email: 'user@example.com', password: 'valid-password', password_confirmation: 'valid-password' }, '/register');
    await expect(h.page(T.registerPageServer).actions.default(event)).rejects.toMatchObject({ status: 303, location: '/login?reason=email-unverified&redirectTo=%2Fworkspace' });
    expect(event.locals.auth.sendVerificationEmail).toHaveBeenCalledWith(user);
    expect(event.locals.session.id).toBe('before-login');
    expect(event.locals.session.has('auth_user_id')).toBe(false);
  });

  it('rejects a missing reset token before calling the auth API', async () => {
    const h = harness(provider);
    const event = h.event({ token: '', email: 'user@example.com', password: 'valid-password', password_confirmation: 'valid-password' });
    const result = await h.page(T.resetPasswordPageServer).actions.default(event);
    expect(result.status).toBe(400);
    expect(result.data.form.errors.token).toEqual(['Reset token is required']);
    expect(event.locals.auth.resetPassword).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('valid-password');
  });

  it('preserves a validated destination through disabled OTP and password recovery redirects', async () => {
    const h = harness(provider);
    const destination = '/invitations/team-token?source=mail#accept';
    const query = new URLSearchParams({ redirectTo: destination });
    await expect(h.page(T.otpLoginPageServer).load(h.event({}, `/otp-login?${query}`)))
      .rejects.toMatchObject({ status: 302, location: `/login?${query}` });
    await expect(h.page(T.resetPasswordPageServer).load(h.event({}, `/reset-password?${query}`)))
      .rejects.toMatchObject({ status: 302, location: `/forgot-password?${query}` });
    const event = h.event({ token: 'reset-token', email: 'user@example.com', password: 'valid-password', password_confirmation: 'valid-password' }, `/reset-password?${query}`);
    event.locals.auth.resetPassword.mockResolvedValue(true);
    await expect(h.page(T.resetPasswordPageServer).actions.default(event))
      .rejects.toMatchObject({ status: 303, location: `/login?reset=success&${query}` });
    await expect(h.page(T.otpLoginPageServer).load(h.event({}, '/otp-login?redirectTo=https://evil.example')))
      .rejects.toMatchObject({ status: 302, location: '/login' });
  });

  it('rejects disabled OTP page posts and direct API calls before invoking auth', async () => {
    const h = harness(provider);
    const otp = h.page(T.otpLoginPageServer);
    await expect(otp.load(h.event())).rejects.toMatchObject({ status: 302, location: '/login' });
    for (const [action, fields] of [['send', { email: 'user@example.com' }], ['verify', { email: 'user@example.com', code: '123456' }]] as const) {
      const event = h.event(fields, '/otp-login');
      const result = await otp.actions[action](event);
      expect(result.status).toBe(403);
      expect(event.locals.auth.sendOtp).not.toHaveBeenCalled();
      expect(event.locals.auth.attemptOtp).not.toHaveBeenCalled();
      const response = await h.controller().handle(action === 'send' ? 'sendOtp' : 'verifyOtp')(h.event(fields, '/api/auth/otp'));
      expect(response.status).toBe(403);
    }
    h.values.set('auth.otp.enabled', 'false');
    expect(await new h.dependencies['./OtpSendRequest.js'].OtpSendRequest().authorize(h.event())).toBe(false);
  });

  it('keeps OTP retry stage and email while clearing invalid codes', async () => {
    const h = harness(provider, { 'auth.otp.enabled': true });
    const otp = h.page(T.otpLoginPageServer);
    const send = h.event({ email: 'user@example.com' }, '/otp-login');
    const sent = await otp.actions.send(send);
    expect(sent).toMatchObject({ codeSent: true, email: 'user@example.com', verifyForm: { id: 'otp-verify', data: { email: 'user@example.com' } } });
    expect(send.locals.auth.sendOtp).toHaveBeenCalledWith('user@example.com');
    for (const code of ['abcdef', '123456']) {
      const event = h.event({ email: 'user@example.com', code }, '/otp-login');
      const result = await otp.actions.verify(event);
      expect(result).toMatchObject({ status: code === 'abcdef' ? 400 : 401, data: { codeSent: true, email: 'user@example.com', verifyForm: { data: { code: '' } } } });
      expect(JSON.stringify(result)).not.toContain(code);
      if (code === '123456') expect(event.locals.auth.attemptOtp).toHaveBeenCalledWith('user@example.com', code, event.locals.session);
      else expect(event.locals.auth.attemptOtp).not.toHaveBeenCalled();
    }
  });

  it('distinguishes recovery success from throttling without leaking account existence', async () => {
    const h = harness(provider);
    const recovery = h.page(T.forgotPasswordPageServer);
    const missing = h.event({ email: 'missing@example.com' }, '/forgot-password');
    const existing = h.event({ email: 'existing@example.com' }, '/forgot-password');
    existing.locals.auth.sendPasswordReset.mockResolvedValue(true);
    const a = await recovery.actions.default(missing);
    const b = await recovery.actions.default(existing);
    expect(a.form.message).toEqual(b.form.message);
    expect(a.form.message.kind).toBe('success');
    await recovery.actions.default(h.event({ email: 'user@example.com' }, '/forgot-password'));
    const blockedEvent = h.event({ email: 'user@example.com' }, '/forgot-password');
    const blocked = await recovery.actions.default(blockedEvent);
    expect(blocked.status).toBe(429);
    expect(blocked.data.form.message.kind).toBe('error');
    expect(blockedEvent.locals.auth.sendPasswordReset).not.toHaveBeenCalled();
  });

  it('uses scoped auth APIs for controller login/logout and the page logout', async () => {
    const h = harness(provider);
    const event = h.event({ email: 'user@example.com', password: 'wrong-secret' });
    const controller = h.controller();
    const result = await controller.login(event);
    expect(result.status).toBe(401);
    expect(await result.json()).toEqual({ data: null, meta: { code: 'invalid_credentials', message: 'Sign-in failed.' } });
    expect(event.locals.auth.attempt).toHaveBeenCalledWith({ email: 'user@example.com', password: 'wrong-secret' }, event.locals.session, { remember: false });
    const logout = h.event({}, '/api/auth/logout');
    const response = await controller.logout(logout);
    expect(await response.json()).toEqual({ data: null, meta: { message: 'Logged out successfully' } });
    expect(logout.locals.auth.logout).toHaveBeenCalledWith(logout.locals.session);
    const pageLogout = h.event({}, '/logout');
    await expect(h.page(T.logoutPageServer).actions.default(pageLogout)).rejects.toMatchObject({ status: 303, location: '/' });
    expect(pageLogout.locals.auth.logout).toHaveBeenCalledWith(pageLogout.locals.session);
  });

  it('validates verification links before invoking the named action and returns consistent API envelopes', async () => {
    const h = harness(provider);
    const invalid = h.event({}, '/verify-email?token=sentinel&id=invalid');
    invalid.request = new Request(invalid.url);
    expect(await h.page(T.verifyEmailPageServer).load(invalid)).toMatchObject({ success: false });
    expect(invalid.locals.auth.verifyEmail).not.toHaveBeenCalled();
    const valid = h.event({}, '/verify-email?token=sentinel&id=7');
    valid.request = new Request(valid.url);
    valid.locals.auth.verifyEmail.mockResolvedValue(true);
    expect(await h.page(T.verifyEmailPageServer).load(valid)).toMatchObject({ success: true });
    expect(valid.locals.auth.verifyEmail).toHaveBeenCalledExactlyOnceWith('sentinel', '7');
    const controller = h.controller();
    const badResponse = await controller.handle('verifyEmail')(h.event({}, '/api/auth/verify-email?id=invalid'));
    expect(badResponse.status).toBe(422);
    expect(await badResponse.json()).toMatchObject({ data: null, meta: { errors: { token: expect.any(Array), id: expect.any(Array) } } });
    const api = h.event({}, '/api/auth/verify-email?token=sentinel&id=7');
    api.locals.auth.verifyEmail.mockResolvedValue(true);
    const response = await controller.handle('verifyEmail')(api);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: null, meta: { message: 'Email verified successfully' } });
  });

  it('uses real named API actions for recovery/reset/OTP and projects users through the resource', async () => {
    const h = harness(provider, { 'auth.otp.enabled': true });
    const controller = h.controller();
    const recovery = h.event({ email: 'missing@example.com' }, '/api/auth/forgot-password');
    const sent = await controller.handle('forgotPassword')(recovery);
    expect(await sent.json()).toEqual({ data: null, meta: { message: 'If that email exists, a reset link has been sent.' } });
    expect(recovery.locals.auth.sendPasswordReset).toHaveBeenCalledExactlyOnceWith('missing@example.com');
    const reset = h.event({ token: 'sentinel', email: 'user@example.com', password: 'new-password', password_confirmation: 'new-password' }, '/api/auth/reset-password');
    const failed = await controller.handle('resetPassword')(reset);
    expect(failed.status).toBe(400);
    expect(await failed.json()).toEqual({ data: null, meta: { message: 'Invalid or expired reset link' } });
    const otp = h.event({ email: 'user@example.com', code: '123456' }, '/api/auth/otp/verify');
    otp.locals.auth.attemptOtp.mockResolvedValue({ id: 7, name: 'User', email: 'user@example.com', password: 'never-public' });
    const signedIn = await controller.handle('verifyOtp')(otp);
    expect(signedIn.status).toBe(200);
    expect(await signedIn.json()).toEqual({ data: { id: 7, name: 'User', email: 'user@example.com', role: 'user', created_at: null } });
  });
});

describe('Auth redirect policy', () => {
  it.each(['https://evil.example', '//evil.example', '/\\evil.example', '/%5cevil.example', '/%2f%2fevil.example', '/nested/..//evil.example', '/%0d%0aLocation:evil', '/%00evil', '/%zz'])('rejects unsafe destination %s', (target) => {
    const h = harness('zod');
    const url = new URL('https://app.example/login');
    url.searchParams.set('redirectTo', target);
    expect(h.app.authRedirect(url)).toBe('/dashboard');
  });

  it('accepts only internal paths and validates the configured fallback as well', () => {
    const h = harness('zod', { 'auth.redirectTo': '/workspace' });
    expect(h.app.authRedirect(new URL('https://app.example/login'))).toBe('/workspace');
    expect(h.app.authRedirect(new URL('https://app.example/login?redirectTo=%2Forders%3Fsort%3Dnew%23list'))).toBe('/orders?sort=new#list');
    h.values.set('auth.redirectTo', '//evil.example');
    expect(h.app.authRedirect(new URL('https://app.example/login'))).toBe('/dashboard');
  });
});

function renderAuthPage(template: () => string, data: any, actionData?: any, provider: ValidationProvider = 'zod') {
  const formInstances: any[] = [];
  const superForm = (initial: any, options: any = {}) => {
    const instance = {
      form: writable(initial.data), errors: writable(initial.errors ?? {}), message: writable(initial.message),
      delayed: writable(false), submitting: writable(false), enhance: () => {}, options,
    };
    formInstances.push(instance);
    return instance;
  };
  const children = (renderer: any, props: any) => props.children?.(renderer);
  const components = Object.fromEntries(['Button', 'Input', 'Label', 'Card', 'CardHeader', 'CardTitle', 'CardDescription', 'CardContent', 'CardFooter', 'Alert'].map((name) => [name, children]));
  const schemas = evaluate(T.authSchema(provider), {
    '@beeblock/svelar/validation': { z },
    '@beeblock/svelar/validation/valibot': { v },
  });
  const compiled = compile(T.applyValidationProvider(template(), provider), { generate: 'server', filename: 'auth-page.svelte' });
  const module = evaluate(compiled.js.code, {
    'svelte/internal/server': svelteServer,
    'sveltekit-superforms': { superForm },
    'sveltekit-superforms/adapters': adapters,
    '$lib/modules/auth/schemas': schemas,
    '$lib/shared/components/auth-links.js': evaluate(T.authLinkHelper(), {}),
    '@beeblock/svelar/ui': components,
    '@lucide/svelte/icons/eye': { __esModule: true, default: children },
    '@lucide/svelte/icons/eye-off': { __esModule: true, default: children },
    '@lucide/svelte/icons/loader-circle': { __esModule: true, default: children },
  });
  const output = render(module.default, { props: { data, form: actionData } });
  return { output: { body: output.body, head: output.head }, formInstances };
}

describe('Auth page rendering', () => {
  it.each<ValidationProvider>(['zod', 'valibot'])('preserves encoded destinations in every auth-mode link (%s)', (provider) => {
    const form = { data: { name: '', email: '', password: '', password_confirmation: '', code: '' }, errors: {} };
    const destination = '/invitations/team-token?source=mail#accept';
    const data = { form, requestForm: form, verifyForm: form, appName: 'Acme', otpEnabled: true, redirectTo: destination };
    const pages = [T.loginPageSvelte, T.registerPageSvelte, T.forgotPasswordPageSvelte, T.otpLoginPageSvelte, T.verifyEmailPageSvelte];
    for (const template of pages) {
      const { output } = renderAuthPage(template, data, undefined, provider);
      const links = [...output.body.matchAll(/href="(\/[^" ]+)"/g)].map((match) => new URL(match[1].replaceAll('&amp;', '&'), 'https://app.example'));
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) {
        expect(link.origin).toBe('https://app.example');
        expect(link.searchParams.get('redirectTo')).toBe(destination);
      }
    }
  });

  it.each([T.loginPageSvelte, T.registerPageSvelte, T.forgotPasswordPageSvelte, T.resetPasswordPageSvelte, T.otpLoginPageSvelte, T.verifyEmailPageSvelte])('compiles and escapes branding without advertising unsupported OAuth or remember-me', (template) => {
    const form = { data: { name: '', email: '', password: '', password_confirmation: '', code: '' }, errors: {} };
    const { output } = renderAuthPage(template, { form, requestForm: form, verifyForm: form, appName: '<script>alert(1)</script>', otpEnabled: false });
    expect(output.head).toContain('&lt;script>');
    expect(output.body).toContain('&lt;script>');
    expect(output.body).not.toContain('<script>alert(1)</script>');
    expect(output.body).not.toMatch(/OAuth|Continue with Google|Continue with GitHub|name="remember"/);
    if (template === T.loginPageSvelte) expect(output.body).not.toContain('/otp-login');
  });

  it('keeps a throttled recovery form visible and only hides it on confirmed success', () => {
    const form = { data: { email: 'user@example.com' }, errors: {}, message: { kind: 'error', text: 'Too many attempts' } };
    const failed = renderAuthPage(T.forgotPasswordPageSvelte, { form, appName: 'Acme' }).output.body;
    expect(failed).toContain('Too many attempts');
    expect(failed).toContain('<form');
    const success = renderAuthPage(T.forgotPasswordPageSvelte, { form: { ...form, message: { kind: 'success', text: 'Check your inbox' } }, appName: 'Acme' }).output.body;
    expect(success).toContain('Check your inbox');
    expect(success).not.toContain('<form');
  });

  it('renders the OTP verification step on a non-enhanced post failure', () => {
    const requestForm = { data: { email: 'user@example.com' }, errors: {} };
    const verifyForm = { data: { email: 'user@example.com', code: '' }, errors: {}, message: 'Invalid or expired code' };
    const output = renderAuthPage(T.otpLoginPageSvelte, { requestForm, verifyForm, appName: 'Acme' }, { codeSent: true, email: 'user@example.com', verifyForm }).output.body;
    expect(output).toContain('action="?/verify"');
    expect(output).toContain('Invalid or expired code');
    expect(output).not.toContain('action="?/send"');
  });

  it.each<ValidationProvider>(['zod', 'valibot'])('keeps send results local and retains typed OTP through prefills and unrelated updates (%s)', (provider) => {
    const requestForm = { id: 'otp-request', data: { email: 'user@example.com' }, errors: {} };
    const verifyForm = { id: 'otp-verify', data: { email: 'user@example.com', code: '' }, errors: {} };
    const { formInstances } = renderAuthPage(T.otpLoginPageSvelte, { requestForm, verifyForm, appName: 'Acme' }, undefined, provider);
    const [request, verify] = formInstances;
    expect(request.options.invalidateAll).toBe(false);
    expect(verify.options.onUpdated).toBeUndefined();
    verify.form.set({ email: 'user@example.com', code: '654321' });
    for (const result of [
      { type: 'success', data: { codeSent: true, email: 'user@example.com', verifyForm: { ...verifyForm, valid: false, posted: false } } },
      { type: 'failure', data: { verifyForm: { ...verifyForm, valid: false, posted: false } } },
      { type: 'failure', data: { form: { ...verifyForm, valid: false, posted: true } } },
      { type: 'failure', data: { verifyForm: { ...verifyForm, id: 'another-form', valid: false, posted: true } } },
      { type: 'failure', data: { requestForm: { ...requestForm, valid: false, posted: true } } },
    ]) {
      verify.options.onResult({ result });
      expect(get(verify.form).code).toBe('654321');
    }
    request.options.onResult({ result: { type: 'success', data: { codeSent: true, email: 'user@example.com' } } });
    expect(get(verify.form)).toEqual({ email: 'user@example.com', code: '654321' });
  });

  it.each<ValidationProvider>(['zod', 'valibot'])('clears OTP only after its own completed server failure and on transport errors (%s)', (provider) => {
    const requestForm = { id: 'otp-request', data: { email: 'user@example.com' }, errors: {} };
    const verifyForm = { id: 'otp-verify', data: { email: 'user@example.com', code: '654321' }, errors: {} };
    const { formInstances } = renderAuthPage(T.otpLoginPageSvelte, { requestForm, verifyForm, appName: 'Acme' }, undefined, provider);
    const verify = formInstances[1];
    for (const status of [400, 401, 403, 422, 429, 503]) {
      verify.form.set({ ...verifyForm.data });
      verify.options.onResult({ result: { type: 'failure', status, data: { verifyForm: { ...verifyForm, valid: false, posted: true } } } });
      expect(get(verify.form).code).toBe('');
    }
    verify.form.set({ ...verifyForm.data });
    verify.options.onError({ result: { type: 'error' } });
    expect(get(verify.form).code).toBe('');
    expect(get(verify.message)).toBe('Unable to verify the code right now. Please try again.');
  });

  it.each([T.loginPageSvelte, T.registerPageSvelte, T.resetPasswordPageSvelte])('clears passwords after a failed update and on unexpected errors', (template) => {
    const initial = { data: { email: 'user@example.com', password: 'initial-secret', password_confirmation: 'initial-secret' }, errors: {} };
    const { formInstances } = renderAuthPage(template, { form: initial, appName: 'Acme' });
    const form = formInstances[0];
    form.form.set({ ...initial.data, password: 'returned-secret' });
    form.options.onUpdated({ form: { valid: false } });
    expect(get(form.form).password).toBe('');
    if (template !== T.loginPageSvelte) expect(get(form.form).password_confirmation).toBe('');
    form.form.set({ ...initial.data });
    form.options.onError({ result: { type: 'error' } });
    expect(get(form.form).password).toBe('');
    expect(get(form.message)).toContain('Please try again');
    expect(template()).toContain('disabled={$submitting}');
  });
});

describe.each<ValidationProvider>(['zod', 'valibot'])('Auth client validation (%s)', (provider) => {
  it('has no initial validation errors, including prefilled password reset and OTP forms', async () => {
    const h = harness(provider, { 'auth.otp.enabled': true });
    for (const template of [T.loginPageServer, T.registerPageServer, T.forgotPasswordPageServer, T.resetPasswordPageServer, T.otpLoginPageServer]) {
      const loaded = await h.page(template).load(h.event({}, '/reset-password?token=reset-token&email=user%40example.com'));
      for (const form of [loaded.form, loaded.requestForm, loaded.verifyForm].filter(Boolean)) {
        expect(form.posted).toBe(false);
        expect(form.errors).toEqual({});
        expect(form.message).toBeUndefined();
      }
    }
  });

  it('wires real client adapters to the same contracts as backend validation for every auth form', async () => {
    const h = harness(provider);
    const initial = { data: { name: '', email: '', password: '', password_confirmation: '', token: '', code: '' }, errors: {} };
    const data = { form: initial, requestForm: initial, verifyForm: initial, appName: 'Acme', otpEnabled: true };
    const valid = { name: 'New user', email: 'user@example.com', password: 'valid-password', password_confirmation: 'valid-password', token: 'reset-token', code: '123456' };
    const invalid = { ...valid, name: '', email: 'invalid', password: '', password_confirmation: 'different', token: '', code: 'invalid' };
    const cases: Array<[() => string, string[]]> = [
      [T.loginPageSvelte, ['loginSchema']],
      [T.registerPageSvelte, ['registerSchema']],
      [T.forgotPasswordPageSvelte, ['forgotPasswordSchema']],
      [T.resetPasswordPageSvelte, ['resetPasswordSchema']],
      [T.otpLoginPageSvelte, ['otpRequestSchema', 'otpVerifySchema']],
    ];
    for (const [template, names] of cases) {
      const { formInstances, output } = renderAuthPage(template, data, undefined, provider);
      expect(formInstances).toHaveLength(names.length);
      expect(output.body).not.toMatch(/text-red-600|role="alert"/);
      expect(template()).toContain('novalidate');
      for (let index = 0; index < names.length; index++) {
        const client = formInstances[index].options.validators;
        expect(client.superFormValidationLibrary).toBe(provider === 'zod' ? 'zod4' : 'valibot');
        const schema = h.schemas[names[index]];
        const backend = provider === 'zod' ? adapters.zod4(schema) : adapters.valibot(schema);
        const clientInvalid = await client.validate(invalid);
        expect(clientInvalid.success).toBe(false);
        expect(clientInvalid).toEqual(await backend.validate(invalid));
        const clientValid = await client.validate(valid);
        expect(clientValid.success).toBe(true);
        expect(clientValid).toEqual(await backend.validate(valid));
      }
    }
  });
});

describe('Client adapter provider conversion', () => {
  it.each(['zod', 'zod4'])('converts combined server/client adapter imports and calls (%s)', (name) => {
    const source = `import { ${name}, ${name}Client } from 'sveltekit-superforms/adapters';\nconst server = ${name}(sharedSchema);\nconst validators = ${name}Client(sharedSchema);\n`;
    expect(T.applyValidationProvider(source, 'zod')).toBe(source);
    expect(T.applyValidationProvider(source, 'valibot')).toBe("import { valibot, valibotClient } from 'sveltekit-superforms/adapters';\nconst server = valibot(sharedSchema);\nconst validators = valibotClient(sharedSchema);\n");
  });
});
