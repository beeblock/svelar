import { Mailer, type MailMessage, type MailTransport, type SendResult } from '../mail/index.js';
import { cloneMailMessage } from './mail-message.js';

export {
  FakeMail,
  fakeMail,
  type ScopedFakeMailRecord,
  FakeQueue,
  FakeEvents,
  FakeNotifications,
  FakeHttp,
  fakeQueue,
  fakeEvents,
  fakeNotifications,
  fakeHttp,
  type FakeOptions,
  type FakePredicate,
  type FakeQueueRecord,
  type FakeEventRecord,
  type FakeEventsOptions,
  type FakeNotificationRecord,
  type FakeHttpRecord,
  type FakeHttpResponse,
} from './scoped-fakes.js';

export interface FakeMailRecord {
  message: MailMessage;
  result: SendResult;
  sentAt: Date;
}

export class FakeMailTransport implements MailTransport {
  private records: FakeMailRecord[] = [];

  async send(message: MailMessage): Promise<SendResult> {
    const result = {
      accepted: Array.isArray(message.to) ? [...message.to] : [message.to],
      rejected: [],
      messageId: `fake-${this.records.length + 1}`,
    };

    this.records.push({
      message: cloneMailMessage(message),
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

/** Legacy configuration helper. Prefer callback-scoped fakeMail() for automatic restoration. */
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
