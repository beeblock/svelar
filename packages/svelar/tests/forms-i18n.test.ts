import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createFormAction, loadForm, validateForm, FormValidationError } from '../src/forms';
import { createI18nHandle, createReroute } from '../src/i18n';

vi.mock('sveltekit-superforms/adapters', () => ({
  zod: (schema: z.ZodTypeAny) => schema,
}));

vi.mock('sveltekit-superforms', () => ({
  fail: (status: number, data: Record<string, any>) => ({ status, data }),
  message: (form: any, text: string, options: { status?: number } = {}) => ({
    status: options.status ?? 400,
    data: { form: { ...form, message: text } },
  }),
  superValidate: async (input: any, schema: z.ZodTypeAny) => {
    let raw: any = {};
    let posted = false;

    if (input?.request instanceof Request) {
      posted = true;
      const formData = await input.request.formData();
      raw = Object.fromEntries(formData.entries());
    } else if (input && typeof input === 'object') {
      raw = input;
    }

    const result = schema.safeParse(raw);
    return {
      valid: result.success,
      posted,
      data: result.success ? result.data : raw,
      errors: result.success ? {} : result.error.flatten().fieldErrors,
    };
  },
}));

function formEvent(fields: Record<string, string>): any {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    body.set(key, value);
  }

  return {
    request: new Request('http://localhost/form', {
      method: 'POST',
      body,
    }),
    locals: {},
  };
}

describe('Forms integration', () => {
  it('loads an empty superform from a Zod schema', async () => {
    const schema = z.object({
      title: z.string().min(3),
      published: z.boolean().default(false),
    });

    const form = await loadForm(schema);

    expect(form).toMatchObject({
      valid: false,
      posted: false,
    });
    expect(form.errors.title).toEqual(expect.any(Array));
  });

  it('validates form data and throws field errors on invalid submissions', async () => {
    const schema = z.object({
      title: z.string().min(3),
      views: z.coerce.number().int().min(0),
    });

    await expect(validateForm(formEvent({ title: 'Hello', views: '10' }), schema)).resolves.toEqual({
      title: 'Hello',
      views: 10,
    });

    await expect(validateForm(formEvent({ title: 'No', views: '-1' }), schema)).rejects.toMatchObject({
      name: 'FormValidationError',
      errors: {
        title: expect.any(Array),
        views: expect.any(Array),
      },
    });
    await expect(validateForm(formEvent({ title: 'No', views: '-1' }), schema)).rejects.toBeInstanceOf(FormValidationError);
  });

  it('creates form actions that pass validated data to handlers', async () => {
    const schema = z.object({
      title: z.string().min(3),
    });
    const seen: string[] = [];

    const action = createFormAction(schema, async (data, event) => {
      seen.push(data.title);
      event.locals.saved = true;
      return { ok: true, title: data.title };
    });

    const event = formEvent({ title: 'Saved post' });
    await expect(action(event)).resolves.toEqual({ ok: true, title: 'Saved post' });
    expect(seen).toEqual(['Saved post']);
    expect(event.locals.saved).toBe(true);
  });

  it('returns failed form payloads for invalid form actions', async () => {
    const schema = z.object({
      title: z.string().min(3),
    });

    const action = createFormAction(schema, async () => {
      throw new Error('should not run');
    });

    const result = await action(formEvent({ title: 'No' }));

    expect(result.status).toBe(400);
    expect(result.data.form.valid).toBe(false);
    expect(result.data.form.errors.title).toEqual(expect.any(Array));
  });

  it('converts handler failures into form messages', async () => {
    const schema = z.object({
      title: z.string().min(3),
    });

    const action = createFormAction(
      schema,
      async () => {
        throw new Error('Cannot save');
      },
      { errorMessage: 'Save failed' },
    );

    const result = await action(formEvent({ title: 'Valid title' }));

    expect(result.status).toBe(400);
    expect(result.data.form.message).toBe('Save failed');
  });
});

describe('i18n integration', () => {
  it('creates a handle that delegates to Paraglide middleware and injects HTML attributes', async () => {
    const localizedRequest = new Request('http://localhost/pt/dashboard');
    const handle = createI18nHandle({
      paraglideMiddleware: async (request, callback) => {
        expect(request.url).toBe('http://localhost/en/dashboard');
        return callback({ request: localizedRequest, locale: 'ar' });
      },
      getTextDirection: (locale) => (locale === 'ar' ? 'rtl' : 'ltr'),
    });

    const event = {
      request: new Request('http://localhost/en/dashboard'),
    } as any;

    const response = await handle({
      event,
      resolve: async (resolvedEvent: any, options: any) => {
        expect(resolvedEvent.request).toBe(localizedRequest);
        const html = options.transformPageChunk({ html: '<html lang="%lang%" dir="%dir%"></html>' });
        return new Response(html);
      },
    } as any);

    expect(event.request).toBe(localizedRequest);
    await expect(response.text()).resolves.toBe('<html lang="ar" dir="rtl"></html>');
  });

  it('creates reroute hooks that strip localized URL prefixes', () => {
    const reroute = createReroute({
      deLocalizeUrl: (url) => ({ pathname: url.pathname.replace(/^\/(en|pt)/, '') || '/' }),
    });

    expect(reroute({ url: new URL('http://localhost/en/dashboard') })).toBe('/dashboard');
    expect(reroute({ url: new URL('http://localhost/pt') })).toBe('/');
  });
});
