import { Mailer, type MailMessage, type MailTransport, type SendResult } from '../mail/index.js';

export interface FakeMailRecord {
  message: MailMessage;
  result: SendResult;
  sentAt: Date;
}

export class FakeMailTransport implements MailTransport {
  private records: FakeMailRecord[] = [];

  async send(message: MailMessage): Promise<SendResult> {
    const result = {
      accepted: Array.isArray(message.to) ? message.to : [message.to],
      rejected: [],
      messageId: `fake-${this.records.length + 1}`,
    };

    this.records.push({
      message: structuredCloneMailMessage(message),
      result,
      sentAt: new Date(),
    });

    return result;
  }

  sent(): FakeMailRecord[] {
    return [...this.records];
  }

  count(predicate?: (record: FakeMailRecord) => boolean): number {
    return predicate ? this.records.filter(predicate).length : this.records.length;
  }

  reset(): void {
    this.records = [];
  }

  assertSent(predicate: (record: FakeMailRecord) => boolean, message: string = 'Expected mail was not sent.'): void {
    if (!this.records.some(predicate)) {
      throw new Error(message);
    }
  }

  assertNotSent(predicate: (record: FakeMailRecord) => boolean, message: string = 'Unexpected mail was sent.'): void {
    if (this.records.some(predicate)) {
      throw new Error(message);
    }
  }

  assertNothingSent(): void {
    if (this.records.length > 0) {
      throw new Error(`Expected no mail to be sent, but ${this.records.length} message(s) were sent.`);
    }
  }
}

export function fakeMailer(options: {
  name?: string;
  from?: { name: string; address: string };
} = {}): FakeMailTransport {
  const name = options.name ?? 'fake';
  const transport = new FakeMailTransport();

  Mailer.configure({
    default: name,
    from: options.from,
    mailers: {
      [name]: {
        driver: 'custom',
        transport,
      },
    },
  });

  return transport;
}

function structuredCloneMailMessage(message: MailMessage): MailMessage {
  return {
    ...message,
    to: Array.isArray(message.to) ? [...message.to] : message.to,
    cc: Array.isArray(message.cc) ? [...message.cc] : message.cc,
    bcc: Array.isArray(message.bcc) ? [...message.bcc] : message.bcc,
    from: typeof message.from === 'object' && message.from
      ? { ...message.from }
      : message.from,
    attachments: message.attachments?.map((attachment) => ({ ...attachment })),
    tags: message.tags ? { ...message.tags } : undefined,
  };
}
