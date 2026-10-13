import { fork, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.SVELAR_TEST_SSE_REDIS_URL;
const manifest = process.env.SVELAR_TEST_SSE_CLIENT;

describe.skipIf(!url || !manifest)('Redis SSE between worker and HTTP replicas', () => {
  let directory: string;
  let bundle: string;
  const children: Array<{ child: ChildProcess; events: any[]; exit: Promise<void>; output: string }> = [];
  const namespace = `svelar-sse-proof:${crypto.randomUUID()}`;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'svelar-sse-proof-'));
    await symlink(join(dirname(resolve(manifest!)), 'node_modules'), join(directory, 'node_modules'));
    bundle = join(directory, 'fixture.mjs');
    await build({ entryPoints: [resolve('tests/broadcasting-process-fixture.ts')], outfile: bundle,
      bundle: true, platform: 'node', format: 'esm', target: 'node22', keepNames: true, packages: 'external', logLevel: 'silent' });
  });
  afterAll(async () => {
    for (const entry of children) {
      if (entry.child.exitCode === null && entry.child.signalCode === null) entry.child.kill('SIGKILL');
      await entry.exit;
    }
    if (directory) await rm(directory, { force: true, recursive: true });
  });
  async function until<T>(callback: () => T | undefined): Promise<T> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const result = callback(); if (result !== undefined) return result;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`SSE process did not become ready: ${children.map((entry) => entry.output).join('\n')}`);
  }
  async function child(role: string) {
    const process = fork(bundle, [], { env: { ...globalThis.process.env, SVELAR_SSE_ROLE: role, SVELAR_SSE_NAMESPACE: namespace }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    const entry = { child: process, events: [] as any[], output: '', exit: new Promise<void>((resolve) => process.once('exit', () => resolve())) };
    process.on('message', (event) => entry.events.push(event));
    process.stdout?.on('data', (data) => { entry.output += data; }); process.stderr?.on('data', (data) => { entry.output += data; });
    children.push(entry);
    const ready = await until(() => entry.events.find((event) => event.event === 'ready'));
    return { ...entry, port: ready.port as number };
  }
  async function connection(port: number, cursor?: string) {
    const abort = new AbortController();
    const response = await fetch(`http://127.0.0.1:${port}`, { signal: abort.signal, headers: cursor ? { 'Last-Event-ID': cursor } : {} });
    const reader = response.body!.getReader();
    let text = '';
    const read = async (name: string) => {
      for (;;) {
        const index = text.indexOf('\n\n');
        if (index >= 0) {
          const frame = text.slice(0, index); text = text.slice(index + 2);
          if (frame.includes(`event: ${name}\n`)) return frame;
          continue;
        }
        const chunk = await reader.read();
        if (chunk.done) throw new Error('SSE ended before the expected event.');
        text += new TextDecoder().decode(chunk.value);
      }
    };
    await read('connected');
    return { read, close: async () => { await reader.cancel(); abort.abort(); } };
  }
  it('fans out one worker event to two replicas and resumes missed events after replica death', async () => {
    const one = await child('web'); const two = await child('web'); const producer = await child('worker');
    const first = await connection(one.port); const second = await connection(two.port);
    producer.child.send({ command: 'publish', value: 1 });
    const oneEvent = await first.read('changed'); const twoEvent = await second.read('changed');
    const cursor = oneEvent.match(/^id: (.+)$/m)![1];
    expect(twoEvent.match(/^id: (.+)$/m)![1]).toBe(cursor);
    expect(oneEvent).toContain('"value":1'); expect(twoEvent).toContain('"value":1');
    await first.close(); one.child.kill('SIGKILL'); await one.exit;
    producer.child.send({ command: 'publish', value: 2 });
    expect(await second.read('changed')).toContain('"value":2');
    const replacement = await child('web'); const resumed = await connection(replacement.port, cursor);
    expect(await resumed.read('changed')).toContain('"value":2');
    await resumed.close(); await second.close();
  }, 25_000);
});
