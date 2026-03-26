/**
 * Register hook: resolves .js imports to .ts files when the .js doesn't exist.
 * Use with: node --import ./ts-resolver.mjs
 */

import { register } from 'node:module';

register('./ts-resolve-hook.mjs', import.meta.url);
