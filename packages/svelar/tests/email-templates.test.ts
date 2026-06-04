import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { Connection } from '../src/database/Connection.js';
import { Migrator } from '../src/database/Migration.js';
import { svelarCoreMigrations } from '../src/database/CoreMigrations.js';
import { EmailTemplate, EmailTemplates } from '../src/email-templates/index.js';

describe('EmailTemplates', () => {
  it('exposes documented defaults through registerDefaults()', async () => {
    EmailTemplates.configure({ driver: 'memory' });
    EmailTemplates.registerDefaults();

    const rendered = await EmailTemplates.render('otp-code', {
      appName: 'Svelar',
      user: { name: 'Ada' },
      code: '123456',
      expiresMinutes: 10,
      purpose: 'login',
    });

    expect(rendered.subject).toContain('123456');
    expect(rendered.html).toContain('Ada');
  });

  it('keeps the singular EmailTemplate alias compatible', async () => {
    EmailTemplate.configure({ driver: 'memory' });
    const rendered = await EmailTemplate.render('welcome', {
      appName: 'Svelar',
      user: { name: 'Ada', email: 'ada@example.com' },
      confirmUrl: 'https://example.com/confirm',
    });

    expect(rendered.subject).toContain('Ada');
  });

  it('persists registered templates with the database driver', async () => {
    const root = await mkdtemp(join(tmpdir(), 'svelar-email-templates-'));
    const filename = join(root, 'templates.sqlite');

    try {
      await Connection.disconnect();
      Connection.configure({
        default: 'sqlite',
        connections: {
          sqlite: { driver: 'sqlite', filename },
        },
      });
      await new Migrator().fresh(svelarCoreMigrations());

      EmailTemplates.configure({ driver: 'database' });
      await EmailTemplates.register({
        name: 'custom-welcome',
        subject: 'Welcome {{name}}',
        html: '<p>Hello {{name}}</p>',
        text: 'Hello {{name}}',
        variables: ['name'],
        category: 'auth',
        active: true,
      });

      expect((await EmailTemplates.render('custom-welcome', { name: 'Ada' })).html).toBe('<p>Hello Ada</p>');

      await EmailTemplates.update('custom-welcome', { subject: 'Hi {{name}}' });
      expect((await EmailTemplates.render('custom-welcome', { name: 'Ada' })).subject).toBe('Hi Ada');

      const authTemplates = await EmailTemplates.list('auth');
      expect(authTemplates.some((template) => template.name === 'custom-welcome')).toBe(true);

      expect(await EmailTemplates.delete('custom-welcome')).toBe(true);
      expect(await EmailTemplates.get('custom-welcome')).toBeNull();
    } finally {
      await Connection.disconnect();
      await rm(root, { recursive: true, force: true });
      EmailTemplates.configure({ driver: 'memory' });
      EmailTemplates.registerDefaults();
    }
  });
});
