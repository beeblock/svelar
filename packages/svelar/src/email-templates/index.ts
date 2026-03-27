/**
 * Svelar Email Templates
 * Reusable, customizable email templates with variable interpolation.
 */

import { randomUUID } from 'crypto';
import { singleton } from '../support/singleton.js';

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
      try {
        const { Connection } = await import('../database/Connection.js');
        await Connection.connection();
        // Would insert into email_templates table
      } catch {
        this.templates.set(template.name, record);
      }
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
    return this.templates.get(name) || null;
  }

  /** List all templates */
  async list(category?: string): Promise<EmailTemplate[]> {
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
    const template = this.templates.get(name);
    if (!template) return null;

    Object.assign(template, data, { updatedAt: Date.now() });
    return template;
  }

  /** Delete a template */
  async delete(name: string): Promise<boolean> {
    return this.templates.delete(name);
  }

  /** Register built-in default templates */
  private registerDefaults(): void {
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
