import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

describe('Published subpath context isolation', () => {
  let root: string;
  let support: any;
  let teams: any;
  let orm: any;
  let queue: any;

  beforeAll(async () => {
    root = await mkdtemp(resolve('.test-context-bundles-'));
    await build({
      entryPoints: {
        support: resolve('src/support/index.ts'), teams: resolve('src/teams/index.ts'),
        orm: resolve('src/orm/index.ts'), queue: resolve('src/queue/index.ts'),
      },
      outdir: root, outExtension: { '.js': '.mjs' }, bundle: true, splitting: false,
      packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent',
    });
    support = await import(pathToFileURL(join(root, 'support.mjs')).href);
    teams = await import(pathToFileURL(join(root, 'teams.mjs')).href);
    orm = await import(pathToFileURL(join(root, 'orm.mjs')).href);
    queue = await import(pathToFileURL(join(root, 'queue.mjs')).href);
  });
  afterAll(async () => { await rm(root, { recursive: true, force: true }); });

  it('shares team/actor context across independently bundled Teams, ORM and Queue', async () => {
    class TenantRecord extends orm.TenantModel { static table = 'tenant_records'; }
    class ProbeJob extends queue.Job { async handle() {} }
    const captured: unknown[] = [];
    const restore = queue.Queue.interceptForTesting((job: any) => { captured.push(job.context); return true; });

    try {
      await support.ApplicationContext.run({ userId: 7, correlationId: 'bundle-test' }, () =>
        teams.Teams.runWithTeam('team-a', async () => {
          expect(support.ApplicationContext.get('teamId')).toBe('team-a');
          expect(TenantRecord.query().toSQL().bindings).toContain('team-a');
          await queue.Queue.dispatch(new ProbeJob());
        }));
      expect(captured).toEqual([{ userId: 7, correlationId: 'bundle-test', teamId: 'team-a' }]);
      expect(support.ApplicationContext.get('teamId')).toBeUndefined();
    } finally { restore(); }
  });

  it('keeps concurrent tenant requests isolated across subpaths and denies queries without context', async () => {
    class TenantRecord extends orm.TenantModel { static table = 'tenant_records'; }
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = teams.Teams.runWithTeam('team-a', async () => {
      await gate;
      return TenantRecord.query().toSQL().bindings;
    });
    const second = support.ApplicationContext.run({ teamId: 'team-b' }, async () => {
      release();
      await Promise.resolve();
      return TenantRecord.query().toSQL().bindings;
    });
    expect(await first).toContain('team-a');
    expect(await second).toContain('team-b');
    expect(() => TenantRecord.query().toSQL()).toThrow();
  });
});
