/**
 * Svelar Email Templates
 * Reusable, customizable email templates with variable interpolation.
 */

import { randomUUID } from 'crypto';
import { join } from 'node:path';
import { singleton } from '../support/singleton.js';
import { assertSqlIdentifier } from '../database/Connection.js';
import { QueryBuilder } from '../orm/QueryBuilder.js';

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === code;
}

export interface EmailTemplate {
  id: string;
  name: string; // 'welcome', 'password-reset', 'invoice'
  subject: string; // Subject with {{variables}}
  html: string; // HTML body with {{variables}}
  text?: string; // Plain text fallback
  variables: string[]; // List of expected variables
  category?: string; // 'auth', 'billing', 'notification'
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface RenderResult {
  subject: string;
  html: string;
  text?: string;
}

export interface TemplateConfig {
  driver: 'database' | 'memory' | 'file';
  path?: string; // For file driver: templates directory
  table?: string;
}

class EmailTemplateManager {
  private config: TemplateConfig = { driver: 'memory' };
  private templates = new Map<string, EmailTemplate>();

  constructor() {
    this.registerDefaults();
  }

  configure(config: TemplateConfig): void {
    this.config = config;
  }

  /** Register a template */
  async register(
    template: Omit<EmailTemplate, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<EmailTemplate> {
    const record: EmailTemplate = {
      ...template,
      id: randomUUID(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    if (this.config.driver === 'memory') {
      this.templates.set(template.name, record);
    } else if (this.config.driver === 'database') {
      await this.query().where('name', record.name).delete();
      await this.query().insert({
        id: record.id,
        name: record.name,
        subject: record.subject,
        html: record.html,
        text: record.text ?? null,
        variables: JSON.stringify(record.variables),
        category: record.category ?? null,
        active: record.active ? 1 : 0,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      });
    } else if (this.config.driver === 'file') {
      await this.writeFileTemplate(record);
    }

    return record;
  }

  /** Render a template with variables */
  async render(
    name: string,
    variables: Record<string, any>
  ): Promise<RenderResult> {
    const template = await this.get(name);
    if (!template) {
      throw new Error(`Template "${name}" not found`);
    }

    const subject = this.interpolate(template.subject, variables);
    const html = this.interpolate(template.html, variables);
    const text = template.text
      ? this.interpolate(template.text, variables)
      : undefined;

    return { subject, html, text };
  }

  /** Get a template by name */
  async get(name: string): Promise<EmailTemplate | null> {
    if (this.config.driver === 'database') {
      const row = await this.query().where('name', name).first();
      if (row) return this.rowToTemplate(row);
    } else if (this.config.driver === 'file') {
      const template = await this.readFileTemplate(name);
      if (template) return template;
    }

    return this.templates.get(name) || null;
  }

  /** List all templates */
  async list(category?: string): Promise<EmailTemplate[]> {
    if (this.config.driver === 'database') {
      const query = this.query();
      if (category) query.where('category', category);
      const rows = await query.orderBy('name').get();
      const records = rows.map((row: any) => this.rowToTemplate(row));
      const names = new Set(records.map((template: EmailTemplate) => template.name));
      const defaults = Array.from(this.templates.values()).filter((template) => {
        return !names.has(template.name) && (!category || template.category === category);
      });
      return [...records, ...defaults];
    }

    if (this.config.driver === 'file') {
      const records = await this.listFileTemplates(category);
      const names = new Set(records.map((template) => template.name));
      const defaults = Array.from(this.templates.values()).filter((template) => {
        return !names.has(template.name) && (!category || template.category === category);
      });
      return [...records, ...defaults];
    }

    let results = Array.from(this.templates.values());
    if (category) {
      results = results.filter((t) => t.category === category);
    }
    return results;
  }

  /** Update a template */
  async update(
    name: string,
    data: Partial<EmailTemplate>
  ): Promise<EmailTemplate | null> {
    if (this.config.driver === 'database') {
      const existing = await this.get(name);
      if (!existing) return null;
      const template = { ...existing, ...data, name, updatedAt: Date.now() };
      await this.query().where('name', name).update({
        subject: template.subject,
        html: template.html,
        text: template.text ?? null,
        variables: JSON.stringify(template.variables),
        category: template.category ?? null,
        active: template.active ? 1 : 0,
        updated_at: template.updatedAt,
      });
      if (this.templates.has(name)) this.templates.set(name, template);
      return template;
    }

    if (this.config.driver === 'file') {
      const existing = await this.get(name);
      if (!existing) return null;
      const template = { ...existing, ...data, name, updatedAt: Date.now() };
      await this.writeFileTemplate(template);
      if (this.templates.has(name)) this.templates.set(name, template);
      return template;
    }

    const template = this.templates.get(name);
    if (!template) return null;

    Object.assign(template, data, { updatedAt: Date.now() });
    return template;
  }

  /** Delete a template */
  async delete(name: string): Promise<boolean> {
    if (this.config.driver === 'database') {
      const existing = await this.get(name);
      if (!existing) return false;
      await this.query().where('name', name).delete();
      this.templates.delete(name);
      return true;
    }

    if (this.config.driver === 'file') {
      const existing = await this.get(name);
      if (!existing) return false;
      const { unlink } = await import('node:fs/promises');
      try {
        await unlink(this.filePath(name));
      } catch (error) {
        if (!isNodeError(error, 'ENOENT')) throw error;
      }
      this.templates.delete(name);
      return true;
    }

    return this.templates.delete(name);
  }

  private table(): string {
    return assertSqlIdentifier(this.config.table ?? 'email_templates', 'Email templates table name');
  }

  private query(): QueryBuilder<any> {
    return new QueryBuilder(this.table());
  }

  private rowToTemplate(row: any): EmailTemplate {
    return {
      id: row.id,
      name: row.name,
      subject: row.subject,
      html: row.html,
      text: row.text ?? undefined,
      variables: JSON.parse(row.variables),
      category: row.category ?? undefined,
      active: Boolean(row.active),
      createdAt: row.created_at ?? row.createdAt ?? row.createdat,
      updatedAt: row.updated_at ?? row.updatedAt ?? row.updatedat,
    };
  }

  private templatesPath(): string {
    return this.config.path ?? 'email-templates';
  }

  private filePath(name: string): string {
    return join(this.templatesPath(), `${encodeURIComponent(name)}.json`);
  }

  private async writeFileTemplate(template: EmailTemplate): Promise<void> {
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(this.templatesPath(), { recursive: true });
    await writeFile(this.filePath(template.name), JSON.stringify(template, null, 2));
  }

  private async readFileTemplate(name: string): Promise<EmailTemplate | null> {
    const { readFile } = await import('node:fs/promises');
    try {
      return JSON.parse(await readFile(this.filePath(name), 'utf-8')) as EmailTemplate;
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return null;
      throw error;
    }
  }

  private async listFileTemplates(category?: string): Promise<EmailTemplate[]> {
    const { readdir, readFile } = await import('node:fs/promises');
    try {
      const files = await readdir(this.templatesPath());
      const templates: EmailTemplate[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const template = JSON.parse(await readFile(join(this.templatesPath(), file), 'utf-8')) as EmailTemplate;
          if (!category || template.category === category) templates.push(template);
        } catch (error) {
          if (!isNodeError(error, 'ENOENT')) throw error;
        }
      }

      return templates.sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return [];
      throw error;
    }
  }

  /** Register built-in default templates */
  registerDefaults(): void {
    // Welcome email
    this.templates.set('welcome', {
      id: randomUUID(),
      name: 'welcome',
      subject: 'Welcome to {{appName}}, {{user.name}}!',
      html: `
        <h1>Welcome, {{user.name}}!</h1>
        <p>Thank you for joining {{appName}}.</p>
        <p>Your account has been created with the email: <strong>{{user.email}}</strong></p>
        <p><a href="{{confirmUrl}}">Confirm your email address</a></p>
      `,
      text: `Welcome, {{user.name}}!\n\nConfirm your email: {{confirmUrl}}`,
      variables: ['appName', 'user.name', 'user.email', 'confirmUrl'],
      category: 'auth',
      active: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Password reset
    this.templates.set('password-reset', {
      id: randomUUID(),
      name: 'password-reset',
      subject: 'Reset your {{appName}} password',
      html: `
        <h1>Password Reset</h1>
        <p>Hi {{user.name}},</p>
        <p>Click the link below to reset your password. This link expires in 1 hour.</p>
        <p><a href="{{resetUrl}}">Reset Password</a></p>
        <p>If you didn't request this, you can ignore this email.</p>
      `,
      text: `Reset your password: {{resetUrl}}\n\nThis link expires in 1 hour.`,
      variables: ['appName', 'user.name', 'resetUrl'],
      category: 'auth',
      active: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Email verification
    this.templates.set('email-verification', {
      id: randomUUID(),
      name: 'email-verification',
      subject: 'Verify your email address',
      html: `
        <h1>Verify Your Email</h1>
        <p>Hi {{user.name}},</p>
        <p><a href="{{verifyUrl}}">Click here to verify your email address</a></p>
        <p>This link expires in 24 hours.</p>
      `,
      text: `Verify your email: {{verifyUrl}}`,
      variables: ['user.name', 'verifyUrl'],
      category: 'auth',
      active: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Team invitation
    this.templates.set('team-invitation', {
      id: randomUUID(),
      name: 'team-invitation',
      subject: '{{inviter.name}} invited you to join {{team.name}}',
      html: `
        <h1>Team Invitation</h1>
        <p>Hi {{user.name}},</p>
        <p><strong>{{inviter.name}}</strong> has invited you to join the team <strong>{{team.name}}</strong>.</p>
        <p><a href="{{acceptUrl}}">Accept Invitation</a></p>
        <p>This invitation expires in 3 days.</p>
      `,
      text: `Accept: {{acceptUrl}}`,
      variables: ['user.name', 'inviter.name', 'team.name', 'acceptUrl'],
      category: 'notification',
      active: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Invoice/receipt
    this.templates.set('invoice', {
      id: randomUUID(),
      name: 'invoice',
      subject: 'Invoice #{{invoice.number}} from {{appName}}',
      html: `
        <h1>Invoice #{{invoice.number}}</h1>
        <p>Hi {{customer.name}},</p>
        <p>Thank you for your purchase!</p>
        <p><strong>Amount:</strong> {{invoice.amount}}</p>
        <p><strong>Date:</strong> {{invoice.date}}</p>
        <p><a href="{{invoiceUrl}}">View Invoice</a></p>
      `,
      text: `Invoice #{{invoice.number}}\nAmount: {{invoice.amount}}`,
      variables: [
        'appName',
        'customer.name',
        'invoice.number',
        'invoice.amount',
        'invoice.date',
        'invoiceUrl',
      ],
      category: 'billing',
      active: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Subscription confirmation
    this.templates.set('subscription-confirmation', {
      id: randomUUID(),
      name: 'subscription-confirmation',
      subject: 'Subscription Confirmation',
      html: `
        <h1>Subscription Confirmed</h1>
        <p>Hi {{user.name}},</p>
        <p>Your {{plan.name}} plan is now active.</p>
        <p><strong>Price:</strong> {{plan.price}} / {{plan.interval}}</p>
        <p>Your next billing date is {{nextBillingDate}}.</p>
      `,
      text: `Your {{plan.name}} plan is active.\nNext billing: {{nextBillingDate}}`,
      variables: ['user.name', 'plan.name', 'plan.price', 'plan.interval', 'nextBillingDate'],
      category: 'billing',
      active: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // OTP code
    this.templates.set('otp-code', {
      id: randomUUID(),
      name: 'otp-code',
      subject: 'Your {{appName}} verification code: {{code}}',
      html: `
        <h1>Your Verification Code</h1>
        <p>Hi {{user.name}},</p>
        <p>Your one-time verification code is:</p>
        <p style="font-size: 32px; font-weight: bold; letter-spacing: 8px; text-align: center; padding: 16px; background: #f3f4f6; border-radius: 8px; font-family: monospace;">{{code}}</p>
        <p>This code expires in {{expiresMinutes}} minutes.</p>
        <p>If you didn't request this code, you can safely ignore this email.</p>
      `,
      text: `Your verification code: {{code}}\n\nThis code expires in {{expiresMinutes}} minutes.`,
      variables: ['appName', 'user.name', 'code', 'expiresMinutes', 'purpose'],
      category: 'auth',
      active: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Subscription canceled
    this.templates.set('subscription-canceled', {
      id: randomUUID(),
      name: 'subscription-canceled',
      subject: 'Your subscription has been canceled',
      html: `
        <h1>Subscription Canceled</h1>
        <p>Hi {{user.name}},</p>
        <p>Your {{plan.name}} subscription has been canceled.</p>
        <p>You have access until {{accessUntilDate}}.</p>
      `,
      text: `Your {{plan.name}} subscription is canceled.\nAccess until: {{accessUntilDate}}`,
      variables: ['user.name', 'plan.name', 'accessUntilDate'],
      category: 'billing',
      active: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  /** Simple template engine — replaces {{var}}, {{#if}}, {{#each}} */
  private interpolate(template: string, vars: Record<string, any>): string {
    let result = template;

    // Handle {{#if condition}}...{{/if}}
    result = result.replace(
      /\{\{#if\s+(\w+(?:\.\w+)*)\}\}([\s\S]*?)\{\{\/if\}\}/g,
      (match, condition, content) => {
        const value = this.getNestedValue(vars, condition);
        return value ? content : '';
      }
    );

    // Handle {{#each array}}...{{/each}}
    result = result.replace(
      /\{\{#each\s+(\w+(?:\.\w+)*)\}\}([\s\S]*?)\{\{\/each\}\}/g,
      (match, arrayPath, content) => {
        const array = this.getNestedValue(vars, arrayPath);
        if (!Array.isArray(array)) return '';

        return array
          .map((item, index) => {
            const itemVars = {
              ...vars,
              this: item,
              $index: index,
            };
            return this.interpolate(content, itemVars);
          })
          .join('');
      }
    );

    // Handle {{variable}} and {{object.property}}
    result = result.replace(/\{\{([\w.$]+)\}\}/g, (match, key) => {
      const value = this.getNestedValue(vars, key);
      return value !== undefined && value !== null ? String(value) : '';
    });

    return result;
  }

  private getNestedValue(
    obj: Record<string, any>,
    path: string
  ): any {
    return path.split('.').reduce((current, part) => {
      return current?.[part];
    }, obj);
  }
}

export const EmailTemplates = singleton(
  'svelar.emailTemplates',
  () => new EmailTemplateManager()
);

export const EmailTemplate = EmailTemplates;
