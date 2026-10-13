import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connection, Schema } from '@beeblock/svelar/database';
import { Model } from '@beeblock/svelar/orm';
import { invoiceSubscriptionId, subscriptionDates } from '../src/StripeApiShapes.js';
import { StripeService } from '../src/StripeService.js';
import { Stripe } from '../src/index.js';
import { Subscription } from '../src/Subscription.js';
import { Invoice } from '../src/Invoice.js';
import { registerDefaultWebhookHandlers } from '../src/DefaultWebhookHandlers.js';
import CreateSubscriptions from '../src/publishable/migrations/create_subscriptions.js';
import CreateInvoices from '../src/publishable/migrations/create_invoices.js';

const transport = vi.hoisted(() => ({
  sdk: 'stripe',
  calls: [] as Array<{ url: string; headers: Headers; body: URLSearchParams }>,
  response: (_url: string): Record<string, unknown> => ({}),
}));

vi.mock('stripe', async () => {
  const current = await vi.importActual<typeof import('stripe')>('stripe');
  const previous = await vi.importActual<typeof import('stripe22')>('stripe22');
  return {
    default: class {
      constructor(key: string, options?: unknown) {
        if (options !== undefined) throw new Error('Service must use the SDK native API version');
        const SDK = transport.sdk === 'stripe22' ? previous.default : current.default;
        return new SDK(key, {
          maxNetworkRetries: 0,
          httpClient: SDK.createFetchHttpClient(async (url, init) => {
            const path = String(url);
            transport.calls.push({
              url: path, headers: new Headers(init?.headers), body: new URLSearchParams(String(init?.body ?? '')),
            });
            return new Response(JSON.stringify(transport.response(path)), {
              status: 200, headers: { 'content-type': 'application/json', 'request-id': 'req_test' },
            });
          }),
        });
      }
    },
  };
});

const config = { secretKey: 'sk_test_fake', publishableKey: 'pk_test_fake', webhookSecret: 'whsec_test', logging: false };
const start = 1770000000;
const end = 1772500000;
const subscription = {
  id: 'sub_test', object: 'subscription', customer: 'cus_test', status: 'active', cancel_at_period_end: false,
  metadata: { billable_type: 'test_billables', billable_id: '7' }, trial_end: null, canceled_at: null,
  items: { data: [{ id: 'si_test', price: { id: 'price_test' }, current_period_start: start, current_period_end: end }] },
};

class TestBillable extends Model {
  static table = 'test_billables';
  static timestamps = false;
  static fillable = ['id', 'name', 'email', 'stripe_customer_id'];
}

afterEach(async () => {
  vi.restoreAllMocks();
  Stripe.webhooks().removeAllListeners();
  await Connection.disconnect();
});

describe('Stripe API object migration', () => {
  it('uses the tracked price item billing period rather than removed subscription fields', () => {
    const result = subscriptionDates({
      ...subscription,
      current_period_start: 1,
      current_period_end: 2,
      items: { data: [
        { price: { id: 'other' }, current_period_start: 5, current_period_end: 6 },
        ...subscription.items.data,
      ] },
    }, 'price_test');
    expect(result.current_period_start).toBe(new Date(start * 1000).toISOString());
    expect(result.current_period_end).toBe(new Date(end * 1000).toISOString());
  });

  it('retains support for older webhook shapes and nullable timestamps', () => {
    expect(subscriptionDates({ current_period_start: 0, current_period_end: 100, trial_end: null, canceled_at: null }))
      .toEqual({ current_period_start: new Date(0).toISOString(), current_period_end: new Date(100000).toISOString(), trial_ends_at: null, canceled_at: null });
    expect(subscriptionDates({ current_period_start: Infinity, current_period_end: 'bad' }).current_period_start).toBeNull();
    expect(invoiceSubscriptionId({ subscription: { id: 'sub_old' } })).toBe('sub_old');
    expect(invoiceSubscriptionId({ parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_new' } } })).toBe('sub_new');
  });
});

describe.each([
  ['stripe22', '2026-05-27.dahlia'],
  ['stripe', '2026-09-30.endive'],
])('native SDK compatibility (%s)', (sdk, apiVersion) => {
  let service: StripeService;

  beforeEach(() => {
    transport.sdk = sdk;
    transport.calls = [];
    transport.response = () => ({});
    service = new StripeService();
    service.configure(config);
    Stripe.configure(config);
    Stripe.webhooks().removeAllListeners();
  });

  it('constructs the actual SDK using its matching API version and caches it', async () => {
    transport.response = () => ({ id: 'cus_test', object: 'customer', deleted: false });
    await service.createCustomer({ id: 7, billableType: 'test_billables' });
    expect(transport.calls[0].headers.get('stripe-version')).toBe(apiVersion);
    expect(transport.calls[0].body.get('metadata[billable_id]')).toBe('7');
    expect(await service.getClient()).toBe(await service.getClient());
  });

  it('uses supported modern subscription and Checkout method arguments', async () => {
    transport.response = (url) => url.includes('/checkout/') ? { id: 'cs_test', object: 'checkout.session' } : subscription;
    const created = await service.createSubscription('cus_test', 'price_test', { trialDays: 3, metadata: { billable_id: '7' } });
    expect(subscriptionDates(created, 'price_test').current_period_end).toBe(new Date(end * 1000).toISOString());
    await service.createCheckoutSession('cus_test', [{ price: 'price_test', quantity: 2 }], {
      successUrl: 'https://example.test/success', cancelUrl: 'https://example.test/cancel', trialDays: 3,
    });
    expect(transport.calls[0].body.get('items[0][price]')).toBe('price_test');
    expect(transport.calls[1].body.get('subscription_data[trial_period_days]')).toBe('3');
    expect(transport.calls[1].headers.get('stripe-version')).toBe(apiVersion);
  });

  it('verifies a real signed webhook and rejects tampering', async () => {
    const client = await service.getClient();
    const payload = JSON.stringify({ id: 'evt_test', object: 'event', type: 'customer.subscription.updated', data: { object: subscription } });
    const signature = client.webhooks.generateTestHeaderString({ payload, secret: config.webhookSecret });
    expect((await service.constructWebhookEvent(payload, signature)).id).toBe('evt_test');
    await expect(service.constructWebhookEvent(payload.replace('sub_test', 'sub_forged'), signature)).rejects.toThrow();
  });

  it.each(['payment_intent', 'charge'])('refunds the invoice allocation using the correct %s identifier', async (type) => {
    transport.response = (url) => url.includes('/invoice_payments') ? {
      object: 'list', has_more: false, data: [{
        id: 'inpay_test', amount_paid: 900, status: 'paid', payment: {
          type, [type]: { id: type === 'charge' ? 'ch_test' : 'pi_test' },
        },
      }],
    } : { id: 're_test', object: 'refund', amount: 900, status: 'succeeded' };
    expect((await service.refundInvoice('in_test')).amount).toBe(900);
    expect(transport.calls[0].url).toContain('invoice=in_test');
    expect(transport.calls[0].url).toContain('status=paid');
    expect(transport.calls[1].body.get(type)).toBe(type === 'charge' ? 'ch_test' : 'pi_test');
    expect(transport.calls[1].body.get(type === 'charge' ? 'payment_intent' : 'charge')).toBeNull();
    expect(transport.calls[1].body.get('amount')).toBe('900');
  });

  it.each([
    { has_more: false, data: [] },
    { has_more: true, data: [{ amount_paid: 900, payment: { type: 'charge', charge: 'ch_test' } }] },
    { has_more: false, data: [{ amount_paid: 1 }, { amount_paid: 2 }] },
    { has_more: false, data: [{ amount_paid: null, payment: { type: 'charge', charge: 'ch_test' } }] },
    { has_more: false, data: [{ amount_paid: 900, payment: { type: 'payment_record', payment_record: 'pr_test' } }] },
  ])('rejects ambiguous, unpaid, or off-Stripe payments without issuing a refund %#', async (payments) => {
    transport.response = () => ({ object: 'list', ...payments });
    await expect(service.refundInvoice('in_test')).rejects.toThrow();
    expect(transport.calls).toHaveLength(1);
  });

  it('rejects deleted customers instead of casting them to active customer objects', async () => {
    transport.response = () => ({ id: 'cus_deleted', object: 'customer', deleted: true });
    await expect(service.getCustomer('cus_deleted')).rejects.toThrow('has been deleted');
  });

  it('persists modern subscription and invoice webhook shapes with the existing ORM migrations', async () => {
    await Connection.disconnect();
    Connection.configure({ default: 'sqlite', connections: { sqlite: { driver: 'sqlite', filename: ':memory:' } } });
    await new Schema().createTable('test_billables', (table) => {
      table.increments('id'); table.string('name'); table.string('email'); table.string('stripe_customer_id');
    });
    await new CreateSubscriptions().up();
    await new CreateInvoices().up();
    await TestBillable.create({ id: 7, name: 'Test', email: 'test@example.test', stripe_customer_id: 'cus_test' });
    Stripe.registerBillable(TestBillable);
    registerDefaultWebhookHandlers(Stripe.webhooks());
    await Stripe.webhooks().handle({ type: 'customer.subscription.created', data: { object: subscription } });
    const local = await Subscription.findByStripeSubscriptionId('sub_test');
    expect(local?.getAttribute('current_period_start')).toBe(new Date(start * 1000).toISOString());
    expect(local?.getAttribute('current_period_end')).toBe(new Date(end * 1000).toISOString());
    await Stripe.webhooks().handle({ type: 'customer.subscription.updated', data: { object: {
      ...subscription, items: { data: [{ ...subscription.items.data[0], current_period_end: end + 100 }] },
    } } });
    expect((await Subscription.findByStripeSubscriptionId('sub_test'))?.getAttribute('current_period_end')).toBe(new Date((end + 100) * 1000).toISOString());
    await Stripe.webhooks().handle({ type: 'invoice.payment_succeeded', data: { object: {
      id: 'in_test', amount_due: 900, amount_paid: 900, currency: 'usd', status: 'paid', metadata: {},
      parent: { type: 'subscription_details', subscription_details: { subscription: { id: 'sub_test' } } },
    } } });
    const invoice = await Invoice.findByStripeInvoiceId('in_test');
    expect(invoice?.getAttribute('subscription_id')).toBe(local?.getAttribute('id'));
    expect(invoice?.getAttribute('billable_id')).toBe(7);
    transport.response = () => ({ object: 'list', has_more: false, data: [{ invoice: 'in_test' }] });
    await Stripe.webhooks().handle({ type: 'charge.refunded', data: { object: {
      id: 'ch_test', payment_intent: 'pi_test', amount: 900, amount_refunded: 900,
    } } });
    expect((await Invoice.findByStripeInvoiceId('in_test'))?.getAttribute('status')).toBe('refunded');
    expect(new URL(transport.calls[0].url).searchParams.get('payment[payment_intent]')).toBe('pi_test');
  });
});
