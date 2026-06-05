/**
 * Svelar Mail
 *
 * Email sending abstraction with swappable drivers.
 *
 * Drivers:
 * - **smtp** — SMTP via nodemailer (requires `npm install nodemailer`)
 * - **postmark** — Postmark transactional email API (zero deps, uses fetch)
 * - **resend** — Resend email API (zero deps, uses fetch)
 * - **mailtrap** — Mailtrap Email API (zero deps, uses fetch)
 * - **log** — Logs emails to console (development)
 * - **null** — Silently discards emails (testing)
 *
 * @example
 * ```ts
 * import { Mailer } from '@beeblock/svelar/mail';
 *
 * Mailer.configure({
 *   default: 'resend',
 *   mailers: {
 *     resend: {
 *       driver: 'resend',
 *       apiKey: process.env.RESEND_API_KEY,
 *     },
 *     postmark: {
 *       driver: 'postmark',
 *       apiToken: process.env.POSTMARK_API_TOKEN,
 *     },
 *     smtp: {
 *       driver: 'smtp',
 *       host: 'smtp.example.com',
 *       port: 587,
 *       auth: { user: 'you@example.com', pass: 'secret' },
 *     },
 *     mailtrap: {
 *       driver: 'mailtrap',
 *       apiToken: process.env.MAILTRAP_API_TOKEN,
 *     },
 *     log: { driver: 'log' },
 *   },
 *   from: { name: 'My App', address: 'noreply@example.com' },
 * });
 *
 * // Send (uses default driver)
 * await Mailer.send({
 *   to: 'user@example.com',
 *   subject: 'Welcome!',
 *   html: '<h1>Welcome to our app!</h1>',
 * });
 *
 * // Send via a specific driver
 * await Mailer.mailer('postmark').send({ ... });
 *
 * // Mailable class
 * class WelcomeEmail extends Mailable {
 *   constructor(private user: User) { super(); }
 *   build() {
 *     return this
 *       .to(this.user.email)
 *       .subject('Welcome!')
 *       .html(`<h1>Hi ${this.user.name}!</h1>`);
 *   }
 * }
 *
 * await Mailer.sendMailable(new WelcomeEmail(user));
 * ```
 */

// ── Types ──────────────────────────────────────────────────

export type MailDriver = 'smtp' | 'postmark' | 'resend' | 'mailtrap' | 'log' | 'null' | 'custom';

export interface MailerConfig {
  default: string;
  mailers: Record<string, MailDriverConfig>;
  from?: { name: string; address: string };
}

export interface MailDriverConfig {
  driver: MailDriver;
  // SMTP
  host?: string;
  port?: number;
  secure?: boolean;
  auth?: { user: string; pass: string };
  // Postmark
  apiToken?: string;
  /** Postmark message stream (default: 'outbound') */
  messageStream?: string;
  // Resend
  apiKey?: string;
  // HTTP API drivers
  endpoint?: string;
  // Custom — provide your own MailTransport instance
  transport?: MailTransport;
}

export interface MailMessage {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  from?: string | { name: string; address: string };
  replyTo?: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: Array<{
    filename: string;
    content: string | Buffer;
    contentType?: string;
  }>;
  /** Optional tags for analytics (supported by Postmark and Resend) */
  tags?: Record<string, string>;
}

export interface SendResult {
  accepted: string[];
  rejected: string[];
  messageId?: string;
}

// ── Mail Transport Interface ───────────────────────────────

export interface MailTransport {
  send(message: MailMessage): Promise<SendResult>;
}

// ── Helpers ────────────────────────────────────────────────

function formatFrom(from: string | { name: string; address: string }): string {
  if (typeof from === 'string') return from;
  return `${from.name} <${from.address}>`;
}

function parseAddress(address: string | { name: string; address: string }): { email: string; name?: string } {
  if (typeof address !== 'string') return { email: address.address, name: address.name };

  const match = address.match(/^\s*(?:"?([^"<]*)"?\s*)?<([^>]+)>\s*$/);
  if (!match) return { email: address.trim() };

  const name = match[1]?.trim();
  return name ? { email: match[2].trim(), name } : { email: match[2].trim() };
}

function toArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function encodeAttachment(content: string | Buffer): string {
  if (Buffer.isBuffer(content)) return content.toString('base64');
  return Buffer.from(content).toString('base64');
}

// ── Log Transport ──────────────────────────────────────────

class LogTransport implements MailTransport {
  async send(message: MailMessage): Promise<SendResult> {
    const to = toArray(message.to);
    console.log(`[Mail] To: ${to.join(', ')} | Subject: ${message.subject}`);
    if (message.text) console.log(`[Mail] Body: ${message.text.slice(0, 200)}`);
    return { accepted: to, rejected: [] };
  }
}

// ── Null Transport ─────────────────────────────────────────

class NullTransport implements MailTransport {
  async send(message: MailMessage): Promise<SendResult> {
    return { accepted: toArray(message.to), rejected: [] };
  }
}

// ── SMTP Transport (nodemailer) ────────────────────────────

class SmtpTransport implements MailTransport {
  constructor(private config: MailDriverConfig) {}

  async send(message: MailMessage): Promise<SendResult> {
    try {
      const nodemailer = await import('nodemailer');
      const transporter = nodemailer.createTransport({
        host: this.config.host,
        port: this.config.port ?? 587,
        secure: this.config.secure ?? false,
        auth: this.config.auth,
      });

      const result = await transporter.sendMail({
        from: message.from ? formatFrom(message.from) : undefined,
        to: toArray(message.to).join(', '),
        cc: toArray(message.cc).join(', ') || undefined,
        bcc: toArray(message.bcc).join(', ') || undefined,
        replyTo: message.replyTo,
        subject: message.subject,
        text: message.text,
        html: message.html,
        attachments: message.attachments,
      });

      return {
        accepted: result.accepted as string[],
        rejected: result.rejected as string[],
        messageId: result.messageId,
      };
    } catch (error: any) {
      if (error.code === 'MODULE_NOT_FOUND') {
        throw new Error('SMTP driver requires nodemailer. Install: npm install nodemailer');
      }
      throw error;
    }
  }
}

// ── Postmark Transport ─────────────────────────────────────

/**
 * Sends email via the Postmark API.
 * Uses fetch — zero external dependencies.
 *
 * API docs: https://postmarkapp.com/developer/api/email-api
 * Endpoint: POST https://api.postmarkapp.com/email
 * Auth: X-Postmark-Server-Token header
 */
class PostmarkTransport implements MailTransport {
  constructor(private config: MailDriverConfig) {}

  async send(message: MailMessage): Promise<SendResult> {
    const token = this.config.apiToken;
    if (!token) {
      throw new Error(
        'Postmark apiToken is required. Set it in your mailer config or POSTMARK_API_TOKEN env var.'
      );
    }

    const to = toArray(message.to);
    const cc = toArray(message.cc);
    const bcc = toArray(message.bcc);

    const body: Record<string, any> = {
      From: message.from ? formatFrom(message.from) : undefined,
      To: to.join(', '),
      Subject: message.subject,
      MessageStream: this.config.messageStream || 'outbound',
    };

    if (cc.length > 0) body.Cc = cc.join(', ');
    if (bcc.length > 0) body.Bcc = bcc.join(', ');
    if (message.replyTo) body.ReplyTo = message.replyTo;
    if (message.html) body.HtmlBody = message.html;
    if (message.text) body.TextBody = message.text;

    // At least one body is required
    if (!body.HtmlBody && !body.TextBody) {
      body.TextBody = '';
    }

    // Tags
    if (message.tags) {
      body.Tag = Object.values(message.tags)[0]; // Postmark supports one tag per message
    }

    // Attachments
    if (message.attachments?.length) {
      body.Attachments = message.attachments.map((att) => ({
        Name: att.filename,
        Content: encodeAttachment(att.content),
        ContentType: att.contentType || 'application/octet-stream',
      }));
    }

    const response = await fetch(this.config.endpoint ?? 'https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': token,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ Message: response.statusText })) as any;
      throw new Error(`Postmark error ${response.status}: ${error.Message || JSON.stringify(error)}`);
    }

    const result = await response.json() as any;

    return {
      accepted: to,
      rejected: [],
      messageId: result.MessageID,
    };
  }
}

// ── Resend Transport ───────────────────────────────────────

/**
 * Sends email via the Resend API.
 * Uses fetch — zero external dependencies.
 *
 * API docs: https://resend.com/docs/api-reference/emails/send-email
 * Endpoint: POST https://api.resend.com/emails
 * Auth: Authorization: Bearer <api_key>
 */
class ResendTransport implements MailTransport {
  constructor(private config: MailDriverConfig) {}

  async send(message: MailMessage): Promise<SendResult> {
    const apiKey = this.config.apiKey;
    if (!apiKey) {
      throw new Error(
        'Resend apiKey is required. Set it in your mailer config or RESEND_API_KEY env var.'
      );
    }

    const to = toArray(message.to);
    const cc = toArray(message.cc);
    const bcc = toArray(message.bcc);

    const body: Record<string, any> = {
      from: message.from ? formatFrom(message.from) : undefined,
      to,
      subject: message.subject,
    };

    if (cc.length > 0) body.cc = cc;
    if (bcc.length > 0) body.bcc = bcc;
    if (message.replyTo) body.reply_to = [message.replyTo];
    if (message.html) body.html = message.html;
    if (message.text) body.text = message.text;

    // Tags
    if (message.tags) {
      body.tags = Object.entries(message.tags).map(([name, value]) => ({ name, value }));
    }

    // Attachments
    if (message.attachments?.length) {
      body.attachments = message.attachments.map((att) => ({
        filename: att.filename,
        content: encodeAttachment(att.content),
        content_type: att.contentType || 'application/octet-stream',
      }));
    }

    const response = await fetch(this.config.endpoint ?? 'https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText })) as any;
      throw new Error(`Resend error ${response.status}: ${error.message || JSON.stringify(error)}`);
    }

    const result = await response.json() as any;

    return {
      accepted: to,
      rejected: [],
      messageId: result.id,
    };
  }
}

// ── Mailtrap Transport ─────────────────────────────────────

/**
 * Sends email via the Mailtrap Email API.
 * Uses fetch — zero external dependencies.
 *
 * API docs: https://docs.mailtrap.io/developers/email-sending
 * Endpoint: POST https://send.api.mailtrap.io/api/send
 * Auth: Authorization: Bearer <api_token>
 */
class MailtrapTransport implements MailTransport {
  constructor(private config: MailDriverConfig) {}

  async send(message: MailMessage): Promise<SendResult> {
    const apiToken = this.config.apiToken ?? this.config.apiKey;
    if (!apiToken) {
      throw new Error(
        'Mailtrap apiToken is required. Set it in your mailer config or MAILTRAP_API_TOKEN env var.'
      );
    }

    const to = toArray(message.to);
    const cc = toArray(message.cc);
    const bcc = toArray(message.bcc);

    const body: Record<string, any> = {
      from: message.from ? parseAddress(message.from) : undefined,
      to: to.map((email) => ({ email })),
      subject: message.subject,
    };

    if (cc.length > 0) body.cc = cc.map((email) => ({ email }));
    if (bcc.length > 0) body.bcc = bcc.map((email) => ({ email }));
    if (message.replyTo) body.reply_to = parseAddress(message.replyTo);
    if (message.html) body.html = message.html;
    if (message.text) body.text = message.text;

    if (!body.html && !body.text) {
      body.text = '';
    }

    if (message.tags) {
      body.category = Object.values(message.tags)[0];
    }

    if (message.attachments?.length) {
      body.attachments = message.attachments.map((att) => ({
        filename: att.filename,
        content: encodeAttachment(att.content),
        type: att.contentType || 'application/octet-stream',
      }));
    }

    const response = await fetch(this.config.endpoint ?? 'https://send.api.mailtrap.io/api/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText })) as any;
      throw new Error(`Mailtrap error ${response.status}: ${error.message || error.error || JSON.stringify(error)}`);
    }

    const result = await response.json() as any;

    return {
      accepted: to,
      rejected: [],
      messageId: result.message_ids?.[0] ?? result.message_id,
    };
  }
}

// ── Mailable Base Class ────────────────────────────────────

export abstract class Mailable {
  private message: Partial<MailMessage> = {};

  abstract build(): this;

  to(address: string | string[]): this {
    this.message.to = address;
    return this;
  }

  cc(address: string | string[]): this {
    this.message.cc = address;
    return this;
  }

  bcc(address: string | string[]): this {
    this.message.bcc = address;
    return this;
  }

  from(address: string | { name: string; address: string }): this {
    this.message.from = address;
    return this;
  }

  replyTo(address: string): this {
    this.message.replyTo = address;
    return this;
  }

  subject(subject: string): this {
    this.message.subject = subject;
    return this;
  }

  text(content: string): this {
    this.message.text = content;
    return this;
  }

  html(content: string): this {
    this.message.html = content;
    return this;
  }

  attach(filename: string, content: string | Buffer, contentType?: string): this {
    if (!this.message.attachments) this.message.attachments = [];
    this.message.attachments.push({ filename, content, contentType });
    return this;
  }

  tag(name: string, value: string): this {
    if (!this.message.tags) this.message.tags = {};
    this.message.tags[name] = value;
    return this;
  }

  /** @internal */
  toMessage(): MailMessage {
    return this.message as MailMessage;
  }
}

// ── Mail Manager ───────────────────────────────────────────

class MailManager {
  private config: MailerConfig | null = null;
  private transports = new Map<string, MailTransport>();

  configure(config: MailerConfig): void {
    this.config = config;
    this.transports.clear();
  }

  async send(message: MailMessage, mailer?: string): Promise<SendResult> {
    const transport = this.resolveTransport(mailer);

    // Apply default from
    if (!message.from && this.config?.from) {
      message.from = this.config.from;
    }

    return transport.send(message);
  }

  async sendMailable(mailable: Mailable, mailer?: string): Promise<SendResult> {
    mailable.build();
    const message = mailable.toMessage();

    if (!message.from && this.config?.from) {
      message.from = this.config.from;
    }

    return this.send(message, mailer);
  }

  mailer(name: string): { send: (msg: MailMessage) => Promise<SendResult> } {
    const transport = this.resolveTransport(name);
    return {
      send: (msg: MailMessage) => {
        if (!msg.from && this.config?.from) msg.from = this.config.from;
        return transport.send(msg);
      },
    };
  }

  private resolveTransport(name?: string): MailTransport {
    const mailerName = name ?? this.config?.default ?? 'log';

    if (this.transports.has(mailerName)) {
      return this.transports.get(mailerName)!;
    }

    if (!this.config) {
      const transport = new LogTransport();
      this.transports.set(mailerName, transport);
      return transport;
    }

    const driverConfig = this.config.mailers[mailerName];
    if (!driverConfig) throw new Error(`Mailer "${mailerName}" is not defined.`);

    let transport: MailTransport;
    switch (driverConfig.driver) {
      case 'smtp': transport = new SmtpTransport(driverConfig); break;
      case 'postmark': transport = new PostmarkTransport(driverConfig); break;
      case 'resend': transport = new ResendTransport(driverConfig); break;
      case 'mailtrap': transport = new MailtrapTransport(driverConfig); break;
      case 'log': transport = new LogTransport(); break;
      case 'null': transport = new NullTransport(); break;
      case 'custom': {
        if (!driverConfig.transport) throw new Error(`Custom mail driver "${mailerName}" requires a "transport" instance.`);
        transport = driverConfig.transport;
        break;
      }
      default: throw new Error(`Unknown mail driver: ${(driverConfig as any).driver}`);
    }

    this.transports.set(mailerName, transport);
    return transport;
  }
}

import { singleton } from '../support/singleton.js';

/**
 * Global Mailer singleton
 */
export const Mailer = singleton('svelar.mail', () => new MailManager());
