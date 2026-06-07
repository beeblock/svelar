import { beforeEach, describe, expect, it } from 'vitest';
import { BillingController, CancelSubscriptionDto, CancelSubscriptionRequest, StripeWebhookController } from '../src/server/index.js';
import { Stripe } from '../src/index.js';
import { StripeWebhookHandler } from '../src/StripeWebhookHandler.js';

function requestEvent(
  path: string,
  init: RequestInit = {},
  locals: Record<string, any> = {},
): any {
  const url = new URL(path, 'http://localhost');
  return {
    request: new Request(url, init),
    url,
    params: {},
    locals,
    getClientAddress: () => '127.0.0.1',
    cookies: {},
    platform: {},
  };
}

async function json(response: Response): Promise<any> {
  return response.json();
}

describe('@beeblock/svelar-stripe', () => {
  beforeEach(() => {
    Stripe.configure({
      secretKey: 'sk_test_fake',
      publishableKey: 'pk_test_fake',
      webhookSecret: 'whsec_fake',
      logging: false,
    });
    Stripe.webhooks().removeAllListeners();
    delete (Stripe.service() as any).getClient;
    delete (Stripe.service() as any).cancelSubscription;
    delete (Stripe.service() as any).refundInvoice;
    delete (Stripe.service() as any).constructWebhookEvent;
  });

  it('denies published admin billing endpoints until an admin guard is configured', async () => {
    const ctrl = new BillingController();
    const response = await ctrl.handle('listSubscriptions')(
      requestEvent('/api/admin/billing/subscriptions'),
    );

    expect(response.status).toBe(403);
    expect(await json(response)).toEqual({
      data: null,
      meta: {
        message: 'Forbidden',
        code: 'stripe_admin_forbidden',
      },
    });
  });

  it('returns FormRequest validation errors as 422 responses through controllers', async () => {
    Stripe.configure({
      secretKey: 'sk_test_fake',
      publishableKey: 'pk_test_fake',
      webhookSecret: 'whsec_fake',
      adminGuard: () => true,
      logging: false,
    });

    const ctrl = new BillingController();
    const response = await ctrl.handle('cancelSubscription')(
      requestEvent('/api/admin/billing/cancel', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ immediately: true }),
      }),
    );

    expect(response.status).toBe(422);
    expect(await json(response)).toMatchObject({
      message: 'The given data was invalid.',
      errors: {
        subscriptionId: expect.any(Array),
      },
    });
  });

  it('coerces form-style booleans and returns DTOs from billing FormRequests', async () => {
    const dto = await CancelSubscriptionRequest.validate(
      requestEvent('/api/admin/billing/cancel', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          subscriptionId: 'sub_123',
          immediately: 'false',
        }),
      }),
    );

    expect(dto).toBeInstanceOf(CancelSubscriptionDto);
    expect(dto.subscriptionId).toBe('sub_123');
    expect(dto.immediately).toBe(false);
  });

  it('wraps admin billing list responses in a data/meta envelope', async () => {
    Stripe.configure({
      secretKey: 'sk_test_fake',
      publishableKey: 'pk_test_fake',
      webhookSecret: 'whsec_fake',
      adminGuard: (event) => event.locals.user?.role === 'admin',
      logging: false,
    });

    (Stripe.service() as any).getClient = async () => ({
      subscriptions: {
        list: async (params: any) => {
          expect(params.limit).toBe(100);
          return {
            has_more: false,
            data: [{
              id: 'sub_123',
              status: 'active',
              cancel_at_period_end: false,
              customer: { id: 'cus_123', email: 'admin@example.test', name: 'Admin' },
              items: {
                data: [{
                  price: {
                    nickname: 'Pro',
                    unit_amount: 2900,
                    currency: 'usd',
                    recurring: { interval: 'month' },
                  },
                }],
              },
              created: 1710000000,
            }],
          };
        },
      },
    });

    const ctrl = new BillingController();
    const response = await ctrl.handle('listSubscriptions')(
      requestEvent('/api/admin/billing/subscriptions?limit=999', {}, { user: { role: 'admin' } }),
    );

    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({
      data: {
        subscriptions: [{
          id: 'sub_123',
          status: 'active',
          customer: {
            email: 'admin@example.test',
          },
        }],
      },
      meta: {
        hasMore: false,
      },
    });
  });

  it('rejects Stripe webhooks without a signature using the resource envelope', async () => {
    const ctrl = new StripeWebhookController();
    const response = await ctrl.handle('handleWebhook')(
      requestEvent('/api/webhooks/stripe', {
        method: 'POST',
        body: '{"id":"evt_123"}',
      }),
    );

    expect(response.status).toBe(400);
    expect(await json(response)).toEqual({
      data: null,
      meta: {
        message: 'Missing Stripe signature',
        code: 'stripe_signature_missing',
      },
    });
  });

  it('constructs signed webhook events from the raw body and dispatches handlers', async () => {
    let handled = false;
    (Stripe.service() as any).constructWebhookEvent = async (body: string, signature: string) => {
      expect(body).toBe('{"id":"evt_123"}');
      expect(signature).toBe('sig_test');
      return { id: 'evt_123', type: 'invoice.created', data: { object: {} } };
    };
    Stripe.webhooks().on('invoice.created', async () => {
      handled = true;
    });

    const ctrl = new StripeWebhookController();
    const response = await ctrl.handle('handleWebhook')(
      requestEvent('/api/webhooks/stripe', {
        method: 'POST',
        headers: { 'stripe-signature': 'sig_test' },
        body: '{"id":"evt_123"}',
      }),
    );

    expect(response.status).toBe(200);
    expect(handled).toBe(true);
    expect(await json(response)).toEqual({
      data: {
        received: true,
      },
    });
  });

  it('returns 400 when Stripe signature verification fails', async () => {
    (Stripe.service() as any).constructWebhookEvent = async () => {
      throw new Error('No signatures found matching the expected signature');
    };

    const ctrl = new StripeWebhookController();
    const response = await ctrl.handle('handleWebhook')(
      requestEvent('/api/webhooks/stripe', {
        method: 'POST',
        headers: { 'stripe-signature': 'sig_bad' },
        body: '{"id":"evt_123"}',
      }),
    );

    expect(response.status).toBe(400);
    expect(await json(response)).toEqual({
      data: null,
      meta: {
        message: 'Invalid Stripe signature',
        code: 'stripe_signature_invalid',
      },
    });
  });

  it('supports once/off webhook listener semantics', async () => {
    const webhooks = new StripeWebhookHandler();
    let calls = 0;
    const handler = async () => {
      calls += 1;
    };

    webhooks.once('checkout.session.completed', handler);
    await webhooks.handle({ type: 'checkout.session.completed' });
    await webhooks.handle({ type: 'checkout.session.completed' });

    expect(calls).toBe(1);
    expect(webhooks.hasHandlers('checkout.session.completed')).toBe(false);
  });
});
