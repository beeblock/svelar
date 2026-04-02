/**
 * make:test — Generate a test file (unit, feature, or e2e)
 */

import { Command } from '../Command.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export class MakeTestCommand extends Command {
  name = 'make:test';
  description = 'Create a new test file';
  arguments = ['name'];
  flags = [
    { name: 'unit', alias: 'u', description: 'Create a unit test (default)', type: 'boolean' as const, default: false },
    { name: 'feature', alias: 'f', description: 'Create a feature test', type: 'boolean' as const, default: false },
    { name: 'e2e', alias: 'e', description: 'Create an e2e (Playwright) test', type: 'boolean' as const, default: false },
  ];

  async handle(args: string[], flags: Record<string, any>): Promise<void> {
    const name = args[0];
    if (!name) {
      this.error('Please provide a test name.');
      return;
    }

    let type: 'unit' | 'feature' | 'e2e' = 'unit';
    if (flags.feature) type = 'feature';
    if (flags.e2e) type = 'e2e';

    const ext = type === 'e2e' ? '.spec.ts' : '.test.ts';
    const dir = join(process.cwd(), 'tests', type);
    mkdirSync(dir, { recursive: true });

    const fileName = name.endsWith(ext) ? name : `${name}${ext}`;
    const filePath = join(dir, fileName);

    if (existsSync(filePath)) {
      this.warn(`Test file already exists: tests/${type}/${fileName}`);
      return;
    }

    let content: string;
    switch (type) {
      case 'unit':
        content = unitTestTemplate(name);
        break;
      case 'feature':
        content = featureTestTemplate(name);
        break;
      case 'e2e':
        content = e2eTestTemplate(name);
        break;
    }

    writeFileSync(filePath, content);
    this.success(`Test created: tests/${type}/${fileName}`);
  }
}

function unitTestTemplate(name: string): string {
  return `import { describe, it, expect } from 'vitest';

describe('${name}', () => {
  it('should work', () => {
    expect(true).toBe(true);
  });
});
`;
}

function featureTestTemplate(name: string): string {
  return `import { describe, it, expect } from 'vitest';
import { useSvelarTest, assertDatabaseHas } from '@beeblock/svelar/testing';

describe('${name}', () => {
  useSvelarTest({ refreshDatabase: true });

  it('should work', async () => {
    expect(true).toBe(true);
  });
});
`;
}

function e2eTestTemplate(name: string): string {
  return `import { test, expect } from '@playwright/test';

test.describe('${name}', () => {
  test('should load the page', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/.*/);
  });
});
`;
}
