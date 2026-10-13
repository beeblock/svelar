import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connection, Schema } from '@beeblock/svelar/database';
import { Model } from '@beeblock/svelar/orm';
import { Billable, BillingService, Invoice, Stripe, StripeService, Subscription, SyncStripeCustomerJob, registerDefaultWebhookHandlers } from '../src/index.js';
import type { BillableId } from '../src/index.js';
import { normalizeBillableId } from '../src/BillableId.js';
import { InvoiceResource, SubscriptionResource } from '../src/server/index.js';
import CreateSubscriptions from '../src/publishable/migrations/create_subscriptions.js';
import CreateInvoices from '../src/publishable/migrations/create_invoices.js';

const uuid = '019c20a1-ff11-7000-8000-abcde1234567';
const ulid = '01KARZ3NDEKTSV4RRFFQ69G5F8';
const config = { secretKey: 'sk_test_fixture', publishableKey: 'pk_test_fixture', webhookSecret: 'whsec_fixture', logging: false };
const driver = process.env.SVELAR_STRIPE_TEST_DRIVER ?? 'sqlite';

class IntegerAccount extends Billable(Model) {
  static table = 'integer_accounts';
  static timestamps = false;
  static fillable = ['name', 'email', 'stripe_customer_id'];
}

class KeyedAccount extends Billable(Model) {
  static table = 'keyed_accounts';
  static primaryKey = 'account_key';
  static timestamps = false;
  static fillable = ['account_key', 'name', 'email', 'stripe_customer_id'];
}

class UuidAccount extends KeyedAccount {
  static incrementing = false;
  static uniqueIds = ['account_key'];
}

class UlidAccount extends UuidAccount {
  static uniqueIdType = 'ulid' as const;
}

function subscription(id: string, billableType: string, billableId: BillableId) {
  return {
    id, object: 'subscription', customer: `cus_${id}`, status: 'active', cancel_at_period_end: false,
    metadata: { billable_type: billableType, billable_id: normalizeBillableId(billableId) },
    items: { data: [{ price: { id: 'price_fixture' }, current_period_start: 1770000000, current_period_end: 1772500000 }] },
  };
}

async function seedKey(key: string) {
  return await KeyedAccount.create({ account_key: key, name: 'Keyed', email: 'keyed@example.test', stripe_customer_id: null }) as KeyedAccount;
}

beforeEach(async () => {
  await Connection.disconnect();
  if (driver !== 'sqlite' && driver !== 'postgres' && driver !== 'mysql') throw new Error('Unsupported native test driver');
  if (driver !== 'sqlite' && !process.env.SVELAR_STRIPE_TEST_DATABASE_URL) throw new Error('Native driver tests require an isolated database URL');
  const url = driver === 'sqlite' ? null : new URL(process.env.SVELAR_STRIPE_TEST_DATABASE_URL!);
  Connection.configure({ default: 'stripe_ids', connections: {
    stripe_ids: driver === 'sqlite' ? { driver, filename: ':memory:' } : {
      driver, host: url!.hostname, port: Number(url!.port), database: url!.pathname.slice(1),
      user: decodeURIComponent(url!.username), password: decodeURIComponent(url!.password), prepare: false,
    },
  } });
  const schema = new Schema();
  for (const table of ['invoices', 'subscriptions', 'integer_accounts', 'keyed_accounts']) await schema.dropTableIfExists(table);
  await schema.createTable('integer_accounts', (table) => {
    table.increments('id'); table.string('name'); table.string('email'); table.string('stripe_customer_id').nullable();
  });
  await schema.createTable('keyed_accounts', (table) => {
    table.string('account_key', 255).primary(); table.string('name'); table.string('email'); table.string('stripe_customer_id').nullable();
  });
  await new CreateSubscriptions().up();
  await new CreateInvoices().up();
  Stripe.configure(config);
  Stripe.registerBillable(IntegerAccount);
  Stripe.registerBillable(KeyedAccount);
  Stripe.webhooks().removeAllListeners();
});

afterEach(async () => {
  vi.restoreAllMocks();
  Stripe.webhooks().removeAllListeners();
  const schema = new Schema();
  for (const table of ['invoices', 'subscriptions', 'integer_accounts', 'keyed_accounts']) await schema.dropTableIfExists(table);
  await Connection.disconnect();
});

describe(`polymorphic billable IDs (${driver})`, () => {
  it('normalizes numeric identities without destroying opaque UUID/ULID/string keys', () => {
    for (const id of [1, '1', uuid, ulid, '00000000000000000000000001', 'account:acme/42', 'caf\u00e9']) {
      expect(normalizeBillableId(id)).toBe(String(id));
    }
    for (const id of [undefined, null, {}, NaN, Infinity, 0, -1, 1.2, Number.MAX_SAFE_INTEGER + 1, '', ' 1', '01', '1e3', '__proto__', 'a\u0000b', 'x'.repeat(256)]) {
      expect(() => normalizeBillableId(id)).toThrow('Billable ID');
    }
  });

  it('reads the actual primary key for integer and custom-key models', async () => {
    const integer = await IntegerAccount.create({ name: 'Integer', email: 'integer@example.test', stripe_customer_id: null }) as IntegerAccount;
    expect(integer._billableId).toBe(integer.getAttribute('id'));
    expect((await seedKey(uuid))._billableId).toBe(uuid);
    expect((await seedKey(ulid))._billableId).toBe(ulid);
    expect(() => new KeyedAccount()._billableId).toThrow('Billable ID');
    const generatedUuid = await UuidAccount.create({ name: 'UUID', email: 'uuid@example.test', stripe_customer_id: null }) as UuidAccount;
    const generatedUlid = await UlidAccount.create({ name: 'ULID', email: 'ulid@example.test', stripe_customer_id: null }) as UlidAccount;
    expect(generatedUuid._billableId).toMatch(/^[0-9a-f-]{14}7[0-9a-f-]{21}$/);
    expect(generatedUlid._billableId).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
  });

  it.each([uuid, ulid])('persists and reuses a customer on the custom primary key %s', async (id) => {
    const account = await seedKey(id);
    const create = vi.spyOn(Stripe.service(), 'createCustomer').mockResolvedValue({ id: 'cus_keyed' } as never);
    expect(await account.createOrGetStripeCustomer()).toBe('cus_keyed');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ id, billableType: 'keyed_accounts' }));
    expect((await KeyedAccount.find(id))?.getAttribute('stripe_customer_id')).toBe('cus_keyed');
    expect(await (await KeyedAccount.find(id) as KeyedAccount).createOrGetStripeCustomer()).toBe('cus_keyed');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('stores mixed integer/custom-key subscriptions as text and scopes by both type and exact ID', async () => {
    const integer = await IntegerAccount.create({ name: 'Integer', email: 'integer@example.test', stripe_customer_id: 'cus_integer' }) as IntegerAccount;
    const keyed = await seedKey(uuid);
    const service = Stripe.service();
    vi.spyOn(service, 'createCustomer').mockResolvedValue({ id: 'cus_keyed' } as never);
    const create = vi.spyOn(service, 'createSubscription').mockImplementation(async (_customer, _price, opts) => {
      return { ...subscription(`sub_${opts?.metadata?.billable_type}`, opts?.metadata?.billable_type ?? '', opts?.metadata?.billable_id ?? ''), metadata: opts?.metadata } as never;
    });
    const billing = new BillingService(service);
    const numeric = await billing.subscribe('integer_accounts', integer._billableId, 'price_fixture');
    const opaque = await billing.subscribe('keyed_accounts', keyed._billableId, 'price_fixture', {
      metadata: { billable_id: '999', billable_type: 'foreign', subscription_name: 'foreign', application: 'fixture' },
    });
    expect(create.mock.calls[1][2]?.metadata).toEqual({ billable_id: uuid, billable_type: 'keyed_accounts', subscription_name: 'default', application: 'fixture' });
    expect(numeric.getAttribute('billable_id')).toBe(String(integer._billableId));
    expect(opaque.getAttribute('billable_id')).toBe(uuid);
    expect(typeof numeric.getAttribute('id')).toBe('number');
    expect((await Subscription.findByBillable('integer_accounts', String(integer._billableId)))?.getAttribute('id')).toBe(numeric.getAttribute('id'));
    expect((await Subscription.allForBillable('keyed_accounts', uuid)).map((row) => row.getAttribute('id'))).toEqual([opaque.getAttribute('id')]);
    expect(await Subscription.findByBillable('integer_accounts', uuid)).toBeNull();
    expect(await Subscription.allForBillable('keyed_accounts', uuid.toUpperCase())).toEqual([]);
    expect(new SubscriptionResource(opaque).toJSON().billableId).toBe(uuid);
  });

  it('protects canonical customer metadata from caller overrides and rejects invalid IDs before SDK I/O', async () => {
    const service = new StripeService();
    service.configure(config);
    const create = vi.fn().mockResolvedValue({ id: 'cus_fixture' });
    const client = vi.spyOn(service, 'getClient').mockResolvedValue({ customers: { create } } as never);
    await service.createCustomer({ id: uuid, billableType: 'keyed_accounts', metadata: { billable_id: '7', billable_type: 'foreign', application: 'fixture' } });
    expect(create.mock.calls[0][0].metadata).toEqual({ billable_id: uuid, billable_type: 'keyed_accounts', application: 'fixture' });
    await expect(service.createCustomer({ id: '' })).rejects.toThrow('Billable ID');
    expect(client).toHaveBeenCalledTimes(1);
  });

  it.each([uuid, ulid])('retains webhook ownership and integer invoice links for %s', async (id) => {
    registerDefaultWebhookHandlers(Stripe.webhooks());
    await Stripe.webhooks().handle({ type: 'customer.subscription.created', data: { object: subscription('sub_webhook', 'keyed_accounts', id) } });
    const local = await Subscription.findByStripeSubscriptionId('sub_webhook');
    expect(local?.getAttribute('billable_id')).toBe(id);
    await Stripe.webhooks().handle({ type: 'invoice.payment_succeeded', data: { object: {
      id: 'in_webhook', metadata: { billable_type: 'foreign', billable_id: '999' },
      parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_webhook' } },
      amount_due: 900, amount_paid: 900, currency: 'usd', status: 'paid',
    } } });
    const invoice = await Invoice.findByStripeInvoiceId('in_webhook');
    expect(invoice?.getAttribute('billable_type')).toBe('keyed_accounts');
    expect(invoice?.getAttribute('billable_id')).toBe(id);
    expect(invoice?.getAttribute('subscription_id')).toBe(local?.getAttribute('id'));
    expect(typeof invoice?.getAttribute('id')).toBe('number');
    expect(new InvoiceResource(invoice!).toJSON().billableId).toBe(id);
    expect((await Invoice.allForBillable('keyed_accounts', id))).toHaveLength(1);
    expect(await Invoice.allForBillable('keyed_accounts', id.toLowerCase() === id ? id.toUpperCase() : id.toLowerCase())).toEqual([]);
  });

  it('maps direct payment invoice metadata without coercing UUIDs or accepting invalid IDs', async () => {
    registerDefaultWebhookHandlers(Stripe.webhooks());
    const object = { id: 'in_direct', metadata: { billable_type: 'keyed_accounts', billable_id: uuid }, amount_due: 100, status: 'open' };
    await Stripe.webhooks().handle({ type: 'invoice.created', data: { object } });
    expect((await Invoice.findByStripeInvoiceId('in_direct'))?.getAttribute('billable_id')).toBe(uuid);
    await Stripe.webhooks().handle({ type: 'invoice.created', data: { object: { ...object, id: 'in_invalid', metadata: { ...object.metadata, billable_id: '' } } } });
    expect(await Invoice.findByStripeInvoiceId('in_invalid')).toBeNull();
  });

  it('serializes and restores queued custom-key customer sync without converting its ID', async () => {
    await seedKey(ulid);
    const restored = SyncStripeCustomerJob.restore(JSON.parse(new SyncStripeCustomerJob('keyed_accounts', ulid, 'job@example.test', 'Job').serialize()));
    const create = vi.spyOn(Stripe.service(), 'createCustomer').mockResolvedValue({ id: 'cus_job' } as never);
    await restored.handle(Stripe.service());
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ id: ulid }));
    expect((await KeyedAccount.find(ulid))?.getAttribute('stripe_customer_id')).toBe('cus_job');
    expect(() => SyncStripeCustomerJob.restore({ billableId: '' })).toThrow('Billable ID');
  });

  it('rejects a differently cased host identity before a customer side effect', async () => {
    await seedKey('Account-Case');
    const create = vi.spyOn(Stripe.service(), 'createCustomer');
    await expect(new BillingService(Stripe.service()).subscribe('keyed_accounts', 'account-case', 'price_fixture')).rejects.toThrow('not found');
    expect(create).not.toHaveBeenCalled();
    expect((await KeyedAccount.find('Account-Case'))?.getAttribute('stripe_customer_id')).toBeNull();
  });

  it('does not merge case/accent-distinct polymorphic identities under host collations', async () => {
    for (const [index, id] of ['Account-Case', 'account-case', 'caf\u00e9', 'cafe'].entries()) {
      const sub = await Subscription.create({ billable_type: 'keyed_accounts', billable_id: id, name: 'default', stripe_subscription_id: `sub_exact_${index}`, stripe_customer_id: 'cus_exact', stripe_price_id: 'price_fixture', status: 'active' });
      await Invoice.create({ billable_type: 'keyed_accounts', billable_id: id, subscription_id: sub.getAttribute('id'), stripe_invoice_id: `in_exact_${index}`, amount_due: 100, amount_paid: 0, currency: 'usd', status: 'open' });
      expect((await Subscription.findByBillable('keyed_accounts', id))?.getAttribute('billable_id')).toBe(id);
    }
    for (const id of ['Account-Case', 'account-case', 'caf\u00e9', 'cafe']) {
      expect((await Subscription.allForBillable('keyed_accounts', id)).map((row) => row.getAttribute('billable_id'))).toEqual([id]);
      expect((await Invoice.allForBillable('keyed_accounts', id)).map((row) => row.getAttribute('billable_id'))).toEqual([id]);
    }
  });
});
