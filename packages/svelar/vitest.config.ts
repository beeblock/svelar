import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '$app/server': fileURLToPath(new URL('./tests/kit-server-boundary.ts', import.meta.url)) } },
  test: {
    server: { deps: { inline: ['sveltekit-superforms'] } },
    include: ['tests/**/*.test.ts'],
    maxWorkers: 1,
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/ui/**',
        'src/dashboard/**',
        'src/pagination/**',
        'src/i18n/**',
        'src/types/**',
        'src/cli/commands/NewCommandTemplates.ts',
        'src/cli/commands/MakeDashboardCommand.ts',
        'src/cli/commands/MakeBroadcastingCommand.ts',
      ],
      reporter: ['text', 'text-summary'],
    },
  },
});
