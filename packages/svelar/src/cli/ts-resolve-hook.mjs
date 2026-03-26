/**
 * ESM resolve hook for Svelar CLI:
 * 1. Resolves 'svelar' and 'svelar/*' imports directly from THIS package's dist/
 *    (bypasses node_modules entirely — no symlinks, junctions, or platform issues)
 * 2. Rewrites .js → .ts when the .js file doesn't exist
 */

import { existsSync } from 'node:fs';
import { resolve as pathResolve, sep, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// This file lives at <svelar-root>/dist/cli/ts-resolve-hook.mjs
// So the svelar package root is two directories up from here.
const thisFileDir = dirname(fileURLToPath(import.meta.url));
const svelarRoot = pathResolve(thisFileDir, '..', '..');

/**
 * Resolve 'svelar' or 'svelar/<subpath>' by pointing directly at our own dist/.
 * This works on every OS because it never touches node_modules or symlinks.
 */
function resolveSvelar(specifier) {
  if (specifier === 'svelar') {
    const target = pathResolve(svelarRoot, 'dist', 'index.js');
    if (existsSync(target)) return pathToFileURL(target).href;
    return null;
  }

  if (specifier.startsWith('svelar/')) {
    const subpath = specifier.slice('svelar/'.length); // e.g. 'database', 'orm', 'auth'
    const target = pathResolve(svelarRoot, 'dist', subpath, 'index.js');
    if (existsSync(target)) return pathToFileURL(target).href;

    // Also try direct file (e.g. svelar/something.js)
    const directTarget = pathResolve(svelarRoot, 'dist', subpath + '.js');
    if (existsSync(directTarget)) return pathToFileURL(directTarget).href;

    return null;
  }

  return null;
}

export async function resolve(specifier, context, nextResolve) {
  // 1. Intercept svelar imports FIRST — before Node tries (and fails) to resolve them
  if (specifier === 'svelar' || specifier.startsWith('svelar/')) {
    const resolved = resolveSvelar(specifier);
    if (resolved) {
      return { url: resolved, shortCircuit: true };
    }
  }

  // 2. Handle relative .js → .ts resolution
  if (specifier.startsWith('.') && specifier.endsWith('.js')) {
    try {
      const parentPath = context.parentURL ? fileURLToPath(context.parentURL) : process.cwd();
      const parentDir = parentPath.endsWith(sep) || parentPath.endsWith('/')
        ? parentPath
        : dirname(parentPath);
      const jsPath = pathResolve(parentDir, specifier);

      if (!existsSync(jsPath)) {
        const tsPath = jsPath.replace(/\.js$/, '.ts');
        if (existsSync(tsPath)) {
          return { url: pathToFileURL(tsPath).href, shortCircuit: true };
        }
      }
    } catch {
      // Fall through
    }
  }

  // 3. Default resolution
  return nextResolve(specifier, context);
}
