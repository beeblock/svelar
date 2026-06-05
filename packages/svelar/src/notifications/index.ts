/**
 * Svelar Notifications
 *
 * Multi-channel notification system for email, database, and custom delivery channels.
 */

import { randomUUID } from 'node:crypto';
import { assertSqlIdentifier } from '../database/Connection.js';
import { QueryBuilder } from '../orm/QueryBuilder.js';
import { singleton } from '../support/singleton.js';

export type NotificationChannel = 'email' | 'database' | string;

export interface NotificationEmailData {
  to?: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string | { name: string; address: string };
}

export interface NotificationDatabaseData {
  type?: string;
  title?: string;
  message?: string;
  data?: Record<string, any>;
}

export interface Notifiable {
  getAttribute(key: string): any;
  routeNotificationForEmail?(): string | string[];
}

export abstract class Notification {
  abstract channels(notifiable: Notifiable): NotificationChannel[];

  toEmail?(notifiable: Notifiable): NotificationEmailData;

  toDatabase?(notifiable: Notifiable): NotificationDatabaseData;

  toChannel?(channel: string, notifiable: Notifiable): any;
}

export interface NotificationChannelDriver {
  send(notifiable: Notifiable, notification: Notification): Promise<void>;
}

export type NotificationChannelConfig =
  | { driver: 'email' }
  | { driver: 'database'; table?: string }
  | { driver: 'custom'; handler: NotificationChannelDriver };

export interface NotifierConfig {
  channels?: Record<string, NotificationChannelConfig>;
}

class EmailNotificationChannel implements NotificationChannelDriver {
  async send(notifiable: Notifiable, notification: Notification): Promise<void> {
    if (!notification.toEmail) return;

    const emailData = notification.toEmail(notifiable);
    const to = emailData.to
      ?? notifiable.routeNotificationForEmail?.()
      ?? notifiable.getAttribute('email');

    if (!to || (Array.isArray(to) && to.length === 0)) {
      throw new Error('Email notification requires a recipient address.');
    }

    const { Mailer } = await import('../mail/index.js');
    await Mailer.send({
      to,
      subject: emailData.subject,
      html: emailData.html,
      text: emailData.text,
      from: emailData.from,
    });
  }
}

class DatabaseNotificationChannel implements NotificationChannelDriver {
  private table: string;

  constructor(table: string = 'notifications') {
    this.table = assertSqlIdentifier(table, 'Notifications table name');
  }

  async send(notifiable: Notifiable, notification: Notification): Promise<void> {
    if (!notification.toDatabase) return;

    const payload = notification.toDatabase(notifiable);
    const type = payload.type ?? notification.constructor.name;
    const data = {
      ...(payload.title !== undefined ? { title: payload.title } : {}),
      ...(payload.message !== undefined ? { message: payload.message } : {}),
      ...(payload.data ?? {}),
    };

    await new QueryBuilder(this.table).insert({
      id: randomUUID(),
      notifiable_id: String(notifiable.getAttribute('id')),
      type,
      data: JSON.stringify(data),
      read_at: null,
      created_at: new Date().toISOString(),
    });
  }
}

class NotifierManager {
  private channels = new Map<string, NotificationChannelDriver>();

  constructor() {
    this.configure();
  }

  configure(config: NotifierConfig = {}): void {
    this.channels.clear();

    const channelConfig = config.channels ?? {
      email: { driver: 'email' as const },
      database: { driver: 'database' as const },
    };

    for (const [name, definition] of Object.entries(channelConfig)) {
      if (definition.driver === 'email') {
        this.channels.set(name, new EmailNotificationChannel());
      } else if (definition.driver === 'database') {
        this.channels.set(name, new DatabaseNotificationChannel(definition.table));
      } else {
        this.channels.set(name, definition.handler);
      }
    }
  }

  extend(name: string, channel: NotificationChannelDriver): void {
    this.channels.set(name, channel);
  }

  async notify(notifiable: Notifiable | Notifiable[], notification: Notification): Promise<void> {
    const notifiables = Array.isArray(notifiable) ? notifiable : [notifiable];

    for (const target of notifiables) {
      await this.notifyVia(target, notification, notification.channels(target));
    }
  }

  async notifyVia(
    notifiable: Notifiable,
    notification: Notification,
    channels: NotificationChannel[],
  ): Promise<void> {
    for (const channelName of channels) {
      const channel = this.channels.get(channelName);
      if (!channel) {
        throw new Error(`Notification channel "${channelName}" is not configured.`);
      }

      await channel.send(notifiable, notification);
    }
  }
}

export const Notifier = singleton('svelar.notifier', () => new NotifierManager());
