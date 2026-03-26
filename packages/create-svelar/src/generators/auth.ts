/**
 * Auth scaffolding generator
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  authMiddleware,
  userModel,
  usersMigration,
  loginPageSvelte,
  registerPageSvelte,
  forgotPasswordPageSvelte,
  logoutPageSvelte,
  gatesDefinition,
  permissionsMigration,
  userModelWithRoles,
  adminPageServer,
  adminPageSvelte,
  adminLayoutServer,
  adminLayoutSvelte,
  adminUsersRoute,
  adminStatsRoute,
} from '../templates/index.js';

export function generateAuthScaffolding(projectDir: string): void {
  // Core auth files
  writeFileSync(
    join(projectDir, 'src', 'lib', 'middleware', 'AuthMiddleware.ts'),
    authMiddleware,
  );

  writeFileSync(
    join(projectDir, 'src', 'lib', 'models', 'User.ts'),
    userModelWithRoles,
  );

  // Auth pages
  writeFileSync(
    join(projectDir, 'src', 'routes', 'login', '+page.svelte'),
    loginPageSvelte,
  );

  writeFileSync(
    join(projectDir, 'src', 'routes', 'register', '+page.svelte'),
    registerPageSvelte,
  );

  writeFileSync(
    join(projectDir, 'src', 'routes', 'forgot-password', '+page.svelte'),
    forgotPasswordPageSvelte,
  );

  writeFileSync(
    join(projectDir, 'src', 'routes', 'logout', '+page.svelte'),
    logoutPageSvelte,
  );

  // Permissions and gates
  writeFileSync(
    join(projectDir, 'src', 'lib', 'auth', 'gates.ts'),
    gatesDefinition,
  );

  // Admin scaffolding
  writeFileSync(
    join(projectDir, 'src', 'routes', 'admin', '+layout.server.ts'),
    adminLayoutServer,
  );

  writeFileSync(
    join(projectDir, 'src', 'routes', 'admin', '+layout.svelte'),
    adminLayoutSvelte,
  );

  writeFileSync(
    join(projectDir, 'src', 'routes', 'admin', '+page.server.ts'),
    adminPageServer,
  );

  writeFileSync(
    join(projectDir, 'src', 'routes', 'admin', '+page.svelte'),
    adminPageSvelte,
  );

  writeFileSync(
    join(projectDir, 'src', 'routes', 'admin', 'users', '+page.svelte'),
    adminUsersRoute,
  );

  writeFileSync(
    join(projectDir, 'src', 'routes', 'admin', 'stats', '+page.svelte'),
    adminStatsRoute,
  );

  // Migrations
  const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  writeFileSync(
    join(projectDir, 'src', 'lib', 'database', 'migrations', `${timestamp}_create_users_table.ts`),
    usersMigration,
  );

  const permissionsTimestamp = new Date(Date.now() + 1000).toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  writeFileSync(
    join(projectDir, 'src', 'lib', 'database', 'migrations', `${permissionsTimestamp}_create_permissions_tables.ts`),
    permissionsMigration,
  );
}
