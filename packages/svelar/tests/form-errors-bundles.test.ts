import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

describe('Public FormRequest error identity across bundles', () => {
  it('recognizes genuine errors from either public entry without confusing subclasses or impostors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'svelar-form-error-bundles-'));
    try {
      await symlink(fileURLToPath(new URL('../../../node_modules', import.meta.url)), join(root, 'node_modules'), 'dir');
      const modules: any[] = [];
      for (const entry of ['forms', 'routing']) {
        const outfile = join(root, entry + '.mjs');
        await build({ entryPoints: [fileURLToPath(new URL(`../src/${entry}/index.ts`, import.meta.url))], outfile,
          bundle: true, minify: true, keepNames: false, platform: 'node', format: 'esm', packages: 'external', target: 'node22', logLevel: 'silent' });
        modules.push(await import(pathToFileURL(outfile).href));
      }
      const [forms, routing] = modules;
      expect(forms.FormValidationError).not.toBe(routing.FormValidationError);
      for (const [origin, target] of [[forms, routing], [routing, forms]]) {
        const validation = new origin.FormValidationError({ title: ['Required'] });
        const authorization = new origin.FormAuthorizationError();
        expect(validation instanceof target.FormValidationError).toBe(true);
        expect(validation instanceof target.FormAuthorizationError).toBe(false);
        expect(authorization instanceof target.FormAuthorizationError).toBe(true);
        class CustomValidationError extends target.FormValidationError {}
        expect(validation instanceof CustomValidationError).toBe(false);
        expect(new CustomValidationError({ title: ['Custom'] }) instanceof target.FormValidationError).toBe(true);
        const impostor = Object.assign(new Error('fake'), { name: 'FormValidationError', statusCode: 422, errors: { title: ['Fake'] } });
        expect(impostor instanceof target.FormValidationError).toBe(false);
        class ResourceController extends routing.Controller {
          async store() { throw validation; }
          handleError(error: any, event: unknown) {
            if (error instanceof routing.FormValidationError) return this.json({ data: null, meta: { errors: error.errors } }, 422);
            return super.handleError(error, event);
          }
        }
        const response = await new ResourceController().handle('store')({ request: new Request('http://localhost/proof'), url: new URL('http://localhost/proof'), locals: {}, params: {} });
        expect(response.status).toBe(422); expect(await response.json()).toEqual({ data: null, meta: { errors: { title: ['Required'] } } });
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
