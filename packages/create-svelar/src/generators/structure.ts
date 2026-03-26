/**
 * Creates the project directory structure
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ProjectOptions } from './types.js';

const DIRECTORIES = [
  '',
  'src',
  'src/routes',
  'src/routes/api',
  'src/routes/api/health',
  'src/routes/api/auth',
  'src/routes/api/auth/register',
  'src/routes/api/auth/login',
  'src/routes/api/auth/logout',
  'src/routes/api/auth/me',
  'src/routes/api/posts',
  'src/routes/api/posts/[id]',
  'src/routes/api/posts/mine',
  'src/routes/api/admin',
  'src/routes/api/admin/users',
  'src/routes/api/admin/stats',
  'src/routes/login',
  'src/routes/register',
  'src/routes/forgot-password',
  'src/routes/dashboard',
  'src/routes/admin',
  'src/routes/logout',
  'src/lib',
  'src/lib/models',
  'src/lib/controllers',
  'src/lib/middleware',
  'src/lib/providers',
  'src/lib/database',
  'src/lib/database/migrations',
  'src/lib/database/seeders',
  'src/lib/dtos',
  'src/lib/services',
  'src/lib/actions',
  'src/lib/repositories',
  'src/lib/plugins',
  'src/lib/scheduler',
  'src/lib/jobs',
  'src/lib/auth',
  'src/lib/utils',
  'src/lib/components',
  'src/lib/components/ui',
  'static',
];

export function createDirectoryStructure(options: ProjectOptions): void {
  for (const dir of DIRECTORIES) {
    mkdirSync(join(options.projectDir, dir), { recursive: true });
  }
}
