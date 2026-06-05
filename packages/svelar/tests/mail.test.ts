import { afterEach, describe, expect, it, vi } from 'vitest';
import { Mailable, Mailer } from '../src/mail/index.js';

describe('Mailer', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('sends Postmark mail with the expected API payload', async () => {
    const requests: Array<{ url: string; headers: Record<string, string>; body: any }> = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(url),
        headers: init?.headers as Record<string, string>,
        body: JSON.parse(String(init?.body)),
      });
      return new Response(JSON.stringify({ MessageID: 'postmark-id' }), { status: 200 });
    }) as any;

    Mailer.configure({
      default: 'postmark',
      from: { name: 'Svelar', address: 'noreply@svelar.dev' },
      mailers: {
        postmark: {
          driver: 'postmark',
          apiToken: 'postmark-token',
          endpoint: 'https://postmark.test/email',
          messageStream: 'broadcasts',
        },
      },
    });

    const result = await Mailer.send({
      to: ['one@example.com', 'two@example.com'],
      cc: 'copy@example.com',
      bcc: 'hidden@example.com',
      replyTo: 'reply@example.com',
      subject: 'Postmark Subject',
      html: '<p>Hello</p>',
      text: 'Hello',
      tags: { category: 'welcome' },
      attachments: [{ filename: 'hello.txt', content: 'hello', contentType: 'text/plain' }],
    });

    expect(result).toEqual({ accepted: ['one@example.com', 'two@example.com'], rejected: [], messageId: 'postmark-id' });
    expect(requests[0]).toMatchObject({
      url: 'https://postmark.test/email',
      headers: {
        'X-Postmark-Server-Token': 'postmark-token',
      },
      body: {
        From: 'Svelar <noreply@svelar.dev>',
        To: 'one@example.com, two@example.com',
        Cc: 'copy@example.com',
        Bcc: 'hidden@example.com',
        ReplyTo: 'reply@example.com',
        Subject: 'Postmark Subject',
        HtmlBody: '<p>Hello</p>',
        TextBody: 'Hello',
        MessageStream: 'broadcasts',
        Tag: 'welcome',
        Attachments: [{ Name: 'hello.txt', Content: 'aGVsbG8=', ContentType: 'text/plain' }],
      },
    });
  });

  it('sends Resend mail with mailable classes', async () => {
    const requests: Array<{ url: string; headers: Record<string, string>; body: any }> = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(url),
        headers: init?.headers as Record<string, string>,
        body: JSON.parse(String(init?.body)),
      });
      return new Response(JSON.stringify({ id: 'resend-id' }), { status: 200 });
    }) as any;

    class WelcomeMail extends Mailable {
      build(): this {
        return this
          .to('user@example.com')
          .replyTo('support@example.com')
          .subject('Welcome')
          .tag('category', 'onboarding')
          .html('<h1>Welcome</h1>');
      }
    }

    Mailer.configure({
      default: 'resend',
      from: { name: 'Svelar', address: 'noreply@svelar.dev' },
      mailers: {
        resend: {
          driver: 'resend',
          apiKey: 'resend-token',
          endpoint: 'https://resend.test/emails',
        },
      },
    });

    const result = await Mailer.sendMailable(new WelcomeMail());

    expect(result).toEqual({ accepted: ['user@example.com'], rejected: [], messageId: 'resend-id' });
    expect(requests[0]).toMatchObject({
      url: 'https://resend.test/emails',
      headers: {
        Authorization: 'Bearer resend-token',
      },
      body: {
        from: 'Svelar <noreply@svelar.dev>',
        to: ['user@example.com'],
        reply_to: ['support@example.com'],
        subject: 'Welcome',
        html: '<h1>Welcome</h1>',
        tags: [{ name: 'category', value: 'onboarding' }],
      },
    });
  });

  it('sends Mailtrap mail with the expected API payload', async () => {
    const requests: Array<{ url: string; headers: Record<string, string>; body: any }> = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(url),
        headers: init?.headers as Record<string, string>,
        body: JSON.parse(String(init?.body)),
      });
      return new Response(JSON.stringify({ success: true, message_ids: ['mailtrap-id'] }), { status: 200 });
    }) as any;

    Mailer.configure({
      default: 'mailtrap',
      from: { name: 'Svelar', address: 'noreply@svelar.dev' },
      mailers: {
        mailtrap: {
          driver: 'mailtrap',
          apiToken: 'mailtrap-token',
          endpoint: 'https://mailtrap.test/api/send',
        },
      },
    });

    const result = await Mailer.send({
      to: ['one@example.com', 'two@example.com'],
      cc: 'copy@example.com',
      bcc: 'hidden@example.com',
      replyTo: 'Reply Team <reply@example.com>',
      subject: 'Mailtrap Subject',
      html: '<p>Hello</p>',
      text: 'Hello',
      tags: { category: 'transactional' },
      attachments: [{ filename: 'hello.txt', content: 'hello', contentType: 'text/plain' }],
    });

    expect(result).toEqual({ accepted: ['one@example.com', 'two@example.com'], rejected: [], messageId: 'mailtrap-id' });
    expect(requests[0]).toMatchObject({
      url: 'https://mailtrap.test/api/send',
      headers: {
        Authorization: 'Bearer mailtrap-token',
      },
      body: {
        from: { name: 'Svelar', email: 'noreply@svelar.dev' },
        to: [{ email: 'one@example.com' }, { email: 'two@example.com' }],
        cc: [{ email: 'copy@example.com' }],
        bcc: [{ email: 'hidden@example.com' }],
        reply_to: { name: 'Reply Team', email: 'reply@example.com' },
        subject: 'Mailtrap Subject',
        html: '<p>Hello</p>',
        text: 'Hello',
        category: 'transactional',
        attachments: [{ filename: 'hello.txt', content: 'aGVsbG8=', type: 'text/plain' }],
      },
    });
  });

  it('throws provider-specific API errors', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ message: 'Invalid token' }), { status: 401 })) as any;

    Mailer.configure({
      default: 'mailtrap',
      mailers: {
        mailtrap: {
          driver: 'mailtrap',
          apiToken: 'bad-token',
          endpoint: 'https://mailtrap.test/api/send',
        },
      },
    });

    await expect(Mailer.send({ to: 'user@example.com', subject: 'Failure', text: 'Nope' }))
      .rejects
      .toThrow('Mailtrap error 401: Invalid token');
  });
});
