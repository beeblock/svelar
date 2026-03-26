/**
 * Shared types for project generators
 */

export type DatabaseDriver = 'sqlite' | 'postgres' | 'mysql';
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface ProjectOptions {
  projectName: string;
  projectDir: string;
  database: DatabaseDriver;
  includeAuth: boolean;
  packageManager: PackageManager;
}
