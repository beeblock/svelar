/**
 * Generator barrel export
 */

export { createDirectoryStructure } from './structure.js';
export { generatePackageJson } from './package-json.js';
export {
  generateEnvFile,
  generateAppBootstrap,
  generateDatabaseConfig,
  generateHooksServer,
} from './database.js';
export { generateAuthScaffolding } from './auth.js';
export type { ProjectOptions, DatabaseDriver, PackageManager } from './types.js';
