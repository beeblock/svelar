import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { resolve } from 'path';

// Resolve the svelar package directly (avoids workspace symlink issues on Windows)
const svelarRoot = resolve(__dirname, '../svelar');

export default defineConfig({
  plugins: [
    sveltekit(),
    paraglideVitePlugin({
      project: './project.inlang',
      outdir: './src/lib/paraglide',
      strategy: ['url', 'cookie', 'baseLocale'],
      outputStructure: 'message-modules',
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      'svelar/actions': resolve(svelarRoot, 'dist/actions/index.js'),
      'svelar/auth': resolve(svelarRoot, 'dist/auth/index.js'),
      'svelar/broadcasting': resolve(svelarRoot, 'dist/broadcasting/index.js'),
      'svelar/cache': resolve(svelarRoot, 'dist/cache/index.js'),
      'svelar/cli': resolve(svelarRoot, 'dist/cli/index.js'),
      'svelar/config': resolve(svelarRoot, 'dist/config/index.js'),
      'svelar/container': resolve(svelarRoot, 'dist/container/index.js'),
      'svelar/database': resolve(svelarRoot, 'dist/database/index.js'),
      'svelar/errors': resolve(svelarRoot, 'dist/errors/index.js'),
      'svelar/events': resolve(svelarRoot, 'dist/events/index.js'),
      'svelar/hashing': resolve(svelarRoot, 'dist/hashing/index.js'),
      'svelar/hooks': resolve(svelarRoot, 'dist/hooks/index.js'),
      'svelar/logging': resolve(svelarRoot, 'dist/logging/index.js'),
      'svelar/mail': resolve(svelarRoot, 'dist/mail/index.js'),
      'svelar/middleware': resolve(svelarRoot, 'dist/middleware/index.js'),
      'svelar/notifications': resolve(svelarRoot, 'dist/notifications/index.js'),
      'svelar/orm': resolve(svelarRoot, 'dist/orm/index.js'),
      'svelar/pagination': resolve(svelarRoot, 'dist/pagination/index.js'),
      'svelar/permissions': resolve(svelarRoot, 'dist/permissions/index.js'),
      'svelar/plugins': resolve(svelarRoot, 'dist/plugins/index.js'),
      'svelar/queue': resolve(svelarRoot, 'dist/queue/index.js'),
      'svelar/repositories': resolve(svelarRoot, 'dist/repositories/index.js'),
      'svelar/routing': resolve(svelarRoot, 'dist/routing/index.js'),
      'svelar/scheduler': resolve(svelarRoot, 'dist/scheduler/index.js'),
      'svelar/services': resolve(svelarRoot, 'dist/services/index.js'),
      'svelar/session': resolve(svelarRoot, 'dist/session/index.js'),
      'svelar/storage': resolve(svelarRoot, 'dist/storage/index.js'),
      'svelar/validation': resolve(svelarRoot, 'dist/validation/index.js'),
      'svelar': resolve(svelarRoot, 'dist/index.js'),
    },
  },
  optimizeDeps: {
    exclude: ['sveltekit-superforms'],
  },
});
