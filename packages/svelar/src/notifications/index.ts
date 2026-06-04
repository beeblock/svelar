/**
 * Svelar Notifications
 *
 * Multi-channel notification system (mail, database, custom channels).
 *
 * @example
 * ```ts
 * import { Notification, Notifier } from '@beeblock/svelar/notifications';
 *
 * class InvoicePaid extends Notification {
 *   constructor(private invoice: Invoice) { super(); }
 *
 *   via() { return ['mail', 'database']; }
 *
 *   toMail() {
 *     return {
 *       subject: 'Invoice Paid',
 *       html: `<p>Invoice #${this.invoice.id} has been paid.</p>`,
 *     };
 *   }
 *
 *   toDatabase() {
 *     return {
 *       type: 'invoice_paid',
 *       data: { invoiceId: this.invoice.id, amount: this.invoice.amount },
 *     };
 *   }
 * }
 *
 * await Notifier.send(user, new InvoicePaid(invoice));
 * ```
 */

import { assertSqlIdentifier } from '../database/Connection.js';
import { QueryBuilder } from '../orm/QueryBuilder.js';
import { singleton } from '../support/singleton.js';

// ── Types ──────────────────────────────────────────────────

export type NotificationChannel = 'mail' | 'database' | string;

export interface NotificationMailData {
  subject: string;
  html?: string;
  text?: string;
  from?: string | { name: string; address: string };
}

export interface NotificationDatabaseData {
  type: string;
  data: Record<string, any>;
}

export interface Notifiable {
  getAttribute(key: string): any;
  /** Email address for mail notifications */
  routeNotificationForMail?(): string;
}

// ── Notification Base Class ────────────────────────────────

export abstract class Notification {
  /** Channels to deliver this notification on */
  abstract via(notifiable: Notifiable): NotificationChannel[];

  /** Format for mail channel */
  toMail?(notifiable: Notifiable): NotificationMailData;

  /** Format for database channel */
  toDatabase?(notifiable: Notifiable): NotificationDatabaseData;

  /** Custom channel format (override for custom channels) */
  toChannel?(channel: string, notifiable: Notifiable): any;
}

// ── Channel Implementations ────────────────────────────────

interface NotificationChannelDriver {
  send(notifiable: Notifiable, notification: Notification): Promise<void>;
}

class MailNotificationChannel implements NotificationChannelDriver {
  async send(notifiable: Notifiable, notification: Notification): Promise<void> {
    if (!notification.toMail) return;

    const mailData = notification.toMail(notifiable);
    const email =
      notifiable.routeNotificationForMail?.() ?? notifiable.getAttribute('email');

    if (!email) {
      console.warn('[Notifications] No email address for notifiable.');
      return;
    }

    // Use the Mailer
    try {
      const { Mailer } = await import('../mail/index.js');
      await Mailer.send({
        to: email,
        subject: mailData.subject,
        html: mailData.html,
        text: mailData.text,
        from: mailData.from,
      });
    } catch (error) {
      console.error('[Notifications] Failed to send mail notification:', error);
    }
  }
}

class DatabaseNotificationChannel implements NotificationChannelDriver {
  private table: string;

  constructor(table: string = 'notifications') {
    this.table = assertSqlIdentifier(table, 'Notifications table name');
  }

  async send(notifiable: Notifiable, notification: Notification): Promise<void> {
    if (!notification.toDatabase) return;

    const dbData = notification.toDatabase(notifiable);

    try {
      await new QueryBuilder(this.table).insert({
        id: crypto.randomUUID(),
        notifiable_id: notifiable.getAttribute('id'),
        type: dbData.type,
        data: JSON.stringify(dbData.data),
        read_at: null,
        created_at: new Date().toISOString(),
      });
    } catch (error) {
      console.error('[Notifications] Failed to store database notification:', error);
    }
  }
}

// ── Notifier Manager ───────────────────────────────────────

class NotifierManager {
  private channels = new Map<string, NotificationChannelDriver>();

  constructor() {
    // Register default channels
    this.channels.set('mail', new MailNotificationChannel());
    this.channels.set('database', new DatabaseNotificationChannel());
  }

  /**
   * Register a custom notification channel
   */
  extend(name: string, channel: NotificationChannelDriver): void {
    this.channels.set(name, channel);
  }

  /**
   * Send a notification to a notifiable entity
   */
  async send(
    notifiable: Notifiable | Notifiable[],
    notification: Notification
  ): Promise<void> {
    const notifiables = Array.isArray(notifiable) ? notifiable : [notifiable];

    for (const target of notifiables) {
      const channels = notification.via(target);

      for (const channelName of channels) {
        const channel = this.channels.get(channelName);

        if (channel) {
          try {
            await channel.send(target, notification);
          } catch (error) {
            console.error(`[Notifications] Channel "${channelName}" failed:`, error);
          }
        } else {
          console.warn(`[Notifications] Unknown channel: ${channelName}`);
        }
      }
    }
  }

  /**
   * Send a notification on specific channels only
   */
  async sendVia(
    notifiable: Notifiable,
    notification: Notification,
    channels: NotificationChannel[]
  ): Promise<void> {
    for (const channelName of channels) {
      const channel = this.channels.get(channelName);
      if (channel) {
        await channel.send(notifiable, notification);
      }
    }
  }
}

/**
 * Global Notifier singleton
 */
export const Notifier = singleton('svelar.notifier', () => new NotifierManager());
