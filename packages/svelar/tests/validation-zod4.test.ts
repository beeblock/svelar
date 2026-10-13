import { describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { z } from '../src/validation/index.js';
import { createFormAction, loadForm, validateForm } from '../src/forms/index.js';
import { FormRequest } from '../src/routing/FormRequest.js';
import { zod4 } from 'sveltekit-superforms/adapters';
import { superValidate } from 'sveltekit-superforms';
import { NewCommandTemplates } from '../src/cli/commands/NewCommandTemplates.js';

// Node-only unit runs cannot load SuperDebug.svelte; validation still uses the real public server APIs.
vi.mock('sveltekit-superforms', async () => ({
  ...await import('sveltekit-superforms/server'),
  fail: (await import('@sveltejs/kit')).fail,
}));

const schema = z.object({ email: z.email(), age: z.coerce.number().int().min(0) });
function formEvent(email: string, age: string) {
  return { request: new Request('http://localhost/form', { method: 'POST', body: new URLSearchParams({ email, age }) }), locals: {} };
}

describe('Native Zod 4 integration', () => {
  it('uses native schemas and real Superforms adapters with validated output', async () => {
    expect('_zod' in schema).toBe(true);
    const form = await superValidate({ email: 'operator@example.com', age: 12 }, zod4(schema));
    expect(form.valid).toBe(true);
    expect(form.data).toEqual({ email: 'operator@example.com', age: 12 });
    const loaded = await loadForm(schema, { email: 'operator@example.com', age: 12 });
    expect(loaded.data.age).toBe(12);
    const action = createFormAction(schema, async (data) => ({ email: data.email, age: data.age }));
    expect(await action(formEvent('operator@example.com', '12'))).toEqual({ email: 'operator@example.com', age: 12 });
    await expect(validateForm(formEvent('bad-email', '-1'), schema)).rejects.toMatchObject({
      errors: { email: expect.any(Array), age: expect.any(Array) },
    });
  });

  it('documents output defaults, validated input prefaults, and coercion behavior', () => {
    const length = z.string().transform((value) => value.length);
    expect(length.default(8).parse(undefined)).toBe(8);
    expect(length.prefault('tuna').parse(undefined)).toBe(4);
    expect(z.object({ name: z.string().default('operator').optional() }).parse({})).toEqual({ name: 'operator' });
    expect(z.coerce.boolean().parse('false')).toBe(true);
    expect(z.boolean().safeParse('false').success).toBe(false);
    expect(z.coerce.number().parse('')).toBe(0);
    expect(z.number().safeParse(Infinity).success).toBe(false);
  });

  it('normalizes native issue codes without losing authorization or DTO transformation', async () => {
    class Request extends FormRequest<typeof schema, { label: string }> {
      rules() { return schema; }
      messages() { return { 'email.invalid_format': 'Invalid email.' }; }
      passedValidation(data: z.output<typeof schema>) { return { label: data.email + ':' + data.age }; }
    }
    const event = (email: string) => ({ ...formEvent(email, '12'), url: new URL('http://localhost/form'), params: {}, cookies: {}, platform: {}, getClientAddress: () => '127.0.0.1' });
    expect(await Request.validate(event('operator@example.com'))).toEqual({ label: 'operator@example.com:12' });
    await expect(Request.validate(event('bad-email'))).rejects.toMatchObject({ errors: { email: ['Invalid email.'] } });
  });

  it('generates native schema imports/adapters and converts only the selected provider', () => {
    const manifest = JSON.parse(NewCommandTemplates.packageJson('probe', '0.8.0'));
    expect(manifest.dependencies.zod).toBe('^4.6.7');
    const methods = ['loginPageServer', 'registerPageServer', 'forgotPasswordPageServer', 'resetPasswordPageServer', 'otpLoginPageServer', 'apiKeysPageServer', 'teamPageServer'] as const;
    for (const method of methods) {
      const template = NewCommandTemplates[method]();
      expect(template).toContain("import { zod4 } from 'sveltekit-superforms/adapters'");
      expect(template).not.toMatch(/\bzod\(/);
      const converted = NewCommandTemplates.applyValidationProvider(template, 'valibot');
      expect(converted).toContain("import { valibot } from 'sveltekit-superforms/adapters'");
      expect(converted).not.toContain('zod4(');
    }
    expect(readFileSync(fileURLToPath(new URL('../tsup.config.ts', import.meta.url)), 'utf8')).toContain("'zod'");
  });

  it('type-checks actual schema/request/form output inference without casts or emitted files', () => {
    const filename = fileURLToPath(new URL('__zod4_inference__.ts', import.meta.url));
    const code = `
      import { z } from '../src/validation/index.js';
      import { FormRequest } from '../src/routing/FormRequest.js';
      import { loadForm, validateForm, createFormAction } from '../src/forms/index.js';
      import { superValidate } from 'sveltekit-superforms';
      import { zod4 } from 'sveltekit-superforms/adapters';
      import * as v from 'valibot';
      const schema = z.object({ email: z.email(), age: z.coerce.number().int() });
      class PlainRequest extends FormRequest { rules() { return schema; } }
      class DtoRequest extends FormRequest<typeof schema, { label: string }> {
        rules() { return schema; }
        passedValidation(data: z.output<typeof schema>) { return { label: data.email }; }
      }
      declare const event: Parameters<typeof PlainRequest.validate>[0];
      const validated = await PlainRequest.validate(event);
      const age: number = validated.age;
      const label: string = (await DtoRequest.validate(event)).label;
      const direct = await superValidate(zod4(schema));
      const email: string = direct.data.email;
      const loaded = await loadForm(schema);
      const loadedAge: number = loaded.data.age;
      const postedAge: number = (await validateForm(event, schema)).age;
      createFormAction(schema, async data => { const n: number = data.age; const s: string = data.email; });
      // @ts-expect-error The numeric field must not degrade to any or unknown.
      const wrong: string = loaded.data.age;
      const vschema = v.object({ title: v.string() });
      const vtitle: string = (await loadForm(vschema, undefined, 'valibot')).data.title;
    `;
    const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, skipLibCheck: true, noEmit: true, types: ['node'] };
    const host = ts.createCompilerHost(options);
    const getSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (file, language, ...rest) => file === filename ? ts.createSourceFile(file, code, language, true) : getSourceFile(file, language, ...rest);
    const fileExists = host.fileExists.bind(host);
    host.fileExists = (file) => file === filename || fileExists(file);
    const optionalPeers = fileURLToPath(new URL('../src/types/externals.d.ts', import.meta.url));
    const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([filename, optionalPeers], options, host));
    expect(diagnostics.map((issue) => `${issue.file?.fileName}: ${ts.flattenDiagnosticMessageText(issue.messageText, '\n')}`)).toEqual([]);
  }, 60_000);
});
