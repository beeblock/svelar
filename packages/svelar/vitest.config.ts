import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
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
