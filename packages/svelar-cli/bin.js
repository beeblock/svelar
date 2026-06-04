#!/usr/bin/env node

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const corePackagePath = require.resolve('@beeblock/svelar/package.json');
const coreCliPath = join(dirname(corePackagePath), 'dist', 'cli', 'bin.js');

await import(pathToFileURL(coreCliPath).href);
