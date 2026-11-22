import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const script = fileURLToPath(new URL('../../../scripts/security-audit.mjs', import.meta.url));
const levels = ['info', 'low', 'moderate', 'high', 'critical'] as const;
function report(severity?: typeof levels[number]) {
  return {
    auditReportVersion: 2,
    vulnerabilities: severity ? { fixture: { name: 'fixture', severity, via: [{
      title: 'Fixture advisory', url: 'https://github.com/advisories/fixture', source: 1,
    }] } } : {},
    metadata: { vulnerabilities: {
      ...Object.fromEntries(levels.map((level) => [level, Number(level === severity)])), total: Number(!!severity),
    } },
  };
}
const clean = report();
const valid = (body: unknown = clean, status: number | null = 0) => ({ status, signal: null, stdout: JSON.stringify(body), stderr: '' });
let directory: string;
beforeAll(async () => { directory = await mkdtemp(join(tmpdir(), 'svelar-audit-contract-')); });
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

async function audit(result: Record<string, unknown>, severity = 'high') {
  // Intercept only the child's npm process boundary; run the real audit CLI and real process exits.
  const bootstrap = `import { registerHooks } from 'node:module';
    registerHooks({ resolve(specifier, context, nextResolve) {
      return specifier === 'node:child_process'
        ? { url: 'data:text/javascript,' + encodeURIComponent('export const spawnSync = () => JSON.parse(process.env.SVELAR_AUDIT_TEST_RESULT);'), shortCircuit: true }
        : nextResolve(specifier, context);
    } });
    process.argv = [process.execPath, ${JSON.stringify(script)}, ${JSON.stringify(`--min-severity=${severity}`)}];
    await import(${JSON.stringify(pathToFileURL(script).href)});`;
  try {
    const output = await exec(process.execPath, ['--input-type=module', '-e', bootstrap], {
      cwd: directory, env: { ...process.env, SVELAR_AUDIT_TEST_RESULT: JSON.stringify(result) }, timeout: 5000,
    });
    return { status: 0, ...output };
  } catch (error: any) {
    if (typeof error.code !== 'number') throw error;
    return { status: error.code as number, stdout: error.stdout as string, stderr: error.stderr as string };
  }
}

describe('Security audit CLI fails closed', () => {
  const malformed = [
    { name: 'spawn error even with a clean payload', result: { ...valid(), error: { code: 'ENOENT' } } },
    { name: 'termination signal even with a clean payload', result: { ...valid(), signal: 'SIGTERM' } },
    { name: 'unexpected npm exit 2', result: valid(clean, 2) },
    { name: 'unexpected npm exit 127', result: valid(clean, 127) },
    { name: 'missing process exit status', result: { stdout: JSON.stringify(clean) } },
    { name: 'null process exit status', result: valid(clean, null) },
    { name: 'string process exit status', result: { ...valid(), status: '0' } },
    { name: 'empty output', result: { ...valid(), stdout: '' } },
    { name: 'whitespace output', result: { ...valid(), stdout: ' \n ' } },
    { name: 'missing output', result: { status: 0, stderr: 'npm unavailable' } },
    { name: 'invalid JSON', result: { ...valid(), stdout: '{broken' } },
    { name: 'JSON error response', result: valid({ error: { code: 'E401', summary: 'Registry unavailable' } }, 1) },
    { name: 'error response with a misleading valid payload', result: valid({ ...clean, error: { code: 'E500' } }) },
    { name: 'null report', result: valid(null) },
    { name: 'array report', result: valid([]) },
    { name: 'missing vulnerability schema', result: valid({ auditReportVersion: 2, metadata: clean.metadata }) },
    { name: 'array vulnerability schema', result: valid({ ...clean, vulnerabilities: [] }) },
    { name: 'unknown audit report version', result: valid({ ...clean, auditReportVersion: 3 }) },
    { name: 'missing vulnerability totals', result: valid({ auditReportVersion: 2, vulnerabilities: {} }) },
    { name: 'inconsistent total count', result: valid({ ...clean, metadata: { vulnerabilities: { ...clean.metadata.vulnerabilities, total: 1 } } }) },
    { name: 'status 1 without advisories', result: valid(clean, 1) },
    { name: 'malformed vulnerability record', result: valid({ ...report('high'), vulnerabilities: { fixture: null } }, 1) },
    { name: 'unknown severity', result: valid({ ...report('high'), vulnerabilities: { fixture: { name: 'fixture', severity: 'unexpected', via: [] } } }, 1) },
    { name: 'non-string severity', result: valid({ ...report('high'), vulnerabilities: { fixture: { name: 'fixture', severity: ['high'], via: [] } } }, 1) },
    { name: 'missing advisory list', result: valid({ ...report('high'), vulnerabilities: { fixture: { name: 'fixture', severity: 'high' } } }, 1) },
    { name: 'malformed advisory', result: valid({ ...report('high'), vulnerabilities: { fixture: { name: 'fixture', severity: 'high', via: [null] } } }, 1) },
    { name: 'mismatched severity totals', result: valid({ ...report('high'), metadata: report('low').metadata }, 1) },
  ];
  it.each(malformed)('rejects $name without reporting PASS', async ({ result }) => {
    const output = await audit(result);
    expect(output.status).toBe(2);
    expect(output.stderr).toContain('Security audit could not be verified:');
    expect(output.stdout).not.toContain('Security audit passed');
  });

  it('accepts a complete clean audit report from npm exit 0', async () => {
    const output = await audit(valid());
    expect(output.status).toBe(0);
    expect(output.stdout).toContain('Security audit passed for high+ findings.');
    expect(output.stderr).toBe('');
  });

  it.each(['high', 'critical'] as const)('blocks valid %s advisories reported with npm exit 1', async (level) => {
    const output = await audit(valid(report(level), 1));
    expect(output.status).toBe(1);
    expect(output.stderr).toContain(`fixture (${level})`);
    expect(output.stdout).not.toContain('Security audit passed');
  });

  it('accepts valid npm exit 1 below the configured threshold but blocks it at moderate', async () => {
    const payload = valid(report('moderate'), 1);
    expect((await audit(payload)).status).toBe(0);
    expect((await audit(payload, 'moderate')).status).toBe(1);
  });

  it('still checks vulnerabilities when npm exit 0 comes from an external audit-level setting', async () => {
    const output = await audit(valid(report('high')));
    expect(output.status).toBe(1);
    expect(output.stdout).not.toContain('Security audit passed');
  });

  it.each(['unexpected', 'constructor', '__proto__'])('rejects invalid or inherited severity flag %s', async (severity) => {
    const output = await audit(valid(), severity);
    expect(output.status).toBe(2);
    expect(output.stderr).toContain('Unknown --min-severity value:');
    expect(output.stdout).not.toContain('Security audit passed');
  });
});
