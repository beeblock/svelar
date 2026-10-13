import { execFile } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const exec = promisify(execFile);
const core = process.env.SVELAR_PLUGIN_CORE;
const node = process.env.SVELAR_PLUGIN_NODE ?? process.execPath;

describe('Built Stripe candidate-core compatibility (opt-in)', () => {
  it.skipIf(!core)('enforces real request-local Core Auth and per-operation capabilities across native public entries', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'svelar-stripe-candidate-'));
    try {
      await mkdir(join(directory, 'node_modules/@beeblock'), { recursive: true });
      await symlink(resolve(core!), join(directory, 'node_modules/@beeblock/svelar'), 'dir');
      const installed = join(directory, 'node_modules/@beeblock/svelar-stripe');
      await mkdir(installed, { recursive: true });
      for (const name of ['dist', 'src/publishable']) await cp(join(packageRoot, name), join(installed, name), { recursive: true });
      await cp(join(packageRoot, 'package.json'), join(installed, 'package.json'));
      const script = join(directory, 'proof.mjs');
      await writeFile(script, `import assert from 'node:assert/strict';
        import { access, realpath } from 'node:fs/promises';
        import { fileURLToPath } from 'node:url';
        import { Stripe } from '@beeblock/svelar-stripe';
        import StripePlugin from '@beeblock/svelar-stripe/plugin';
        import { BillingController, CancelSubscriptionRequest, RefundRequest } from '@beeblock/svelar-stripe/server';
        import { AuthManager } from '@beeblock/svelar/auth';
        import { Plugin } from '@beeblock/svelar/plugins';
        assert.ok(new StripePlugin() instanceof Plugin);
        assert.equal(await realpath(fileURLToPath(import.meta.resolve('@beeblock/svelar/auth'))), await realpath(${JSON.stringify(resolve(core!, 'dist/auth/index.js'))}));
        for (const entries of Object.values(new StripePlugin().publishables())) for (const item of entries) await access(item.source);
        class Account {
          static persisted;
          static async find() { return this.persisted; }
          constructor(data) { this.data = data; }
          getAttribute(key) { return this.data[key]; }
        }
        Account.persisted = new Account({ id: 7, disabled: false });
        const auth = new AuthManager({ guard: 'session', model: Account, eligibility: { disabledColumn: 'disabled' }, audit: false });
        assert.equal(await auth.login(Account.persisted), Account.persisted);
        const calls = []; const capabilities = []; let allowed = true;
        Stripe.configure({ secretKey: 'fixture', publishableKey: 'fixture', webhookSecret: 'fixture', logging: false,
          adminGuard: (_, capability) => { capabilities.push(capability); return allowed; } });
        const sdk = {
          subscriptions: {
            list: async value => { calls.push(['list', value]); return { data: [], has_more: false }; },
            cancel: async id => { calls.push(['cancel', id]); return { id, status: 'canceled', cancel_at_period_end: false }; },
            update: async (id, value) => { calls.push(['update', id, value]); return { id, status: 'active', cancel_at_period_end: true }; }
          },
          invoicePayments: { list: async value => { calls.push(['payments', value]); return { has_more: false, data: [{ amount_paid: 500, payment: { type: 'payment_intent', payment_intent: 'pi_fixture' } }] }; } },
          refunds: { create: async value => { calls.push(['refund', value]); return { id: 're_fixture', amount: 500, status: 'succeeded' }; } }
        };
        Stripe.service().getClient = async () => sdk;
        const event = (body, authenticated = true) => {
          const url = new URL('https://app.test/api/admin/billing');
          return { url, params: {}, locals: { user: Account.persisted, ...(authenticated ? { auth } : {}) },
            request: new Request(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined) };
        };
        const controller = new BillingController();
        assert.equal((await controller.listSubscriptions(event(undefined, false))).status, 403);
        await assert.rejects(CancelSubscriptionRequest.validate(event({ subscriptionId: 'sub_fixture' }, false)));
        assert.equal(calls.length, 0);
        assert.equal(capabilities.length, 0);
        allowed = false;
        assert.equal((await controller.cancelSubscription(event({ subscriptionId: 'sub_fixture' }))).status, 403);
        await assert.rejects(RefundRequest.validate(event({ invoiceId: 'in_fixture' })));
        assert.equal(calls.length, 0);
        assert.deepEqual(capabilities, ['action.billing.cancel', 'action.billing.refund']);
        allowed = 'true';
        assert.equal((await controller.listSubscriptions(event())).status, 403);
        assert.equal(calls.length, 0);
        allowed = true;
        assert.equal((await controller.listSubscriptions(event())).status, 200);
        assert.equal(capabilities.at(-1), 'screen.billing.view');
        assert.equal((await controller.cancelSubscription(event({ subscriptionId: 'sub_fixture', immediately: 'false' }))).status, 200);
        assert.deepEqual(calls.at(-1), ['update', 'sub_fixture', { cancel_at_period_end: true }]);
        assert.equal((await controller.cancelSubscription(event({ subscriptionId: 'sub_fixture', immediately: true }))).status, 200);
        assert.deepEqual(calls.at(-1), ['cancel', 'sub_fixture']);
        const refunded = await controller.refundInvoice(event({ invoiceId: 'in_fixture' }));
        assert.equal(refunded.status, 200);
        assert.equal(capabilities.at(-1), 'action.billing.refund');
        assert.deepEqual(calls.at(-1), ['refund', { amount: 500, payment_intent: 'pi_fixture' }]);
        assert.equal((await refunded.json()).data.refund.id, 're_fixture');
        const previousWrites = calls.length;
        await assert.rejects(CancelSubscriptionRequest.validate(event({ subscriptionId: '' })));
        assert.equal(calls.length, previousWrites);
        console.log('candidate stripe auth and capability proof passed');
      `);
      const result = await exec(node, [script], { cwd: directory, timeout: 30000 });
      expect(result.stdout).toContain('candidate stripe auth and capability proof passed');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it.skipIf(!core)('strictly checks plugin source against installed candidate public APIs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'svelar-stripe-candidate-types-'));
    try {
      const appModules = resolve(core!, '../../');
      await symlink(appModules, join(directory, 'node_modules'), 'dir');
      const sdk = JSON.parse(await readFile(join(core!, 'package.json'), 'utf8'));
      const paths: Record<string, string[]> = {};
      for (const [entry, value] of Object.entries(sdk.exports) as [string, { types?: string } | string][]) {
        if (typeof value !== 'string' && value.types) paths[entry === '.' ? '@beeblock/svelar' : '@beeblock/svelar/' + entry.slice(2)] = [resolve(core!, value.types)];
      }
      await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', strict: true, skipLibCheck: true, noEmit: true, types: ['node'], paths }, include: [packageRoot + '/src/**/*.ts'], exclude: [packageRoot + '/src/publishable/**'] }));
      const tsc = resolve(appModules, 'typescript/bin/tsc');
      await exec(node, [tsc, '-p', join(directory, 'tsconfig.json')], { cwd: directory, timeout: 30000 }).catch((error: unknown) => {
        throw new Error(error instanceof Error && 'stdout' in error ? String(error.stdout) : String(error), { cause: error });
      });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
