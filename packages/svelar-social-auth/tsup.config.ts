import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    'plugin': 'src/plugin.ts',
    'types': 'src/types.ts',
    'server/index': 'src/server/index.ts',
  },
  format: ['esm'],
  dts: false,
  splitting: false,
  clean: true,
  target: 'node20',
  sourcemap: false,
  minify: true,
  external: [
    '@beeblock/svelar',
    '@beeblock/svelar/*',
    'svelte',
    'svelte/*',
    '@sveltejs/kit',
    'node:url',
    'node:path',
    'node:crypto',
  ],
  outDir: 'dist',
});
