/**
 * ESM resolve hook for Svelar CLI:
 * 1. Resolves '@beeblock/svelar' and '@beeblock/svelar/*' imports directly
 *    from THIS package's dist/ (bypasses node_modules entirely)
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
 * Resolve '@beeblock/svelar' or '@beeblock/svelar/<subpath>' by pointing directly at our own dist/.
 * This works on every OS because it never touches node_modules or symlinks.
 */
function resolveSvelar(specifier) {
  const packageName = '@beeblock/svelar';

  if (specifier === packageName) {
    const target = pathResolve(svelarRoot, 'dist', 'index.js');
    if (existsSync(target)) return pathToFileURL(target).href;
    return null;
  }

  if (specifier.startsWith(`${packageName}/`)) {
    const subpath = specifier.slice(`${packageName}/`.length); // e.g. 'database', 'orm', 'auth'
    const target = pathResolve(svelarRoot, 'dist', subpath, 'index.js');
    if (existsSync(target)) return pathToFileURL(target).href;

    // Also try direct file (e.g. @beeblock/svelar/something.js)
    const directTarget = pathResolve(svelarRoot, 'dist', subpath + '.js');
    if (existsSync(directTarget)) return pathToFileURL(directTarget).href;

    return null;
  }

  return null;
}

export async function resolve(specifier, context, nextResolve) {
  // 1. Intercept Svelar imports FIRST — before Node tries (and fails) to resolve them
  if (specifier === '@beeblock/svelar' || specifier.startsWith('@beeblock/svelar/')) {
    const resolved = resolveSvelar(specifier);
    if (resolved) {
      return { url: resolved, shortCircuit: true };
    }
  }

  // 2. Resolve $lib/ alias (SvelteKit convention) to src/lib/ in the project
  if (specifier.startsWith('$lib/')) {
    const subpath = specifier.slice('$lib/'.length);
    const projectRoot = process.cwd();
    // Try .ts extension (most common in dev)
    const withTs = pathResolve(projectRoot, 'src', 'lib', subpath.replace(/\.js$/, '.ts'));
    if (existsSync(withTs)) {
      return { url: pathToFileURL(withTs).href, shortCircuit: true };
    }
    // Try exact path (.js or extensionless)
    const exact = pathResolve(projectRoot, 'src', 'lib', subpath);
    if (existsSync(exact)) {
      return { url: pathToFileURL(exact).href, shortCircuit: true };
    }
    // Try adding .ts (for imports without extension like '$lib/modules/auth/schemas')
    const addTs = pathResolve(projectRoot, 'src', 'lib', subpath + '.ts');
    if (existsSync(addTs)) {
      return { url: pathToFileURL(addTs).href, shortCircuit: true };
    }
  }

  // 3. Handle relative .js → .ts resolution
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
