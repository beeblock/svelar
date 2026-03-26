import { existsSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  // Only handle local/relative imports
  if (specifier.startsWith('.') || specifier.startsWith('file://')) {
    const parentPath = context.parentURL ? fileURLToPath(context.parentURL) : process.cwd();
    const parentDir = parentPath.endsWith('/') ? parentPath : pathResolve(parentPath, '..');

    // Try .js -> .ts rewrite
    if (specifier.endsWith('.js')) {
      const tsSpec = specifier.replace(/\.js$/, '.ts');
      const fullPath = pathResolve(parentDir, tsSpec);
      if (existsSync(fullPath)) {
        return nextResolve(tsSpec, context);
      }
    }

    // Try adding .ts extension for extensionless imports
    if (!specifier.endsWith('.ts') && !specifier.endsWith('.js') && !specifier.endsWith('.mjs')) {
      // Try direct .ts
      const tsPath = pathResolve(parentDir, specifier + '.ts');
      if (existsSync(tsPath)) {
        return nextResolve(specifier + '.ts', context);
      }
      // Try /index.ts
      const indexPath = pathResolve(parentDir, specifier, 'index.ts');
      if (existsSync(indexPath)) {
        return nextResolve(specifier + '/index.ts', context);
      }
    }
  }

  return nextResolve(specifier, context);
}
