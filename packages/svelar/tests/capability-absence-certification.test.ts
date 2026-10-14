import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const gate = await import(pathToFileURL(resolve(import.meta.dirname, '../../../scripts/capability-absence-certification.mjs')).href);
const core10Sha256 = '4f72573381beef38f61b9fae9244f6c01a86767ca313455eba2a1d0bb90a28f7';

describe('Installed capability absence sidecar', () => {
  it('prepares only by default and accepts an explicit immutable artifact identity', () => {
    const options = gate.parseCapabilityOptions([]);
    expect(options.certify).toBe(false);
    expect(options.expectedSha256).toBeUndefined();
    expect(gate.parseCapabilityOptions([`--expected-core-sha256=${core10Sha256}`]).expectedSha256).toBe(core10Sha256);
    expect(gate.parseCapabilityOptions([`--expected-core-sha256=${core10Sha256.toUpperCase()}`]).expectedSha256).toBe(core10Sha256);
    expect(gate.parseCapabilityOptions(['--certify', '--validation=valibot']).certify).toBe(true);
    expect(gate.receiptLabel).toBe('test-owned frontend + CLI-generated backend');
  });
  it.each(['--clients=', '--clients=./source', '--report-dir=', '--validation=other', '--skip-typecheck', '--skip-csrf',
    '--expected-core-sha256=', '--expected-core-sha256=abc', `--expected-core-sha256=${'g'.repeat(64)}`])('rejects incomplete or bypass options %s', flag => {
    expect(() => gate.parseCapabilityOptions([flag])).toThrow();
  });
  it('derives receipt labels and version/hash metadata from the actual physical package', () => {
    const artifact = { path: '/artifacts/core10.tgz', sha256: core10Sha256, integrity: 'sha512-verified' };
    const identity = gate.capabilityReceiptIdentity('/app/node_modules/@beeblock/svelar/package.json', { name: '@beeblock/svelar', version: '0.8.0' }, artifact);
    expect(identity.installed.version).toBe('0.8.0');
    expect(identity.installed.artifact).toBe(artifact);
    expect(identity.label).toContain('actual installed @beeblock/svelar@0.8.0');
    expect(identity.label).toContain(core10Sha256);
    const future = gate.capabilityReceiptIdentity('/other/package.json', { name: '@beeblock/svelar', version: '0.9.1' }, { ...artifact, sha256: 'a'.repeat(64) });
    expect(future.label).toContain('actual installed @beeblock/svelar@0.9.1');
    expect(future.label).not.toContain(core10Sha256);
    expect(() => gate.capabilityReceiptIdentity('/app/package.json', { name: 'other', version: '0.8.0' }, artifact)).toThrow();
    expect(() => gate.capabilityReceiptIdentity('/app/package.json', { name: '@beeblock/svelar' }, artifact)).toThrow();
    expect(() => gate.capabilityReceiptIdentity('/app/package.json', { name: '@beeblock/svelar', version: '0.8.0' }, { ...artifact, sha256: '' })).toThrow();
  });
  it('generates the complete protected backend before test-owned frontend and grant fixtures', () => {
    const commands = gate.generatorCommands('/owned/app', 'zod') as string[][];
    expect(commands[0]).toEqual(['new', '/owned/app', '--no-install', '--validation=zod']);
    expect(commands[1]).toContain('--crud');
    for (const command of commands.slice(1, 3)) {
      expect(command).toContain('--capability=capability-proof');
      expect(command).toContain('--scope=platform');
      expect(command).not.toContain('--public');
    }
    expect(commands.map(command => command[0])).toEqual(['new', 'make:entity', 'make:route', 'make:seeder', 'make:factory', 'make:factory', 'make:command']);
    const files = gate.capabilityFixtureFiles() as Array<{ path: string; content: string }>;
    expect(files.some(file => /CapabilityRecord(?:Controller|Requests|Dtos|Actions|Repository|Service|Resource)\.ts$/.test(file.path))).toBe(false);
  });
  it.each(['zod', 'valibot'])('uses public server snapshots, client can and the generated shared %s schemas', provider => {
    const files = gate.capabilityFixtureFiles(provider) as Array<{ path: string; content: string }>;
    const server = files.find(file => file.path.endsWith('+page.server.ts'))!.content;
    expect(server).toContain('capabilityAccess.guardLayout');
    expect(server).toContain('capabilityAccess.snapshot(input)');
    expect(server).toContain('resolveCapabilityInput');
    expect(server).not.toContain('locals.user =');
    const page = files.find(file => file.path.endsWith('+page.svelte'))!.content;
    expect(page).toContain("from '@beeblock/svelar/permissions/client'");
    expect(page).toContain('capabilityClient(data.capabilities)');
    for (const action of gate.commands) expect(page).toContain(`{#if access.can('action.capability-proof.${action}')}`);
    expect(page).toContain('createState.validateForm({ update: true })');
    expect(page).toContain('updateState.validateForm({ update: true })');
    expect(page).toContain("from '$lib/modules/capability-proof/contracts/schemas/capability-record.schema.js'");
    expect(page).toContain("from '@beeblock/svelar/http'");
    expect(page).toContain('disabled={pending}');
    expect(page).toContain('aria-busy={pending}');
    expect(page).toContain('role="status"');
    expect(page).toContain('role="alert"');
    expect(page).toContain('role="alertdialog"');
    expect(page).toContain('untrack(() => data.createForm)');
    expect(page).toContain('untrack(() => data.updateForm)');
    expect(page).toContain('untrack(() => data.records)');
    expect(page).toContain('role="alertdialog" tabindex="-1"');
    expect(page).toContain('createState.reset()');
    for (const icon of ['plus', 'pencil', 'trash-2']) expect(page).toContain(`from '@lucide/svelte/icons/${icon}'`);
    expect(page).not.toContain("from 'lucide-svelte/");
  });
  it('seeds exact grants for ordinary users and reads full state through the repository', () => {
    const files = gate.capabilityFixtureFiles() as Array<{ path: string; content: string }>;
    const factory = files.find(file => file.path.endsWith('CapabilityActorFactory.ts'))!.content;
    expect(factory).toContain("role: 'user'");
    expect(factory).toContain('await Hash.make(password)');
    const seed = files.find(file => file.path.endsWith('CapabilityAbsenceSeeder.ts'))!.content;
    expect(seed).toContain("kind === 'reader' ? ['screen.capability-proof.view']");
    expect(seed).toContain('profiles.setCustom');
    expect(seed).toContain('Permissions.global().assignRole');
    const state = files.find(file => file.path.endsWith('CapabilityStateCommand.ts'))!.content;
    expect(state).toContain('new CapabilityRecordRepository().all()');
    expect(state).toContain('record.getAttributes()');
    expect(state).not.toContain('record.toArray()');
    for (const file of files) {
      expect(file.content).not.toContain('Connection.raw');
      expect(file.content).not.toContain('CREATE TABLE');
      expect(file.content).not.toContain('csrfExclude');
    }
  });
  it('requires actual DOM absence, a privileged positive control and a nonempty persisted row', () => {
    const reader = { ready: true, records: 1, buttons: { create: 0, update: 0, delete: 0 }, documentWidth: 390, viewportWidth: 390 };
    expect(() => gate.assertActionPresentation(reader, false)).not.toThrow();
    expect(() => gate.assertActionPresentation({ ...reader, buttons: { ...reader.buttons, create: 1 } }, false)).toThrow(/absent/);
    expect(() => gate.assertActionPresentation(reader, true)).toThrow(/must exist/);
    expect(() => gate.assertActionPresentation({ ...reader, records: 0 }, false)).toThrow(/persisted/);
    expect(() => gate.assertActionPresentation({ ...reader, documentWidth: 450 }, false)).toThrow(/overflow/);
    expect(() => gate.assertActionPresentation({ ...reader, buttons: { create: 1, update: 1, delete: 1 } }, true)).not.toThrow();
  });
});
