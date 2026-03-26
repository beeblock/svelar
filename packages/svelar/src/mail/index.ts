/**
 * Svelar Mail
 *
 * Email sending abstraction with template support.
 *
 * @example
 * ```ts
 * import { Mailer } from 'svelar/mail';
 *
 * Mailer.configure({
 *   default: 'smtp',
 *   mailers: {
 *     smtp: {
 *       driver: 'smtp',
 *       host: 'smtp.example.com',
 *       port: 587,
 *       auth: { user: 'you@example.com', pass: 'secret' },
 *     },
 *     log: { driver: 'log' },
 *   },
 *   from: { name: 'My App', address: 'noreply@example.com' },
 * });
 *
 * // Send
 * await Mailer.send({
 *   to: 'user@example.com',
 *   subject: 'Welcome!',
 *   html: '<h1>Welcome to our app!</h1>',
 * });
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

export type MailDriver = 'smtp' | 'log' | 'null';

export interface MailerConfig {
  default: string;
  mailers: Record<string, MailDriverConfig>;
  from?: { name: string; address: string };
}

export interface MailDriverConfig {
  driver: MailDriver;
  host?: string;
  port?: number;
  secure?: boolean;
  auth?: { user: string; pass: string };
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
}

export interface SendResult {
  accepted: string[];
  rejected: string[];
  messageId?: string;
}

// ── Mail Transport Interface ───────────────────────────────

interface MailTransport {
  send(message: MailMessage): Promise<SendResult>;
}

// Log Transport
class LogTransport implements MailTransport {
  async send(message: MailMessage): Promise<SendResult> {
    const to = Array.isArray(message.to) ? message.to : [message.to];
    console.log(`[Mail] To: ${to.join(', ')} | Subject: ${message.subject}`);
    if (message.text) console.log(`[Mail] Body: ${message.text.slice(0, 200)}`);
    return { accepted: to, rejected: [] };
  }
}

// Null Transport
class NullTransport implements MailTransport {
  async send(message: MailMessage): Promise<SendResult> {
    const to = Array.isArray(message.to) ? message.to : [message.to];
    return { accepted: to, rejected: [] };
  }
}

// SMTP Transport (wraps nodemailer)
class SmtpTransport implements MailTransport {
  private config: MailDriverConfig;

  constructor(config: MailDriverConfig) {
    this.config = config;
  }

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
        from: typeof message.from === 'object'
          ? `${message.from.name} <${message.from.address}>`
          : message.from,
        to: Array.isArray(message.to) ? message.to.join(', ') : message.to,
        cc: message.cc ? (Array.isArray(message.cc) ? message.cc.join(', ') : message.cc) : undefined,
        bcc: message.bcc ? (Array.isArray(message.bcc) ? message.bcc.join(', ') : message.bcc) : undefined,
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
      // Fallback to log transport
      const transport = new LogTransport();
      this.transports.set(mailerName, transport);
      return transport;
    }

    const driverConfig = this.config.mailers[mailerName];
    if (!driverConfig) throw new Error(`Mailer "${mailerName}" is not defined.`);

    let transport: MailTransport;
    switch (driverConfig.driver) {
      case 'smtp': transport = new SmtpTransport(driverConfig); break;
      case 'log': transport = new LogTransport(); break;
      case 'null': transport = new NullTransport(); break;
      default: throw new Error(`Unknown mail driver: ${driverConfig.driver}`);
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
