import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CronExpression } from 'cron-parser';
import { cronMatches, parseCron, ScheduledTask, Scheduler } from '../src/scheduler/index.js';
import { nextCronDate } from '../src/scheduler/cron.js';
import { ScheduleMonitor } from '../src/scheduler/ScheduleMonitor.js';
import { QueryBuilder } from '../src/orm/QueryBuilder.js';

class CronTestTask extends ScheduledTask {
  calls = 0;
  async handle(): Promise<void> { this.calls++; }
}

const invalidExpressions = [
  '*/0 * * * *', '*/00 * * * *', '1-10/0 * * * *', '*/-1 * * * *',
  '60 * * * *', '-1 * * * *', '0 24 * * *', '0 -1 * * *',
  '0 0 0 * *', '0 0 32 * *', '0 0 * 0 *', '0 0 * 13 *',
  '0 0 * * 8', '10-1 * * * *', '0 0 * * FRI-MON',
  '10abc * * * *', '0 0 * JANuary *', '0 0 * * MONday', '*/1x * * * *',
  '1, * * * *', '1,,2 * * * *', '1- * * * *', '', '* * * *', '* * * * * *',
  '0 0 31 FEB *', 'H * * * *', '0 0 L * *', '0 0 * * MON#2', '? * * * *',
];

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('Scheduler Cron Contract', () => {
  it('privately bundles the calendar engine for native Node ESM despite an incompatible app dependency', async () => {
    const root = await mkdtemp(join(tmpdir(), 'svelar-cron-bundle-'));
    const source = fileURLToPath(new URL('../src/scheduler/cron.ts', import.meta.url));
    const configPath = fileURLToPath(new URL('../tsup.config.ts', import.meta.url));
    const tsconfig = fileURLToPath(new URL('../tsconfig.json', import.meta.url));
    try {
      const bundled = spawnSync(process.execPath, ['--input-type=module', '-e', `
        import { build } from 'tsup';
        import { createJiti } from 'jiti';
        const config = await createJiti(import.meta.url).import(${JSON.stringify(configPath)}, { default: true });
        await build({ ...config, config: false, entry: { cron: ${JSON.stringify(source)} }, outDir: ${JSON.stringify(root)}, tsconfig: ${JSON.stringify(tsconfig)}, silent: true });
      `], { timeout: 10_000, encoding: 'utf8', cwd: fileURLToPath(new URL('..', import.meta.url)) });
      expect(bundled.error).toBeUndefined();
      expect(bundled.status, bundled.stderr).toBe(0);
      await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
      for (const [name, version] of [['cron-parser', '4.9.0'], ['luxon', '0.0.0']]) {
        const directory = join(root, 'node_modules', name);
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, 'package.json'), JSON.stringify({ name, version, main: 'index.cjs' }));
        await writeFile(join(directory, 'index.cjs'), `throw new Error(${JSON.stringify(`App ${name} must not supply the private calendar engine`)});`);
      }
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
        import assert from 'node:assert/strict';
        import { pathToFileURL } from 'node:url';
        const { parseCron, cronMatches, nextCronDate } = await import(pathToFileURL(process.argv[1]).href);
        assert.deepEqual(parseCron('0 9 * JAN MON').month, [1]);
        assert.equal(cronMatches('0 9 * * *', new Date('2026-10-12T12:00:59Z'), 'America/Sao_Paulo'), true);
        assert.equal(cronMatches('0 9 1 * MON', new Date('2026-10-05T09:00:20Z'), 'UTC'), true);
        assert.equal(nextCronDate('0 0 29 FEB *', new Date('2096-03-01T00:00:00Z'), 'UTC').toISOString(), '2104-02-29T00:00:00.000Z');
        console.log('private calendar engine: PASS');
      `, join(root, 'cron.js')], { timeout: 5000, encoding: 'utf8', cwd: root });
      expect(child.error).toBeUndefined();
      expect(child.status, child.stderr).toBe(0);
      expect(child.stdout).toContain('private calendar engine: PASS');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('preserves wildcard nulls and sorted numeric fields', () => {
    expect(parseCron('* * * * *')).toEqual({ minute: null, hour: null, dayOfMonth: null, month: null, dayOfWeek: null });
    expect(parseCron('10,0,5 3-5 1,15 JAN,MAR MON-FRI')).toEqual({
      minute: [0, 5, 10], hour: [3, 4, 5], dayOfMonth: [1, 15], month: [1, 3], dayOfWeek: [1, 2, 3, 4, 5],
    });
    expect(parseCron('1-10/3 * * * 7').minute).toEqual([1, 4, 7, 10]);
    expect(parseCron('0 0 * * 7').dayOfWeek).toEqual([0]);
    expect(parseCron('0 0 * * 0-7').dayOfWeek).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(parseCron('0 0 * jul thu').month).toEqual([7]);
  });

  it.each(invalidExpressions)('rejects malformed expression %j', (expression) => {
    expect(() => parseCron(expression)).toThrow();
    expect(() => new CronTestTask().cron(expression)).toThrow();
  });

  it('rejects zero-step inputs in a finite child process', () => {
    const source = fileURLToPath(new URL('../src/scheduler/index.ts', import.meta.url));
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { createJiti } from 'jiti';
      const jiti = createJiti(import.meta.url);
      const { parseCron } = await jiti.import(${JSON.stringify(source)});
      let rejected = 0;
      for (const expression of ${JSON.stringify(invalidExpressions)}) {
        try { parseCron(expression); } catch { rejected++; }
      }
      console.log(JSON.stringify({ rejected }));
    `], { timeout: 5000, encoding: 'utf8', cwd: fileURLToPath(new URL('..', import.meta.url)) });
    expect(child.error).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual({ rejected: invalidExpressions.length });
  });

  it('uses OR when both day-of-month and weekday are restricted', () => {
    const expression = '0 9 1 * MON';
    expect(cronMatches(expression, new Date('2026-10-01T09:00:59.999Z'), 'UTC')).toBe(true);
    expect(cronMatches(expression, new Date('2026-10-05T09:00:20Z'), 'UTC')).toBe(true);
    expect(cronMatches(expression, new Date('2026-10-06T09:00:00Z'), 'UTC')).toBe(false);
    expect(cronMatches(expression, new Date('2026-10-05T09:01:00Z'), 'UTC')).toBe(false);
    expect(nextCronDate(expression, new Date('2026-10-01T09:00:00Z'), 'UTC').toISOString()).toBe('2026-10-05T09:00:00.000Z');
  });

  it('matches an entire minute without modifying the caller date', () => {
    const date = new Date('2026-10-12T09:15:59.999Z');
    expect(cronMatches('*/15 9 * * *', date, 'UTC')).toBe(true);
    expect(cronMatches('*/15 9 * * *', new Date('2026-10-12T09:16:00Z'), 'UTC')).toBe(false);
    expect(date.toISOString()).toBe('2026-10-12T09:15:59.999Z');
  });

  it.each([
    ['2026-01-01T00:00:00Z', '2028-02-29T00:00:00.000Z'],
    ['2096-03-01T00:00:00Z', '2104-02-29T00:00:00.000Z'],
    ['2396-03-01T00:00:00Z', '2400-02-29T00:00:00.000Z'],
  ])('finds leap-day dates beyond a one-year horizon from %s', (from, expected) => {
    expect(nextCronDate('0 0 29 FEB *', new Date(from), 'UTC').toISOString()).toBe(expected);
    expect(cronMatches('0 0 29 FEB *', new Date(expected), 'UTC')).toBe(true);
  });

  it('applies explicit timezones to both matching and next dates', () => {
    const date = new Date('2026-10-12T12:00:45Z');
    expect(cronMatches('0 9 * * *', date, 'America/Sao_Paulo')).toBe(true);
    expect(cronMatches('0 9 * * *', date, 'UTC')).toBe(false);
    expect(nextCronDate('0 9 * * *', date, 'America/Sao_Paulo').toISOString()).toBe('2026-10-13T12:00:00.000Z');
    expect(cronMatches('0 9 * * *', new Date('2026-10-12T03:30:31Z'), 'Asia/Kolkata')).toBe(true);
  });

  it('uses the same parser DST transition rules for due checks and previews', () => {
    const transition = new Date('2026-03-08T07:00:00Z');
    expect(nextCronDate('0 2 * * *', new Date('2026-03-08T05:00:00Z'), 'America/New_York').toISOString()).toBe(transition.toISOString());
    expect(cronMatches('0 2 * * *', transition, 'America/New_York')).toBe(true);
    expect(cronMatches('0 2 * * *', new Date('2026-03-08T07:01:00Z'), 'America/New_York')).toBe(false);
  });

  it('defaults to the system timezone in a separate process', () => {
    const source = fileURLToPath(new URL('../src/scheduler/cron.ts', import.meta.url));
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { createJiti } from 'jiti';
      const { cronMatches, nextCronDate } = await createJiti(import.meta.url).import(${JSON.stringify(source)});
      const date = new Date('2026-10-12T03:30:45Z');
      console.log(JSON.stringify({ matches: cronMatches('0 9 * * *', date), next: nextCronDate('0 9 * * *', date).toISOString() }));
    `], { env: { ...process.env, TZ: 'Asia/Kolkata' }, timeout: 5000, encoding: 'utf8', cwd: fileURLToPath(new URL('..', import.meta.url)) });
    expect(child.error).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual({ matches: true, next: '2026-10-13T03:30:00.000Z' });
  });

  it('wires task timezone into dueTasks and actual scheduler execution', async () => {
    const local = new CronTestTask().dailyAt('09:00').timezone('America/Sao_Paulo');
    const utc = new CronTestTask().dailyAt('09:00').timezone('UTC');
    local.name = 'local';
    utc.name = 'utc';
    const scheduler = new Scheduler().register(local).register(utc);
    const date = new Date('2026-10-12T12:00:20Z');
    expect(local.getTimezone()).toBe('America/Sao_Paulo');
    expect(scheduler.dueTasks(date)).toEqual([local]);
    expect(await scheduler.run(date)).toHaveLength(1);
    expect(local.calls).toBe(1);
    expect(utc.calls).toBe(0);
  });

  it('rejects invalid fluent inputs before registration or iteration', () => {
    const task = new CronTestTask();
    expect(() => task.everyMinutes(0)).toThrow();
    expect(() => task.hourlyAt(60)).toThrow();
    expect(() => task.dailyAt('24:00')).toThrow();
    expect(() => task.dailyAt('09:00junk')).toThrow();
    expect(() => task.dailyAt('09:00:10')).toThrow();
    expect(() => task.weeklyOn(8)).toThrow();
    expect(() => task.monthlyOn(32)).toThrow();
    expect(() => task.timezone('Invalid/Zone')).toThrow();
    expect(() => task.timezone('')).toThrow();
    expect(() => cronMatches('* * * * *', new Date(NaN), 'UTC')).toThrow();
    class InvalidTask extends CronTestTask { schedule(): this { return this.everyMinutes(0); } }
    const scheduler = new Scheduler();
    expect(() => scheduler.register(new InvalidTask())).toThrow();
    expect(scheduler.getTasks()).toEqual([]);
  });
});

describe('Schedule Monitor Calendar Previews', () => {
  it('reports real leap-day and timezone previews rather than now', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2096-03-01T12:00:00Z'));
    vi.spyOn(QueryBuilder.prototype, 'get').mockResolvedValue([]);
    const task = new CronTestTask().cron('0 0 29 FEB *').timezone('UTC');
    task.name = 'leap-preview';
    ScheduleMonitor.configure(new Scheduler().register(task));
    const info = await ScheduleMonitor.getTask(task.name);
    expect(info?.nextRun?.toISOString()).toBe('2104-02-29T00:00:00.000Z');
    expect(info?.nextRunError).toBeUndefined();
    expect(info?.timezone).toBe('UTC');
  });

  it('reports an unavailable preview explicitly if the calendar iterator fails', async () => {
    vi.spyOn(QueryBuilder.prototype, 'get').mockResolvedValue([]);
    vi.spyOn(CronExpression.prototype, 'next').mockImplementation(() => { throw new Error('Private parser diagnostic'); });
    const task = new CronTestTask().daily().timezone('UTC');
    task.name = 'unavailable-preview';
    ScheduleMonitor.configure(new Scheduler().register(task));
    const info = await ScheduleMonitor.getTask(task.name);
    expect(info?.nextRun).toBeNull();
    expect(info?.nextRunError).toBe('Unable to calculate the next scheduled run');
    expect(JSON.stringify(info)).not.toContain('Private parser diagnostic');
  });

  it('does not invent a daily time for stepped hours', async () => {
    vi.spyOn(QueryBuilder.prototype, 'get').mockResolvedValue([]);
    const task = new CronTestTask().cron('0 */2 * * *');
    task.name = 'stepped-preview';
    ScheduleMonitor.configure(new Scheduler().register(task));
    expect((await ScheduleMonitor.getTask(task.name))?.humanReadable).toBe('0 */2 * * *');
  });
});
