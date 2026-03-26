/**
 * Template barrel export
 *
 * All project scaffolding templates are exported from here.
 * Each template is a string constant ready to be written to disk.
 */

export { svelteConfig } from './svelte-config.js';
export { viteConfig } from './vite-config.js';
export { appHtml } from './app-html.js';
export { appDts } from './app-dts.js';
export { appCss } from './app-css.js';
export { gitignore } from './gitignore.js';
export { welcomePage, layoutPage } from './welcome-page.js';
export { healthRoute } from './health-route.js';
export { databaseSeeder } from './database-seeder.js';
export {
  authMiddleware,
  userModel,
  usersMigration,
  loginPageSvelte,
  registerPageSvelte,
  forgotPasswordPageSvelte,
  logoutPageSvelte,
} from './auth.js';
export {
  buttonComponent,
  inputComponent,
  labelComponent,
  cardComponent,
  cardHeaderComponent,
  cardTitleComponent,
  cardDescriptionComponent,
  cardContentComponent,
  cardFooterComponent,
  alertComponent,
  badgeComponent,
  uiIndex,
} from './ui-components.js';
export {
  permissionsMigration,
  gatesDefinition,
  userModelWithRoles,
} from './permissions.js';
export {
  adminPageServer,
  adminPageSvelte,
  adminLayoutServer,
  adminLayoutSvelte,
  adminUsersRoute,
  adminStatsRoute,
} from './admin.js';
export { cnUtil } from './utils.js';
