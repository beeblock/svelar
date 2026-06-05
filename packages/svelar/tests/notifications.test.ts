import { afterEach, describe, expect, it } from 'vitest';
import { Connection } from '../src/database/Connection.js';
import { Schema } from '../src/database/SchemaBuilder.js';
import { Mailer, type MailTransport } from '../src/mail/index.js';
import { Notification, Notifier, type Notifiable } from '../src/notifications/index.js';
import { QueryBuilder } from '../src/orm/QueryBuilder.js';

class TestUser implements Notifiable {
  constructor(private attributes: Record<string, any>) {}

  getAttribute(key: string): any {
    return this.attributes[key];
  }
}

describe.sequential('Notifier', () => {
  afterEach(async () => {
    Notifier.configure();
    await Connection.disconnect();
  });

  it('sends email notifications through the configured Mailer', async () => {
    const sent: any[] = [];
    const transport: MailTransport = {
      async send(message) {
        sent.push(message);
        return { accepted: Array.isArray(message.to) ? message.to : [message.to], rejected: [] };
      },
    };

    Mailer.configure({
      default: 'capture',
      mailers: {
        capture: { driver: 'custom', transport },
      },
      from: { name: 'Svelar', address: 'noreply@svelar.dev' },
    });
    Notifier.configure({
      channels: {
        email: { driver: 'email' },
      },
    });

    class WelcomeNotification extends Notification {
      channels(): string[] {
        return ['email'];
      }

      toEmail() {
        return {
          subject: 'Welcome',
          html: '<p>Hello</p>',
        };
      }
    }

    await Notifier.notify(new TestUser({ id: 1, email: 'user@example.com' }), new WelcomeNotification());

    expect(sent).toEqual([
      {
        to: 'user@example.com',
        subject: 'Welcome',
        html: '<p>Hello</p>',
        text: undefined,
        from: { name: 'Svelar', address: 'noreply@svelar.dev' },
      },
    ]);
  });

  it('stores database notifications using the configured table', async () => {
    await Connection.disconnect();
    Connection.configure({
      default: 'sqlite',
      connections: {
        sqlite: { driver: 'sqlite', filename: ':memory:' },
      },
    });

    const schema = new Schema();
    await schema.createTable('user_notifications', (table) => {
      table.string('id').primary();
      table.string('notifiable_id');
      table.string('type');
      table.text('data');
      table.timestamp('read_at').nullable();
      table.timestamp('created_at');
    });

    Notifier.configure({
      channels: {
        database: { driver: 'database', table: 'user_notifications' },
      },
    });

    class OrderShippedNotification extends Notification {
      channels(): string[] {
        return ['database'];
      }

      toDatabase() {
        return {
          type: 'order_shipped',
          title: 'Order Shipped',
          message: 'Your order has shipped.',
          data: { orderId: 123 },
        };
      }
    }

    await Notifier.notify(new TestUser({ id: 7, email: 'user@example.com' }), new OrderShippedNotification());

    const rows = await new QueryBuilder('user_notifications').get();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      notifiable_id: '7',
      type: 'order_shipped',
      read_at: null,
    });
    expect(JSON.parse(rows[0].data)).toEqual({
      title: 'Order Shipped',
      message: 'Your order has shipped.',
      orderId: 123,
    });
  });

  it('supports custom channels and explicit channel delivery', async () => {
    const delivered: any[] = [];
    Notifier.configure({
      channels: {
        audit: {
          driver: 'custom',
          handler: {
            async send(notifiable, notification) {
              delivered.push(notification.toChannel?.('audit', notifiable));
            },
          },
        },
      },
    });

    class AuditNotification extends Notification {
      channels(): string[] {
        return ['email'];
      }

      toChannel(channel: string, notifiable: Notifiable) {
        return { channel, userId: notifiable.getAttribute('id') };
      }
    }

    await Notifier.notifyVia(new TestUser({ id: 42 }), new AuditNotification(), ['audit']);

    expect(delivered).toEqual([{ channel: 'audit', userId: 42 }]);
  });

  it('fails fast for unconfigured channels', async () => {
    Notifier.configure({ channels: {} });

    class MissingChannelNotification extends Notification {
      channels(): string[] {
        return ['database'];
      }
    }

    await expect(Notifier.notify(new TestUser({ id: 1 }), new MissingChannelNotification()))
      .rejects
      .toThrow('Notification channel "database" is not configured.');
  });
});
