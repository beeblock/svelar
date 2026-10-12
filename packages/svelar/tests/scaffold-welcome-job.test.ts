import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import { transformScaffoldFile } from '../src/cli/commands/NewCommand.js';
import { NewCommandTemplates as T } from '../src/cli/commands/NewCommandTemplates.js';
import { EmailTemplates } from '../src/email-templates/index.js';
import { Mailer } from '../src/mail/index.js';
import { Job } from '../src/queue/index.js';
import { fakeMailer } from '../src/testing/fakes.js';

interface WelcomeJob extends Job {
  userId: number;
  email: string;
  name: string;
}

type WelcomeJobConstructor = new (userId: number, email: string, name: string) => WelcomeJob;

function welcomeJob(flat: boolean): WelcomeJobConstructor {
  const generated = transformScaffoldFile('src/lib/shared/jobs/SendWelcomeEmail.ts', T.sendWelcomeEmail(), flat);
  expect(generated.path).toBe(flat ? 'src/lib/jobs/SendWelcomeEmail.ts' : 'src/lib/shared/jobs/SendWelcomeEmail.ts');
  const compiled = ts.transpileModule(generated.content, {
    fileName: generated.path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  expect(compiled.diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)).toEqual([]);
  const dependencies: Record<string, unknown> = {
    '@beeblock/svelar/queue': { Job },
    '@beeblock/svelar/email-templates': { EmailTemplates },
    '@beeblock/svelar/mail': { Mailer },
  };
  const module = { exports: {} as Record<string, unknown> };
  new Function('exports', 'require', 'module', compiled.outputText)(module.exports, (name: string) => {
    if (!(name in dependencies)) throw new Error(`Unexpected generated job import: ${name}`);
    return dependencies[name];
  }, module);
  return module.exports.SendWelcomeEmail as WelcomeJobConstructor;
}

beforeEach(() => {
  vi.stubEnv('APP_NAME', 'Acme Studio');
  vi.stubEnv('APP_URL', 'https://acme.example.test');
  EmailTemplates.configure({ driver: 'memory' });
  EmailTemplates.registerDefaults();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  Mailer.configure({ default: 'null', mailers: { null: { driver: 'null' } } });
  EmailTemplates.configure({ driver: 'memory' });
  EmailTemplates.registerDefaults();
});

describe.each([false, true])('Generated welcome email job (flat=%s)', (flat) => {
  it('renders nested user variables in the real subject, HTML and text and sends to the recipient', async () => {
    const transport = fakeMailer();
    const render = vi.spyOn(EmailTemplates, 'render');
    const SendWelcomeEmail = welcomeJob(flat);
    await new SendWelcomeEmail(42, 'ada@example.test', 'Ada Lovelace').handle();

    expect(render).toHaveBeenCalledWith('welcome', {
      appName: 'Acme Studio',
      user: { name: 'Ada Lovelace', email: 'ada@example.test' },
      confirmUrl: 'https://acme.example.test/verify-email',
    });
    expect(transport.count()).toBe(1);
    const { message, result } = transport.sent()[0];
    expect(message.to).toBe('ada@example.test');
    expect(result.accepted).toEqual(['ada@example.test']);
    expect(message.subject).toBe('Welcome to Acme Studio, Ada Lovelace!');
    expect(message.html).toContain('<h1>Welcome, Ada Lovelace!</h1>');
    expect(message.html).toContain('<strong>ada@example.test</strong>');
    expect(message.html).toContain('Thank you for joining Acme Studio.');
    expect(message.html).toContain('href="https://acme.example.test/verify-email"');
    expect(message.text).toBe('Welcome, Ada Lovelace!\n\nConfirm your email: https://acme.example.test/verify-email');
    expect([message.subject, message.html, message.text].join('\n')).not.toContain('{{');
  });

  it('keeps serialized recipient data isolated between reconstructed jobs', async () => {
    const transport = fakeMailer();
    const SendWelcomeEmail = welcomeJob(flat);
    for (const [id, email, name] of [[42, 'ada@example.test', 'Ada Lovelace'], [43, 'grace@example.test', 'Grace Hopper']] as const) {
      const payload = new SendWelcomeEmail(id, email, name).serialize();
      const restored = Object.create(SendWelcomeEmail.prototype) as WelcomeJob;
      restored.restore(JSON.parse(payload));
      await restored.handle();
    }
    expect(transport.count()).toBe(2);
    const [first, second] = transport.sent();
    expect(first.message).toMatchObject({ to: 'ada@example.test', subject: 'Welcome to Acme Studio, Ada Lovelace!' });
    expect(second.message).toMatchObject({ to: 'grace@example.test', subject: 'Welcome to Acme Studio, Grace Hopper!' });
    expect(second.message.html).toContain('Grace Hopper');
    expect(second.message.html).toContain('grace@example.test');
    expect(second.message.text).toContain('Grace Hopper');
    expect([second.message.subject, second.message.html, second.message.text].join('\n')).not.toContain('Ada');
  });
});
