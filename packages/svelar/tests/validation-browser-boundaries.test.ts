import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { isUlid, isUuidv7, ulid, uuidv7 } from '../src/support/uuid.js';

describe('Shared browser validation boundaries', () => {
  it.each(['index', 'valibot'])('bundles and executes the %s rules without Node globals or crypto polyfills', async (provider) => {
    const entry = fileURLToPath(new URL(`../src/validation/${provider}.ts`, import.meta.url));
    const result = await build({ entryPoints: [entry], write: false, bundle: true, platform: 'browser', format: 'iife', globalName: 'Validation', metafile: true });
    expect(Object.keys(result.metafile!.inputs).some((path) => path.endsWith('/support/uuid.ts'))).toBe(false);
    const sandbox: Record<string, any> = {};
    runInNewContext(result.outputFiles[0].text, sandbox);
    const { rules, v } = sandbox.Validation;
    const parse = (schema: unknown, value: string) => provider === 'valibot' ? v.safeParse(schema, value).success : (schema as any).safeParse(value).success;
    expect(parse(rules.uuidv7(), uuidv7())).toBe(true);
    expect(parse(rules.uuidv7(), 'not-a-uuid')).toBe(false);
    expect(parse(rules.ulid(), ulid())).toBe(true);
    expect(parse(rules.ulid(), '8' + '0'.repeat(25))).toBe(false);
  });
  it('retains server generator exports and rejects ULIDs outside the 128-bit encoding', () => {
    expect(isUuidv7(uuidv7())).toBe(true); expect(isUlid(ulid())).toBe(true);
    expect(isUlid('7' + 'Z'.repeat(25))).toBe(true);
    expect(isUlid('8' + '0'.repeat(25))).toBe(false);
    expect(isUlid('Z'.repeat(26))).toBe(false);
    expect(isUlid('0' + 'I'.repeat(25))).toBe(false);
  });
});
