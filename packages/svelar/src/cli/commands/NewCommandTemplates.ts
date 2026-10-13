/**
 * NewCommandTemplates — All scaffold file templates for `npx svelar new`.
 *
 * Each static method returns the full file content as a string.
 * Used by NewCommand.ts to write project files.
 */

export type ValidationProvider = 'zod' | 'valibot';

export class NewCommandTemplates {
	static reviewedAccess(path: string, content: string): string {
		const personal = new Set([
			'src/routes/login/+page.server.ts', 'src/routes/register/+page.server.ts', 'src/routes/logout/+page.server.ts',
			'src/routes/forgot-password/+page.server.ts', 'src/routes/reset-password/+page.server.ts', 'src/routes/otp-login/+page.server.ts',
			'src/routes/dashboard/api-keys/+page.server.ts', 'src/routes/dashboard/team/+page.server.ts',
			'src/routes/api/auth/register/+server.ts', 'src/routes/api/auth/login/+server.ts', 'src/routes/api/auth/logout/+server.ts',
			'src/routes/api/auth/me/+server.ts', 'src/routes/api/auth/forgot-password/+server.ts', 'src/routes/api/auth/reset-password/+server.ts',
			'src/routes/api/auth/otp/send/+server.ts', 'src/routes/api/auth/otp/verify/+server.ts', 'src/routes/api/auth/verify-email/+server.ts',
			'src/routes/api/auth/session/+server.ts', 'src/routes/api/posts/+server.ts', 'src/routes/api/posts/[id]/+server.ts',
			'src/routes/api/posts/mine/+server.ts', 'src/routes/api/broadcasting/[channel]/+server.ts',
			'src/routes/api/internal/broadcast/+server.ts', 'src/routes/api/webhooks/incoming/[source]/+server.ts', 'src/routes/api/health/+server.ts',
		]);
		return personal.has(path) && !content.startsWith('// svelar:public')
			? '// svelar:public - reviewed non-functional-RBAC surface; authentication, policies, validation, CSRF or provider signature checks remain.\n' + content : content;
	}
	// ─── Config ─────────────────────────────────────────────────

	static applicationWorkflowFiles(): Array<{ path: string; content: string }> {
		const auth: Array<[string, () => string]> = [
			['RegisterUserDto', () => this.registerUserDto()], ['LoginDto', () => this.loginDto()],
			['ForgotPasswordDto', () => this.forgotPasswordDto()], ['ResetPasswordDto', () => this.resetPasswordDto()],
			['OtpSendDto', () => this.otpSendDto()], ['OtpVerifyDto', () => this.otpVerifyDto()],
			['LogoutDto', () => this.logoutDto()], ['VerifyEmailDto', () => this.verifyEmailDto()],
			['LoginAction', () => this.loginAction()], ['LogoutAction', () => this.logoutAction()],
			['ForgotPasswordAction', () => this.forgotPasswordAction()], ['ResetPasswordAction', () => this.resetPasswordAction()],
			['SendOtpAction', () => this.sendOtpAction()], ['VerifyOtpAction', () => this.verifyOtpAction()],
			['VerifyEmailAction', () => this.verifyEmailAction()], ['LogoutRequest', () => this.logoutRequest()],
			['VerifyEmailRequest', () => this.verifyEmailRequest()],
		];
		const posts: Array<[string, () => string]> = [
			['CreatePostDto', () => this.createPostDto()], ['UpdatePostDto', () => this.updatePostDto()],
			['DeletePostDto', () => this.deletePostDto()], ['UpdatePostAction', () => this.updatePostAction()],
			['DeletePostAction', () => this.deletePostAction()], ['DeletePostRequest', () => this.deletePostRequest()],
		];
		return [...auth.map(([name, render]) => ({ path: `src/lib/modules/auth/${name}.ts`, content: render() })),
			...posts.map(([name, render]) => ({ path: `src/lib/modules/posts/${name}.ts`, content: render() }))];
	}

	static packageJson(name: string, svelarVersion: string, validation: ValidationProvider = 'zod'): string {
		const validationDependencies = validation === 'valibot'
			? { valibot: "^1.5.0" }
			: { zod: "^4.6.7", valibot: "^1.5.0" };
		const uiDependencies = {
			"@internationalized/date": "^3.12.4",
			"bits-ui": "^2.19.5",
			"embla-carousel-svelte": "^8.6.0",
			formsnap: "^2.0.1",
			layerchart: "^2.8.0",
			"mode-watcher": "^1.1.0",
			paneforge: "^1.0.2",
			"svelte-sonner": "^1.2.1",
			"sveltekit-superforms": "^2.31.0",
			"tailwind-variants": "^3.3.1",
			typebox: "^1.3.37",
			// The Svelte 5 drawer integration still requires the upstream next line.
			"vaul-svelte": "^1.0.0-next.7",
			"zod-v3-to-json-schema": "^4.0.0",
		};

		return (
			JSON.stringify(
				{
					name,
					version: "0.0.1",
					private: true,
					type: "module",
					engines: { node: "^22.12.0 || >=24.0.0" },
					scripts: {
						prepare: "svelte-kit sync",
						dev: "vite dev",
						prebuild: "svelar lint:architecture",
						build: "vite build",
						"lint:architecture": "svelar lint:architecture",
						preview: "vite preview",
						migrate: "npx svelar migrate",
						"migrate:rollback": "npx svelar migrate --rollback",
						"migrate:refresh": "npx svelar migrate --refresh",
						seed: "npx svelar seed:run",
						"dev:worker": "node scripts/svelar-dev-runtime.mjs queue:work --queue=default",
						"dev:scheduler": "node scripts/svelar-dev-runtime.mjs schedule:run",
						test: "svelte-kit sync && vitest run",
						"test:watch": "svelte-kit sync && vitest",
						"test:e2e": "playwright test",
						"test:coverage": "svelte-kit sync && vitest run --coverage",
						"ui:install":
							"npm exec --package shadcn-svelte@latest -- shadcn-svelte add --all --yes && npm install --save-prod "
							+ Object.entries(uiDependencies).map(([dependency, version]) => `${dependency}@${version}`).join(' '),
					},
					devDependencies: {
						"@sveltejs/adapter-node": "^5.5.7",
						"@sveltejs/kit": "^2.70.3",
						"@sveltejs/vite-plugin-svelte": "^7.3.1",
						"@tailwindcss/vite": "^4.3.3",
						"@lucide/svelte": "^1.56.0",
						svelte: "^5.57.2",
						"svelte-check": "^4.7.6",
						tailwindcss: "^4.3.3",
						typescript: "^6.0.3",
						"@types/node": "^22.20.5",
						vite: "^8.3.4",
						vitest: "^4.1.11",
						"@vitest/coverage-v8": "^4.1.11",
						"@playwright/test": "^1.64.0",
					},
					dependencies: {
						...uiDependencies,
						"@aws-sdk/client-s3": "^3.1150.0",
						"@aws-sdk/s3-request-presigner": "^3.1150.0",
						"better-sqlite3": "^12.11.1",
						bullmq: "^5.81.5",
						"drizzle-orm": "^0.45.4",
						ioredis: "^5.11.1",
						meilisearch: "^0.62.0",
						mysql2: "^3.24.6",
						postgres: "^3.4.9",
						"@beeblock/svelar": `^${svelarVersion}`,
						clsx: "^2.1.1",
						pdfkit: "^0.18.0",
						"tailwind-merge": "^3.7.0",
						"tw-animate-css": "^1.4.0",
						...validationDependencies,
					},
					overrides: {
						"@sveltejs/kit": { cookie: "^0.7.2" },
						exceljs: { uuid: "^11.1.1" },
						"esbuild@>=0.27.3 <0.28.1": "^0.28.2",
					},
				},
				null,
				2,
			) + "\n"
		);
	}

	static validationConfig(validation: ValidationProvider = 'zod'): string {
		return JSON.stringify({ validation }, null, 2) + "\n";
	}

	static applyValidationProvider(content: string, validation: ValidationProvider = 'zod'): string {
		if (validation === 'zod') return content;

		return content
			.replace(/(import \{)([^}]+)(\} from 'sveltekit-superforms\/adapters';)/g, (_match, start: string, imports: string, end: string) =>
				start + imports.replace(/\bzod4?Client\b/g, 'valibotClient').replace(/\bzod4?\b/g, 'valibot') + end)
			.replace(/\bzod4?Client\(/g, 'valibotClient(')
			.replace(/\bzod4?\(/g, 'valibot(');
	}

	static svelteConfig(): string {
		return `import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    alias: {
      '$lib': 'src/lib',
      '$lib/*': 'src/lib/*',
    },
  },
};

export default config;
`;
	}

	static svelarDevRuntimeScript(): string {
		return `import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

function loadEnvFile(path) {
  if (!existsSync(path)) return {};

  const env = {};
  for (const rawLine of readFileSync(path, 'utf8').split(/\\r?\\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const index = line.indexOf('=');
    if (index === -1) continue;

    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

const fileEnv = {
  ...loadEnvFile('.env'),
  ...loadEnvFile('.env.local'),
};

const pgBouncerPort = process.env.PGBOUNCER_HOST_PORT ?? fileEnv.PGBOUNCER_HOST_PORT ?? '56432';
const mysqlPort = process.env.MYSQL_HOST_PORT ?? fileEnv.MYSQL_HOST_PORT ?? '53306';
const redisPort = process.env.REDIS_HOST_PORT ?? fileEnv.REDIS_HOST_PORT ?? '56379';
const gotenbergPort = process.env.GOTENBERG_HOST_PORT ?? fileEnv.GOTENBERG_HOST_PORT ?? '53000';
const rustfsApiPort = process.env.RUSTFS_API_PORT ?? fileEnv.RUSTFS_API_PORT ?? '5335';
const meiliPort = process.env.MEILI_PORT ?? fileEnv.MEILI_PORT ?? '5333';
const soketiPort = process.env.SOKETI_PORT ?? fileEnv.SOKETI_PORT ?? '5334';
const dbDriver = process.env.DB_DRIVER ?? fileEnv.DB_DRIVER ?? 'postgres';

const env = {
  ...fileEnv,
  ...process.env,
  NODE_ENV: 'development',
  APP_URL: process.env.APP_URL ?? fileEnv.APP_URL ?? 'http://127.0.0.1:5173',
  DB_DRIVER: dbDriver,
  DB_HOST: process.env.DB_HOST ?? '127.0.0.1',
  DB_PORT: process.env.DB_PORT ?? (dbDriver === 'mysql' ? mysqlPort : pgBouncerPort),
  DB_PREPARE: process.env.DB_PREPARE ?? 'false',
  REDIS_HOST: process.env.REDIS_HOST ?? '127.0.0.1',
  REDIS_PORT: process.env.REDIS_PORT ?? redisPort,
  CACHE_DRIVER: process.env.CACHE_DRIVER ?? 'redis',
  QUEUE_DRIVER: process.env.QUEUE_DRIVER ?? 'redis',
  RATE_LIMIT_STORE: process.env.RATE_LIMIT_STORE ?? 'cache',
  RATE_LIMIT_CACHE_STORE: process.env.RATE_LIMIT_CACHE_STORE ?? 'redis',
  PUSHER_HOST: process.env.PUSHER_HOST ?? '127.0.0.1',
  PUSHER_PORT: process.env.PUSHER_PORT ?? soketiPort,
  PUSHER_CLIENT_HOST: process.env.PUSHER_CLIENT_HOST ?? 'localhost',
  PUSHER_CLIENT_PORT: process.env.PUSHER_CLIENT_PORT ?? soketiPort,
  MEILISEARCH_HOST: process.env.MEILISEARCH_HOST ?? \`http://127.0.0.1:\${meiliPort}\`,
  GOTENBERG_URL: process.env.GOTENBERG_URL ?? \`http://127.0.0.1:\${gotenbergPort}\`,
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? \`http://127.0.0.1:\${rustfsApiPort}\`,
};

const child = spawn('npx', ['svelar', ...process.argv.slice(2)], {
  env,
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
`;
	}

	static viteConfig(): string {
		return `import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { createRequire } from 'module';
import { dirname, resolve } from 'path';

// Resolve the svelar package root so we can alias submodule imports
const require_ = createRequire(import.meta.url);
const svelarRoot = dirname(require_.resolve('@beeblock/svelar/package.json'));

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));

  return {
  plugins: [sveltekit(), tailwindcss()],
  resolve: {
    alias: {
      '@beeblock/svelar/actions': resolve(svelarRoot, 'dist/actions/index.js'),
      '@beeblock/svelar/api-keys': resolve(svelarRoot, 'dist/api-keys/index.js'),
      '@beeblock/svelar/audit': resolve(svelarRoot, 'dist/audit/index.js'),
      '@beeblock/svelar/auth': resolve(svelarRoot, 'dist/auth/index.js'),
      '@beeblock/svelar/broadcasting/client': resolve(svelarRoot, 'dist/broadcasting/client.js'),
      '@beeblock/svelar/broadcasting': resolve(svelarRoot, 'dist/broadcasting/index.js'),
      '@beeblock/svelar/cache': resolve(svelarRoot, 'dist/cache/index.js'),
      '@beeblock/svelar/cli': resolve(svelarRoot, 'dist/cli/index.js'),
      '@beeblock/svelar/config': resolve(svelarRoot, 'dist/config/index.js'),
      '@beeblock/svelar/container': resolve(svelarRoot, 'dist/container/index.js'),
      '@beeblock/svelar/dashboard/schemas': resolve(svelarRoot, 'dist/dashboard/schemas.js'),
      '@beeblock/svelar/dashboard': resolve(svelarRoot, 'dist/dashboard/index.js'),
      '@beeblock/svelar/database': resolve(svelarRoot, 'dist/database/index.js'),
      '@beeblock/svelar/deployment': resolve(svelarRoot, 'dist/deployment/index.js'),
      '@beeblock/svelar/dates': resolve(svelarRoot, 'dist/support/date.js'),
      '@beeblock/svelar/email-templates': resolve(svelarRoot, 'dist/email-templates/index.js'),
      '@beeblock/svelar/errors': resolve(svelarRoot, 'dist/errors/index.js'),
      '@beeblock/svelar/events': resolve(svelarRoot, 'dist/events/index.js'),
      '@beeblock/svelar/excel': resolve(svelarRoot, 'dist/excel/index.js'),
      '@beeblock/svelar/feature-flags': resolve(svelarRoot, 'dist/feature-flags/index.js'),
      '@beeblock/svelar/forms': resolve(svelarRoot, 'dist/forms/index.js'),
      '@beeblock/svelar/hashing': resolve(svelarRoot, 'dist/hashing/index.js'),
      '@beeblock/svelar/hooks': resolve(svelarRoot, 'dist/hooks/index.js'),
      '@beeblock/svelar/http': resolve(svelarRoot, 'dist/http/index.js'),
      '@beeblock/svelar/logging/LogViewer': resolve(svelarRoot, 'dist/logging/LogViewer.js'),
      '@beeblock/svelar/logging': resolve(svelarRoot, 'dist/logging/index.js'),
      '@beeblock/svelar/mail': resolve(svelarRoot, 'dist/mail/index.js'),
      '@beeblock/svelar/middleware': resolve(svelarRoot, 'dist/middleware/index.js'),
      '@beeblock/svelar/notifications': resolve(svelarRoot, 'dist/notifications/index.js'),
      '@beeblock/svelar/operations': resolve(svelarRoot, 'dist/operations/index.js'),
      '@beeblock/svelar/orm': resolve(svelarRoot, 'dist/orm/index.js'),
      '@beeblock/svelar/pagination': resolve(svelarRoot, 'src/pagination'),
      '@beeblock/svelar/pdf/GeneratePdfJob': resolve(svelarRoot, 'dist/pdf/GeneratePdfJob.js'),
      '@beeblock/svelar/pdf': resolve(svelarRoot, 'dist/pdf/index.js'),
      '@beeblock/svelar/permissions/client': resolve(svelarRoot, 'dist/permissions/client.js'),
      '@beeblock/svelar/permissions': resolve(svelarRoot, 'dist/permissions/index.js'),
      '@beeblock/svelar/plugins/PluginInstaller': resolve(svelarRoot, 'dist/plugins/PluginInstaller.js'),
      '@beeblock/svelar/plugins/PluginPublisher': resolve(svelarRoot, 'dist/plugins/PluginPublisher.js'),
      '@beeblock/svelar/plugins/PluginRegistry': resolve(svelarRoot, 'dist/plugins/PluginRegistry.js'),
      '@beeblock/svelar/plugins': resolve(svelarRoot, 'dist/plugins/index.js'),
      '@beeblock/svelar/queue/JobMonitor': resolve(svelarRoot, 'dist/queue/JobMonitor.js'),
      '@beeblock/svelar/queue': resolve(svelarRoot, 'dist/queue/index.js'),
      '@beeblock/svelar/repositories': resolve(svelarRoot, 'dist/repositories/index.js'),
      '@beeblock/svelar/routing': resolve(svelarRoot, 'dist/routing/index.js'),
      '@beeblock/svelar/scheduler/ScheduleMonitor': resolve(svelarRoot, 'dist/scheduler/ScheduleMonitor.js'),
      '@beeblock/svelar/scheduler': resolve(svelarRoot, 'dist/scheduler/index.js'),
      '@beeblock/svelar/search': resolve(svelarRoot, 'dist/search/index.js'),
      '@beeblock/svelar/services': resolve(svelarRoot, 'dist/services/index.js'),
      '@beeblock/svelar/session': resolve(svelarRoot, 'dist/session/index.js'),
      '@beeblock/svelar/storage': resolve(svelarRoot, 'dist/storage/index.js'),

      '@beeblock/svelar/support': resolve(svelarRoot, 'dist/support/index.js'),
      '@beeblock/svelar/teams': resolve(svelarRoot, 'dist/teams/index.js'),
      '@beeblock/svelar/uploads': resolve(svelarRoot, 'dist/uploads/index.js'),
      '@beeblock/svelar/validation/valibot': resolve(svelarRoot, 'dist/validation/valibot.js'),
      '@beeblock/svelar/validation': resolve(svelarRoot, 'dist/validation/index.js'),
      '@beeblock/svelar/webhooks': resolve(svelarRoot, 'dist/webhooks/index.js'),
      '@beeblock/svelar/ui': resolve(svelarRoot, 'src/ui'),
      '@beeblock/svelar/i18n/LanguageSwitcher.svelte': resolve(svelarRoot, 'src/i18n/LanguageSwitcher.svelte'),
      '@beeblock/svelar/i18n': resolve(svelarRoot, 'dist/i18n/index.js'),
      '@beeblock/svelar/testing': resolve(svelarRoot, 'dist/testing/index.js'),
      '@beeblock/svelar': resolve(svelarRoot, 'dist/index.js'),
    },
  },
  server: {
    fs: {
      // Allow serving files from the svelar package (UI components are source .svelte files)
      allow: ['.', svelarRoot],
    },
  },
  ssr: {
    // Node-only optional drivers must stay external for adapter-node production builds.
	    external: ['bcrypt', 'argon2', 'bullmq', 'ioredis', 'meilisearch', '@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner'],
    // Process Svelte icon components during SSR.
    noExternal: ['@lucide/svelte', '@tabler/icons-svelte', 'bits-ui'],
  },
  optimizeDeps: {
    exclude: ['@lucide/svelte', '@tabler/icons-svelte', 'bits-ui'],
  },
  build: {
    rolldownOptions: {
      output: { keepNames: true },
      onwarn(warning, warn) {
        const warningText = [
          warning.message,
          warning.id,
          ...(Array.isArray(warning.ids) ? warning.ids : []),
        ]
          .filter(Boolean)
          .join(' ');

        if (
          warning.code === 'CIRCULAR_DEPENDENCY' &&
          (
            warningText.includes('node_modules/typebox') ||
            warningText.includes('node_modules/zod-v3-to-json-schema')
          )
        ) {
          return;
        }

        warn(warning);
      },
    },
  },
  };
});
`;
	}

	static tsConfig(): string {
		return (
			JSON.stringify(
				{
					extends: "./.svelte-kit/tsconfig.json",
					compilerOptions: {
						allowJs: true,
						checkJs: true,
						esModuleInterop: true,
						forceConsistentCasingInFileNames: true,
						resolveJsonModule: true,
						skipLibCheck: true,
						sourceMap: true,
						strict: true,
						moduleResolution: "bundler",
						types: ["node", "vite/client"],
					},
				},
				null,
				2,
			) + "\n"
		);
	}

	static appHtml(): string {
		return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <link rel="icon" href="%sveltekit.assets%/favicon.svg" type="image/svg+xml" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    %sveltekit.head%
  </head>
  <body data-sveltekit-prerender="true">
    <div style="display: contents">%sveltekit.body%</div>
  </body>
</html>
`;
	}

	static faviconSvg(): string {
		return `<svg width="459" height="540" viewBox="0 0 459 540" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M458.11 4.54057L457.86 5.97056C457.832 6.12139 457.772 6.2639 457.683 6.38823C457.595 6.51256 457.482 6.61574 457.35 6.69057C439.037 17.0172 418.88 24.5506 396.88 29.2906C385.494 31.7506 377.45 33.4239 372.75 34.3106C365.117 27.0639 359.18 21.9206 354.94 18.8806C353.98 18.1939 350.274 16.0072 343.82 12.3206C338.96 9.54057 334.68 8.33056 329.39 6.06056C327.504 5.25389 324.92 4.31723 321.64 3.25056C319.114 2.4239 316.5 1.56388 313.8 0.670546C316.34 0.210546 318.73 -0.0127699 320.97 0.00056342C371.304 0.213897 414.804 0.250549 451.47 0.110549C453.464 0.103882 455.454 0.127223 457.44 0.180556C457.585 0.185536 457.722 0.245097 457.824 0.347182C457.926 0.449268 457.985 0.58629 457.99 0.730574L458.11 4.54057Z" fill="#FDC509"/>
<path d="M313.8 0.670478C316.5 1.56381 319.114 2.42383 321.64 3.25049C324.92 4.31716 327.504 5.25383 329.39 6.06049C334.68 8.33049 338.96 9.5405 343.82 12.3205C350.274 16.0072 353.98 18.1938 354.94 18.8805C359.18 21.9205 365.117 27.0638 372.75 34.3105C375.577 38.4505 378.604 42.4238 381.83 46.2305C383.057 47.6772 385.537 51.5605 389.27 57.8805L396.06 70.0305C396.13 70.1583 396.239 70.2603 396.373 70.3215C396.506 70.3827 396.656 70.3999 396.8 70.3705C419.49 66.0905 437.64 59.9005 457.92 53.4905L457.96 75.2105C443.294 83.5838 428.11 90.7371 412.41 96.6705C409.424 94.7438 406.304 92.9505 403.05 91.2905C390.21 84.7305 377.88 77.4205 364.48 71.9505C353.92 67.2305 343.067 63.2405 331.92 59.9805C321.187 56.8338 313.174 54.6038 307.88 53.2905C306.767 53.0172 305.637 52.8372 304.49 52.7505C304.349 52.7391 304.208 52.7713 304.085 52.8427C303.962 52.9141 303.863 53.0214 303.8 53.1505L301.91 57.0805C302.157 55.1338 302.094 53.2505 301.72 51.4305C301.681 51.2523 301.606 51.0824 301.5 50.9305L301.17 50.4305L301.45 0.900489C301.452 0.832197 301.466 0.764839 301.494 0.702246C301.521 0.639654 301.561 0.583042 301.61 0.535681C301.659 0.488321 301.717 0.451129 301.781 0.426215C301.844 0.4013 301.912 0.389153 301.98 0.390479L313.8 0.670478Z" fill="#FD8005"/>
<path d="M457.98 36.2305C435.55 45.7705 412.84 52.1705 389.27 57.8805C385.537 51.5605 383.057 47.6772 381.83 46.2305C378.604 42.4239 375.577 38.4505 372.75 34.3105C377.45 33.4238 385.494 31.7505 396.88 29.2905C418.88 24.5505 439.037 17.0172 457.35 6.69052C457.482 6.61569 457.596 6.51252 457.684 6.38818C457.772 6.26385 457.832 6.12134 457.86 5.97052L458.11 4.54053L457.98 36.2305Z" fill="#FCB10A"/>
<path d="M457.98 36.2307L457.92 53.4907C437.64 59.9007 419.49 66.0907 396.8 70.3707C396.655 70.4001 396.505 70.3829 396.372 70.3217C396.239 70.2605 396.13 70.1585 396.06 70.0307L389.27 57.8807C412.84 52.1707 435.55 45.7707 457.98 36.2307Z" fill="#FB9708"/>
<path d="M245.16 50.0405C244.92 57.0405 244.487 62.6005 243.86 66.7205C239.75 93.7505 224.43 100.88 198.77 98.8304L198.6 93.4504C198.595 93.309 198.535 93.1753 198.434 93.0781C198.333 92.9808 198.199 92.9278 198.06 92.9305L143.01 93.2104L142.48 92.8304L142.57 50.4504C142.57 50.3178 142.623 50.1907 142.716 50.0969C142.81 50.0031 142.937 49.9504 143.07 49.9504L245.16 50.0405Z" fill="#F43702"/>
<path d="M285.14 50.2205C285.06 58.0205 285 65.8505 284.96 73.7105C284.87 89.1905 279.31 100.911 269.83 113.151L198.53 113.241L198.71 106.231L198.77 98.8305C224.43 100.881 239.75 93.7505 243.86 66.7205C244.487 62.6005 244.92 57.0405 245.16 50.0405L285.14 50.2205Z" fill="#D50E09"/>
<path d="M301.17 50.4305L301.5 50.9305C301.606 51.0824 301.68 51.2522 301.72 51.4305C302.093 53.2505 302.157 55.1338 301.91 57.0804L301.65 113.18L269.83 113.15C279.31 100.91 284.87 89.1904 284.96 73.7104C285 65.8504 285.06 58.0205 285.14 50.2205L301.17 50.4305Z" fill="#B40C08"/>
<path d="M364.48 71.9505C361.574 79.2638 358.63 86.5605 355.65 93.8405C352.85 100.651 349.58 107.721 345.81 113.221C339.24 122.761 332.19 130.931 325.76 139.971C325.732 140.01 325.716 140.056 325.713 140.105C325.71 140.153 325.721 140.201 325.744 140.244C325.766 140.286 325.801 140.322 325.843 140.346C325.884 140.37 325.932 140.382 325.98 140.381L345.5 140.481H302.13C301.998 140.481 301.871 140.427 301.777 140.331C301.683 140.236 301.63 140.106 301.63 139.971L301.65 113.181L301.91 57.0805L303.8 53.1505C303.863 53.0214 303.962 52.9141 304.085 52.8427C304.208 52.7713 304.349 52.7392 304.49 52.7505C305.637 52.8372 306.767 53.0172 307.88 53.2905C313.174 54.6039 321.187 56.8339 331.92 59.9805C343.067 63.2405 353.92 67.2305 364.48 71.9505Z" fill="#FD5303"/>
<path d="M364.48 71.9504C377.88 77.4204 390.21 84.7305 403.05 91.2905C406.303 92.9505 409.423 94.7438 412.41 96.6704L427.03 106.28C416.937 116.06 408.863 127.244 402.81 139.83C402.787 139.879 402.776 139.932 402.778 139.986C402.781 140.039 402.797 140.091 402.824 140.137C402.852 140.183 402.891 140.221 402.938 140.248C402.984 140.274 403.036 140.289 403.09 140.29L411.43 140.49L345.5 140.48L325.98 140.38C325.932 140.382 325.884 140.37 325.842 140.346C325.8 140.321 325.766 140.286 325.743 140.243C325.72 140.201 325.71 140.153 325.713 140.105C325.716 140.056 325.732 140.01 325.76 139.97C332.19 130.93 339.24 122.76 345.81 113.22C349.58 107.72 352.85 100.65 355.65 93.8405C358.63 86.5605 361.573 79.2638 364.48 71.9504Z" fill="#F43702"/>
<path d="M457.96 75.2107L457.89 106.061L439.69 116.351L427.03 106.281L412.41 96.6707C428.11 90.7374 443.293 83.584 457.96 75.2107Z" fill="#FD5303"/>
<path d="M101.18 92.8306C109.79 103.171 119.01 112.481 131.45 118.091C137.69 120.904 145.07 122.914 153.59 124.121C168.63 126.247 183.49 125.277 198.17 121.211L197.98 150.451C180.494 157.277 162.604 158.677 144.31 154.651C132.564 152.064 121.264 148.154 110.41 142.921C95.6302 135.787 83.3169 125.654 73.4702 112.521C66.1835 102.794 61.4269 96.2639 59.2002 92.9306L101.18 92.8306Z" fill="#FD8005"/>
<path d="M142.48 92.8306L143.01 93.2106C160.71 100.861 179.36 103.951 198.71 106.231L198.53 113.241L198.17 121.211C183.49 125.277 168.63 126.247 153.59 124.121C145.07 122.914 137.69 120.904 131.45 118.091C119.01 112.481 109.79 103.171 101.18 92.8306H142.48Z" fill="#FB9708"/>
<path d="M198.77 98.8305L198.71 106.231C179.36 103.951 160.71 100.861 143.01 93.2105L198.06 92.9305C198.199 92.9279 198.333 92.9809 198.434 93.0782C198.535 93.1754 198.595 93.3091 198.6 93.4505L198.77 98.8305Z" fill="#FCB10A"/>
<path d="M59.2001 92.9307C61.4268 96.264 66.1834 102.794 73.4701 112.521C83.3168 125.654 95.6301 135.787 110.41 142.921C121.263 148.154 132.563 152.064 144.31 154.651C162.603 158.677 180.493 157.277 197.98 150.451L197.87 163.351C197.869 163.393 197.859 163.434 197.842 163.472C197.825 163.511 197.8 163.545 197.769 163.574C197.739 163.603 197.703 163.625 197.663 163.64C197.624 163.655 197.582 163.662 197.54 163.661C182.733 162.981 168.72 163.031 155.5 163.811C149.45 164.171 143.05 165.731 135.95 167.761C132.61 168.721 129.377 169.571 126.25 170.311L87.4301 171.461C76.4701 163.114 66.0734 154.387 56.2401 145.281C43.0501 133.081 33.0101 120.891 24.3501 106.021C27.6601 103.611 31.0401 100.991 34.4801 99.1907C42.2134 95.164 50.4534 93.0773 59.2001 92.9307Z" fill="#FD5303"/>
<path d="M457.89 106.061L457.98 132.371L457.03 134.881C456.985 135 456.908 135.104 456.807 135.183C456.707 135.262 456.587 135.312 456.46 135.327C456.334 135.342 456.205 135.323 456.089 135.271C455.972 135.218 455.873 135.135 455.8 135.031C451.107 128.424 445.737 122.197 439.69 116.351L457.89 106.061Z" fill="#F43702"/>
<path d="M427.03 106.281L439.69 116.351C445.737 122.197 451.107 128.424 455.8 135.031C455.873 135.135 455.973 135.218 456.089 135.271C456.205 135.323 456.334 135.342 456.46 135.327C456.587 135.312 456.707 135.262 456.807 135.183C456.908 135.104 456.985 135 457.03 134.881L457.98 132.371L458.01 139.821C458.01 139.958 457.956 140.091 457.861 140.188C457.765 140.286 457.635 140.341 457.5 140.341L411.43 140.491L403.09 140.291C403.037 140.289 402.984 140.274 402.938 140.248C402.891 140.221 402.852 140.183 402.825 140.137C402.797 140.091 402.781 140.039 402.778 139.986C402.776 139.932 402.787 139.879 402.81 139.831C408.863 127.244 416.937 116.061 427.03 106.281Z" fill="#D50E09"/>
<path d="M24.3502 106.021C33.0102 120.891 43.0502 133.081 56.2402 145.281C66.0735 154.387 76.4702 163.114 87.4302 171.461C77.8235 171.234 68.3669 170.331 59.0602 168.751C48.6302 166.991 39.2702 163.921 30.5902 159.701C23.3369 156.167 17.2169 150.381 12.2302 142.341C11.7502 141.561 11.2302 141.291 10.7602 140.801C10.6466 140.684 10.5586 140.543 10.5018 140.388C10.445 140.233 10.4206 140.067 10.4302 139.901C10.5369 138.074 10.2169 136.477 9.47021 135.111C10.2502 128.497 12.3136 122.384 15.6602 116.771C16.8736 114.731 19.7702 111.147 24.3502 106.021Z" fill="#F43702"/>
<path d="M87.4302 171.461L126.25 170.311L116.23 175.061C116.024 175.014 115.79 175.041 115.53 175.141C111.924 176.514 107.84 178.194 103.28 180.181C101.614 180.901 97.5336 182.587 91.0403 185.241C85.1469 187.647 79.2969 190.444 73.4902 193.631L59.6302 202.291C46.6202 199.851 34.5802 196.481 23.8002 188.841C19.0136 185.454 14.1602 180.351 9.24023 173.531L9.47025 135.111C10.2169 136.477 10.5369 138.074 10.4302 139.901C10.4207 140.067 10.4451 140.234 10.5019 140.388C10.5587 140.543 10.6467 140.684 10.7603 140.801C11.2303 141.291 11.7503 141.561 12.2303 142.341C17.2169 150.381 23.3369 156.167 30.5902 159.701C39.2702 163.921 48.6302 166.991 59.0602 168.751C68.3669 170.331 77.8236 171.234 87.4302 171.461Z" fill="#D50E09"/>
<path d="M59.6302 202.291C56.3902 204.857 54.4302 206.551 53.7502 207.371C47.9702 214.404 45.0069 222.55 44.8602 231.81C44.3269 242.817 46.4735 253.171 51.3002 262.871C53.0002 266.281 55.6102 269.08 57.9502 272.25C54.2636 272.244 50.5835 272.271 46.9102 272.331C44.1602 272.381 41.7102 271.36 39.0502 271.82C38.4829 271.919 37.9013 271.903 37.3402 271.771C33.1402 270.801 29.2902 270.131 25.8902 268.621C14.2102 263.447 8.56356 254.271 8.95023 241.091C9.04356 237.831 9.09021 236.157 9.09021 236.07C9.10354 215.304 9.15354 194.457 9.2402 173.531C14.1602 180.351 19.0135 185.454 23.8002 188.841C34.5802 196.481 46.6202 199.851 59.6302 202.291Z" fill="#B40C08"/>
<path d="M116.23 175.061L115.53 183.811C115.519 183.956 115.538 184.103 115.586 184.241C115.634 184.379 115.709 184.506 115.808 184.613C115.907 184.72 116.026 184.805 116.159 184.863C116.292 184.921 116.435 184.951 116.58 184.951H165.55C165.746 184.951 165.935 185.029 166.074 185.167C166.212 185.306 166.29 185.494 166.29 185.691L166.16 210.281L165.8 213.171C165.793 213.229 165.773 213.285 165.741 213.334C165.71 213.384 165.667 213.425 165.617 213.456C165.567 213.487 165.511 213.506 165.453 213.512C165.394 213.518 165.335 213.511 165.28 213.491C155.98 210.277 146.384 206.774 136.49 202.981C124.35 198.321 113.16 195.421 101.01 195.021C94.3836 194.801 86.6902 194.947 77.9302 195.461C75.9302 195.041 74.4502 194.431 73.4902 193.631C79.2969 190.444 85.1469 187.647 91.0403 185.241C97.5336 182.587 101.614 180.901 103.28 180.181C107.84 178.194 111.924 176.514 115.53 175.141C115.79 175.041 116.024 175.014 116.23 175.061Z" fill="#FDC509"/>
<path d="M166.16 210.281L166.47 230.241C165.83 234.054 165.697 237.537 166.07 240.691L165.34 243.031C164.927 243.151 164.34 242.864 163.58 242.171C163.408 242.011 163.216 241.877 163.01 241.771C155.49 237.941 149.23 233.451 141.81 229.171C133.07 224.137 118.614 215.701 98.4402 203.861C93.5002 200.961 86.6635 198.161 77.9302 195.461C86.6902 194.947 94.3835 194.801 101.01 195.021C113.16 195.421 124.35 198.321 136.49 202.981C146.384 206.774 155.98 210.277 165.28 213.491C165.335 213.511 165.394 213.518 165.453 213.512C165.511 213.506 165.567 213.487 165.617 213.456C165.667 213.425 165.71 213.384 165.741 213.334C165.773 213.285 165.793 213.229 165.8 213.171L166.16 210.281Z" fill="#FCB10A"/>
<path d="M73.4903 193.631C74.4503 194.431 75.9303 195.041 77.9303 195.461C86.6637 198.161 93.5003 200.961 98.4403 203.861C118.614 215.701 133.07 224.137 141.81 229.171C149.23 233.451 155.49 237.941 163.01 241.771C163.216 241.877 163.408 242.011 163.58 242.171C164.34 242.864 164.927 243.151 165.34 243.031C165.694 251.404 165.71 259.897 165.39 268.511C165.384 268.564 165.44 269.107 165.56 270.141C165.627 270.794 165.514 271.534 165.22 272.361L142.01 272.251L144.1 272.071C144.137 272.069 144.173 272.055 144.201 272.031C144.229 272.006 144.247 271.973 144.253 271.936C144.259 271.9 144.252 271.862 144.233 271.83C144.214 271.798 144.185 271.773 144.15 271.761C106.3 255.641 78.1004 244.851 44.8604 231.811C45.007 222.551 47.9703 214.404 53.7503 207.371C54.4303 206.551 56.3903 204.857 59.6303 202.291L73.4903 193.631Z" fill="#E15E05"/>
<path d="M238.59 230.27C220.64 240.02 200.94 245.97 180.9 249.64L166.07 240.69C165.697 237.537 165.83 234.054 166.47 230.24L238.59 230.27Z" fill="#B9D84B"/>
<path d="M302.41 239.291C272.18 249.001 238 255.081 204.72 263.431C202.7 262.477 201.327 261.737 200.6 261.211C197.527 258.951 194.22 257.091 190.68 255.631C188.954 254.917 185.694 252.921 180.9 249.641C200.94 245.971 220.64 240.021 238.59 230.271L301.86 230.231C301.997 230.231 302.127 230.284 302.225 230.379C302.322 230.475 302.378 230.605 302.38 230.741L302.41 239.291Z" fill="#9EC744"/>
<path d="M44.8604 231.811C78.1004 244.851 106.3 255.641 144.15 271.761C144.185 271.773 144.214 271.798 144.233 271.83C144.252 271.862 144.259 271.9 144.253 271.936C144.247 271.973 144.229 272.006 144.201 272.031C144.173 272.055 144.137 272.069 144.1 272.071L142.01 272.251H57.9504C55.6104 269.081 53.0003 266.281 51.3003 262.871C46.4737 253.171 44.327 242.817 44.8604 231.811Z" fill="#C14704"/>
<path d="M302.41 239.291L302.33 251.051L302.25 253.781C302.247 253.936 302.207 254.089 302.135 254.228C302.062 254.366 301.958 254.487 301.83 254.581C292.05 261.574 282.387 266.63 272.84 269.75C260.967 273.637 249.087 277.521 237.2 281.401L228.57 276.81L204.72 263.431C238 255.081 272.18 249.001 302.41 239.291Z" fill="#6FB33D"/>
<path d="M180.9 249.641C185.694 252.921 188.954 254.917 190.68 255.631C194.22 257.091 197.527 258.951 200.6 261.211C201.327 261.737 202.7 262.477 204.72 263.431L228.57 276.811C226.057 277.431 223.957 277.617 222.27 277.371C205.924 274.964 189.507 273.217 173.02 272.131C170.607 271.971 168.18 272.087 165.74 272.481C165.567 272.441 165.394 272.401 165.22 272.361C165.514 271.534 165.627 270.794 165.56 270.141C165.44 269.107 165.384 268.564 165.39 268.511C165.71 259.897 165.694 251.404 165.34 243.031L166.07 240.691L180.9 249.641Z" fill="#3E8832"/>
<path d="M302.66 278.091C302.48 278.151 302.344 278.164 302.25 278.13L285.72 278.351C285.587 278.353 285.46 278.408 285.366 278.503C285.273 278.599 285.22 278.727 285.22 278.861L285.1 293.051L284.92 288.971C284.918 288.926 284.903 288.883 284.876 288.847C284.849 288.812 284.812 288.785 284.77 288.771C284.728 288.757 284.682 288.756 284.639 288.769C284.597 288.781 284.558 288.806 284.53 288.841C281.124 292.854 277.267 296.434 272.96 299.581L268.9 297.491L251.87 288.951L237.2 281.401C249.087 277.521 260.967 273.637 272.84 269.75C282.387 266.63 292.05 261.574 301.83 254.581C301.958 254.487 302.062 254.366 302.135 254.228C302.207 254.089 302.247 253.936 302.25 253.781L302.33 251.051L302.66 278.091Z" fill="#51A746"/>
<path d="M228.57 276.811L237.2 281.401L251.87 288.951C232.51 295.641 215.41 298.621 195.07 298.041C185.317 297.767 175.547 297.291 165.76 296.611L165.74 272.481C168.18 272.087 170.607 271.971 173.02 272.131C189.507 273.217 205.924 274.964 222.27 277.371C223.957 277.617 226.057 277.431 228.57 276.811Z" fill="#138B74"/>
<path d="M302.25 278.131C302.544 291.404 303.787 304.594 305.98 317.701C298.66 314.654 291.737 310.877 285.21 306.371C285.097 306.017 285.044 305.657 285.05 305.291L285.1 293.051L285.22 278.861C285.22 278.727 285.273 278.599 285.366 278.503C285.46 278.408 285.587 278.353 285.72 278.351L302.25 278.131Z" fill="#B9D84B"/>
<path d="M302.66 278.091C302.874 278.351 303.144 278.481 303.47 278.481C317.484 278.447 331.454 278.404 345.38 278.351C348.97 297.861 351.16 316.261 348.91 335.831L342.23 333.291L310.19 319.551L305.98 317.701C303.787 304.594 302.544 291.404 302.25 278.131C302.344 278.164 302.48 278.151 302.66 278.091Z" fill="#91D95B"/>
<path d="M372.67 278.341C373.284 282.667 373.994 286.927 374.8 291.121C377.407 304.647 379.504 318.251 381.09 331.931C381.72 337.391 382.64 342.631 383.48 348.001L371.93 344.501L348.91 335.831C351.16 316.261 348.97 297.861 345.38 278.351L372.67 278.341Z" fill="#66C96E"/>
<path d="M430.47 278.361L427.18 278.791C427.051 278.81 426.935 278.878 426.853 278.98C426.772 279.082 426.731 279.21 426.74 279.341C428.15 299.531 428.81 317.271 426.52 336.871C414.11 343.311 400.12 348.051 386.32 348.451L383.48 348.001C382.64 342.631 381.72 337.391 381.09 331.931C379.504 318.251 377.407 304.647 374.8 291.121C373.994 286.927 373.284 282.667 372.67 278.341L430.47 278.361Z" fill="#47B874"/>
<path d="M430.47 278.361C441.23 279.521 449.1 284.811 454.08 294.231C455.233 296.417 456.033 298.797 456.48 301.371C456.947 304.037 457.137 306.544 457.05 308.891C455.017 310.737 453.367 313.231 452.1 316.371C445.513 325.524 436.987 332.357 426.52 336.871C428.81 317.271 428.15 299.531 426.74 279.341C426.731 279.21 426.771 279.082 426.853 278.98C426.934 278.878 427.051 278.81 427.18 278.791L430.47 278.361Z" fill="#24A37C"/>
<path d="M285.1 293.051L285.05 305.291L277.95 302.321L272.96 299.581C277.267 296.434 281.124 292.854 284.53 288.841C284.559 288.806 284.597 288.781 284.64 288.769C284.682 288.756 284.728 288.757 284.77 288.771C284.812 288.785 284.85 288.812 284.876 288.848C284.903 288.883 284.919 288.926 284.92 288.971L285.1 293.051Z" fill="#0D6F68"/>
<path d="M251.87 288.95L268.9 297.49C253.35 305.63 237.98 311.24 220.33 312.18C202.82 313.12 184.85 311.62 166.59 308.53C166.449 308.507 166.319 308.441 166.215 308.341C166.112 308.241 166.04 308.112 166.01 307.97L165.78 306.87L165.76 296.61C175.547 297.29 185.317 297.767 195.07 298.04C215.41 298.62 232.51 295.64 251.87 288.95Z" fill="#0D6F68"/>
<path d="M272.96 299.58L277.95 302.32C268.63 306.787 261.46 309.924 256.44 311.73C227.42 322.17 196.72 323.04 166.65 316.01C166.518 315.98 166.396 315.916 166.295 315.825C166.194 315.734 166.116 315.619 166.07 315.49L165.78 314.62V306.87L166.01 307.97C166.04 308.112 166.112 308.241 166.215 308.341C166.319 308.441 166.449 308.507 166.59 308.53C184.85 311.62 202.82 313.12 220.33 312.18C237.98 311.24 253.35 305.63 268.9 297.49L272.96 299.58Z" fill="#0D6562"/>
<path d="M277.95 302.321L285.05 305.291C285.044 305.657 285.097 306.017 285.21 306.371L285.27 307.241C269.14 315.921 252.85 323.121 234.8 326.681C220.014 329.601 203.45 330.587 185.11 329.641C179.944 329.374 173.514 328.444 165.82 326.851L165.78 314.621L166.07 315.491C166.116 315.619 166.194 315.734 166.295 315.825C166.396 315.916 166.518 315.98 166.65 316.011C196.72 323.041 227.42 322.171 256.44 311.731C261.46 309.924 268.63 306.787 277.95 302.321Z" fill="#085A66"/>
<path d="M305.98 317.701L310.19 319.551C309.737 324.204 308.924 328.754 307.75 333.201C305.83 340.501 301.32 341.541 294.93 343.601C292.27 343.781 288.65 343.171 286.15 344.211L285.41 343.611L285.31 320.761L285.27 307.241L285.21 306.371C291.737 310.877 298.66 314.654 305.98 317.701Z" fill="#9EC744"/>
<path d="M285.27 307.24L285.31 320.76C281.043 325.08 277.617 327.94 275.03 329.34C261.29 336.774 246.91 340.33 231.89 340.01C216.963 339.69 202.047 339.897 187.14 340.63C179.947 340.99 172.83 340.497 165.79 339.15L165.82 326.85C173.513 328.444 179.943 329.374 185.11 329.64C203.45 330.587 220.013 329.6 234.8 326.68C252.85 323.12 269.14 315.92 285.27 307.24Z" fill="#094A57"/>
<path d="M457.05 308.891L457.08 315.981C454.687 326.534 451.457 335.394 447.39 342.561C442.57 351.047 435.72 360.154 426.84 369.881C412.08 386.061 393 397.051 370.56 395.381C370.494 395.375 370.428 395.383 370.365 395.404C370.302 395.425 370.244 395.458 370.195 395.502C370.145 395.546 370.105 395.6 370.077 395.66C370.049 395.72 370.033 395.784 370.03 395.851L369.86 401.381L369.74 395.891L369.79 388.331C383.264 382.377 392.687 377.934 398.06 375.001C421.5 362.221 440.09 340.221 452.1 316.371C453.367 313.231 455.017 310.737 457.05 308.891Z" fill="#085A66"/>
<path d="M457.08 315.981L457.1 359.001C452.1 370.534 446.394 380.167 439.98 387.901C431.42 398.221 419.82 406.934 405.18 414.041C393.86 419.531 382.06 423.941 370.53 428.991C370.396 429.049 370.28 429.141 370.194 429.259C370.108 429.377 370.055 429.516 370.04 429.661L369.82 431.881L369.86 401.381L370.03 395.851C370.033 395.785 370.049 395.72 370.077 395.66C370.105 395.6 370.145 395.546 370.195 395.502C370.244 395.459 370.302 395.425 370.365 395.404C370.428 395.383 370.494 395.375 370.56 395.381C393 397.051 412.08 386.061 426.84 369.881C435.72 360.154 442.57 351.047 447.39 342.561C451.457 335.394 454.687 326.534 457.08 315.981Z" fill="#094A57"/>
<path d="M452.1 316.371C440.09 340.221 421.5 362.221 398.06 375.001C392.687 377.934 383.263 382.377 369.79 388.331L369.93 367.821C375.957 365.554 381.573 362.491 386.78 358.631C388.84 357.101 391.75 353.811 389.66 351.181C388.66 349.927 387.547 349.017 386.32 348.451C400.12 348.051 414.11 343.311 426.52 336.871C436.987 332.357 445.513 325.524 452.1 316.371Z" fill="#0D6F68"/>
<path d="M285.31 320.76L285.41 343.611L166.07 343.741C166.007 343.741 165.944 343.728 165.885 343.702C165.827 343.677 165.774 343.64 165.73 343.593C165.686 343.546 165.652 343.491 165.63 343.43C165.608 343.37 165.597 343.305 165.6 343.241L165.79 339.151C172.83 340.497 179.947 340.99 187.14 340.63C202.047 339.897 216.963 339.69 231.89 340.01C246.91 340.33 261.29 336.774 275.03 329.341C277.617 327.941 281.043 325.08 285.31 320.76Z" fill="#083747"/>
<path d="M342.23 333.291C340 335.641 335.26 340.99 337 344.75L321.43 344.471L304.91 343.931L294.93 343.601C301.32 341.541 305.83 340.5 307.75 333.201C308.924 328.754 309.737 324.204 310.19 319.551L342.23 333.291Z" fill="#6FB33D"/>
<path d="M342.23 333.291L348.91 335.831L371.93 344.5C370.41 346.647 369.684 349.344 369.75 352.591C369.917 350.444 369.777 348.624 369.33 347.13C369.191 346.662 368.907 346.251 368.519 345.954C368.131 345.658 367.659 345.492 367.17 345.481L347.72 345.06L337 344.75C335.26 340.99 340 335.641 342.23 333.291Z" fill="#3E8832"/>
<path d="M294.93 343.601L304.91 343.931C302.457 350.071 299.12 357.417 294.9 365.971C289.174 377.584 281.674 387.301 272.4 395.121C277.16 389.174 280.854 383.334 283.48 377.601C285.42 373.361 286.01 368.651 286.05 363.471C286.104 357.051 286.137 350.631 286.15 344.211C288.65 343.171 292.27 343.781 294.93 343.601Z" fill="#B9D84B"/>
<path d="M321.43 344.471C313.997 363.151 303.497 379.941 289.93 394.841C287.484 396.181 284.937 397.387 282.29 398.461C279.364 399.654 276.79 400.791 274.57 401.871C269.61 404.291 264.47 406.334 259.15 408.001L272.4 395.121C281.674 387.301 289.174 377.584 294.9 365.971C299.12 357.417 302.457 350.071 304.91 343.931L321.43 344.471Z" fill="#91D95B"/>
<path d="M337 344.75L347.72 345.06L334 371.7L324.16 376.85L289.93 394.84C303.497 379.94 313.997 363.15 321.43 344.47L337 344.75Z" fill="#66C96E"/>
<path d="M371.93 344.5L383.48 348L386.32 348.451C387.547 349.017 388.66 349.927 389.66 351.181C391.75 353.811 388.84 357.1 386.78 358.63C381.573 362.49 375.957 365.554 369.93 367.82L369.58 364.841L369.35 354.601L369.75 352.591C369.683 349.344 370.41 346.647 371.93 344.5Z" fill="#195239"/>
<path d="M369.75 352.591L369.35 354.601L334 371.701L347.72 345.061L367.17 345.481C367.659 345.492 368.131 345.658 368.519 345.954C368.907 346.251 369.191 346.663 369.33 347.131C369.777 348.624 369.917 350.444 369.75 352.591Z" fill="#47B874"/>
<path d="M369.35 354.601L369.58 364.841C359.094 374.247 348.404 383.401 337.51 392.301C318.67 407.681 300.67 422.741 287.46 443.421L240.63 443.391C263.26 429.261 279.93 415.741 302.14 397.141C308.934 391.447 316.274 384.684 324.16 376.851L334 371.701L369.35 354.601Z" fill="#209D93"/>
<path d="M457.1 359V416.901C457.1 417.226 457.063 417.555 456.99 417.88C455.13 425.927 450.527 431.751 443.18 435.351C435.42 439.151 426.23 441.351 415.61 441.951C415.317 441.97 415.027 442.011 414.74 442.07C412.42 442.604 409.077 442.891 404.71 442.931C393.25 443.031 381.707 443.017 370.08 442.891L369.82 431.88L370.04 429.661C370.055 429.515 370.108 429.377 370.194 429.259C370.28 429.141 370.396 429.049 370.53 428.991C382.06 423.941 393.86 419.531 405.18 414.041C419.82 406.934 431.42 398.221 439.98 387.901C446.394 380.167 452.1 370.534 457.1 359Z" fill="#083747"/>
<path d="M369.93 367.821L369.79 388.331L369.74 395.891C362.754 400.677 355.957 405.714 349.35 411.001C337.85 420.207 328.034 431.024 319.9 443.451L298.19 443.461L287.46 443.421C300.67 422.741 318.67 407.681 337.51 392.301C348.404 383.401 359.094 374.247 369.58 364.841L369.93 367.821Z" fill="#188495"/>
<path d="M324.16 376.851C316.273 384.684 308.933 391.447 302.14 397.141C279.93 415.741 263.26 429.261 240.63 443.391L187.51 442.911C180.423 443.284 173.767 443.127 167.54 442.441L154.62 441.441C156.88 441.001 159.203 440.824 161.59 440.911C162.566 440.944 163.544 440.85 164.5 440.631C167.073 440.024 172.077 439.091 179.51 437.831C182.517 437.317 187.687 436.261 195.02 434.661C200.367 433.487 205.457 432.094 210.29 430.481C227.47 424.734 243.757 417.241 259.15 408.001C264.47 406.334 269.61 404.291 274.57 401.871C276.79 400.791 279.363 399.654 282.29 398.461C284.937 397.387 287.483 396.181 289.93 394.841L324.16 376.851Z" fill="#2FB991"/>
<path d="M20.5104 391.171L25.8704 430.441C25.7838 430.347 25.6271 430.304 25.4004 430.311C18.4538 425.744 11.8504 420.674 5.59043 415.101L0.29044 403.041L0.0904283 391.721C0.0891266 391.655 0.101039 391.59 0.125462 391.529C0.149885 391.467 0.186333 391.412 0.232762 391.364C0.279192 391.317 0.334695 391.279 0.396062 391.253C0.457429 391.226 0.523466 391.212 0.590428 391.211L20.5104 391.171Z" fill="#6FB33D"/>
<path d="M74.4302 391.171L76.5403 391.361C76.6938 391.376 76.8398 391.432 76.9617 391.524C77.0836 391.616 77.1766 391.74 77.2303 391.881C80.7103 401.091 83.6202 409.861 84.5302 419.481C84.7902 422.154 84.8236 426.561 84.6302 432.701C84.4502 438.467 84.3136 444.244 84.2202 450.031C71.6202 448.331 59.0802 444.701 47.1302 440.511C43.8102 439.351 40.2169 437.774 36.3503 435.781C32.8836 434.001 29.3902 432.221 25.8702 430.441L20.5103 391.171H74.4302Z" fill="#9EC744"/>
<path d="M149.67 442.011L149.33 450.461C140.184 451.747 131.95 452.417 124.63 452.471C121.95 452.491 115.47 452.351 105.19 452.051C98.1569 451.891 91.1669 451.217 84.2202 450.031C84.3135 444.244 84.4502 438.467 84.6302 432.701C84.8235 426.561 84.7902 422.154 84.5302 419.481C83.6202 409.861 80.7102 401.091 77.2302 391.881C77.1765 391.74 77.0835 391.616 76.9616 391.524C76.8397 391.432 76.6938 391.376 76.5402 391.361L74.4302 391.171L149.56 391.181C149.605 391.181 149.649 391.199 149.68 391.23C149.712 391.262 149.73 391.306 149.73 391.351L149.67 442.011Z" fill="#B9D84B"/>
<path d="M369.74 395.891L369.86 401.381L369.82 431.881L370.08 442.891L369.69 443.511L323.42 443.521L319.9 443.451C328.034 431.024 337.85 420.207 349.35 411.001C355.957 405.714 362.754 400.677 369.74 395.891Z" fill="#177492"/>
<path d="M5.59 415.101C5.55 423.001 8.00666 430.054 12.96 436.26C16.3333 440.48 19.79 443.724 23.33 445.991C27.5433 448.684 33.2733 451.75 40.52 455.19C57.9867 462.264 76.0333 467.511 94.66 470.931C96.5467 471.277 98.3433 471.53 100.05 471.69C103.037 472.144 105.937 472.551 108.75 472.911C114.997 473.711 121.237 474.551 127.47 475.431C131.443 475.991 138.787 476.564 149.5 477.151L149.63 492.621L149.39 495.56C149.375 495.701 149.31 495.831 149.206 495.925C149.103 496.019 148.969 496.071 148.83 496.07C139.777 496.11 131.51 495.864 124.03 495.331C109.397 494.284 94.55 491.387 79.49 486.641C63.8 481.701 32.04 470.251 0 460.361L0.290009 403.041L5.59 415.101Z" fill="#0D6F68"/>
<path d="M25.4003 430.311C30.3603 441.151 33.0803 447.691 40.5203 455.191C33.2737 451.751 27.5436 448.684 23.3303 445.991C19.7903 443.724 16.3337 440.481 12.9603 436.261C8.00699 430.054 5.55032 423.001 5.59032 415.101C11.8503 420.674 18.4537 425.744 25.4003 430.311Z" fill="#3E8832"/>
<path d="M25.8704 430.44C29.3904 432.22 32.8837 434.001 36.3504 435.781C40.2171 437.774 43.8104 439.35 47.1304 440.51C59.0804 444.7 71.6204 448.331 84.2204 450.031C91.1671 451.217 98.1571 451.891 105.19 452.051C104.737 458.857 103.024 465.404 100.05 471.69C98.3437 471.53 96.5471 471.277 94.6604 470.931C76.0337 467.511 57.9871 462.264 40.5204 455.19C33.0804 447.69 30.3604 441.15 25.4004 430.31C25.6271 430.304 25.7837 430.347 25.8704 430.44Z" fill="#51A746"/>
<path d="M154.62 441.441L167.54 442.441C177.66 451.221 188.667 458.281 200.56 463.621C233.093 478.207 265.06 476.837 296.46 459.511C307.28 453.537 316.267 448.207 323.42 443.521L369.69 443.511C369.717 450.857 369.717 458.064 369.69 465.131C369.663 470.631 369.233 474.557 368.4 476.911C364.79 487.061 355.34 493.051 344.99 495.841C341.423 496.801 336.823 497.584 331.19 498.191C327.55 498.584 322.893 498.784 317.22 498.791C246.393 498.924 196.977 498.977 168.97 498.951C161.323 498.944 154.94 499.034 149.82 499.221L149.63 492.621L149.5 477.151L149.33 450.461L149.67 442.011L154.62 441.441Z" fill="#083747"/>
<path d="M187.51 442.911C217.33 458.331 248.91 466.001 280.06 448.931C285.333 446.037 288.407 444.351 289.28 443.871C289.55 443.726 289.848 443.647 290.15 443.641L298.19 443.461L319.9 443.451L323.42 443.521C316.267 448.207 307.28 453.537 296.46 459.511C265.06 476.837 233.093 478.207 200.56 463.621C188.667 458.281 177.66 451.221 167.54 442.441C173.767 443.127 180.423 443.284 187.51 442.911Z" fill="#094A57"/>
<path d="M240.63 443.391L287.46 443.421L298.19 443.461L290.15 443.641C289.848 443.647 289.55 443.726 289.28 443.871C288.407 444.351 285.334 446.037 280.06 448.931C248.91 466.001 217.33 458.331 187.51 442.911L240.63 443.391Z" fill="#085A66"/>
<path d="M149.33 450.461L149.5 477.151C138.787 476.564 131.444 475.991 127.47 475.431C121.237 474.551 114.997 473.711 108.75 472.911C105.937 472.551 103.037 472.144 100.05 471.691C103.024 465.404 104.737 458.857 105.19 452.051C115.47 452.351 121.95 452.491 124.63 452.471C131.95 452.417 140.184 451.747 149.33 450.461Z" fill="#47B874"/>
<path d="M149.63 492.621L149.82 499.221L149.69 502.791C124.58 513.291 98.88 509.941 73.68 502.541C61.2333 498.887 48.9233 494.951 36.75 490.731C24.49 486.477 12.2433 482.097 0.0100098 477.591L0 460.361C32.04 470.251 63.8 481.701 79.49 486.641C94.55 491.387 109.397 494.284 124.03 495.331C131.51 495.864 139.777 496.111 148.83 496.071C148.969 496.071 149.103 496.019 149.206 495.925C149.31 495.831 149.375 495.701 149.39 495.561L149.63 492.621Z" fill="#0D6562"/>
<path d="M149.69 502.791L149.72 510.591L148.37 522.611C148.356 522.743 148.298 522.867 148.206 522.963C148.114 523.059 147.992 523.121 147.86 523.141C124.52 526.731 101.33 528.021 78.1802 522.711C62.8802 519.204 46.2036 514.057 28.1502 507.271C19.3636 503.964 9.98359 499.657 0.0102539 494.351V477.591C12.2436 482.097 24.4902 486.477 36.7502 490.731C48.9236 494.951 61.2336 498.887 73.6802 502.541C98.8802 509.941 124.58 513.291 149.69 502.791Z" fill="#094A57"/>
<path d="M149.72 510.591L149.83 538.721C149.83 538.851 149.78 538.975 149.69 539.067C149.6 539.159 149.478 539.211 149.35 539.211H0.270233C0.230451 539.211 0.192315 539.195 0.164185 539.167C0.136054 539.138 0.120239 539.1 0.120239 539.061L0.0102539 494.351C9.98359 499.657 19.3636 503.964 28.1502 507.271C46.2036 514.057 62.8802 519.204 78.1802 522.711C101.33 528.021 124.52 526.731 147.86 523.141C147.992 523.121 148.114 523.059 148.206 522.963C148.298 522.867 148.356 522.743 148.37 522.611L149.72 510.591Z" fill="#083747"/>
</svg>`;
	}

	static appCss(): string {
		return `@import "tailwindcss";
@import "tw-animate-css";
@source "../node_modules/@beeblock/svelar/src/ui";

@custom-variant dark (&:is(.dark *));

:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.129 0.042 264.695);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.129 0.042 264.695);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.129 0.042 264.695);
  --primary: oklch(0.208 0.042 265.755);
  --primary-foreground: oklch(0.984 0.003 247.858);
  --secondary: oklch(0.968 0.007 264.536);
  --secondary-foreground: oklch(0.208 0.042 265.755);
  --muted: oklch(0.968 0.007 264.536);
  --muted-foreground: oklch(0.554 0.023 264.364);
  --accent: oklch(0.968 0.007 264.536);
  --accent-foreground: oklch(0.208 0.042 265.755);
  --destructive: oklch(0.577 0.245 27.325);
  --destructive-foreground: oklch(0.577 0.245 27.325);
  --border: oklch(0.929 0.013 264.531);
  --input: oklch(0.929 0.013 264.531);
  --ring: oklch(0.869 0.022 264.401);
  --chart-1: oklch(0.646 0.222 41.116);
  --chart-2: oklch(0.6 0.118 184.704);
  --chart-3: oklch(0.398 0.07 227.392);
  --chart-4: oklch(0.828 0.189 84.429);
  --chart-5: oklch(0.769 0.188 70.08);
  --sidebar: oklch(0.984 0.003 247.858);
  --sidebar-foreground: oklch(0.554 0.023 264.364);
  --sidebar-primary: oklch(0.208 0.042 265.755);
  --sidebar-primary-foreground: oklch(0.984 0.003 247.858);
  --sidebar-accent: oklch(0.968 0.007 264.536);
  --sidebar-accent-foreground: oklch(0.208 0.042 265.755);
  --sidebar-border: oklch(0.929 0.013 264.531);
  --sidebar-ring: oklch(0.869 0.022 264.401);
}

.dark {
  --background: oklch(0.129 0.042 264.695);
  --foreground: oklch(0.984 0.003 247.858);
  --card: oklch(0.129 0.042 264.695);
  --card-foreground: oklch(0.984 0.003 247.858);
  --popover: oklch(0.129 0.042 264.695);
  --popover-foreground: oklch(0.984 0.003 247.858);
  --primary: oklch(0.984 0.003 247.858);
  --primary-foreground: oklch(0.208 0.042 265.755);
  --secondary: oklch(0.279 0.041 260.873);
  --secondary-foreground: oklch(0.984 0.003 247.858);
  --muted: oklch(0.279 0.041 260.873);
  --muted-foreground: oklch(0.711 0.019 264.147);
  --accent: oklch(0.279 0.041 260.873);
  --accent-foreground: oklch(0.984 0.003 247.858);
  --destructive: oklch(0.577 0.245 27.325);
  --destructive-foreground: oklch(0.577 0.245 27.325);
  --border: oklch(0.279 0.041 260.873);
  --input: oklch(0.279 0.041 260.873);
  --ring: oklch(0.442 0.036 264.591);
  --chart-1: oklch(0.488 0.243 264.376);
  --chart-2: oklch(0.696 0.17 162.48);
  --chart-3: oklch(0.769 0.188 70.08);
  --chart-4: oklch(0.627 0.265 303.9);
  --chart-5: oklch(0.645 0.246 16.439);
  --sidebar: oklch(0.129 0.042 264.695);
  --sidebar-foreground: oklch(0.984 0.003 247.858);
  --sidebar-primary: oklch(0.488 0.243 264.376);
  --sidebar-primary-foreground: oklch(0.984 0.003 247.858);
  --sidebar-accent: oklch(0.279 0.041 260.873);
  --sidebar-accent-foreground: oklch(0.984 0.003 247.858);
  --sidebar-border: oklch(0.279 0.041 260.873);
  --sidebar-ring: oklch(0.442 0.036 264.591);
}

@theme inline {
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
  --color-brand: #ff3e00;
  --color-brand-dark: #e03500;
  --color-brand-light: #fff5f2;
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
  }
}
`;
	}

	static componentsJson(): string {
		return (
			JSON.stringify(
				{
					$schema: "https://shadcn-svelte.com/schema.json",
					tailwind: {
						css: "src/app.css",
						baseColor: "slate",
					},
					aliases: {
						lib: "$lib",
						utils: "$lib/utils",
						components: "$lib/components",
						ui: "$lib/components/ui",
						hooks: "$lib/hooks",
					},
					typescript: true,
					registry: "https://shadcn-svelte.com/registry",
				},
				null,
				2,
			) + "\n"
		);
	}

	static utilsCn(): string {
		return `import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
export type { WithoutChild, WithoutChildren, WithoutChildrenOrChild, WithElementRef } from 'bits-ui';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`;
	}

	static appDts(): string {
		return `import type { AuthManager } from '@beeblock/svelar/auth';
import type { Session } from '@beeblock/svelar/session';
import type { User } from '$lib/modules/auth/User.js';

declare global {
  namespace App {
    interface Locals {
      auth: AuthManager;
      session: Session;
      user: User | null;
      authenticatedVia?: 'bearer' | 'session' | null;
    }
  }
}

export {};
`;
	}

	static appTs(): string {
		return `/**
 * Svelar Application Bootstrap
 *
 * Configures database, hashing, auth, cache, queue, audit, API keys,
 * webhooks, teams, uploads, email templates, feature flags, PDF, and scheduling.
 * This runs once when the server starts.
 */

import { Connection } from '@beeblock/svelar/database';
import { container } from '@beeblock/svelar/container';
import { config } from '@beeblock/svelar/config';
import { Hash } from '@beeblock/svelar/hashing';
import { AuthManager } from '@beeblock/svelar/auth';
import { Cache, type CacheConfig } from '@beeblock/svelar/cache';
import { Queue } from '@beeblock/svelar/queue';
import { JobMonitor } from '@beeblock/svelar/queue/JobMonitor';
import { Audit } from '@beeblock/svelar/audit';
import { Log } from '@beeblock/svelar/logging';
import { Search } from '@beeblock/svelar/search';
import { ApiKeys } from '@beeblock/svelar/api-keys';
import { Webhooks, WebhookInbox } from '@beeblock/svelar/webhooks';
import { BackgroundOperation } from '@beeblock/svelar/operations';
	import { Teams } from '@beeblock/svelar/teams';
	import { EmailTemplates } from '@beeblock/svelar/email-templates';
	import { Mailer } from '@beeblock/svelar/mail';
	import { Uploads } from '@beeblock/svelar/uploads';
import { Features } from '@beeblock/svelar/feature-flags';
import { PDF } from '@beeblock/svelar/pdf';
import { configureDashboard } from '@beeblock/svelar/dashboard';
import { Broadcast } from '@beeblock/svelar/broadcasting';
import { Permissions } from '@beeblock/svelar/permissions';
import { DeploymentRuntime } from '@beeblock/svelar/deployment';
import { createDashboardProviders, dashboardAuthorization } from './lib/modules/admin/DashboardProvidersService.js';
import { permissionManifest } from './lib/shared/permissions/manifest.js';
import { createScheduler } from './lib/shared/scheduler/index.js';
import { User } from './lib/modules/auth/User.js';
import { UserRepository } from './lib/modules/auth/UserRepository.js';
import { EventServiceProvider } from './lib/shared/providers/EventServiceProvider.js';
import './lib/modules/auth/gates.js';

await config.loadFromDirectory('config');
Permissions.registerManifest(permissionManifest);

// ── Database ───────────────────────────────────────────────
Connection.configure({
  default: config.get('database.default', process.env.DB_DRIVER ?? 'sqlite'),
  connections: {
    sqlite: {
      driver: 'sqlite',
      filename: config.get('database.connections.sqlite.filename', process.env.DB_PATH ?? 'database.db'),
    },
    postgres: {
      driver: 'postgres',
      url: config.get('database.connections.postgres.url', process.env.DATABASE_URL),
      host: config.get('database.connections.postgres.host', process.env.DB_HOST ?? 'localhost'),
      port: config.get('database.connections.postgres.port', Number(process.env.DB_PORT ?? 5432)),
      database: config.get('database.connections.postgres.database', process.env.DB_NAME ?? 'svelar_db'),
      user: config.get('database.connections.postgres.user', process.env.DB_USER ?? 'postgres'),
      password: config.get('database.connections.postgres.password', process.env.DB_PASSWORD ?? ''),
      prepare: config.get(
        'database.connections.postgres.prepare',
        process.env.DB_PREPARE ? process.env.DB_PREPARE !== 'false' : process.env.DB_HOST !== 'pgbouncer'
      ),
    },
    mysql: {
      driver: 'mysql',
      url: config.get('database.connections.mysql.url', process.env.DATABASE_URL),
      host: config.get('database.connections.mysql.host', process.env.DB_HOST ?? 'localhost'),
      port: config.get('database.connections.mysql.port', Number(process.env.DB_PORT ?? 3306)),
      database: config.get('database.connections.mysql.database', process.env.DB_NAME ?? 'svelar_db'),
      user: config.get('database.connections.mysql.user', process.env.DB_USER ?? 'root'),
      password: config.get('database.connections.mysql.password', process.env.DB_PASSWORD ?? ''),
    },
  },
});

// ── Hashing (scrypt, zero dependencies) ───────────────────
// The same database backend is configured in web, worker and scheduler bootstrap.
Log.configure({
  default: config.get('logging.default', 'console'),
  channels: config.get('logging.channels', { console: { driver: 'console', level: 'info', format: 'json' } }),
  viewer: {
    driver: config.get('logging.viewer.driver', process.env.LOG_VIEWER_DRIVER === 'memory' ? 'memory' : 'database'),
    retentionSeconds: config.get('logging.viewer.retentionSeconds', Number(process.env.LOG_RETENTION_SECONDS ?? 2592000)),
    tailIntervalMs: config.get('logging.viewer.tailIntervalMs', Number(process.env.LOG_TAIL_INTERVAL_MS ?? 1000)),
    onTailError: () => console.error('Shared log tail unavailable; check database connectivity.'),
  },
});

Hash.configure({ driver: 'scrypt' });

// ── Auth (session-based with password reset, email verification, OTP) ──
export const auth = new AuthManager({
  guard: config.get('auth.guard', 'session'),
  model: User,
  jwt: {
    secret: config.get('auth.jwt.secret', process.env.JWT_SECRET ?? process.env.APP_KEY),
  },
  appUrl: config.get('app.url', process.env.APP_URL ?? 'http://localhost:5173'),
  appName: config.get('app.name', process.env.APP_NAME ?? 'Svelar'),
  eligibility: {
    disabledAtColumn: config.get('auth.eligibility.disabledAtColumn', 'disabled_at'),
    lockedUntilColumn: config.get('auth.eligibility.lockedUntilColumn', 'locked_until'),
    requireVerifiedEmail: config.get('auth.emailVerification.required', process.env.AUTH_EMAIL_VERIFICATION_REQUIRED === 'true') === true,
    ...config.get('auth.eligibility', {}),
  },
  presentation: {
    brand: config.get('auth.brand', {}),
    providers: config.get('auth.providers', []),
  },
});

// ── Cache ─────────────────────────────────────────────────
container.instance('auth', auth);

const cacheConfig: CacheConfig = {
  default: config.get('cache.default', process.env.CACHE_DRIVER ?? 'memory'),
  stores: {
    memory: {
      driver: 'memory',
      ttl: config.get('cache.stores.memory.ttl', undefined),
    },
    file: {
      driver: 'file',
      path: config.get('cache.stores.file.path', 'storage/cache'),
      ttl: config.get('cache.stores.file.ttl', undefined),
    },
    redis: {
      driver: 'redis',
      url: config.get('cache.stores.redis.url', process.env.REDIS_URL),
      host: config.get('cache.stores.redis.host', process.env.REDIS_HOST ?? 'localhost'),
      port: config.get('cache.stores.redis.port', Number(process.env.REDIS_PORT ?? 6379)),
      password: config.get('cache.stores.redis.password', process.env.REDIS_PASSWORD),
      db: config.get('cache.stores.redis.db', Number(process.env.REDIS_DB ?? 0)),
      prefix: config.get('cache.stores.redis.prefix', 'svelar_cache:'),
      ttl: config.get('cache.stores.redis.ttl', undefined),
    },
  },
};
Cache.configure(cacheConfig);

// ── Queue ─────────────────────────────────────────────────
const queueConnections: Record<string, any> = {
  sync: { driver: 'sync' },
  memory: { driver: 'memory' },
  database: {
    driver: 'database',
    table: config.get('queue.connections.database.table', 'svelar_jobs'),
  },
  redis: {
    driver: 'redis',
    url: config.get('queue.connections.redis.url', process.env.REDIS_URL),
    host: config.get('queue.connections.redis.host', process.env.REDIS_HOST ?? 'localhost'),
    port: config.get('queue.connections.redis.port', Number(process.env.REDIS_PORT ?? 6379)),
    password: config.get('queue.connections.redis.password', process.env.REDIS_PASSWORD),
    db: config.get('queue.connections.redis.db', Number(process.env.REDIS_DB ?? 0)),
    prefix: config.get('queue.connections.redis.prefix', 'svelar'),
  },
};
const queueConfig = {
  default: config.get('queue.default', process.env.QUEUE_DRIVER ?? 'sync'),
  connections: queueConnections,
};
Queue.configure(queueConfig);
JobMonitor.configure({ driver: queueConfig.connections[queueConfig.default]?.driver ?? queueConfig.default, ...queueConfig });

// Durable search intent uses the model database and is retried by workers/scheduler.
if (process.env.MEILISEARCH_HOST) {
  Search.configure({
    host: config.get('search.host', process.env.MEILISEARCH_HOST),
    apiKey: config.get('search.apiKey', process.env.MEILISEARCH_KEY),
    indexPrefix: config.get('search.indexPrefix', process.env.SEARCH_INDEX_PREFIX ?? ''),
    syncDriver: 'outbox',
  });
}

// ── Audit Logging ─────────────────────────────────────────
Audit.configure({ driver: 'database', table: 'audit_logs', enabled: true });

// ── API Keys ──────────────────────────────────────────────
ApiKeys.configure({ driver: 'database', prefix: 'sk_' });

// ── Webhooks ──────────────────────────────────────────────
Webhooks.configure({ driver: 'database', maxAttempts: 5 });
WebhookInbox.configure({ driver: 'database' });

// ── Teams ─────────────────────────────────────────────────
Teams.configure({ driver: 'database' });

// ── Uploads ───────────────────────────────────────────────
Uploads.configure({ driver: 'database', maxFileSize: 10 * 1024 * 1024 });

// ── Email Templates ──────────────────────────────────────
EmailTemplates.configure({ driver: 'database' });
EmailTemplates.registerDefaults();

// ── Broadcasting (SSE) ────────────────────────────────────
Broadcast.configure({
  default: 'sse',
  drivers: {
    sse: { driver: 'sse', ...(process.env.BROADCAST_BACKPLANE === 'redis' ? { backplane: {
      driver: 'redis' as const,
      url: process.env.REDIS_URL ?? (() => {
        const url = new URL('redis://localhost');
        url.hostname = process.env.REDIS_HOST ?? 'localhost';
        url.port = process.env.REDIS_PORT ?? '6379';
        url.password = process.env.REDIS_PASSWORD ?? '';
        url.pathname = '/' + (process.env.REDIS_DB ?? '0');
        return url.toString();
      })(),
      channel: process.env.BROADCAST_CHANNEL ?? 'svelar:broadcast',
    } } : {}) },
  },
});

// Channel authorization — private-user-{id} for per-user channels
Broadcast.channel('private-user-{id}', async (user: any, params: any) => {
  return user && String(user.id) === params.id;
});

Broadcast.channel('private-operations.{hash}', async (user: any, params: any) => {
  if (!user) return false;
  try { return BackgroundOperation.currentChannel() === 'private-operations.' + params.hash; }
  catch { return false; }
});

// Presence channel for admin dashboard
Broadcast.channel('presence-admin', async (user: any) => {
  if (!user || user.role !== 'admin') return false;
  return { id: user.id, name: user.name };
});

	// ── Feature Flags ────────────────────────────────────────
	Features.configure({ driver: 'database' });

	// ── Mail ─────────────────────────────────────────────────
	const mailDefault = config.get('mail.default', config.get('mail.driver', process.env.MAIL_DRIVER ?? 'log'));
	Mailer.configure({
	  default: mailDefault,
	  from: {
	    address: config.get('mail.from.address', process.env.MAIL_FROM ?? 'hello@example.com'),
	    name: config.get('mail.from.name', process.env.MAIL_FROM_NAME ?? process.env.APP_NAME ?? 'Svelar'),
	  },
	  mailers: {
	    log: { driver: 'log' },
	    null: { driver: 'null' },
	    smtp: {
	      driver: 'smtp',
	      host: config.get('mail.mailers.smtp.host', config.get('mail.smtp.host', process.env.MAIL_HOST ?? process.env.SMTP_HOST ?? 'localhost')),
	      port: Number(config.get('mail.mailers.smtp.port', config.get('mail.smtp.port', process.env.MAIL_PORT ?? process.env.SMTP_PORT ?? 587))),
	      secure: config.get('mail.mailers.smtp.secure', config.get('mail.smtp.secure', process.env.MAIL_SECURE === 'true')),
	      auth: {
	        user: config.get('mail.mailers.smtp.auth.user', config.get('mail.smtp.user', process.env.MAIL_USER ?? process.env.SMTP_USER ?? '')),
	        pass: config.get('mail.mailers.smtp.auth.pass', config.get('mail.smtp.password', process.env.MAIL_PASSWORD ?? process.env.SMTP_PASSWORD ?? '')),
	      },
	    },
	    postmark: {
	      driver: 'postmark',
	      apiToken: config.get('mail.mailers.postmark.apiToken', process.env.POSTMARK_API_TOKEN ?? ''),
	      messageStream: config.get('mail.mailers.postmark.messageStream', process.env.POSTMARK_MESSAGE_STREAM ?? 'outbound'),
	      endpoint: config.get('mail.mailers.postmark.endpoint', process.env.POSTMARK_ENDPOINT),
	    },
	    resend: {
	      driver: 'resend',
	      apiKey: config.get('mail.mailers.resend.apiKey', process.env.RESEND_API_KEY ?? ''),
	      endpoint: config.get('mail.mailers.resend.endpoint', process.env.RESEND_ENDPOINT),
	    },
	    mailtrap: {
	      driver: 'mailtrap',
	      apiToken: config.get('mail.mailers.mailtrap.apiToken', process.env.MAILTRAP_API_TOKEN ?? ''),
	      endpoint: config.get('mail.mailers.mailtrap.endpoint', process.env.MAILTRAP_ENDPOINT),
	    },
	  },
	});

	// ── PDF ─────────────────────────────────────────────────
const pdfDriver = config.get('pdf.driver', process.env.PDF_DRIVER ?? 'pdfkit') as 'pdfkit' | 'gotenberg';
const parseDurationMs = (value: unknown, fallback: number): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return fallback;

  const match = value.trim().match(/^(\\d+)(ms|s|m)?$/);
  if (!match) return fallback;

  const amount = Number(match[1]);
  const unit = match[2] ?? 'ms';
  if (unit === 'm') return amount * 60_000;
  if (unit === 's') return amount * 1_000;
  return amount;
};

PDF.configure({
  driver: pdfDriver,
  gotenberg: {
    url: config.get('pdf.gotenberg.url', process.env.GOTENBERG_URL ?? 'http://localhost:3000'),
    timeout: parseDurationMs(config.get('pdf.gotenberg.timeout', process.env.GOTENBERG_TIMEOUT ?? '60s'), 60_000),
  },
});

// ── Dashboard ─────────────────────────────────────────────
configureDashboard({ enabled: true, prefix: '/admin', providers: createDashboardProviders({
  cacheStores: Object.entries(cacheConfig.stores).map(([name, store]) => ({ name, driver: store.driver })),
}), authorize: dashboardAuthorization });

// ── Scheduler ─────────────────────────────────────────────
export const scheduler = createScheduler();

// ── Job Registration ──────────────────────────────────────
import { SendWelcomeEmail } from './lib/shared/jobs/SendWelcomeEmail.js';
import { DailyDigestJob } from './lib/shared/jobs/DailyDigestJob.js';
import { ExportDataJob } from './lib/shared/jobs/ExportDataJob.js';

Queue.registerAll([SendWelcomeEmail, DailyDigestJob, ExportDataJob]);

// ── Events (boot listeners + observers) ──────────────────
const esp = new EventServiceProvider(container);
await esp.boot();

// ── Auth Feature Toggles ─────────────────────────────────
export const authConfig = {
  appName: config.get('app.name', process.env.APP_NAME ?? 'Svelar'),
  otpEnabled: config.get('auth.otp.enabled', process.env.AUTH_OTP_ENABLED === 'true') === true,
  emailVerificationRequired: config.get('auth.emailVerification.required', process.env.AUTH_EMAIL_VERIFICATION_REQUIRED === 'true') === true,
  rememberEnabled: Number(process.env.SESSION_REMEMBER_LIFETIME ?? 604800) > 0,
};

export function authRedirect(url: URL): string {
  const localPath = (target: unknown): string | null => {
    if (typeof target !== 'string' || !target.startsWith('/')) return null;
    try {
      const decoded = decodeURIComponent(target);
      if (decoded.startsWith('//') || [...decoded].some((char) => {
        const code = char.charCodeAt(0);
        return code < 32 || code === 127 || code === 92;
      })) return null;
      const destination = new URL(target, url.origin);
      if (destination.origin !== url.origin || destination.pathname.startsWith('//')) return null;
      return destination.pathname + destination.search + destination.hash;
    } catch {
      return null;
    }
  };

  return localPath(url.searchParams.get('redirectTo'))
    ?? localPath(config.get('auth.redirectTo', '/dashboard'))
    ?? '/dashboard';
}

// Readiness proves configured dependencies, not merely that the HTTP process exists.
DeploymentRuntime.configure({ checks: {
  database: async (signal) => { await new UserRepository().probe(); return !signal.aborted; },
  cache: async (signal) => { await Cache.get('svelar:readiness'); return !signal.aborted; },
  queue: async (signal) => {
    const adapter = Queue.adapter('default', queueConfig.default);
    if (adapter.capabilities.shared) await adapter.counts();
    return !signal.aborted;
  },
  realtime: async (signal) => { await Broadcast.ready(); return !signal.aborted; },
} });
DeploymentRuntime.ready();

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
  DeploymentRuntime.beginDrain();
  void Broadcast.drain().catch(() => console.error('Svelar realtime drain failed.'));
});
// adapter-node emits this only after HTTP drain: never disconnect the DB on SIGTERM.
process.once('sveltekit:shutdown', () => {
  void (async () => {
    await scheduler.stop();
    await Queue.stop();
    await Broadcast.drain();
    await Connection.disconnect();
  })().catch(() => console.error('Svelar shutdown cleanup failed.'));
});

export { Connection, Hash, Broadcast };
`;
	}

	static hooksServerTs(): string {
		return `/**
 * SvelteKit Server Hooks — Svelar middleware pipeline
 */

import { createSvelarApp } from '@beeblock/svelar/hooks';
import { DatabaseSessionStore } from '@beeblock/svelar/session';

// Import app.ts to trigger database + hashing + auth configuration
import { auth } from './app.js';

export const { handle, handleError } = createSvelarApp({
  auth,
  secret: process.env.APP_KEY,
  sessionStore: new DatabaseSessionStore(),
  sessionLifetime: Number(process.env.SESSION_LIFETIME ?? 86400),
  sessionIdleLifetime: Number(process.env.SESSION_IDLE_LIFETIME ?? process.env.SESSION_LIFETIME ?? 86400),
  sessionAbsoluteLifetime: Number(process.env.SESSION_ABSOLUTE_LIFETIME ?? 86400),
  sessionRememberLifetime: Number(process.env.SESSION_REMEMBER_LIFETIME ?? 604800) || undefined,
  sessionRememberAbsoluteLifetime: Number(process.env.SESSION_REMEMBER_ABSOLUTE_LIFETIME ?? 2592000),
  sessionWarningBefore: Number(process.env.SESSION_WARNING_BEFORE ?? 120),
  sessionTouchOnActivity: process.env.SESSION_TOUCH_ON_ACTIVITY !== 'false',
  sessionTouchThrottle: Number(process.env.SESSION_TOUCH_THROTTLE ?? 300),
  rateLimitStore: process.env.RATE_LIMIT_STORE === 'cache' ? 'cache' : 'memory',
  rateLimitCacheStore: process.env.RATE_LIMIT_CACHE_STORE || process.env.CACHE_DRIVER,
  authThrottleStore: process.env.RATE_LIMIT_STORE === 'cache' ? 'cache' : 'memory',
  authThrottleCacheStore: process.env.RATE_LIMIT_CACHE_STORE || process.env.CACHE_DRIVER,
  csrfExcludePaths: ['/api/webhooks/incoming/', '/api/internal/'],
});
`;
	}

	static envExample(): string {
		return `# ── App ────────────────────────────────────────────────────
# APP_KEY: Encryption key for cookies, sessions, and tokens. Must be unique per environment.
# Generate with: npx svelar key:generate
APP_KEY=change-me-to-a-random-string
# APP_NAME: Displayed in emails, page titles, and meta tags.
APP_NAME=My App
# APP_URL: Full public URL of your app. Used for CORS, redirects, and link generation.
APP_URL=http://localhost:5173

# Shared log viewer for web, workers and scheduler; requires migrations.
LOG_VIEWER_DRIVER=database
LOG_RETENTION_SECONDS=2592000
LOG_TAIL_INTERVAL_MS=1000

# ── Sessions ──────────────────────────────────────────────
# SESSION_LIFETIME: Idle session lifetime in seconds.
# SESSION_LIFETIME=86400
# SESSION_ABSOLUTE_LIFETIME: Optional hard maximum lifetime in seconds, regardless of activity.
# SESSION_ABSOLUTE_LIFETIME=
# SESSION_TOUCH_ON_ACTIVITY: Extend session TTL only for real navigation/mutations, not polling/SSE.
# SESSION_TOUCH_ON_ACTIVITY=true
# SESSION_TOUCH_THROTTLE: Minimum seconds between session TTL touches.
# SESSION_TOUCH_THROTTLE=300
# SESSION_IDLE_LIFETIME=86400
# SESSION_REMEMBER_LIFETIME: Persistent idle lifetime; set 0 to hide/disable remember-me.
# SESSION_REMEMBER_LIFETIME=604800
# SESSION_REMEMBER_ABSOLUTE_LIFETIME=2592000
# SESSION_WARNING_BEFORE=120

# ── Internal ──────────────────────────────────────────────
# INTERNAL_SECRET: Shared secret for internal HTTP bridge (scheduler -> web server).
# Must match between the scheduler process and the web server.
INTERNAL_SECRET=change-me-to-a-random-string

# ── Database ──────────────────────────────────────────────
# DB_DRIVER: sqlite | postgres | mysql
# SQLite is the default — no extra config needed.
DB_DRIVER=sqlite
# DB_PATH: Path to SQLite file (relative to project root). Only used with sqlite driver.
DB_PATH=database.db
# DATABASE_URL: Optional connection URL for PostgreSQL or MySQL. When set, it takes precedence over DB_HOST/DB_PORT/etc.
# DATABASE_URL=postgres://postgres:secret@localhost:5432/svelar_db

# PostgreSQL (uncomment to switch)
# In Docker: app connects through PgBouncer on port 6432, not directly to postgres.
# DB_DRIVER=postgres
# DB_HOST=pgbouncer
# DB_PORT=6432
# DB_NAME=svelar_db
# DB_USER=postgres
# DB_PASSWORD=secret
# DB_PREPARE=false # Required when connecting through PgBouncer transaction pooling.

# MySQL (uncomment to switch)
# DB_DRIVER=mysql
# DB_HOST=localhost
# DB_PORT=3306
# DB_NAME=svelar_db
# DB_USER=root
# DB_PASSWORD=secret
# DB_ROOT_PASSWORD: Root password for MySQL container (Docker only).
# DB_ROOT_PASSWORD=rootsecret

# ── PgBouncer (connection pooling — PostgreSQL only) ─────
# PgBouncer sits between app and PostgreSQL. Included automatically with postgres.
# App connects to pgbouncer:6432, PgBouncer connects to postgres:5432.
# Pool settings are in docker/pgbouncer/pgbouncer.ini (not env vars).
# PostgreSQL tuning is in docker/postgres/postgresql.conf.
# Credentials are read from DATABASE_URL in docker-compose.yml (no static password files).
# PGBOUNCER_HOST_PORT: Host port exposed by docker-compose.dev.yml for local CLI/dev tools.
# PGBOUNCER_HOST_PORT=56432
# MYSQL_HOST_PORT: Host port exposed by docker-compose.dev.yml when using MySQL.
# MYSQL_HOST_PORT=53306

# ── Auth ──────────────────────────────────────────────────
# AUTH_OTP_ENABLED: Opt in to emailed one-time code login after configuring mail delivery.
AUTH_OTP_ENABLED=false
# AUTH_EMAIL_VERIFICATION_REQUIRED: Require email verification before access.
AUTH_EMAIL_VERIFICATION_REQUIRED=false
# JWT_SECRET: Secret key for signing JWT tokens. Required if using JWT auth.
# JWT_SECRET=your-jwt-secret-key

# ── Mail ──────────────────────────────────────────────────
	# MAIL_DRIVER: log | null | smtp | postmark | resend | mailtrap
	# "log" prints to console (dev). Switch to a real driver for production.
	# MAIL_DRIVER=log
# MAIL_FROM: Default sender address for all outgoing emails.
# MAIL_FROM=hello@example.com
# SMTP (uncomment for generic SMTP)
# SMTP_HOST=smtp.example.com
# SMTP_PORT=587
# SMTP_USER=your-smtp-user
# SMTP_PASSWORD=your-smtp-password
# Postmark (uncomment to use)
# POSTMARK_API_TOKEN=your-postmark-server-token
	# Resend (uncomment to use)
	# RESEND_API_KEY=re_your-resend-api-key
	# Mailtrap Email API (uncomment to use)
	# MAILTRAP_API_TOKEN=your-mailtrap-api-token

# ── Queue ─────────────────────────────────────────────────
# QUEUE_DRIVER: sync | memory | database | redis
# "sync" runs jobs immediately (dev). "database" uses the svelar_jobs migration.
# "redis" uses BullMQ for background processing.
# QUEUE_DRIVER=sync
# QUEUE_WORKER_CONCURRENCY: Jobs processed in parallel by Redis/BullMQ workers.
# QUEUE_WORKER_CONCURRENCY=1

# ── Redis ─────────────────────────────────────────────────
# Required for: BullMQ queue, Redis cache driver, Redis session driver.
# REDIS_HOST=localhost
# REDIS_PORT=6379
# REDIS_PASSWORD: Set a password in production. Docker compose uses this for the Redis container too.
# REDIS_PASSWORD=
# REDIS_HOST_PORT: Host port exposed by docker-compose.dev.yml for local workers/scheduler.
# REDIS_HOST_PORT=56379

# ── Rate Limiting ─────────────────────────────────────────
# RATE_LIMIT_STORE: memory | cache. Use "cache" with CACHE_DRIVER=redis for multi-instance production apps.
# RATE_LIMIT_STORE=memory
# RATE_LIMIT_CACHE_STORE: cache store name used when RATE_LIMIT_STORE=cache.
# RATE_LIMIT_CACHE_STORE=redis

# ── Storage ───────────────────────────────────────────────
# STORAGE_DISK: local | s3
# "local" stores files on disk. "s3" uses any S3-compatible service (AWS or RustFS).
# STORAGE_DISK=local
# S3_ENDPOINT: URL of the S3-compatible service. Use http://rustfs:9000 for Docker RustFS.
# S3_ENDPOINT=http://localhost:9000
# S3_ACCESS_KEY=svelar
# S3_SECRET_KEY=svelarsecret
# S3_BUCKET: Bucket name. Created automatically by most S3 services.
# S3_BUCKET=svelar
# S3_REGION=us-east-1

# RustFS (S3 storage container — Docker only)
# RUSTFS_ACCESS_KEY: Admin access key for RustFS. Also used as S3_ACCESS_KEY.
# RUSTFS_ACCESS_KEY=svelar
# RUSTFS_SECRET_KEY: Admin secret key for RustFS. Also used as S3_SECRET_KEY.
# RUSTFS_SECRET_KEY=svelarsecret
# RUSTFS_CONSOLE_PORT: Host port for the RustFS admin console (default: 9001). Change per project on shared droplets.
# RUSTFS_CONSOLE_PORT=9001
# RUSTFS_API_PORT: Host port exposed by docker-compose.dev.yml for local S3 clients.
# RUSTFS_API_PORT=5335

# ── Search ────────────────────────────────────────────────
# Meilisearch — full-text search engine (optional).
# MEILISEARCH_HOST=http://localhost:7700
# MEILISEARCH_KEY: Master key for Meilisearch. Required in production.
# MEILISEARCH_KEY=
# MEILI_MASTER_KEY: Same key, used by the Meilisearch Docker container.
# MEILI_MASTER_KEY=svelar-meili-master-key
# MEILI_PORT: Host port for Meilisearch dashboard (Docker only, default: 7700).
# MEILI_PORT=7700

# ── PDF ───────────────────────────────────────────────────
# PDF_DRIVER: pdfkit | gotenberg
# "pdfkit" works out of the box. "gotenberg" renders HTML to PDF (needs Gotenberg service).
# PDF_DRIVER=gotenberg
# GOTENBERG_URL: URL of the Gotenberg service. Use http://gotenberg:3000 for Docker.
# GOTENBERG_URL=http://localhost:3001
# GOTENBERG_TIMEOUT: Max time for PDF generation (default: 60s).
# GOTENBERG_TIMEOUT=60s
# GOTENBERG_LOG_LEVEL: Gotenberg container log level (default: info).
# GOTENBERG_LOG_LEVEL=info
# GOTENBERG_HOST_PORT: Host port exposed by docker-compose.dev.yml for local PDF generation.
# GOTENBERG_HOST_PORT=53000

# ── Broadcasting ──────────────────────────────────────────
# Pusher/Soketi WebSocket for real-time events (optional).
# PUSHER_KEY=app-key
# PUSHER_SECRET=app-secret
# PUSHER_APP_ID=app-id
# PUSHER_HOST: Use "soketi" for Docker, "localhost" for local dev.
# PUSHER_HOST=localhost
# PUSHER_PORT=6001
# SOKETI_PORT: Host port for Soketi WebSocket (Docker only, default: 6001).
# SOKETI_PORT=6001
# SOKETI_DEBUG: Enable Soketi debug logging (0 or 1).
# SOKETI_DEBUG=0
# SOKETI_MAX_CONNS: Max concurrent WebSocket connections per app (default: 1000).
# SOKETI_MAX_CONNS=1000

# ── Stripe ────────────────────────────────────────────────
# Install @beeblock/svelar-stripe plugin first.
# STRIPE_SECRET_KEY=sk_test_...
# STRIPE_PUBLISHABLE_KEY=pk_test_...
# STRIPE_WEBHOOK_SECRET: Webhook signing secret from Stripe dashboard.
# STRIPE_WEBHOOK_SECRET=whsec_...
# STRIPE_CURRENCY: Default currency for charges (default: usd).
# STRIPE_CURRENCY=usd

# ── Docker / Deployment ──────────────────────────────────
# APP_PORT: Host port for the production container (default: 3000).
# Change per project when running multiple apps on the same droplet.
# APP_PORT=3000
# DEV_PORT: Host port for the development container (default: 5173).
# DEV_PORT=5173
# DOCKER_IMAGE: Full Docker Hub image path (e.g. username/myapp).
# Set automatically by CI/CD — only needed for manual docker compose commands.
# DOCKER_IMAGE=username/myapp

# ── Container Memory Limits ──────────────────────────────
# Prevent any single container from consuming all droplet memory.
# APP_MEMORY_LIMIT: Web app container. Default: 1G.
# APP_MEMORY_LIMIT=1G
# WORKER_MEMORY_LIMIT: Queue worker container. Default: 512M.
# WORKER_MEMORY_LIMIT=512M
# SCHEDULER_MEMORY_LIMIT: Scheduler container. Default: 256M.
# SCHEDULER_MEMORY_LIMIT=256M
# POSTGRES_MEMORY_LIMIT: PostgreSQL container. Default: 1G. Scale with postgresql.conf shared_buffers.
# POSTGRES_MEMORY_LIMIT=1G
# MYSQL_MEMORY_LIMIT: MySQL container (if using MySQL). Default: 1G.
# MYSQL_MEMORY_LIMIT=1G
# REDIS_MEMORY_LIMIT: Redis container. Default: 256M.
# REDIS_MEMORY_LIMIT=256M
`;
	}

	static gitignore(): string {
		return `node_modules
.svelte-kit
build
dist
.env
.env.*
*.db
!.env.example

# Storage (keep dirs, ignore contents)
storage/logs/*
storage/cache/*
storage/uploads/*
storage/sessions/*
!storage/**/.gitkeep

# Infrastructure (contains server IPs and SSH key paths)
infra/droplet.env

# Testing
test-results/
playwright-report/
coverage/
`;
	}

	static runtimeGuidance(): string {
		return `## Production Runtime Contracts

- Controllers, entities, routes and dashboards require an explicit capability decision: use \`--capability=<resource>\` with team/platform scope and page path, or a reviewed \`--public\` exemption. Public only exempts functional RBAC, never auth, policies, validation or CSRF.
- Register literal capability manifests, seed catalogs/profiles, and guard endpoints before FormRequest parsing. System profiles evolve as defaults minus exclusions plus inclusions; custom profiles are exact. Verify platform ownership against current trusted account data.
- User-bound API credentials restrict current user authority through verified \`credentialCapabilities\`. Service accounts require trusted tenant/actor context and cannot grant platform capabilities. Client snapshots are presentation only.
- Authenticate before Origin/CSRF; only verified Bearer identity permits a machine-request exemption. A submitted header never bypasses browser protection or permits session fallback. Signed incoming webhook routes authenticate provider credentials independently.
- Apply configured account eligibility to password, session, token, refresh, OTP and federation login. Federation callbacks use \`auth.login()\` after provider/state proof and secure linking, never direct session writes. Add focused migrations before enabling new status columns. Auth APIs audit attempts; do not duplicate events or log credentials.
- Render only public \`auth.presentation()\` data through the shared AuthFrame; provider controls require real configured available adapters. Never return full auth configuration to page loads or claim branding slots implement OAuth/OIDC/SAML.
- Auth identity comes from the configured model primary key and \`auth.id()\`, never a shadow \`user.id\`. Match actual foreign-key column types through app migrations. Preserve the server-validated return path across login/register/recovery/OTP links; never trust a browser redirect target without validation.
- Generic controller failures use the request-scoped global ErrorHandler, including awaited reporters/renderers. Return or await \`super.handleError(error, event)\`; preserve native SvelteKit redirects/HTTP errors and do not emit unreported generic 500s.
- Use \`Queue.adapter(queue, connection)\` for named queue monitoring, replay, batch controls and timelines; include live/dead-letter source on job references. Never import BullMQ internals in app code. Unknown worker telemetry remains null/incomplete.
- Register jobs in the common bootstrap and run daemon profiles with \`queue:work --profile=...\`. Use persistent scheduler runtime and \`ScheduleMonitor.requestRun()\`; queued run-now is not completed execution.
- Use atomic cache primitives and \`Http.budget\` for distributed quotas. Memory is process-local and null coordination fails closed. Trust only configured proxy chains.
- Register durable \`WebhookInbox\` sources with exact raw-byte provider verification and trusted account mapping. Register the inbox sweep in every scheduler. Handlers are at-least-once and need domain idempotency; generic HMAC is not Stripe timestamp verification.
- Use \`BackgroundOperation\` for persisted progress, results and cooperative cancellation. Enforce tenant plus actor ownership and private channel authorization. Register handlers/sweeps across processes; queue and realtime only wake up durable work.
- Sessions renew through real navigation/mutations or trusted server activity, not polling headers. Configure idle, absolute and remember limits and use protected session status/renew endpoints. Multitab messages only invalidate local presentation.
- Configure shared database logs in the common bootstrap and register durable search outbox sweeps. Meilisearch outages must not turn committed database writes into failed writes.
- Use callback-scoped fakes and explicit tenant/actor context in tests. Native database resets require an isolated test database and explicit destructive acknowledgement.
- Factories may await real password hashes in \`definition()\`. Use \`makeAsync/makeManyAsync\` for non-persisted asynchronous definitions; synchronous make methods reject them. Generated auth tests use isolated migrations, never the application's configured database or bootstrap.
- Use \`withQueueRecovery\` with a public shared adapter and caller-owned start/stop/kill fixtures for worker acceptance tests. Await every operation, honor abort signals and deadlines, and never kill unrelated workers. Fakes do not prove native recovery.
- Dashboard topology, stack traces, scheduler pages and dependency probes expose bounded coverage/unknown state. Use configured queue discovery pages and the actual cache inventory; empty/null process-local reads are not distributed health or evidence of browser delivery.
`;
	}

	static agentsMd(): string {
		return `# Svelar App — Agent Guidelines

## Required Flow

- Follow the Svelar architecture: route -> controller/page action -> FormRequest/shared schema validation -> DTO -> action/service -> repository -> model/resource -> response.
- Use Svelar CLI generators before hand-writing artifacts when a generator exists.
- For CRUD/API features, start with \`npx svelar make:entity ... --crud\` or the focused \`make:controller\`, \`make:request\`, \`make:schema\`, \`make:dto\`, \`make:action\`, \`make:resource\`, \`make:repository\`, and \`make:model\` commands. If you skip a generator, explain the reason before editing files.
- Use Svelar ORM and migrations. Avoid raw SQL unless it is a low-level driver/infrastructure exception.
- Keep one migration per table or focused schema change.
- Use shared schemas for backend validation and frontend forms. Use Superforms where app forms need shared validation.
- Keep validation consistent with \`svelar.validation.json\`. Use Zod schemas in Zod apps and Valibot schemas in Valibot apps.
- Use policies, permissions, teams, middleware, rate limits, sessions, jobs, events, listeners, observers, cache, storage, search, PDF, and broadcasting through Svelar APIs instead of ad hoc implementations.

${this.runtimeGuidance()}

## ORM Helper Lifecycle

### Scope And Cast Contracts

- Register named scopes through \`Model.addGlobalScope\`; scopes inherit safely and use a synchronous, frozen, condition-only adapter. They cannot execute/raw-rewrite a query. Group application OR predicates inside protected boundaries.
- Scope-aware inserts require explicit equality/IN/null-compatible attributes. Never infer defaults from arbitrary predicates; range/pattern/negative scope inserts fail closed. Authorize \`withoutGlobalScope\` explicitly; scoped bulk upsert/FROM/union bypasses are rejected.
- Use exact \`decimal\`/\`decimal:<scale>\` string casts for monetary decimals instead of Number. Custom \`AttributeCast\` defines synchronous get/set/optional equals. Mutable JSON/Date edits are tracked against deep originals and persisted change snapshots.
- Keyset iteration respects custom primary keys and OR grouping. Bulk QueryBuilder writes remain eventless; individual Model persistence provides observers/audit/search outbox effects.

### Find-Or-Create Contracts

- Model-aware \`firstOrCreate\` and \`updateOrCreate\` return full Model instances, even after \`select(...)\`. Clone builders to preserve caller filters, connection, tenant scope, and soft-delete scope; do not append lookup criteria to the caller.
- Keep automatic tenant and soft-delete guards outside grouped user predicates, including OR/raw OR. Helpers also group caller predicates before adding search criteria and the row primary key, so OR cannot widen a lookup or single-record update beyond those guards.
- Delegate model writes to the full \`Model.create\` / \`fill\` / \`save\` lifecycle: respect \`fillable\`, generated IDs, timestamps, JSON casts, observers, audit, and configured Searchable synchronization. An existing \`firstOrCreate\` match is read-only.
- Seed new records only from the passed search plus create/update attributes, not inferred \`where\` defaults. Use SQL \`IS NULL\` for null search attributes and reject undefined search attributes.
- \`Model.forTenant(teamId)\` and a plain builder's \`.forTenant(teamId)\` establish real explicit tenant scopes, preserved by clone. They guard reads/writes, auto-assign the selected tenant during helper creation, and guard upsert without ambient context; conflicting tenant values are rejected. Arbitrary \`where('team_id', teamId)\` is not a creation default. Authorize \`withoutTenantScope()\` as an administrative bypass; unscoped tenant-model creation still requires an explicit tenant attribute.
- Require matching database unique constraints in migrations. Recover only a recognized unique violation from the INSERT, then re-read the winner using the same visible, filtered, scoped search. In an active PostgreSQL transaction, isolate the INSERT with a savepoint before recovery.
- Propagate unrelated storage and observer errors; do not treat lifecycle failures as duplicate-insert success or retry the whole lifecycle. If a scoped update target is missing, throw before updated/saved post-hooks, including no-dirty updates.
- These helpers are not atomic; concurrent updates to an existing record are last-writer-wins. Use database \`upsert\` or transaction/locking when atomicity is needed; \`upsert\` is eventless and does not run the full Model lifecycle.
- Tenant-scoped \`upsert\` requires the tenant column in \`conflictColumns\` and a matching composite unique constraint; ambient or explicit \`forTenant()\` scope assigns tenant values and rejects conflicts. Upsert rejects all row predicates and soft-delete scopes: consciously use \`withTrashed().upsert(...)\` for table identity, or eventful helpers for scoped row writes. PostgreSQL/SQLite guard target/excluded tenant equality; MySQL guards each assignment against any unique/PK collision. A foreign collision can throw on PostgreSQL/SQLite or no-op on MySQL; metadata is not Model success. Upsert stays eventless: supply IDs/timestamps and authorize the tenant-only \`withoutTenantScope()\` admin bypass. MySQL's empty-update self-assignment is not \`INSERT IGNORE\`; unrelated validation/storage errors propagate.
- A raw \`QueryBuilder\` without a model class is eventless and returns plain rows. Its helpers require stable unique row identity through an \`id\` column, not a custom model primary key. Both model and raw helpers require a single-table write target and reject joined, grouped/HAVING, CTE, and union queries.

## Hard Stops

- Do not implement CRUD directly inside \`src/routes/**/+server.ts\`. Route files should bind or call controllers and stay thin.
- Do not put validation, authorization, persistence, and response shaping all in a SvelteKit action or API route.
- Do not create a write path without a shared schema, FormRequest, DTO, action/service, repository/model, and resource/consistent response envelope.
- Do not create database tables from runtime code. Use migrations.
- Do not use raw SQL for normal CRUD/query work. Use models, repositories, and the Svelar ORM/query builder.
- If existing code violates these rules, stop adding more of the same pattern and first refactor the touched flow toward Svelar conventions.

## Data, Config, And Seeders

- Never hardcode app data in routes, controllers, actions, services, repositories, or Svelte components.
- Schema changes go in migrations. Do not create or alter tables from runtime code, route handlers, services, stores, jobs, or app bootstrap.
- Demo/default/reference data goes in seeders. Use \`npx svelar make:seeder\` or the existing seeder structure, then run \`npx svelar seed:run\`.
- Test data goes in factories or test setup, not production seeders or route handlers.
- Runtime settings go through \`.env\`, \`.env.example\`, \`src/app.ts\`, and Svelar config helpers. Do not hardcode secrets, URLs, ports, bucket names, provider keys, feature flags, user IDs, team IDs, role IDs, or permission IDs.
- Permission and role names may be named constants/contracts, but assignment of initial roles/permissions belongs in seeders.
- File paths, public URLs, mail provider names, queue names, disk names, and search index names should come from config or central constants, not scattered string literals.
- If a feature needs initial admin/demo records, create or update a seeder and document the login/test data.

## Feature Checklist

- HTTP/API: route file -> controller -> FormRequest -> DTO -> action/service -> repository/model -> resource/response.
- Page form: shared schema -> Superforms -> page action -> FormRequest/DTO/action -> resource-like \`{ data, meta }\` result.
- Database: migration per table/focused change, model, repository, seeder/factory where needed.
- Authorization: FormRequest \`authorize\`, policies for model decisions, roles/permissions/teams where feature access is user-configurable.
- Side effects: events/listeners/observers; queue jobs for slow or retryable work.
- Runtime services: use Svelar cache, queue, scheduler, storage/uploads, PDF, mail, search, broadcasting, audit/logging, and webhooks APIs instead of one-off integrations.
- UI: loading states, inline validation, no duplicate validation toasts, success/error feedback, empty states, and realtime updates where expected.
- Tests: add focused unit/feature/browser tests for the behavior touched, including permissions and failure cases.

## Imports

- Prefer app aliases such as \`$lib/modules/...\`, \`$lib/shared/...\`, \`$lib/database/...\`, and \`$lib/factories/...\`.
- Prefer Svelar subpath imports such as \`@beeblock/svelar/orm\`, \`@beeblock/svelar/routing\`, \`@beeblock/svelar/forms\`, \`@beeblock/svelar/validation\`, \`@beeblock/svelar/auth\`, \`@beeblock/svelar/queue\`, and \`@beeblock/svelar/storage\`.

## Frontend

- Use Svelte 5 runes in \`.svelte\` files: \`$props\`, \`$state\`, \`$derived\`, \`$effect\`, and \`{@render children()}\`.
- Do not use Svelte runes in plain \`.ts\` files.
- Use generated shadcn-svelte components for app UI.
- Mutating browser \`fetch\` calls must include Svelar's CSRF header. Enhanced forms can use the regular form flow.

## Verification

- Before shipping meaningful changes, run focused tests and \`npm run build\` when feasible.
- Ambient \`App.Locals\` declarations belong in \`src/svelar.d.ts\`; \`src/app.ts\` shadows a same-name \`app.d.ts\`. Keep anonymous users nullable and narrow authentication before reading user IDs.
- For queue or scheduler behavior, run \`npm run dev:worker\` and \`npm run dev:scheduler\` locally with Redis available.
- Do not revert unrelated user changes in the working tree.
`;
	}

	static claudeMd(): string {
		return this.agentsMd();
	}

	static codexSvelarSkill(): string {
		return `---
name: svelar-specialist
description: Use when working in this Svelar app, including scaffolding, routes, controllers, FormRequests, DTOs, schemas, ORM models, migrations, repositories, services, actions, resources, auth, policies, permissions, teams, queues, cache, scheduler, events, listeners, observers, mail, notifications, storage/uploads, PDF, search, SSE/Soketi broadcasting, webhooks, audit/logging, Docker, browser testing, production hardening, or any @beeblock/svelar import.
---

# Svelar Specialist

Use this skill for Svelar app work. Svelar is Laravel-inspired on SvelteKit 2. Follow Svelar conventions first; do not replace them with ad hoc SvelteKit-only code for real features.

## Non-Negotiable Rules

- Use Svelar CLI generators before hand-writing artifacts whenever a generator exists.
- For CRUD/API features, start with \`npx svelar make:entity ... --crud\` or the focused \`make:controller\`, \`make:request\`, \`make:schema\`, \`make:dto\`, \`make:action\`, \`make:resource\`, \`make:repository\`, and \`make:model\` commands. If you skip a generator, explain the reason before editing files.
- Use controllers for HTTP/API resources. SvelteKit page server actions may orchestrate page forms, but business workflows still go through FormRequest -> DTO -> action/service.
- Default flow: route -> controller/page action -> FormRequest/shared schema validation -> DTO -> action -> service -> repository -> model/resource -> response.
- Use both FormRequest classes and DTOs for write paths. FormRequest validates and authorizes; DTO carries validated data into actions/services.
- Use shared contract schemas for frontend and backend validation. Do not duplicate one schema for Superforms and another schema for FormRequest.
- Keep validation consistent with \`svelar.validation.json\`: Zod apps use \`@beeblock/svelar/validation\`; Valibot apps use \`@beeblock/svelar/validation/valibot\`.
- Use Svelar ORM, models, repositories, and migrations. Avoid raw SQL except explicit infrastructure-level driver behavior that the ORM cannot represent.
- Create one migration per table or focused schema change.
- Prefer integer primary keys internally plus UUID v7 or ULID public identifiers for API/UI exposure when useful.
- Use policies, permissions, roles, teams, middleware, rate limits, sessions, jobs, events, listeners, observers, cache, storage, search, PDF, mail, notifications, audit, logs, and broadcasting through Svelar APIs instead of custom one-off implementations.
- Mutating browser \`fetch\` calls must include the Svelar CSRF token header. Enhanced forms can rely on the form flow.
- Use \`$lib/...\` aliases for app-owned imports. Keep relative imports only for local SvelteKit conventions like \`./$types\`.
- Use generated shadcn-svelte components for app UI. Reserve Svelar UI components for framework surfaces.
- Use Svelte 5 runes in \`.svelte\` files only: \`$props\`, \`$state\`, \`$derived\`, \`$effect\`, and \`{@render children()}\`.
- Do not use Svelte runes in plain \`.ts\` files.

## Hard Stops

- Do not implement CRUD directly inside \`src/routes/**/+server.ts\`. Route files should bind or call controllers and stay thin.
- Do not put validation, authorization, persistence, and response shaping all in a SvelteKit action or API route.
- Do not create a write path without a shared schema, FormRequest, DTO, action/service, repository/model, and resource/consistent response envelope.
- Do not create database tables from runtime code. Use migrations.
- Do not use raw SQL for normal CRUD/query work. Use models, repositories, and the Svelar ORM/query builder.
- If existing code violates these rules, stop adding more of the same pattern and first refactor the touched flow toward Svelar conventions.

## Data, Config, And Seeders

- Never hardcode app data in routes, controllers, actions, services, repositories, or Svelte components.
- Schema changes go in migrations. Do not create or alter tables from runtime code, route handlers, services, stores, jobs, or app bootstrap.
- Demo/default/reference data goes in seeders. Use \`npx svelar make:seeder\` or the existing seeder structure, then run \`npx svelar seed:run\`.
- Test data goes in factories or test setup, not production seeders or route handlers.
- Runtime settings go through \`.env\`, \`.env.example\`, \`src/app.ts\`, and Svelar config helpers. Do not hardcode secrets, URLs, ports, bucket names, provider keys, feature flags, user IDs, team IDs, role IDs, or permission IDs.
- Permission and role names may be named constants/contracts, but assignment of initial roles/permissions belongs in seeders.
- File paths, public URLs, mail provider names, queue names, disk names, and search index names should come from config or central constants, not scattered string literals.
- If a feature needs initial admin/demo records, create or update a seeder and document the login/test data.

## Feature Checklist

- HTTP/API: route file -> controller -> FormRequest -> DTO -> action/service -> repository/model -> resource/response.
- Page form: shared schema -> Superforms -> page action -> FormRequest/DTO/action -> resource-like \`{ data, meta }\` result.
- Database: migration per table/focused change, model, repository, seeder/factory where needed.
- Authorization: FormRequest \`authorize\`, policies for model decisions, roles/permissions/teams where feature access is user-configurable.
- Side effects: events/listeners/observers; queue jobs for slow or retryable work.
- Runtime services: use Svelar cache, queue, scheduler, storage/uploads, PDF, mail, search, broadcasting, audit/logging, and webhooks APIs instead of one-off integrations.
- UI: loading states, inline validation, no duplicate validation toasts, success/error feedback, empty states, and realtime updates where expected.
- Tests: add focused unit/feature/browser tests for the behavior touched, including permissions and failure cases.

## CLI-First Workflow

For a full Laravel-style resource, start with \`make:entity\`:

- \`npx svelar make:entity Invoice --module=billing --fields "title:string,total:number,status:enum(draft,paid)" --crud --capability=invoices --scope=team --screen-route=/invoices\`

Use focused generators for individual artifacts:

- \`npx svelar make:model Invoice --module=billing\`
- \`npx svelar make:migration create_invoices_table\`
- \`npx svelar make:schema invoice --module=billing\`
- \`npx svelar make:dto CreateInvoice --module=billing --input=CreateInvoiceInput --schema=invoice\`
- \`npx svelar make:request CreateInvoiceRequest --module=billing\`
- \`npx svelar make:action CreateInvoiceAction --module=billing\`
- \`npx svelar make:service InvoiceService --module=billing\`
- \`npx svelar make:repository InvoiceRepository --module=billing\`
- \`npx svelar make:controller InvoiceController --module=billing --capability=invoices --scope=team --screen-route=/invoices\`
- \`npx svelar make:resource InvoiceResource --module=billing\`
- \`npx svelar make:event InvoicePaid --module=billing\`
- \`npx svelar make:listener SendInvoiceReceipt --module=billing\`
- \`npx svelar make:observer InvoiceObserver --module=billing\`
- \`npx svelar make:job SyncInvoiceJob\`
- \`npx svelar make:task PruneOldInvoices\`
- \`npx svelar make:command ReconcileInvoices\`
- \`npx svelar make:channel TeamChannel\`
- \`npx svelar make:broadcasting\`
- \`npx svelar make:dashboard --capability=operations --scope=platform\`
- \`npx svelar make:docker\`
- \`npx svelar make:test InvoiceService --unit\`

Runtime commands include \`migrate\`, \`seed:run\`, \`routes:list\`, \`queue:work\`, \`queue:failed\`, \`queue:retry\`, \`queue:flush\`, \`schedule:run\`, \`search:setup\`, and \`tinker\`.

## DDD Module Layout

In generated DDD apps, module artifacts belong here:

- \`contracts/schemas/<name>.schema.ts\`
- \`domain/models/<Model>.ts\`
- \`domain/events/<Event>.ts\`
- \`domain/observers/<Observer>.ts\`
- \`domain/policies/<Policy>.ts\`
- \`application/actions/<Action>.ts\`
- \`application/dto/<Dto>.ts\`
- \`application/listeners/<Listener>.ts\`
- \`application/notifications/<Notification>.ts\`
- \`application/services/<Service>.ts\`
- \`infrastructure/repositories/<Repository>.ts\`
- \`interface/http/controllers/<Controller>.ts\`
- \`interface/http/requests/<Request>.ts\`
- \`interface/http/resources/<Resource>.ts\`

Cross-cutting files belong under \`src/lib/shared/channels\`, \`commands\`, \`jobs\`, \`middleware\`, \`providers\`, and \`scheduler\`. Migrations and seeders belong under \`src/lib/database\`.

Do not put a pile of unrelated files directly under the module root. Keep routes thin and delegate to controllers/actions.

## Required Write Flow

For create/update/delete workflows:

1. Shared schema in \`contracts/schemas\`.
2. FormRequest in \`interface/http/requests\` imports the schema, authorizes, and returns a DTO from \`passedValidation\`.
3. DTO in \`application/dto\` is a plain typed payload.
4. Action in \`application/actions\` executes the use case.
5. Service in \`application/services\` orchestrates reusable business behavior.
6. Repository in \`infrastructure/repositories\` owns persistence queries.
7. Model in \`domain/models\` owns table mapping, casts, relationships, fillable/hidden, soft deletes, observers.
8. Resource in \`interface/http/resources\` shapes API responses.
9. Controller in \`interface/http/controllers\` accepts the request and returns Svelar responses/resources.

For page forms, the page action may call the FormRequest/action directly, but it must not become the business layer.

## Validation And Superforms

Zod schemas import from \`@beeblock/svelar/validation\`:

- \`import { z, rules } from '@beeblock/svelar/validation';\`
- \`export type CreatePostInput = z.infer<typeof createPostSchema>;\`

Valibot schemas import from \`@beeblock/svelar/validation/valibot\`:

- \`import { rules, v } from '@beeblock/svelar/validation/valibot';\`
- \`export type CreatePostInput = v.InferOutput<typeof createPostSchema>;\`

Superforms rules:

- Use the same shared schema as FormRequest.
- Render validation failures inline under every input.
- Use \`aria-invalid\` for invalid controls.
- Do not show duplicate validation toasts for ordinary field errors.
- Disable controls during pending/delayed submissions.
- Reset create forms after successful create when expected.
- Return a Svelar resource-like envelope: \`{ data, meta }\`.
- Include \`meta.form\` on success, validation failure, and service failure so enhanced forms update immediately.
- Update response/result panels from the action result, not stale cached load data.

## API Response Shape

Prefer Svelar resources:

- \`return this.ok(new PostResource(post));\`
- \`return this.created(new PostResource(post));\`
- \`return this.forbidden('You do not have permission to perform this action.');\`

Use consistent envelopes with \`data\` and optional \`meta\`. Do not invent unrelated \`{ ok, status, payload }\` shapes per feature.

## Controllers And Routes

API route files should be thin and bind controllers:

- Import \`resource\` from \`@beeblock/svelar/routing\`.
- Import the controller from \`$lib/modules/<module>/interface/http/controllers/<Controller>.js\`.
- Export the HTTP handlers returned by \`resource(Controller)\`.

Controllers validate through FormRequests, call actions/services, and return resources. Do not put persistence logic directly in route files.

## Migrations, Models, Repositories, ORM

- Use \`Migration\` and the Svelar schema builder.
- Use \`.default(value)\`, not \`.defaultTo(value)\`.
- Use \`addColumn\` and \`dropColumn\`; do not invent \`alterTable\`.
- Models extend \`Model\`.
- Use \`fillable\`, \`hidden\`, casts, relationships, timestamps, soft deletes, observers, and public ID helpers as needed.
- Repositories wrap query use cases and hide query details from services/controllers.
- Prefer \`Model.query()\` and repository methods over raw connection queries.
- Cross-driver behavior matters: SQLite, PostgreSQL, and MySQL are supported out of the box.

### Find-Or-Create Contracts

- Model-aware \`firstOrCreate\` and \`updateOrCreate\` return full Model instances, even after \`select(...)\`. Clone builders to preserve caller filters, connection, tenant scope, and soft-delete scope; do not append lookup criteria to the caller.
- Keep automatic tenant and soft-delete guards outside grouped user predicates, including OR/raw OR. Helpers also group caller predicates before adding search criteria and the row primary key, so OR cannot widen a lookup or single-record update beyond those guards.
- Delegate model writes to the full \`Model.create\` / \`fill\` / \`save\` lifecycle: respect \`fillable\`, generated IDs, timestamps, JSON casts, observers, audit, and configured Searchable synchronization. An existing \`firstOrCreate\` match is read-only.
- Seed new records only from the passed search plus create/update attributes, not inferred \`where\` defaults. Use SQL \`IS NULL\` for null search attributes and reject undefined search attributes.
- \`Model.forTenant(teamId)\` and a plain builder's \`.forTenant(teamId)\` establish real explicit tenant scopes, preserved by clone. They guard reads/writes, auto-assign the selected tenant during helper creation, and guard upsert without ambient context; conflicting tenant values are rejected. Arbitrary \`where('team_id', teamId)\` is not a creation default. Authorize \`withoutTenantScope()\` as an administrative bypass; unscoped tenant-model creation still requires an explicit tenant attribute.
- Require matching database unique constraints in migrations. Recover only a recognized unique violation from the INSERT, then re-read the winner using the same visible, filtered, scoped search. In an active PostgreSQL transaction, isolate the INSERT with a savepoint before recovery.
- Propagate unrelated storage and observer errors; do not treat lifecycle failures as duplicate-insert success or retry the whole lifecycle. If a scoped update target is missing, throw before updated/saved post-hooks, including no-dirty updates.
- These helpers are not atomic; concurrent updates to an existing record are last-writer-wins. Use database \`upsert\` or transaction/locking when atomicity is needed; \`upsert\` is eventless and does not run the full Model lifecycle.
- Tenant-scoped \`upsert\` requires the tenant column in \`conflictColumns\` and a matching composite unique constraint; ambient or explicit \`forTenant()\` scope assigns tenant values and rejects conflicts. Upsert rejects all row predicates and soft-delete scopes: consciously use \`withTrashed().upsert(...)\` for table identity, or eventful helpers for scoped row writes. PostgreSQL/SQLite guard target/excluded tenant equality; MySQL guards each assignment against any unique/PK collision. A foreign collision can throw on PostgreSQL/SQLite or no-op on MySQL; metadata is not Model success. Upsert stays eventless: supply IDs/timestamps and authorize the tenant-only \`withoutTenantScope()\` admin bypass. MySQL's empty-update self-assignment is not \`INSERT IGNORE\`; unrelated validation/storage errors propagate.
- A raw \`QueryBuilder\` without a model class is eventless and returns plain rows. Its helpers require stable unique row identity through an \`id\` column, not a custom model primary key. Both model and raw helpers require a single-table write target and reject joined, grouped/HAVING, CTE, and union queries.

${this.runtimeGuidance()}

## Auth, Policies, Permissions, Teams

- Use Svelar auth/session/API-token helpers instead of custom auth code.
- Use FormRequest \`authorize\` for request-level authorization.
- Use policies for model/resource decisions.
- Use \`Permissions\` and roles for RBAC.
- Use \`Teams\` for team-scoped membership, invitations, and resource access.
- Team RBAC uses an explicit immutable \`Permissions.forTeam(team.id)\` facade after membership authorization. Global \`Permissions\`/\`HasRoles\` checks do not inherit team grants. Use \`Permissions.global()\` for platform gates.
- Register application capabilities in code and sync them in a seeder with \`Permissions.syncCapabilities()\`; UI-created permission names alone do not create backend gates.
- Unauthorized page actions should surface a toast/alert/modal or inline message where the user can continue, not crash into a generic 500.
- API routes should return 401/403 resource responses, not unhandled exceptions.

## Events, Listeners, Observers, Cross-Module Reads

Events are for side effects. Listeners react immediately or dispatch queue jobs for slow/retryable work. Observers handle model lifecycle work. Register observers and listeners in a provider, usually \`EventServiceProvider\`.

For request/response reads across modules, do not import another module's model/repository/controller. Use a narrow public application service/query/facade from the owning module and return plain DTO/contract data. Events are not for data queries.

## Queues, Scheduler, Cache

- Use \`Queue\` and \`Job\` for background work.
- Use Redis/BullMQ for async production queues where configured.
- Use finite \`--once\` workers in tests.
- Use \`ScheduledTask\` and register tasks explicitly.
- Use fixed five-field cron and explicit \`.timezone(...)\` when host-local time is not intended. Day-of-month/day-of-week restrictions use OR; \`TaskInfo.nextRun\` can be null when unavailable.
- Use database-backed scheduler locks for no-overlap tasks.
- Run \`npm run dev:worker\` and \`npm run dev:scheduler\` when testing local runtime behavior.
- Expose queue/scheduler status through the Svelar dashboard when relevant.
- Pass the queue name to \`JobMonitor.getJob/retryJob/deleteJob\` so job IDs cannot resolve in another queue. Runtime metrics can be unknown; do not replace null with a false healthy value.
- Inspect \`ScheduleMonitor.runTask()\` results: \`skipped\` means overlap prevented execution and \`success: false\` means execution failed. An awaited promise alone is not success.
- Use callback-scoped \`fakeQueue\`, \`fakeEvents\`, \`fakeNotifications\`, \`fakeHttp\`, and \`fakeMail\` from \`@beeblock/svelar/testing\`; await all work inside the callback so interception is restored reliably.

## Shared Logs And Durable Search

- Configure the database LogViewer in the common app bootstrap and run migrations. Memory viewing is explicitly process-local; never create log tables at runtime.
- Await all viewer reads/writes. Use \`LogViewer.page({ cursor, limit, tenantId, correlationId })\` and its \`{ data, meta }\` envelope. A tenant filter is not authorization. Schedule \`LogViewer.prune()\` for retention.
- Database tails follow persisted entries across processes. Close subscriptions on disconnect, support entry-ID/Last-Event-ID replay, and report failures through a different sink.
- Search defaults to a durable outbox on the model database. Model writes and indexing intent share a transaction; queue signals occur only after commit. Existing apps register \`SearchOutboxSweep\` to recover failed dispatches and retries.
- Meilisearch outages must not make committed writes look failed. Outbox persistence failure rolls back the write. Inspect outbox stats, dead letters and replay instead of swallowing lost synchronization.
- Inline delivery is explicit \`syncDriver: 'inline'\`. Index hidden-safe serialized fields or an explicit safe \`toSearchableObject()\`; never index secrets.
- Reindex with keyset \`chunkById\`. Bulk query writes are eventless; individual Model writes provide observers/audit/outbox effects.
- \`Connection.afterCommit\` captures application context and discards rolled-back callbacks. \`AfterCommitError.committed === true\` means never blindly repeat the original write. Await database work; detached work cannot reuse ended transactions.

## Storage, Uploads, PDF, Mail, Search

- Use \`Storage\` and \`Uploads\`; do not expose internal Docker URLs such as \`http://rustfs:9000/...\` to browser users.
- Use RustFS for local S3-compatible storage. Do not add MinIO.
- Browser-facing downloads/previews should go through authorized app routes or temporary public URLs.
- PDFKit is the local default; Gotenberg tests must set \`PDF_DRIVER=gotenberg\`.
- Gotenberg webhook workflows should show visible queued/ready state in the UI and notify users when ready.
- Mail drivers include SMTP, Postmark, Resend, Mailtrap, log, and null.
- Use \`Search\` and \`Searchable\` for Meilisearch indexing and fallback search.

## Broadcasting And Realtime

- SSE and Soketi/Pusher are separate paths; test both when claiming realtime coverage.
- Soketi health pings are not enough. Prove visible cross-browser updates.
- Use channel authorization for private/presence channels.
- Browser mutations that should update other users must broadcast an event after the successful action/service commit.

## Docker And Production

- Generated Docker should use adapter-node.
- Keep separate \`app\`, \`worker\`, and \`scheduler\` services.
- Keep optional runtime adapters externalized when needed: \`bcrypt\`, \`argon2\`, \`bullmq\`, \`ioredis\`, \`meilisearch\`, \`@aws-sdk/client-s3\`, \`@aws-sdk/s3-request-presigner\`.
- For PostgreSQL production checks, use PgBouncer with prepared statements disabled and \`pg_stat_statements\` enabled.
- Generated local service ports should be non-default/randomizable because other local projects may already use common ports.

## Imports

Use \`@beeblock/svelar/<module>\` subpaths:

- \`@beeblock/svelar/orm\` for \`Model\`, \`SoftDeletes\`
- \`@beeblock/svelar/database\` for \`Migration\`
- \`@beeblock/svelar/routing\` for \`Controller\`, \`Resource\`, \`FormRequest\`
- \`@beeblock/svelar/validation\` or \`@beeblock/svelar/validation/valibot\`
- \`@beeblock/svelar/auth\`, \`hashing\`, \`cache\`, \`queue\`, \`scheduler\`, \`storage\`, \`uploads\`, \`search\`, \`pdf\`, \`broadcasting\`, \`audit\`, \`webhooks\`, \`teams\`, \`permissions\`, \`api-keys\`, \`hooks\`, \`config\`

Use \`$lib/modules/...\`, \`$lib/shared/...\`, \`$lib/database/...\`, and \`$lib/factories/...\` for app imports.

## Dogfood App Standard

A dogfood app must expose user workflows that prove Svelar features, not only service health pings.

- Start with Svelar CLI scaffolding.
- Keep a step-by-step timeline in the app docs for material work and verification.
- Use the feature being tested in a visible workflow.
- Upload tests should show browser-safe previews/downloads.
- Soketi tests should update a second browser without refresh.
- Gotenberg webhook tests should update a queue/listing screen.
- Test with real Docker services where possible: Postgres/PgBouncer, Redis/BullMQ/cache, RustFS, Gotenberg, Meilisearch, Soketi, and mail provider adapters.
- Validate browser UX: loading states, empty states, inline validation errors without duplicate toasts, toast/alert feedback, realtime updates, and no stale form state.

## Verification

- Run focused tests after changes.
- Review \`update --migrate-zod4 --dry-run\` and the separate \`update --migrate-core --dry-run\` for recognized historical scaffolds before approving edits. Exact-original backups do not replace schema review, authorization tests, browser login or a production build; never blanket-overwrite customized source to silence compiler errors.
- Verify desktop/mobile labels, inline validation without duplicate toasts, bounded page width and keyboard scrolling in both admin views. Test browser startup cleanup on failure.
- Keep ambient \`App.Locals\` declarations in \`src/svelar.d.ts\`, not a file shadowed by the \`src/app.ts\` bootstrap. Never hide missing auth checks with non-null assertions or an \`any\` index signature.
- Run \`npm run build\` before release-impacting work.
- For generated app or dogfood verification, use sibling apps under \`/Users/rzeradev/projects/beeblock/svelar-testing-area/\`.
- Test browser-visible behavior with Postgres/PgBouncer, Redis/BullMQ/cache, RustFS, Gotenberg, Meilisearch, auth/session/API tokens, policies/permissions, teams, webhooks, uploads, PDF, SSE, Soketi/Pusher realtime, logs, audit, exception handling, scheduler, CLI commands, and tinker when those features are in scope.
`;
	}

	static claudeSvelarSkill(): string {
		return this.codexSvelarSkill();
	}

	static svelarDatabaseJson(): string {
		return (
			JSON.stringify(
				{
					default: "sqlite",
					connections: {
						sqlite: {
							driver: "sqlite",
							filename: "database.db",
						},
						postgres: {
							driver: "postgres",
							host: "localhost",
							port: 5432,
							database: "svelar_db",
							user: "postgres",
							password: "secret",
						},
						mysql: {
							driver: "mysql",
							host: "localhost",
							port: 3306,
							database: "svelar_db",
							user: "root",
							password: "secret",
						},
					},
					migrations: {
						table: "migrations",
						path: "src/lib/database/migrations",
					},
				},
				null,
				2,
			) + "\n"
		);
	}

	// ─── Domain Layer ──────────────────────────────────────────

	static userModel(): string {
		return `import { Model } from '@beeblock/svelar/orm';
import { HasRoles } from '@beeblock/svelar/permissions';
import { auditable } from '@beeblock/svelar/audit';

/**
 * User model with HasRoles mixin and audit logging.
 */
export class User extends HasRoles(Model) {
  static table = 'users';
  static timestamps = true;
  static fillable = ['name', 'email', 'password', 'role'];
  static hidden = ['password'];

  declare id: number;
  declare name: string;
  declare email: string;
  declare password: string;
  declare role: string;
  declare created_at: Date;
  declare updated_at: Date;

  get isAdmin(): boolean {
    return this.role === 'admin';
  }

  posts() {
    return this.hasMany(Post, 'user_id');
  }
}

// Enable audit logging for User model (tracks create/update/delete)
auditable(User);

import { Post } from '$lib/modules/posts/Post.js';
`;
	}

	static postModel(): string {
		return `import { Model } from '@beeblock/svelar/orm';
import { auditable } from '@beeblock/svelar/audit';

export class Post extends Model {
  static table = 'posts';
  static timestamps = true;
  static fillable = ['title', 'slug', 'body', 'published', 'user_id'];

  static casts = {
    published: 'boolean' as const,
    created_at: 'date' as const,
    updated_at: 'date' as const,
  };

  declare id: number;
  declare title: string;
  declare slug: string;
  declare body: string;
  declare published: boolean;
  declare user_id: number;
  declare created_at: Date;
  declare updated_at: Date;

  author() {
    return this.belongsTo(User, 'user_id');
  }
}

// Enable audit logging for Post model (tracks create/update/delete)
auditable(Post);

import { User } from '$lib/modules/auth/User.js';
`;
	}

	static userRepository(): string {
		return `import { Repository } from '@beeblock/svelar/repositories';
import { User } from './User.js';

export class UserRepository extends Repository<User> {
  model() {
    return User;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.query().where('email', email).first();
  }

  async probe(): Promise<void> {
    await this.query().select(User.primaryKey).limit(1).get();
  }

  async findWithPosts(id: number): Promise<User | null> {
    return this.query().with('posts').find(id);
  }

  async consolePage(search: string | undefined, limit: number, offset: number): Promise<{ users: User[]; total: number }> {
    const query = this.query();
    if (search) query.whereNested((filter: any) => filter.where('name', 'like', '%' + search + '%').orWhere('email', 'like', '%' + search + '%'));
    const total = await query.clone().count();
    const users = await query.orderBy('id').limit(limit).offset(offset).get();
    return { users, total };
  }

  async lockForConsole(id: string): Promise<User | null> {
    return this.query().where('id', id).forUpdate().first();
  }
}
`;
	}

	static permissionManifest(actions: readonly string[]): string {
		const definition = {
			screens: [{ resource: 'operations', label: 'Operations', group: 'Platform', route: '/admin/dashboard', scope: 'platform' }],
			actions: actions.map((action) => ({ screen: 'operations', action, label: action.split('.').join(' ') })),
			aliases: [],
			systemProfiles: [{ name: 'platform-operator', label: 'Platform operator', scope: 'platform', defaults: 'all' }],
		};
		return `import { PermissionManifest, type PermissionManifestDefinition } from '@beeblock/svelar/permissions';

export const permissionDefinition: PermissionManifestDefinition = ${JSON.stringify(definition, null, 2)};
export const permissionManifest = new PermissionManifest(permissionDefinition);
`;
	}

	static platformIdentityService(): string {
		return `import type { CapabilityPrincipal } from '@beeblock/svelar/permissions';
import { UserRepository } from '$lib/modules/auth/UserRepository.js';

const repository = new UserRepository();

// Platform identity is checked against the current persisted account, not editable tenant roles or captured job flags.
export async function verifyPlatformOwner(principal: CapabilityPrincipal): Promise<boolean> {
  if (principal.kind !== 'user' || principal.modelType !== 'User') return false;
  const user = await repository.findById(principal.modelId);
  return user?.getAttribute('role') === 'admin';
}
`;
	}

	static roleRepository(): string {
		return `import { QueryBuilder } from '@beeblock/svelar/orm';
import type { RoleRecord } from '@beeblock/svelar/permissions';

export class RoleRepository {
  async page(search: string | undefined, limit: number, offset: number, guard: string) {
    const query = new QueryBuilder<RoleRecord>('roles').where('guard', guard);
    if (search) query.where('name', 'like', '%' + search + '%');
    const total = await query.clone().count();
    const roles = await query.orderBy('name').orderBy('id').limit(limit).offset(offset).get();
    return { roles, total };
  }
}
`;
	}

	static dashboardProvidersService(): string {
		return `import { Connection } from '@beeblock/svelar/database';
import { config } from '@beeblock/svelar/config';
import { DashboardOperationError, createConfiguredDashboardDependencyObserver, type DashboardDependencyInventory, type DashboardProviders, type DashboardAuthorizer, type DashboardProfileScope, type DashboardUserAccessInput, type DashboardUserRoleInput, type DashboardUserCapabilityInput } from '@beeblock/svelar/dashboard';
import { Permissions, PermissionProfiles, isReservedRoleName } from '@beeblock/svelar/permissions';
import { Teams } from '@beeblock/svelar/teams';
import { ApplicationContext } from '@beeblock/svelar/support';
import { UserRepository } from '$lib/modules/auth/UserRepository.js';
import { RoleRepository } from '$lib/modules/admin/RoleRepository.js';
import { permissionDefinition, permissionManifest } from '$lib/shared/permissions/manifest.js';
import { capabilityAccess, resolveCapabilityInput } from '$lib/shared/permissions/access.server.js';

const users = new UserRepository();
const roles = new RoleRepository();
const operations = {
  retryJob: 'queue.retry', deleteJob: 'queue.delete', retryJobs: 'queue.retry.batch', cleanupJobs: 'queue.cleanup', pauseQueue: 'queue.pause',
  runTask: 'scheduler.run', toggleTask: 'scheduler.toggle', users: 'users.view', resetPassword: 'users.resetPassword', deleteUser: 'users.delete',
  permissions: 'permissions.view', saveProfile: 'permissions.profile.update', deleteRole: 'permissions.delete', features: 'features.view', toggleFeature: 'features.toggle',
  userAccess: 'users.access.view', assignRole: 'users.roles.assign', detachRole: 'users.roles.detach',
  grantCapability: 'users.capabilities.grant', revokeCapability: 'users.capabilities.revoke', createRole: 'permissions.create',
} as const;

export const dashboardAuthorization: DashboardAuthorizer = async (event, operation) => {
  const input = resolveCapabilityInput(event);
  if (!input || !await capabilityAccess.can('screen.operations.view', input)) return false;
  return operation === 'view' || (operation in operations && await capabilityAccess.can('action.operations.' + operations[operation], input));
};

async function profileScope(scope: DashboardProfileScope) {
  const role = await Permissions.findRoleById(scope.roleId);
  if (!role || role.guard !== permissionManifest.guard) throw new DashboardOperationError(404, 'Role not found.');
  if (isReservedRoleName(role.name) || role.name === 'admin') throw new DashboardOperationError(403, 'This platform role is protected.');
  if (scope.scope === 'team') {
    if (!scope.teamId || !await Teams.findById(scope.teamId)) throw new DashboardOperationError(404, 'Team not found.');
    return new PermissionProfiles(permissionManifest).forTeam(scope.teamId);
  }
  if (scope.teamId !== undefined) throw new DashboardOperationError(403, 'Inconsistent permission scope.');
  return new PermissionProfiles(permissionManifest).forPlatform();
}

function roleResource(role: { id: number; name: string; guard: string; description?: string }) {
  return { id: role.id, name: role.name, guard: role.guard, label: role.description || role.name,
    protected: isReservedRoleName(role.name) || role.name === 'admin' };
}
async function assignmentScope(input: DashboardUserAccessInput, event: Parameters<DashboardAuthorizer>[0], mutation = false) {
  const user = await users.lockForConsole(input.id);
  if (!user) throw new DashboardOperationError(404, 'User not found.');
  const currentId = event.locals.user?.getAttribute?.('id') ?? event.locals.user?.id;
  const protectedUser = user.getAttribute('role') === 'admin' || String(user.getAttribute('id')) === String(currentId);
  if (mutation && protectedUser) throw new DashboardOperationError(403, 'This account is protected.');
  if (input.scope === 'team') {
    if (!input.teamId || !await Teams.isMember(input.teamId, user.getAttribute('id'))) throw new DashboardOperationError(403, 'User is not a member of this team.');
    return { user, protectedUser, assignments: Permissions.forTeam(input.teamId) };
  }
  if (input.teamId !== undefined) throw new DashboardOperationError(403, 'Inconsistent permission scope.');
  return { user, protectedUser, assignments: Permissions.global() };
}
async function roleAssignment(input: DashboardUserRoleInput, event: Parameters<DashboardAuthorizer>[0], remove: boolean) {
  await Connection.transaction(async () => {
    const { user, assignments } = await assignmentScope(input, event, true);
    const role = await Permissions.findRoleById(input.roleId);
    if (!role || role.guard !== permissionManifest.guard) throw new DashboardOperationError(404, 'Role not found.');
    if (roleResource(role).protected) throw new DashboardOperationError(403, 'This role is protected.');
    const profiles = input.scope === 'team' ? new PermissionProfiles(permissionManifest).forTeam(input.teamId!) : new PermissionProfiles(permissionManifest).forPlatform();
    if (!remove && !await profiles.get(role.id)) throw new DashboardOperationError(409, 'Configure a profile in this assignment scope first.');
    if (remove) await assignments.removeRole('User', user.getAttribute('id'), role.id);
    else await assignments.assignRole('User', user.getAttribute('id'), role.id);
  });
}
async function capabilityAssignment(input: DashboardUserCapabilityInput, event: Parameters<DashboardAuthorizer>[0], remove: boolean) {
  await Connection.transaction(async () => {
    const { user, assignments } = await assignmentScope(input, event, true);
    const permission = await Permissions.findPermission(input.capability, permissionManifest.guard);
    if (!permission) throw new DashboardOperationError(404, 'Capability not found.');
    if (!remove && permissionManifest.require(input.capability).scope !== input.scope) throw new DashboardOperationError(403, 'Capability cannot cross scopes.');
    if (remove) await assignments.revokeModelPermission('User', user.getAttribute('id'), permission.id);
    else await assignments.giveModelPermission('User', user.getAttribute('id'), permission.id);
  });
}

export function createDashboardProviders(health: DashboardDependencyInventory = {}): DashboardProviders { return {
  dependencies: createConfiguredDashboardDependencyObserver(health),
  shell: { title: config.get('app.name', process.env.APP_NAME ?? 'Svelar'), appPath: '/dashboard', logoutPath: '/api/auth/logout' },
  users: {
    async access(input, event) {
      return Connection.transaction(async () => {
        const { user, assignments, protectedUser } = await assignmentScope(input, event);
        const assigned = await assignments.getModelRoles('User', user.getAttribute('id'));
        const direct = await assignments.getModelDirectPermissions('User', user.getAttribute('id'));
        if (assigned.length > 100 || direct.length > 10000) throw new DashboardOperationError(503, 'Permission snapshot exceeds its bound.');
        return { ...input, id: String(user.getAttribute('id')), protected: protectedUser, roles: assigned.map(roleResource),
          directCapabilities: direct.filter((permission) => permission.guard === permissionManifest.guard).map((permission) => permission.name) };
      });
    },
    async assignRole(input, event) { await roleAssignment(input, event, false); },
    async detachRole(input, event) { await roleAssignment(input, event, true); },
    async grantCapability(input, event) { await capabilityAssignment(input, event, false); },
    async revokeCapability(input, event) { await capabilityAssignment(input, event, true); },
    async list(filter, event) {
      const result = await users.consolePage(filter.search, filter.limit, filter.offset);
      const currentId = event.locals.user?.getAttribute?.('id') ?? event.locals.user?.id;
      return { items: result.users.map((user) => {
        const protectedUser = user.getAttribute('role') === 'admin' || String(user.getAttribute('id')) === String(currentId);
        return { id: user.getAttribute('id'), name: user.getAttribute('name'), email: user.getAttribute('email'),
          globalRole: user.getAttribute('role') ?? null, protected: protectedUser, canDelete: !protectedUser, canResetPassword: !protectedUser };
      }), total: result.total, hasMore: filter.offset + result.users.length < result.total, scope: 'shared' };
    },
    async delete(id, event) {
      await Connection.transaction(async () => {
        const user = await users.lockForConsole(id);
        if (!user) throw new DashboardOperationError(404, 'User not found.');
        const currentId = event.locals.user?.getAttribute?.('id') ?? event.locals.user?.id;
        if (user.getAttribute('role') === 'admin' || String(user.getAttribute('id')) === String(currentId)) throw new DashboardOperationError(403, 'This account is protected.');
        await users.delete(id);
      });
    },
    async resetPassword(id, event) {
      const user = await users.findById(id);
      if (!user) throw new DashboardOperationError(404, 'User not found.');
      const currentId = event.locals.user?.getAttribute?.('id') ?? event.locals.user?.id;
      if (user.getAttribute('role') === 'admin' || String(user.getAttribute('id')) === String(currentId)) throw new DashboardOperationError(403, 'Use account recovery for this protected account.');
      if (!event.locals.auth || !await event.locals.auth.sendPasswordReset(user.getAttribute('email'))) throw new DashboardOperationError(503, 'Password recovery is unavailable.');
      return { queued: false };
    },
  },
  permissions: {
    async getRole(id) { const role = await Permissions.findRoleById(id); return role && role.guard === permissionManifest.guard ? roleResource(role) : null; },
    async createRole(input) {
      if (isReservedRoleName(input.name) || input.name === 'admin') throw new DashboardOperationError(403, 'This platform role is protected.');
      await Connection.transaction(async () => {
        const role = await Permissions.findRole(input.name, permissionManifest.guard) ?? await Permissions.createRole({ name: input.name, description: input.label, guard: permissionManifest.guard });
        const profiles = await profileScope({ roleId: role.id, scope: input.scope, teamId: input.teamId });
        if (await profiles.get(role.id)) throw new DashboardOperationError(409, 'A profile already exists in this scope.');
        await profiles.setCustom(role.id, []);
      });
      return roleResource((await Permissions.findRole(input.name, permissionManifest.guard))!);
    },
    async roles(filter) {
      const result = await roles.page(filter.search, filter.limit, filter.offset, permissionManifest.guard);
      return { items: result.roles.map((role) => ({ id: role.id, name: role.name, label: role.description || role.name, guard: role.guard,
        protected: isReservedRoleName(role.name) || role.name === 'admin' })), total: result.total, hasMore: filter.offset + result.roles.length < result.total, scope: 'shared' };
    },
    async manifest() { return permissionDefinition; },
    async profile(scope) { return (await profileScope(scope)).preview(scope.roleId); },
    async saveProfile(input) {
      const profiles = await profileScope(input);
      if (input.kind === 'system') await profiles.setSystem(input.roleId, input.systemProfile!, { exclusions: input.exclusions, inclusions: input.inclusions });
      else await profiles.setCustom(input.roleId, input.capabilities);
    },
    async deleteRole(scope) {
      const profiles = await profileScope(scope);
      const userId = ApplicationContext.get<number>('userId');
      const assignments = scope.scope === 'team' ? Permissions.forTeam(scope.teamId!) : Permissions.global();
      if (userId && (await assignments.getModelRoles('User', userId)).some((role) => role.id === scope.roleId)) throw new DashboardOperationError(403, 'Your current role assignments are protected.');
      await profiles.deleteRole(scope.roleId);
    },
  },
  features: { names: config.get<string[]>('features.operationalNames', []), scope: 'shared' },
}; }
`;
	}

	static postRepository(): string {
		return `import { Repository } from '@beeblock/svelar/repositories';
import { Post } from './Post.js';

export class PostRepository extends Repository<Post> {
  model() {
    return Post;
  }

  async findPublished(): Promise<Post[]> {
    return this.query()
      .where('published', true)
      .orderBy('created_at', 'desc')
      .get();
  }

  async findBySlug(slug: string): Promise<Post | null> {
    return this.query().where('slug', slug).first();
  }

  async findByUser(userId: number): Promise<Post[]> {
    return this.query()
      .where('user_id', userId)
      .orderBy('created_at', 'desc')
      .get();
  }
}
`;
	}

	static authService(): string {
		return `import { Service, type ServiceResult } from '@beeblock/svelar/services';
import { authFailurePresentation, type AuthManager, type AuthLoginSession, type AuthUser, type AuthFailureReason } from '@beeblock/svelar/auth';
import { config } from '@beeblock/svelar/config';
import { Hash } from '@beeblock/svelar/hashing';
import { Event } from '@beeblock/svelar/events';
import { UserRepository } from '$lib/modules/auth/UserRepository.js';
import { UserRegistered } from '$lib/modules/auth/UserRegistered.js';
import type { User } from '$lib/modules/auth/User.js';
import type { RegisterUserDto } from '$lib/modules/auth/RegisterUserDto.js';
import type { LoginDto } from '$lib/modules/auth/LoginDto.js';
import type { ForgotPasswordDto } from '$lib/modules/auth/ForgotPasswordDto.js';
import type { ResetPasswordDto } from '$lib/modules/auth/ResetPasswordDto.js';
import type { OtpSendDto } from '$lib/modules/auth/OtpSendDto.js';
import type { OtpVerifyDto } from '$lib/modules/auth/OtpVerifyDto.js';
import type { LogoutDto } from '$lib/modules/auth/LogoutDto.js';
import type { VerifyEmailDto } from '$lib/modules/auth/VerifyEmailDto.js';

export interface AuthRuntimeContext {
  auth: AuthManager;
  session: AuthLoginSession;
}

export type AuthWriteResult<T> = ServiceResult<T> & {
  reason?: AuthFailureReason;
  authenticated?: boolean;
  status?: 400 | 401 | 403 | 422 | 429 | 503;
};

export class AuthService extends Service {
  constructor(private readonly context: AuthRuntimeContext, private readonly users = new UserRepository()) { super(); }

  private denied(message: string): AuthWriteResult<never> {
    const reason = this.context.auth.failureReason() ?? 'invalid_credentials';
    return { ...this.fail(message), reason, status: authFailurePresentation(reason).status };
  }

  async register(data: RegisterUserDto): Promise<AuthWriteResult<User>> {
    if (await this.users.findByEmail(data.email)) return this.fail('Email already registered', { email: ['Email already registered'] });
    const user = await this.users.create({
      name: data.name, email: data.email, password: await Hash.make(data.password),
    });
    await Event.dispatch(new UserRegistered(user));
    if (config.get('auth.emailVerification.required', process.env.AUTH_EMAIL_VERIFICATION_REQUIRED === 'true') === true) {
      await this.context.auth.sendVerificationEmail(user);
      return { ...this.ok(user), authenticated: false, reason: 'email_unverified' };
    }
    const authenticated = !!await this.context.auth.login(user, this.context.session);
    const reason = authenticated ? undefined : this.context.auth.failureReason() ?? 'temporarily_unavailable';
    return { ...this.ok(user), authenticated, reason };
  }

  async login(data: LoginDto): Promise<AuthWriteResult<AuthUser>> {
    if (data.remember && Number(process.env.SESSION_REMEMBER_LIFETIME ?? 604800) <= 0) {
      return { ...this.fail('Persistent sign-in is unavailable.'), status: 422 };
    }
    const user = await this.context.auth.attempt({ email: data.email, password: data.password }, this.context.session, { remember: data.remember });
    return user ? this.ok(user) : this.denied('Sign-in failed.');
  }

  async logout(_data: LogoutDto): Promise<ServiceResult<void>> {
    await this.context.auth.logout(this.context.session);
    return this.ok();
  }

  async forgotPassword(data: ForgotPasswordDto): Promise<ServiceResult<void>> {
    // Do not expose whether the account exists.
    await this.context.auth.sendPasswordReset(data.email);
    return this.ok();
  }

  async resetPassword(data: ResetPasswordDto): Promise<ServiceResult<void>> {
    const success = await this.context.auth.resetPassword(data.token, data.email, data.password);
    return success ? this.ok() : this.fail('Invalid or expired reset link');
  }

  async sendOtp(data: OtpSendDto): Promise<AuthWriteResult<void>> {
    if (config.get('auth.otp.enabled', process.env.AUTH_OTP_ENABLED === 'true') !== true) {
      return { ...this.fail('Code sign-in is disabled.'), status: 403 };
    }
    await this.context.auth.sendOtp(data.email);
    return this.ok();
  }

  async verifyOtp(data: OtpVerifyDto): Promise<AuthWriteResult<AuthUser>> {
    if (config.get('auth.otp.enabled', process.env.AUTH_OTP_ENABLED === 'true') !== true) {
      return { ...this.fail('Code sign-in is disabled.'), status: 403 };
    }
    const user = await this.context.auth.attemptOtp(data.email, data.code, this.context.session);
    return user ? this.ok(user) : this.denied('Invalid or expired code');
  }

  async verifyEmail(data: VerifyEmailDto): Promise<ServiceResult<void>> {
    const success = await this.context.auth.verifyEmail(data.token, data.id);
    return success ? this.ok() : this.fail('Invalid or expired verification link');
  }
}
`;
	}

	static postService(): string {
		return `import { CrudService } from '@beeblock/svelar/services';
import type { Repository } from '@beeblock/svelar/repositories';
import { Broadcast } from '@beeblock/svelar/broadcasting';
import { Gate } from '@beeblock/svelar/auth';
import { PostRepository } from '$lib/modules/posts/PostRepository.js';
import type { Post } from '$lib/modules/posts/Post.js';
import type { User } from '$lib/modules/auth/User.js';
import type { CreatePostDto } from '$lib/modules/posts/CreatePostDto.js';
import type { UpdatePostDto } from '$lib/modules/posts/UpdatePostDto.js';
import type { DeletePostDto } from '$lib/modules/posts/DeletePostDto.js';

export class PostService extends CrudService<Post, CreatePostDto, UpdatePostDto> {
  constructor(private readonly posts = new PostRepository()) { super(); }
  protected repository(): Repository<Post> { return this.posts; }

  async findPublished(): Promise<Post[]> { return this.posts.findPublished(); }
  async findByUser(userId: number): Promise<Post[]> { return this.posts.findByUser(userId); }

  async createForUser(user: User, data: CreatePostDto): Promise<Post> {
    const post = await this.posts.create({
      title: data.title, slug: data.slug, body: data.body, published: data.published, user_id: user.id,
    });
    try {
      await Broadcast.event('post:created', { id: post.id, title: post.title, userId: user.id }).on('posts').send();
    } catch {
      // A delivery outage must not turn a persisted write into a retryable failure.
    }
    return post;
  }

  async updateForUser(user: User, data: UpdatePostDto): Promise<Post> {
    const post = await this.posts.findByIdOrFail(data.id);
    await Gate.authorize('edit-post', user, post);
    const patch: Partial<Pick<Post, 'title' | 'slug' | 'body' | 'published'>> = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.slug !== undefined) patch.slug = data.slug;
    if (data.body !== undefined) patch.body = data.body;
    if (data.published !== undefined) patch.published = data.published;
    return this.posts.update(data.id, patch);
  }

  async deleteForUser(user: User, data: DeletePostDto): Promise<void> {
    const post = await this.posts.findByIdOrFail(data.id);
    await Gate.authorize('delete-post', user, post);
    await this.posts.delete(data.id);
  }
}
`;
	}

	static authController(): string {
		return `import { Controller, FormAuthorizationError, FormValidationError, type RequestEvent } from '@beeblock/svelar/routing';
import { authFailurePresentation } from '@beeblock/svelar/auth';
import { RegisterRequest } from '$lib/modules/auth/RegisterRequest.js';
import { LoginRequest } from '$lib/modules/auth/LoginRequest.js';
import { ForgotPasswordRequest } from '$lib/modules/auth/ForgotPasswordRequest.js';
import { ResetPasswordRequest } from '$lib/modules/auth/ResetPasswordRequest.js';
import { OtpSendRequest } from '$lib/modules/auth/OtpSendRequest.js';
import { OtpVerifyRequest } from '$lib/modules/auth/OtpVerifyRequest.js';
import { LogoutRequest } from '$lib/modules/auth/LogoutRequest.js';
import { VerifyEmailRequest } from '$lib/modules/auth/VerifyEmailRequest.js';
import { RegisterUserAction } from '$lib/modules/auth/RegisterUserAction.js';
import { LoginAction } from '$lib/modules/auth/LoginAction.js';
import { LogoutAction } from '$lib/modules/auth/LogoutAction.js';
import { ForgotPasswordAction } from '$lib/modules/auth/ForgotPasswordAction.js';
import { ResetPasswordAction } from '$lib/modules/auth/ResetPasswordAction.js';
import { SendOtpAction } from '$lib/modules/auth/SendOtpAction.js';
import { VerifyOtpAction } from '$lib/modules/auth/VerifyOtpAction.js';
import { VerifyEmailAction } from '$lib/modules/auth/VerifyEmailAction.js';
import { UserResource } from '$lib/modules/auth/UserResource.js';

type AuthRequestEvent = Omit<RequestEvent, 'locals'> & { locals: App.Locals };

export class AuthController extends Controller {
  protected async handleError(error: unknown, event: RequestEvent): Promise<Response> {
    if (error instanceof FormValidationError) return this.json({ data: null, meta: { message: error.message, errors: error.errors } }, 422);
    if (error instanceof FormAuthorizationError) return this.json({ data: null, meta: { message: error.message } }, 403);
    return super.handleError(error, event);
  }

  async register(event: AuthRequestEvent) {
    const dto = await RegisterRequest.validate(event);
    const result = await new RegisterUserAction({ auth: event.locals.auth, session: event.locals.session }).run(dto);
    if (!result.success) return this.json({ data: null, meta: { message: result.error } }, 422);
    return UserResource.make(result.data!).additional({ authenticated: result.authenticated, ...(result.reason ? { reason: result.reason } : {}) }).status(201).toResponse();
  }

  async login(event: AuthRequestEvent) {
    const dto = await LoginRequest.validate(event);
    const result = await new LoginAction({ auth: event.locals.auth, session: event.locals.session }).run(dto);
    if (!result.success) {
      const failure = authFailurePresentation(result.reason ?? 'invalid_credentials');
      return this.json({ data: null, meta: { code: failure.reason, message: result.error } }, result.status ?? failure.status, { 'Cache-Control': 'no-store' });
    }
    return UserResource.make(result.data!).toResponse();
  }

  async logout(event: AuthRequestEvent) {
    const dto = await LogoutRequest.validate(event);
    await new LogoutAction({ auth: event.locals.auth, session: event.locals.session }).run(dto);
    return this.json({ data: null, meta: { message: 'Logged out successfully' } });
  }

  async me(event: AuthRequestEvent) {
    if (!event.locals.user) return this.json({ data: null, meta: { message: 'Unauthenticated' } }, 401);
    return UserResource.make(event.locals.user).toResponse();
  }

  async forgotPassword(event: AuthRequestEvent) {
    const dto = await ForgotPasswordRequest.validate(event);
    await new ForgotPasswordAction({ auth: event.locals.auth, session: event.locals.session }).run(dto);
    return this.json({ data: null, meta: { message: 'If that email exists, a reset link has been sent.' } });
  }

  async resetPassword(event: AuthRequestEvent) {
    const dto = await ResetPasswordRequest.validate(event);
    const result = await new ResetPasswordAction({ auth: event.locals.auth, session: event.locals.session }).run(dto);
    return this.json({ data: null, meta: { message: result.success ? 'Password has been reset. You can now log in.' : result.error } }, result.success ? 200 : 400);
  }

  async sendOtp(event: AuthRequestEvent) {
    const dto = await OtpSendRequest.validate(event);
    const result = await new SendOtpAction({ auth: event.locals.auth, session: event.locals.session }).run(dto);
    return this.json({ data: null, meta: { message: result.success ? 'If that email exists, a verification code has been sent.' : result.error } }, result.success ? 200 : result.status ?? 403);
  }

  async verifyOtp(event: AuthRequestEvent) {
    const dto = await OtpVerifyRequest.validate(event);
    const result = await new VerifyOtpAction({ auth: event.locals.auth, session: event.locals.session }).run(dto);
    if (!result.success) return this.json({ data: null, meta: { message: result.error, code: result.reason } }, result.status ?? 401);
    return UserResource.make(result.data!).toResponse();
  }

  async verifyEmail(event: AuthRequestEvent) {
    const dto = await VerifyEmailRequest.validate(event);
    const result = await new VerifyEmailAction({ auth: event.locals.auth, session: event.locals.session }).run(dto);
    return this.json({ data: null, meta: { message: result.success ? 'Email verified successfully' : result.error } }, result.success ? 200 : 400);
  }
}
`;
	}

	static postController(): string {
		return `import { Controller, FormAuthorizationError, FormValidationError, type RequestEvent } from '@beeblock/svelar/routing';
import { AuthorizationError } from '@beeblock/svelar/auth';
import { CreatePostRequest } from '$lib/modules/posts/CreatePostRequest.js';
import { UpdatePostRequest } from '$lib/modules/posts/UpdatePostRequest.js';
import { DeletePostRequest } from '$lib/modules/posts/DeletePostRequest.js';
import { PostService } from '$lib/modules/posts/PostService.js';
import { CreatePostAction } from '$lib/modules/posts/CreatePostAction.js';
import { UpdatePostAction } from '$lib/modules/posts/UpdatePostAction.js';
import { DeletePostAction } from '$lib/modules/posts/DeletePostAction.js';
import { PostResource } from '$lib/modules/posts/PostResource.js';
import type { User } from '$lib/modules/auth/User.js';

const postService = new PostService();
type PostRequestEvent = Omit<RequestEvent, 'locals'> & { locals: App.Locals };

export class PostController extends Controller {
  private actor(event: PostRequestEvent): User {
    if (!event.locals.user) throw new FormAuthorizationError();
    return event.locals.user;
  }

  protected async handleError(error: unknown, event: RequestEvent): Promise<Response> {
    if (error instanceof FormValidationError) return this.json({ data: null, meta: { message: error.message, errors: error.errors } }, 422);
    if (error instanceof FormAuthorizationError) return this.json({ data: null, meta: { message: error.message } }, 403);
    if (error instanceof AuthorizationError) return this.json({ data: null, meta: { message: error.message } }, error.statusCode);
    return super.handleError(error, event);
  }

  async index(event: PostRequestEvent) {
    const posts = event.url.searchParams.get('all') === 'true' && event.locals.user
      ? await postService.findAll() : await postService.findPublished();
    return PostResource.collection(posts).toResponse();
  }

  async show(event: PostRequestEvent) {
    return PostResource.make(await postService.findByIdOrFail(event.params.id)).toResponse();
  }

  async store(event: PostRequestEvent) {
    const dto = await CreatePostRequest.validate(event);
    const post = await new CreatePostAction(this.actor(event)).run(dto);
    return PostResource.make(post).status(201).toResponse();
  }

  async update(event: PostRequestEvent) {
    const dto = await UpdatePostRequest.validate(event);
    const post = await new UpdatePostAction(this.actor(event)).run(dto);
    return PostResource.make(post).toResponse();
  }

  async destroy(event: PostRequestEvent) {
    const dto = await DeletePostRequest.validate(event);
    await new DeletePostAction(this.actor(event)).run(dto);
    return this.noContent();
  }

  async mine(event: PostRequestEvent) {
    return PostResource.collection(await postService.findByUser(this.actor(event).id)).toResponse();
  }
}
`;
	}

	static adminController(): string {
		return `import { Controller } from '@beeblock/svelar/routing';
import { Gate } from '@beeblock/svelar/auth';
import { AdminService } from './AdminService.js';
import { UserResource } from '$lib/modules/auth/UserResource.js';
import { RoleResource } from './RoleResource.js';
import { PermissionResource } from './PermissionResource.js';
import { UpdateUserRoleRequest } from './UpdateUserRoleRequest.js';
import { DeleteUserRequest } from './DeleteUserRequest.js';
import { CreateRoleRequest } from './CreateRoleRequest.js';
import { DeleteRoleRequest } from './DeleteRoleRequest.js';
import { CreatePermissionRequest } from './CreatePermissionRequest.js';
import { DeletePermissionRequest } from './DeletePermissionRequest.js';
import { RolePermissionRequest } from './RolePermissionRequest.js';
import { UserRoleRequest } from './UserRoleRequest.js';
import { UserPermissionRequest } from './UserPermissionRequest.js';
import { ExportDataRequest } from './ExportDataRequest.js';

const adminService = new AdminService();

export class AdminController extends Controller {
  private async authorize(event: any) {
    if (await Gate.denies('admin-access', event.locals.user)) {
      return this.json({ message: 'Unauthorized' }, 403);
    }
    return null;
  }

  // ── Users ────────────────────────────────────────────

  async listUsers(event: any) {
    const denied = await this.authorize(event);
    if (denied) return denied;

    const users = await adminService.listUsers();
    return UserResource.collection(users).toResponse();
  }

  async updateUserRole(event: any) {
    const denied = await this.authorize(event);
    if (denied) return denied;

    const data = await UpdateUserRoleRequest.validate(event);
    const result = await adminService.updateUserRole(data.userId, data.role);
    if (!result.success) return this.json({ message: result.error }, 400);

    return UserResource.make(result.data).toResponse();
  }

  async deleteUser(event: any) {
    const denied = await this.authorize(event);
    if (denied) return denied;

    const data = await DeleteUserRequest.validate(event);
    const result = await adminService.deleteUser(data.userId, event.locals.user.id);
    if (!result.success) return this.json({ message: result.error }, 400);

    return this.json(result.data);
  }

  // ── Roles ────────────────────────────────────────────

  async createRole(event: any) {
    const denied = await this.authorize(event);
    if (denied) return denied;

    const data = await CreateRoleRequest.validate(event);
    const result = await adminService.createRole(data.name, data.guard, data.description);
    if (!result.success) return this.json({ message: result.error }, 409);

    return RoleResource.make(result.data).status(201).toResponse();
  }

  async deleteRole(event: any) {
    const denied = await this.authorize(event);
    if (denied) return denied;

    const data = await DeleteRoleRequest.validate(event);
    const result = await adminService.deleteRole(data.name, data.guard);
    return this.json(result.data);
  }

  // ── Permissions ──────────────────────────────────────

  async createPermission(event: any) {
    const denied = await this.authorize(event);
    if (denied) return denied;

    const data = await CreatePermissionRequest.validate(event);
    const result = await adminService.createPermission(data.name, data.guard, data.description);
    if (!result.success) return this.json({ message: result.error }, 409);

    return PermissionResource.make(result.data).status(201).toResponse();
  }

  async deletePermission(event: any) {
    const denied = await this.authorize(event);
    if (denied) return denied;

    const data = await DeletePermissionRequest.validate(event);
    const result = await adminService.deletePermission(data.name, data.guard);
    return this.json(result.data);
  }

  // ── Role-Permission pivots ───────────────────────────

  async attachRolePermission(event: any) {
    const denied = await this.authorize(event);
    if (denied) return denied;

    const data = await RolePermissionRequest.validate(event);
    const result = await adminService.attachRolePermission(data.roleId, data.permissionId);
    return this.json(result.data);
  }

  async detachRolePermission(event: any) {
    const denied = await this.authorize(event);
    if (denied) return denied;

    const data = await RolePermissionRequest.validate(event);
    const result = await adminService.detachRolePermission(data.roleId, data.permissionId);
    return this.json(result.data);
  }

  // ── User-Role pivots ─────────────────────────────────

  async assignUserRole(event: any) {
    const denied = await this.authorize(event);
    if (denied) return denied;

    const data = await UserRoleRequest.validate(event);
    const result = await adminService.assignUserRole(data.userId, data.roleId);
    return this.json(result.data);
  }

  async removeUserRole(event: any) {
    const denied = await this.authorize(event);
    if (denied) return denied;

    const data = await UserRoleRequest.validate(event);
    const result = await adminService.removeUserRole(data.userId, data.roleId);
    return this.json(result.data);
  }

  // ── User-Permission pivots ───────────────────────────

  async grantUserPermission(event: any) {
    const denied = await this.authorize(event);
    if (denied) return denied;

    const data = await UserPermissionRequest.validate(event);
    const result = await adminService.grantUserPermission(data.userId, data.permissionId);
    return this.json(result.data);
  }

  async revokeUserPermission(event: any) {
    const denied = await this.authorize(event);
    if (denied) return denied;

    const data = await UserPermissionRequest.validate(event);
    const result = await adminService.revokeUserPermission(data.userId, data.permissionId);
    return this.json(result.data);
  }

  // ── Export ───────────────────────────────────────────

  async exportData(event: any) {
    const denied = await this.authorize(event);
    if (denied) return denied;

    const data = await ExportDataRequest.validate(event);
    const result = await adminService.exportData(event.locals.user.id, data.format);
    return this.json(result.data);
  }
}
`;
	}

	static registerRequest(): string {
		return `import { FormRequest } from '@beeblock/svelar/routing';
import { registerSchema, type RegisterInput } from '$lib/modules/auth/schemas.js';
import { RegisterUserDto } from '$lib/modules/auth/RegisterUserDto.js';

export class RegisterRequest extends FormRequest<typeof registerSchema, RegisterUserDto> {
  rules() {
    return registerSchema;
  }

  passedValidation(data: RegisterInput): RegisterUserDto {
    return new RegisterUserDto(data);
  }
}
`;
	}

	static loginRequest(): string {
		return `import { FormRequest } from '@beeblock/svelar/routing';
import { loginSchema, type LoginInput } from '$lib/modules/auth/schemas.js';
import { LoginDto } from '$lib/modules/auth/LoginDto.js';

export class LoginRequest extends FormRequest<typeof loginSchema, LoginDto> {
  rules() {
    return loginSchema;
  }

  passedValidation(data: LoginInput): LoginDto {
    return new LoginDto(data);
  }
}
`;
	}

	static forgotPasswordRequest(): string {
		return `import { FormRequest } from '@beeblock/svelar/routing';
import { forgotPasswordSchema, type ForgotPasswordInput } from '$lib/modules/auth/schemas.js';
import { ForgotPasswordDto } from '$lib/modules/auth/ForgotPasswordDto.js';

export class ForgotPasswordRequest extends FormRequest<typeof forgotPasswordSchema, ForgotPasswordDto> {
  rules() {
    return forgotPasswordSchema;
  }

  passedValidation(data: ForgotPasswordInput): ForgotPasswordDto {
    return new ForgotPasswordDto(data);
  }
}
`;
	}

	static resetPasswordRequest(): string {
		return `import { FormRequest } from '@beeblock/svelar/routing';
import { resetPasswordSchema, type ResetPasswordInput } from '$lib/modules/auth/schemas.js';
import { ResetPasswordDto } from '$lib/modules/auth/ResetPasswordDto.js';

export class ResetPasswordRequest extends FormRequest<typeof resetPasswordSchema, ResetPasswordDto> {
  rules() {
    return resetPasswordSchema;
  }

  passedValidation(data: ResetPasswordInput): ResetPasswordDto {
    return new ResetPasswordDto(data);
  }
}
`;
	}

	static otpSendRequest(): string {
		return `import { FormRequest } from '@beeblock/svelar/routing';
import type { RequestEvent } from '@beeblock/svelar/routing';
import { config } from '@beeblock/svelar/config';
import { otpRequestSchema, type OtpRequestInput } from '$lib/modules/auth/schemas.js';
import { OtpSendDto } from '$lib/modules/auth/OtpSendDto.js';

export class OtpSendRequest extends FormRequest<typeof otpRequestSchema, OtpSendDto> {
  rules() {
    return otpRequestSchema;
  }

  authorize(_event: RequestEvent): boolean {
    return config.get('auth.otp.enabled', process.env.AUTH_OTP_ENABLED === 'true') === true;
  }

  passedValidation(data: OtpRequestInput): OtpSendDto {
    return new OtpSendDto(data);
  }
}
`;
	}

	static otpVerifyRequest(): string {
		return `import { FormRequest } from '@beeblock/svelar/routing';
import type { RequestEvent } from '@beeblock/svelar/routing';
import { config } from '@beeblock/svelar/config';
import { otpVerifySchema, type OtpVerifyInput } from '$lib/modules/auth/schemas.js';
import { OtpVerifyDto } from '$lib/modules/auth/OtpVerifyDto.js';

export class OtpVerifyRequest extends FormRequest<typeof otpVerifySchema, OtpVerifyDto> {
  rules() {
    return otpVerifySchema;
  }

  authorize(_event: RequestEvent): boolean {
    return config.get('auth.otp.enabled', process.env.AUTH_OTP_ENABLED === 'true') === true;
  }

  passedValidation(data: OtpVerifyInput): OtpVerifyDto {
    return new OtpVerifyDto(data);
  }
}
`;
	}

	static createPostRequest(): string {
		return `import { FormRequest } from '@beeblock/svelar/routing';
import type { RequestEvent } from '@beeblock/svelar/routing';
import { createPostSchema, type CreatePostInput } from '$lib/modules/posts/schemas.js';
import { CreatePostDto } from '$lib/modules/posts/CreatePostDto.js';

export class CreatePostRequest extends FormRequest<typeof createPostSchema, CreatePostDto> {
  rules() {
    return createPostSchema;
  }

  authorize(event: RequestEvent): boolean {
    return !!event.locals.user;
  }

  passedValidation(data: CreatePostInput): CreatePostDto {
    const slug = data.slug ?? data.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!slug) this.failedValidation({ slug: ['Provide a lowercase alphanumeric slug for this title.'] });
    return new CreatePostDto({ ...data, slug });
  }
}
`;
	}

	static updatePostRequest(): string {
		return `import { FormRequest } from '@beeblock/svelar/routing';
import type { RequestEvent } from '@beeblock/svelar/routing';
import { updatePostSchema, type UpdatePostInput } from '$lib/modules/posts/schemas.js';
import { UpdatePostDto } from '$lib/modules/posts/UpdatePostDto.js';

export class UpdatePostRequest extends FormRequest<typeof updatePostSchema, UpdatePostDto> {
  rules() {
    return updatePostSchema;
  }

  authorize(event: RequestEvent): boolean {
    return !!event.locals.user;
  }

  protected async parseBody(event: RequestEvent): Promise<Record<string, unknown>> {
    return { ...await super.parseBody(event), id: event.params.id };
  }

  passedValidation(data: UpdatePostInput): UpdatePostDto {
    return new UpdatePostDto(data);
  }
}
`;
	}

	static logoutRequest(): string {
		return `import { FormRequest } from '@beeblock/svelar/routing';
import { logoutSchema, type LogoutInput } from '$lib/modules/auth/schemas.js';
import { LogoutDto } from '$lib/modules/auth/LogoutDto.js';

export class LogoutRequest extends FormRequest<typeof logoutSchema, LogoutDto> {
  rules() { return logoutSchema; }
  passedValidation(data: LogoutInput): LogoutDto { return new LogoutDto(data); }
}
`;
	}

	static verifyEmailRequest(): string {
		return `import { FormRequest } from '@beeblock/svelar/routing';
import { verifyEmailSchema, type VerifyEmailInput } from '$lib/modules/auth/schemas.js';
import { VerifyEmailDto } from '$lib/modules/auth/VerifyEmailDto.js';

export class VerifyEmailRequest extends FormRequest<typeof verifyEmailSchema, VerifyEmailDto> {
  rules() { return verifyEmailSchema; }
  passedValidation(data: VerifyEmailInput): VerifyEmailDto { return new VerifyEmailDto(data); }
}
`;
	}

	static deletePostRequest(): string {
		return `import { FormRequest } from '@beeblock/svelar/routing';
import type { RequestEvent } from '@beeblock/svelar/routing';
import { deletePostSchema, type DeletePostInput } from '$lib/modules/posts/schemas.js';
import { DeletePostDto } from '$lib/modules/posts/DeletePostDto.js';

export class DeletePostRequest extends FormRequest<typeof deletePostSchema, DeletePostDto> {
  rules() { return deletePostSchema; }
  authorize(event: RequestEvent): boolean { return !!event.locals.user; }
  protected async parseBody(event: RequestEvent): Promise<Record<string, unknown>> {
    return { ...await super.parseBody(event), id: event.params.id };
  }
  passedValidation(data: DeletePostInput): DeletePostDto { return new DeletePostDto(data); }
}
`;
	}

	private static contractDto(name: string, input: string, fields: readonly string[], module: 'auth' | 'posts' = 'auth'): string {
		const shape = fields.length ? `Pick<${input}, ${fields.map((field) => `'${field}'`).join(' | ')}>` : input;
		return `import type { ${input} } from '$lib/modules/${module}/schemas.js';

export class ${name} {
${fields.map((field) => `  readonly ${field}: ${input}['${field}'];`).join('\n')}

  constructor(${fields.length ? 'input' : '_input'}: ${shape}) {
${fields.map((field) => `    this.${field} = input.${field};`).join('\n')}
  }
}
`;
	}

	static registerUserDto(): string { return NewCommandTemplates.contractDto('RegisterUserDto', 'RegisterInput', ['name', 'email', 'password']); }
	static loginDto(): string { return NewCommandTemplates.contractDto('LoginDto', 'LoginInput', ['email', 'password', 'remember']); }
	static forgotPasswordDto(): string { return NewCommandTemplates.contractDto('ForgotPasswordDto', 'ForgotPasswordInput', ['email']); }
	static resetPasswordDto(): string { return NewCommandTemplates.contractDto('ResetPasswordDto', 'ResetPasswordInput', ['token', 'email', 'password']); }
	static otpSendDto(): string { return NewCommandTemplates.contractDto('OtpSendDto', 'OtpRequestInput', ['email']); }
	static otpVerifyDto(): string { return NewCommandTemplates.contractDto('OtpVerifyDto', 'OtpVerifyInput', ['email', 'code']); }
	static logoutDto(): string { return NewCommandTemplates.contractDto('LogoutDto', 'LogoutInput', []); }
	static verifyEmailDto(): string { return NewCommandTemplates.contractDto('VerifyEmailDto', 'VerifyEmailInput', ['token', 'id']); }
	static updatePostDto(): string { return NewCommandTemplates.contractDto('UpdatePostDto', 'UpdatePostInput', ['id', 'title', 'slug', 'body', 'published'], 'posts'); }
	static deletePostDto(): string { return NewCommandTemplates.contractDto('DeletePostDto', 'DeletePostInput', ['id'], 'posts'); }

	static createPostDto(): string {
		return `import type { CreatePostInput } from '$lib/modules/posts/schemas.js';

export class CreatePostDto {
  readonly title: CreatePostInput['title'];
  readonly slug: string;
  readonly body: CreatePostInput['body'];
  readonly published: CreatePostInput['published'];
  constructor(input: CreatePostInput & { slug: string }) {
    this.title = input.title;
    this.slug = input.slug;
    this.body = input.body;
    this.published = input.published;
  }
}
`;
	}

	private static authWriteAction(name: string, dto: string, method: string): string {
		return `import { Action } from '@beeblock/svelar/actions';
import { AuthService, type AuthRuntimeContext } from '$lib/modules/auth/AuthService.js';
import type { ${dto} } from '$lib/modules/auth/${dto}.js';

type Result = Awaited<ReturnType<AuthService['${method}']>>;

export class ${name} extends Action<${dto}, Result> {
  constructor(context: AuthRuntimeContext, private readonly service = new AuthService(context)) { super(); }
  async execute(input: ${dto}): Promise<Result> {
    return this.service.${method}(input);
  }
}
`;
	}

	static registerUserAction(): string { return NewCommandTemplates.authWriteAction('RegisterUserAction', 'RegisterUserDto', 'register'); }
	static loginAction(): string { return NewCommandTemplates.authWriteAction('LoginAction', 'LoginDto', 'login'); }
	static logoutAction(): string { return NewCommandTemplates.authWriteAction('LogoutAction', 'LogoutDto', 'logout'); }
	static forgotPasswordAction(): string { return NewCommandTemplates.authWriteAction('ForgotPasswordAction', 'ForgotPasswordDto', 'forgotPassword'); }
	static resetPasswordAction(): string { return NewCommandTemplates.authWriteAction('ResetPasswordAction', 'ResetPasswordDto', 'resetPassword'); }
	static sendOtpAction(): string { return NewCommandTemplates.authWriteAction('SendOtpAction', 'OtpSendDto', 'sendOtp'); }
	static verifyOtpAction(): string { return NewCommandTemplates.authWriteAction('VerifyOtpAction', 'OtpVerifyDto', 'verifyOtp'); }
	static verifyEmailAction(): string { return NewCommandTemplates.authWriteAction('VerifyEmailAction', 'VerifyEmailDto', 'verifyEmail'); }

	private static postWriteAction(name: string, dto: string, method: string): string {
		return `import { Action } from '@beeblock/svelar/actions';
import { PostService } from '$lib/modules/posts/PostService.js';
import type { User } from '$lib/modules/auth/User.js';
import type { ${dto} } from '$lib/modules/posts/${dto}.js';

type Result = Awaited<ReturnType<PostService['${method}']>>;

export class ${name} extends Action<${dto}, Result> {
  constructor(private readonly user: User, private readonly service = new PostService()) { super(); }
  async execute(input: ${dto}): Promise<Result> {
    return this.service.${method}(this.user, input);
  }
}
`;
	}

	static createPostAction(): string { return NewCommandTemplates.postWriteAction('CreatePostAction', 'CreatePostDto', 'createForUser'); }
	static updatePostAction(): string { return NewCommandTemplates.postWriteAction('UpdatePostAction', 'UpdatePostDto', 'updateForUser'); }
	static deletePostAction(): string { return NewCommandTemplates.postWriteAction('DeletePostAction', 'DeletePostDto', 'deleteForUser'); }

	static userResource(): string {
		return `import { Resource } from '@beeblock/svelar/routing';
import type { UserResponse } from './schemas.js';

export class UserResource extends Resource {
  toJSON(): UserResponse {
    return {
      id: this.data.id,
      name: this.data.name,
      email: this.data.email,
      role: this.data.role ?? 'user',
      created_at: this.data.created_at ?? null,
    };
  }
}
`;
	}

	static postResource(): string {
		return `import { Resource } from '@beeblock/svelar/routing';
import type { PostResponse } from './schemas.js';

export class PostResource extends Resource {
  toJSON(): PostResponse {
    return {
      id: this.data.id,
      title: this.data.title,
      slug: this.data.slug,
      body: this.data.body,
      published: !!this.data.published,
      user_id: this.data.user_id,
      created_at: this.data.created_at ?? null,
      updated_at: this.data.updated_at ?? null,
    };
  }
}
`;
	}

	static adminSchema(validation: ValidationProvider = 'zod'): string {
		if (validation === 'valibot') {
			return `import * as v from 'valibot';

const positiveInteger = () => v.pipe(
  v.unknown(),
  v.transform((input) => Number(input)),
  v.number(),
  v.integer(),
  v.minValue(1)
);

const optionalTrimmedString = (max?: number) =>
  max
    ? v.optional(v.pipe(v.string(), v.trim(), v.maxLength(max)), '')
    : v.optional(v.pipe(v.string(), v.trim()), '');

export const updateUserRoleSchema = v.object({
  userId: positiveInteger(),
  role: v.picklist(['user', 'admin']),
});

export const deleteUserSchema = v.object({
  userId: positiveInteger(),
});

export const createRoleSchema = v.object({
  name: v.pipe(v.string(), v.trim(), v.minLength(2, 'Role name must be at least 2 characters'), v.maxLength(50)),
  guard: optionalTrimmedString(),
  description: optionalTrimmedString(255),
});

export const deleteRoleSchema = v.object({
  name: v.pipe(v.string(), v.trim(), v.minLength(1)),
  guard: optionalTrimmedString(),
});

export const createPermissionSchema = v.object({
  name: v.pipe(v.string(), v.trim(), v.minLength(2, 'Permission name must be at least 2 characters'), v.maxLength(50)),
  guard: optionalTrimmedString(),
  description: optionalTrimmedString(255),
});

export const deletePermissionSchema = v.object({
  name: v.pipe(v.string(), v.trim(), v.minLength(1)),
  guard: optionalTrimmedString(),
});

export const rolePermissionSchema = v.object({
  roleId: positiveInteger(),
  permissionId: positiveInteger(),
});

export const userRoleSchema = v.object({
  userId: positiveInteger(),
  roleId: positiveInteger(),
});

export const userPermissionSchema = v.object({
  userId: positiveInteger(),
  permissionId: positiveInteger(),
});

export const exportDataSchema = v.object({
  format: v.optional(v.picklist(['csv', 'json']), 'csv'),
});

// ── Inferred Types ───────────────────────────────────────

export type UpdateUserRoleInput = v.InferOutput<typeof updateUserRoleSchema>;
export type DeleteUserInput = v.InferOutput<typeof deleteUserSchema>;
export type CreateRoleInput = v.InferOutput<typeof createRoleSchema>;
export type DeleteRoleInput = v.InferOutput<typeof deleteRoleSchema>;
export type CreatePermissionInput = v.InferOutput<typeof createPermissionSchema>;
export type DeletePermissionInput = v.InferOutput<typeof deletePermissionSchema>;
export type RolePermissionInput = v.InferOutput<typeof rolePermissionSchema>;
export type UserRoleInput = v.InferOutput<typeof userRoleSchema>;
export type UserPermissionInput = v.InferOutput<typeof userPermissionSchema>;
export type ExportDataInput = v.InferOutput<typeof exportDataSchema>;

// ── Response Schemas ─────────────────────────────────────

export const roleResponseSchema = v.object({
  id: v.number(),
  name: v.string(),
  guard: v.string(),
  description: v.nullable(v.string()),
});

export const permissionResponseSchema = v.object({
  id: v.number(),
  name: v.string(),
  guard: v.string(),
  description: v.nullable(v.string()),
});

export type RoleResponse = v.InferOutput<typeof roleResponseSchema>;
export type PermissionResponse = v.InferOutput<typeof permissionResponseSchema>;
`;
		}

		return "import { z } from '@beeblock/svelar/validation';\n\nexport const updateUserRoleSchema = z.object({\n  userId: z.coerce.number().int().positive(),\n  role: z.enum(['user', 'admin']),\n});\n\nexport const deleteUserSchema = z.object({\n  userId: z.coerce.number().int().positive(),\n});\n\nexport const createRoleSchema = z.object({\n  name: z.string().trim().min(2, 'Role name must be at least 2 characters').max(50),\n  guard: z.string().trim().optional().or(z.literal('')),\n  description: z.string().trim().max(255).optional().or(z.literal('')),\n});\n\nexport const deleteRoleSchema = z.object({\n  name: z.string().trim().min(1),\n  guard: z.string().trim().optional().or(z.literal('')),\n});\n\nexport const createPermissionSchema = z.object({\n  name: z.string().trim().min(2, 'Permission name must be at least 2 characters').max(50),\n  guard: z.string().trim().optional().or(z.literal('')),\n  description: z.string().trim().max(255).optional().or(z.literal('')),\n});\n\nexport const deletePermissionSchema = z.object({\n  name: z.string().trim().min(1),\n  guard: z.string().trim().optional().or(z.literal('')),\n});\n\nexport const rolePermissionSchema = z.object({\n  roleId: z.coerce.number().int().positive(),\n  permissionId: z.coerce.number().int().positive(),\n});\n\nexport const userRoleSchema = z.object({\n  userId: z.coerce.number().int().positive(),\n  roleId: z.coerce.number().int().positive(),\n});\n\nexport const userPermissionSchema = z.object({\n  userId: z.coerce.number().int().positive(),\n  permissionId: z.coerce.number().int().positive(),\n});\n\nexport const exportDataSchema = z.object({\n  format: z.enum(['csv', 'json']).default('csv'),\n});\n\n// ── Inferred Types ───────────────────────────────────────\n\nexport type UpdateUserRoleInput = z.infer<typeof updateUserRoleSchema>;\nexport type DeleteUserInput = z.infer<typeof deleteUserSchema>;\nexport type CreateRoleInput = z.infer<typeof createRoleSchema>;\nexport type DeleteRoleInput = z.infer<typeof deleteRoleSchema>;\nexport type CreatePermissionInput = z.infer<typeof createPermissionSchema>;\nexport type DeletePermissionInput = z.infer<typeof deletePermissionSchema>;\nexport type RolePermissionInput = z.infer<typeof rolePermissionSchema>;\nexport type UserRoleInput = z.infer<typeof userRoleSchema>;\nexport type UserPermissionInput = z.infer<typeof userPermissionSchema>;\nexport type ExportDataInput = z.infer<typeof exportDataSchema>;\n\n// ── Response Schemas ─────────────────────────────────────\n\nexport const roleResponseSchema = z.object({\n  id: z.number(),\n  name: z.string(),\n  guard: z.string(),\n  description: z.string().nullable(),\n});\n\nexport const permissionResponseSchema = z.object({\n  id: z.number(),\n  name: z.string(),\n  guard: z.string(),\n  description: z.string().nullable(),\n});\n\nexport type RoleResponse = z.infer<typeof roleResponseSchema>;\nexport type PermissionResponse = z.infer<typeof permissionResponseSchema>;\n";
	}


	// ─── Admin Actions ─────────────────────────────────────

	static adminActions(): string {
		return "import { Action } from '@beeblock/svelar/actions';\nimport { AdminService } from './AdminService.js';\nimport type {\n  CreatePermissionDto,\n  CreateRoleDto,\n  DeletePermissionDto,\n  DeleteRoleDto,\n  DeleteUserDto,\n  RolePermissionDto,\n  UpdateUserRoleDto,\n  UserPermissionDto,\n  UserRoleDto,\n} from './AdminDtos.js';\n\nconst service = new AdminService();\n\nexport class UpdateUserRoleAction extends Action<UpdateUserRoleDto, unknown> {\n  async execute(dto: UpdateUserRoleDto): Promise<unknown> {\n    return service.updateUserRole(dto.userId, dto.role);\n  }\n}\n\nexport class DeleteUserAction extends Action<{ dto: DeleteUserDto; currentUserId: number }, unknown> {\n  async execute(input: { dto: DeleteUserDto; currentUserId: number }): Promise<unknown> {\n    return service.deleteUser(input.dto.userId, input.currentUserId);\n  }\n}\n\nexport class CreateRoleAction extends Action<CreateRoleDto, unknown> {\n  async execute(dto: CreateRoleDto): Promise<unknown> {\n    return service.createRole(dto.name, dto.guard, dto.description);\n  }\n}\n\nexport class DeleteRoleAction extends Action<DeleteRoleDto, unknown> {\n  async execute(dto: DeleteRoleDto): Promise<unknown> {\n    return service.deleteRole(dto.name, dto.guard);\n  }\n}\n\nexport class CreatePermissionAction extends Action<CreatePermissionDto, unknown> {\n  async execute(dto: CreatePermissionDto): Promise<unknown> {\n    return service.createPermission(dto.name, dto.guard, dto.description);\n  }\n}\n\nexport class DeletePermissionAction extends Action<DeletePermissionDto, unknown> {\n  async execute(dto: DeletePermissionDto): Promise<unknown> {\n    return service.deletePermission(dto.name, dto.guard);\n  }\n}\n\nexport class AttachRolePermissionAction extends Action<RolePermissionDto, unknown> {\n  async execute(dto: RolePermissionDto): Promise<unknown> {\n    return service.attachRolePermission(dto.roleId, dto.permissionId);\n  }\n}\n\nexport class DetachRolePermissionAction extends Action<RolePermissionDto, unknown> {\n  async execute(dto: RolePermissionDto): Promise<unknown> {\n    return service.detachRolePermission(dto.roleId, dto.permissionId);\n  }\n}\n\nexport class AssignUserRoleAction extends Action<UserRoleDto, unknown> {\n  async execute(dto: UserRoleDto): Promise<unknown> {\n    return service.assignUserRole(dto.userId, dto.roleId);\n  }\n}\n\nexport class RemoveUserRoleAction extends Action<UserRoleDto, unknown> {\n  async execute(dto: UserRoleDto): Promise<unknown> {\n    return service.removeUserRole(dto.userId, dto.roleId);\n  }\n}\n\nexport class GrantUserPermissionAction extends Action<UserPermissionDto, unknown> {\n  async execute(dto: UserPermissionDto): Promise<unknown> {\n    return service.grantUserPermission(dto.userId, dto.permissionId);\n  }\n}\n\nexport class RevokeUserPermissionAction extends Action<UserPermissionDto, unknown> {\n  async execute(dto: UserPermissionDto): Promise<unknown> {\n    return service.revokeUserPermission(dto.userId, dto.permissionId);\n  }\n}\n";
	}


	// ─── Admin DTOs ─────────────────────────────────────────

	static adminDtos(): string {
		return "import type {\n  CreatePermissionInput,\n  CreateRoleInput,\n  DeletePermissionInput,\n  DeleteRoleInput,\n  DeleteUserInput,\n  RolePermissionInput,\n  UpdateUserRoleInput,\n  UserPermissionInput,\n  UserRoleInput,\n} from './schemas.js';\n\nexport class UpdateUserRoleDto {\n  constructor(\n    public readonly userId: number,\n    public readonly role: 'user' | 'admin'\n  ) {}\n\n  static from(input: UpdateUserRoleInput): UpdateUserRoleDto {\n    return new UpdateUserRoleDto(input.userId, input.role);\n  }\n}\n\nexport class DeleteUserDto {\n  constructor(public readonly userId: number) {}\n\n  static from(input: DeleteUserInput): DeleteUserDto {\n    return new DeleteUserDto(input.userId);\n  }\n}\n\nexport class CreateRoleDto {\n  constructor(\n    public readonly name: string,\n    public readonly guard: string | undefined,\n    public readonly description: string | undefined\n  ) {}\n\n  static from(input: CreateRoleInput): CreateRoleDto {\n    return new CreateRoleDto(input.name, input.guard || undefined, input.description || undefined);\n  }\n}\n\nexport class DeleteRoleDto {\n  constructor(\n    public readonly name: string,\n    public readonly guard: string | undefined\n  ) {}\n\n  static from(input: DeleteRoleInput): DeleteRoleDto {\n    return new DeleteRoleDto(input.name, input.guard || undefined);\n  }\n}\n\nexport class CreatePermissionDto {\n  constructor(\n    public readonly name: string,\n    public readonly guard: string | undefined,\n    public readonly description: string | undefined\n  ) {}\n\n  static from(input: CreatePermissionInput): CreatePermissionDto {\n    return new CreatePermissionDto(input.name, input.guard || undefined, input.description || undefined);\n  }\n}\n\nexport class DeletePermissionDto {\n  constructor(\n    public readonly name: string,\n    public readonly guard: string | undefined\n  ) {}\n\n  static from(input: DeletePermissionInput): DeletePermissionDto {\n    return new DeletePermissionDto(input.name, input.guard || undefined);\n  }\n}\n\nexport class RolePermissionDto {\n  constructor(\n    public readonly roleId: number,\n    public readonly permissionId: number\n  ) {}\n\n  static from(input: RolePermissionInput): RolePermissionDto {\n    return new RolePermissionDto(input.roleId, input.permissionId);\n  }\n}\n\nexport class UserRoleDto {\n  constructor(\n    public readonly userId: number,\n    public readonly roleId: number\n  ) {}\n\n  static from(input: UserRoleInput): UserRoleDto {\n    return new UserRoleDto(input.userId, input.roleId);\n  }\n}\n\nexport class UserPermissionDto {\n  constructor(\n    public readonly userId: number,\n    public readonly permissionId: number\n  ) {}\n\n  static from(input: UserPermissionInput): UserPermissionDto {\n    return new UserPermissionDto(input.userId, input.permissionId);\n  }\n}\n";
	}


	// ─── Admin Requests ─────────────────────────────────────

	static updateUserRoleRequest(): string {
		return "import { FormRequest } from '@beeblock/svelar/forms';\nimport { UpdateUserRoleDto } from './AdminDtos.js';\nimport { updateUserRoleSchema } from './schemas.js';\n\nexport class UpdateUserRoleRequest extends FormRequest {\n  rules() {\n    return updateUserRoleSchema;\n  }\n\n  authorize(event: any): boolean {\n    return event.locals.user?.role === 'admin';\n  }\n\n  passedValidation(data: any): UpdateUserRoleDto {\n    return UpdateUserRoleDto.from(data);\n  }\n}\n";
	}


	static deleteUserRequest(): string {
		return "import { FormRequest } from '@beeblock/svelar/forms';\nimport { DeleteUserDto } from './AdminDtos.js';\nimport { deleteUserSchema } from './schemas.js';\n\nexport class DeleteUserRequest extends FormRequest {\n  rules() {\n    return deleteUserSchema;\n  }\n\n  authorize(event: any): boolean {\n    return event.locals.user?.role === 'admin';\n  }\n\n  passedValidation(data: any): DeleteUserDto {\n    return DeleteUserDto.from(data);\n  }\n}\n";
	}


	static createRoleRequest(): string {
		return "import { FormRequest } from '@beeblock/svelar/forms';\nimport { CreateRoleDto } from './AdminDtos.js';\nimport { createRoleSchema } from './schemas.js';\n\nexport class CreateRoleRequest extends FormRequest {\n  rules() {\n    return createRoleSchema;\n  }\n\n  authorize(event: any): boolean {\n    return event.locals.user?.role === 'admin';\n  }\n\n  passedValidation(data: any): CreateRoleDto {\n    return CreateRoleDto.from(data);\n  }\n}\n";
	}


	static deleteRoleRequest(): string {
		return "import { FormRequest } from '@beeblock/svelar/forms';\nimport { DeleteRoleDto } from './AdminDtos.js';\nimport { deleteRoleSchema } from './schemas.js';\n\nexport class DeleteRoleRequest extends FormRequest {\n  rules() {\n    return deleteRoleSchema;\n  }\n\n  authorize(event: any): boolean {\n    return event.locals.user?.role === 'admin';\n  }\n\n  passedValidation(data: any): DeleteRoleDto {\n    return DeleteRoleDto.from(data);\n  }\n}\n";
	}


	static createPermissionRequest(): string {
		return "import { FormRequest } from '@beeblock/svelar/forms';\nimport { CreatePermissionDto } from './AdminDtos.js';\nimport { createPermissionSchema } from './schemas.js';\n\nexport class CreatePermissionRequest extends FormRequest {\n  rules() {\n    return createPermissionSchema;\n  }\n\n  authorize(event: any): boolean {\n    return event.locals.user?.role === 'admin';\n  }\n\n  passedValidation(data: any): CreatePermissionDto {\n    return CreatePermissionDto.from(data);\n  }\n}\n";
	}


	static deletePermissionRequest(): string {
		return "import { FormRequest } from '@beeblock/svelar/forms';\nimport { DeletePermissionDto } from './AdminDtos.js';\nimport { deletePermissionSchema } from './schemas.js';\n\nexport class DeletePermissionRequest extends FormRequest {\n  rules() {\n    return deletePermissionSchema;\n  }\n\n  authorize(event: any): boolean {\n    return event.locals.user?.role === 'admin';\n  }\n\n  passedValidation(data: any): DeletePermissionDto {\n    return DeletePermissionDto.from(data);\n  }\n}\n";
	}


	static rolePermissionRequest(): string {
		return "import { FormRequest } from '@beeblock/svelar/forms';\nimport { RolePermissionDto } from './AdminDtos.js';\nimport { rolePermissionSchema } from './schemas.js';\n\nexport class RolePermissionRequest extends FormRequest {\n  rules() {\n    return rolePermissionSchema;\n  }\n\n  authorize(event: any): boolean {\n    return event.locals.user?.role === 'admin';\n  }\n\n  passedValidation(data: any): RolePermissionDto {\n    return RolePermissionDto.from(data);\n  }\n}\n";
	}


	static userRoleRequest(): string {
		return "import { FormRequest } from '@beeblock/svelar/forms';\nimport { UserRoleDto } from './AdminDtos.js';\nimport { userRoleSchema } from './schemas.js';\n\nexport class UserRoleRequest extends FormRequest {\n  rules() {\n    return userRoleSchema;\n  }\n\n  authorize(event: any): boolean {\n    return event.locals.user?.role === 'admin';\n  }\n\n  passedValidation(data: any): UserRoleDto {\n    return UserRoleDto.from(data);\n  }\n}\n";
	}


	static userPermissionRequest(): string {
		return "import { FormRequest } from '@beeblock/svelar/forms';\nimport { UserPermissionDto } from './AdminDtos.js';\nimport { userPermissionSchema } from './schemas.js';\n\nexport class UserPermissionRequest extends FormRequest {\n  rules() {\n    return userPermissionSchema;\n  }\n\n  authorize(event: any): boolean {\n    return event.locals.user?.role === 'admin';\n  }\n\n  passedValidation(data: any): UserPermissionDto {\n    return UserPermissionDto.from(data);\n  }\n}\n";
	}


	static exportDataRequest(): string {
		return `import { FormRequest } from '@beeblock/svelar/forms';
import { exportDataSchema } from './schemas.js';

export class ExportDataRequest extends FormRequest<typeof exportDataSchema> {
  rules() {
    return exportDataSchema;
  }

  authorize(event: any): boolean {
    return event.locals.user?.role === 'admin';
  }
}
`;
	}

	// ─── Admin Resources ─────────────────────────────────────

	static roleResource(): string {
		return `import { Resource } from '@beeblock/svelar/routing';
import type { RoleResponse } from './schemas.js';

export class RoleResource extends Resource {
  toJSON(): RoleResponse {
    return {
      id: this.data.id,
      name: this.data.name,
      guard: this.data.guard ?? 'web',
      description: this.data.description ?? null,
    };
  }
}
`;
	}

	static permissionResource(): string {
		return `import { Resource } from '@beeblock/svelar/routing';
import type { PermissionResponse } from './schemas.js';

export class PermissionResource extends Resource {
  toJSON(): PermissionResponse {
    return {
      id: this.data.id,
      name: this.data.name,
      guard: this.data.guard ?? 'web',
      description: this.data.description ?? null,
    };
  }
}
`;
	}

	// ─── Admin Service ───────────────────────────────────────

	static adminService(): string {
		return `import { Service } from '@beeblock/svelar/services';
import { Permissions } from '@beeblock/svelar/permissions';
import { Queue } from '@beeblock/svelar/queue';
import { UserRepository } from '$lib/modules/auth/UserRepository.js';
import { Post } from '$lib/modules/posts/Post.js';
import { User } from '$lib/modules/auth/User.js';
import { ExportDataJob } from '$lib/shared/jobs/ExportDataJob.js';

const userRepo = new UserRepository();

export class AdminService extends Service {
  // ── Users ────────────────────────────────────────

  async listUsers() {
    return User.query().get();
  }

  async updateUserRole(userId: number, role: string) {
    const user = await User.find(userId);
    if (!user) return this.fail('User not found');

    user.role = role;
    await user.save();
    return this.ok(user);
  }

  async deleteUser(userId: number, currentUserId: number) {
    if (userId === currentUserId) {
      return this.fail('Cannot delete your own account');
    }

    const user = await User.find(userId);
    if (!user) return this.fail('User not found');

    if (user.role === 'admin') {
      const adminCount = await User.where('role', '=', 'admin').count();
      if (adminCount <= 1) return this.fail('Cannot delete the last admin user');
    }

    await Post.where('user_id', '=', userId).delete();
    await user.delete();
    return this.ok({ message: 'User deleted successfully' });
  }

  // ── Roles ────────────────────────────────────────

  async createRole(name: string, guard?: string, description?: string) {
    const existing = await Permissions.findRole(name, guard);
    if (existing) return this.fail('Role already exists');

    const role = await Permissions.createRole({ name, guard, description });
    return this.ok(role);
  }

  async deleteRole(name: string, guard?: string) {
    await Permissions.deleteRole(name, guard);
    return this.ok({ message: 'Role deleted' });
  }

  // ── Permissions ──────────────────────────────────

  async createPermission(name: string, guard?: string, description?: string) {
    const existing = await Permissions.findPermission(name, guard);
    if (existing) return this.fail('Permission already exists');

    const perm = await Permissions.createPermission({ name, guard, description });
    return this.ok(perm);
  }

  async deletePermission(name: string, guard?: string) {
    await Permissions.deletePermission(name, guard);
    return this.ok({ message: 'Permission deleted' });
  }

  // ── Role-Permission pivots ───────────────────────

  async attachRolePermission(roleId: number, permissionId: number) {
    await Permissions.giveRolePermission(roleId, permissionId);
    return this.ok({ message: 'Permission attached to role' });
  }

  async detachRolePermission(roleId: number, permissionId: number) {
    await Permissions.revokeRolePermission(roleId, permissionId);
    return this.ok({ message: 'Permission detached from role' });
  }

  // ── User-Role pivots ─────────────────────────────

  async assignUserRole(userId: number, roleId: number) {
    await Permissions.assignRole('User', userId, roleId);
    return this.ok({ message: 'Role assigned to user' });
  }

  async removeUserRole(userId: number, roleId: number) {
    await Permissions.removeRole('User', userId, roleId);
    return this.ok({ message: 'Role removed from user' });
  }

  // ── User-Permission pivots ───────────────────────

  async grantUserPermission(userId: number, permissionId: number) {
    await Permissions.giveModelPermission('User', userId, permissionId);
    return this.ok({ message: 'Permission granted to user' });
  }

  async revokeUserPermission(userId: number, permissionId: number) {
    await Permissions.revokeModelPermission('User', userId, permissionId);
    return this.ok({ message: 'Permission revoked from user' });
  }

  // ── Export ───────────────────────────────────────

  async exportData(userId: number, format: 'csv' | 'json') {
    await Queue.dispatch(new ExportDataJob(userId, format));
    return this.ok({ message: \`Export job dispatched (format: \${format})\` });
  }
}
`;
	}

	static gates(): string {
		return `import { Gate } from '@beeblock/svelar/auth';

Gate.define('admin-access', (user) => user?.role === 'admin');

Gate.define('edit-post', (user, post) => {
  if (!user) return false;
  return user.id === post.user_id || user.role === 'admin';
});

Gate.define('delete-post', (user, post) => {
  if (!user) return false;
  return user.id === post.user_id || user.role === 'admin';
});

Gate.define('manage-users', (user) => user?.role === 'admin');

Gate.defineSuperUser((user) => user?.role === 'admin');
`;
	}

	static authSchema(validation: ValidationProvider = 'zod'): string {
		if (validation === 'valibot') {
			return `import { v } from '@beeblock/svelar/validation/valibot';

// ── Input Schemas (DTOs + UI validation) ─────────────────

export const loginSchema = v.object({
  email: v.pipe(v.string(), v.email('Please enter a valid email address')),
  password: v.pipe(v.string(), v.minLength(1, 'Password is required')),
  remember: v.optional(v.boolean(), false),
});

export const registerSchema = v.pipe(
  v.object({
    name: v.pipe(v.string(), v.minLength(2, 'Name must be at least 2 characters'), v.maxLength(100)),
    email: v.pipe(v.string(), v.email('Please enter a valid email address')),
    password: v.pipe(v.string(), v.minLength(8, 'Password must be at least 8 characters')),
    password_confirmation: v.string(),
  }),
  v.forward(
    v.check((data) => data.password === data.password_confirmation, 'Passwords do not match'),
    ['password_confirmation']
  )
);

export const forgotPasswordSchema = v.object({
  email: v.pipe(v.string(), v.email('Please enter a valid email address')),
});

export const resetPasswordSchema = v.pipe(
  v.object({
    token: v.pipe(v.string(), v.minLength(1, 'Reset token is required')),
    email: v.pipe(v.string(), v.email()),
    password: v.pipe(v.string(), v.minLength(8, 'Password must be at least 8 characters')),
    password_confirmation: v.string(),
  }),
  v.forward(
    v.check((data) => data.password === data.password_confirmation, 'Passwords do not match'),
    ['password_confirmation']
  )
);

export const otpRequestSchema = v.object({
  email: v.pipe(v.string(), v.email('Please enter a valid email address')),
});

export const otpVerifySchema = v.object({
  email: v.pipe(v.string(), v.email()),
  code: v.pipe(v.string(), v.regex(/^[0-9]{6}$/, 'Code must be 6 digits')),
});

export const logoutSchema = v.object({});
export const verifyEmailSchema = v.object({
  token: v.pipe(v.string(), v.minLength(1, 'Verification token is required'), v.maxLength(1024)),
  id: v.pipe(v.string(), v.regex(/^[1-9][0-9]*$/, 'A valid user ID is required'), v.maxLength(255)),
});

// ── Inferred Types ───────────────────────────────────────

export type LoginInput = v.InferOutput<typeof loginSchema>;
export type RegisterInput = v.InferOutput<typeof registerSchema>;
export type ForgotPasswordInput = v.InferOutput<typeof forgotPasswordSchema>;
export type ResetPasswordInput = v.InferOutput<typeof resetPasswordSchema>;
export type OtpRequestInput = v.InferOutput<typeof otpRequestSchema>;
export type OtpVerifyInput = v.InferOutput<typeof otpVerifySchema>;
export type LogoutInput = v.InferOutput<typeof logoutSchema>;
export type VerifyEmailInput = v.InferOutput<typeof verifyEmailSchema>;

// ── Response Schemas (Resources + API contracts) ─────────

export const userResponseSchema = v.object({
  id: v.number(),
  name: v.string(),
  email: v.pipe(v.string(), v.email()),
  role: v.string(),
  created_at: v.nullable(v.string()),
});

export type UserResponse = v.InferOutput<typeof userResponseSchema>;
`;
		}

		return `import { z } from '@beeblock/svelar/validation';

// ── Input Schemas (DTOs + UI validation) ─────────────────

export const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
  remember: z.boolean().default(false),
});

export const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  password_confirmation: z.string(),
}).refine((data) => data.password === data.password_confirmation, {
  message: 'Passwords do not match',
  path: ['password_confirmation'],
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  password_confirmation: z.string(),
}).refine((data) => data.password === data.password_confirmation, {
  message: 'Passwords do not match',
  path: ['password_confirmation'],
});

export const otpRequestSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
});

export const otpVerifySchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^[0-9]{6}$/, 'Code must be 6 digits'),
});

export const logoutSchema = z.object({});
export const verifyEmailSchema = z.object({
  token: z.string().min(1, 'Verification token is required').max(1024),
  id: z.string().regex(/^[1-9][0-9]*$/, 'A valid user ID is required').max(255),
});

// ── Inferred Types ───────────────────────────────────────

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type OtpRequestInput = z.infer<typeof otpRequestSchema>;
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;
export type LogoutInput = z.infer<typeof logoutSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

// ── Response Schemas (Resources + API contracts) ─────────

export const userResponseSchema = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string().email(),
  role: z.string(),
  created_at: z.string().nullable(),
});

export type UserResponse = z.infer<typeof userResponseSchema>;
`;
	}

	static postSchema(validation: ValidationProvider = 'zod'): string {
		if (validation === 'valibot') {
			return `import * as v from 'valibot';

// ── Input Schemas ────────────────────────────────────────

export const createPostSchema = v.object({
  title: v.pipe(v.string(), v.minLength(3, 'Title must be at least 3 characters'), v.maxLength(255)),
  slug: v.optional(v.pipe(v.string(), v.regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with dashes'))),
  body: v.pipe(v.string(), v.minLength(10, 'Body must be at least 10 characters')),
  published: v.optional(v.boolean(), false),
});

export const updatePostSchema = v.object({
  id: v.pipe(v.string(), v.regex(/^[1-9][0-9]*$/, 'A valid post ID is required'), v.maxLength(255)),
  title: v.optional(v.pipe(v.string(), v.minLength(3), v.maxLength(255))),
  slug: v.optional(v.pipe(v.string(), v.regex(/^[a-z0-9-]+$/))),
  body: v.optional(v.pipe(v.string(), v.minLength(10))),
  published: v.optional(v.boolean()),
});

export const deletePostSchema = v.object({
  id: v.pipe(v.string(), v.regex(/^[1-9][0-9]*$/, 'A valid post ID is required'), v.maxLength(255)),
});

// ── Inferred Types ───────────────────────────────────────

export type CreatePostInput = v.InferOutput<typeof createPostSchema>;
export type UpdatePostInput = v.InferOutput<typeof updatePostSchema>;
export type DeletePostInput = v.InferOutput<typeof deletePostSchema>;

// ── Response Schema (Resources + API contracts) ──────────

export const postResponseSchema = v.object({
  id: v.number(),
  title: v.string(),
  slug: v.string(),
  body: v.string(),
  published: v.boolean(),
  user_id: v.number(),
  created_at: v.nullable(v.string()),
  updated_at: v.nullable(v.string()),
});

export type PostResponse = v.InferOutput<typeof postResponseSchema>;
`;
		}

		return `import { z } from '@beeblock/svelar/validation';

// ── Input Schemas ────────────────────────────────────────

export const createPostSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters').max(255),
  slug: z.string().regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with dashes').optional(),
  body: z.string().min(10, 'Body must be at least 10 characters'),
  published: z.boolean().default(false),
});

export const updatePostSchema = z.object({
  id: z.string().regex(/^[1-9][0-9]*$/, 'A valid post ID is required').max(255),
  title: z.string().min(3).max(255).optional(),
  slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
  body: z.string().min(10).optional(),
  published: z.boolean().optional(),
});

export const deletePostSchema = z.object({
  id: z.string().regex(/^[1-9][0-9]*$/, 'A valid post ID is required').max(255),
});

// ── Inferred Types ───────────────────────────────────────

export type CreatePostInput = z.infer<typeof createPostSchema>;
export type UpdatePostInput = z.infer<typeof updatePostSchema>;
export type DeletePostInput = z.infer<typeof deletePostSchema>;

// ── Response Schema (Resources + API contracts) ──────────

export const postResponseSchema = z.object({
  id: z.number(),
  title: z.string(),
  slug: z.string(),
  body: z.string(),
  published: z.boolean(),
  user_id: z.number(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
});

export type PostResponse = z.infer<typeof postResponseSchema>;
`;
	}

	// ─── Migrations ────────────────────────────────────────────

	static svelarCoreMigrations(): Array<{ path: string; className: string; label: string; content: string }> {
		const migrations = [
			['00000000_000001_create_sessions_table.ts', 'CreateSessionsTable', 'Sessions table'],
			['00000000_000003_create_refresh_tokens_table.ts', 'CreateRefreshTokensTable', 'Refresh tokens table'],
			['00000000_000004_create_password_resets_table.ts', 'CreatePasswordResetsTable', 'Password resets table'],
			['00000000_000005_create_email_verifications_table.ts', 'CreateEmailVerificationsTable', 'Email verifications table'],
			['00000000_000006_create_otp_codes_table.ts', 'CreateOtpCodesTable', 'OTP codes table'],
			['00000000_000007_create_api_keys_table.ts', 'CreateApiKeysTable', 'API keys table'],
			['00000000_000008_create_audit_logs_table.ts', 'CreateAuditLogsTable', 'Audit logs table'],
			['00000000_000009_create_webhooks_table.ts', 'CreateWebhooksTable', 'Webhooks table'],
			['00000000_000010_create_webhook_deliveries_table.ts', 'CreateWebhookDeliveriesTable', 'Webhook deliveries table'],
			['00000000_000011_create_svelar_uploads_table.ts', 'CreateSvelarUploadsTable', 'Uploads table'],
			['00000000_000012_create_email_templates_table.ts', 'CreateEmailTemplatesTable', 'Email templates table'],
			['00000000_000013_create_notifications_table.ts', 'CreateNotificationsTable', 'Notifications table'],
			['00000000_000014_create_teams_table.ts', 'CreateTeamsTable', 'Teams table'],
			['00000000_000015_create_team_members_table.ts', 'CreateTeamMembersTable', 'Team members table'],
			['00000000_000016_create_team_invitations_table.ts', 'CreateTeamInvitationsTable', 'Team invitations table'],
			['00000000_000017_create_feature_flags_table.ts', 'CreateFeatureFlagsTable', 'Feature flags table'],
			['00000000_000018_create_feature_flag_overrides_table.ts', 'CreateFeatureFlagOverridesTable', 'Feature flag overrides table'],
			['00000000_000019_create_permissions_table.ts', 'CreatePermissionsTable', 'Permissions table'],
			['00000000_000020_create_roles_table.ts', 'CreateRolesTable', 'Roles table'],
			['00000000_000021_create_role_has_permissions_table.ts', 'CreateRoleHasPermissionsTable', 'Role permissions table'],
			['00000000_000022_create_model_has_roles_table.ts', 'CreateModelHasRolesTable', 'Model roles table'],
			['00000000_000023_create_model_has_permissions_table.ts', 'CreateModelHasPermissionsTable', 'Model permissions table'],
			['00000000_000024_create_scheduler_locks_table.ts', 'CreateSchedulerLocksTable', 'Scheduler locks table'],
			['00000000_000025_create_scheduled_task_runs_table.ts', 'CreateScheduledTaskRunsTable', 'Scheduled task runs table'],
			['00000000_000026_create_svelar_jobs_table.ts', 'CreateSvelarJobsTable', 'Queue jobs table'],
			['00000000_000027_create_svelar_failed_jobs_table.ts', 'CreateSvelarFailedJobsTable', 'Failed jobs table'],
			['00000000_000028_create_scheduled_task_settings_table.ts', 'CreateScheduledTaskSettingsTable', 'Scheduled task settings table'],
			['00000000_000029_create_webhook_inbox_entries_table.ts', 'CreateWebhookInboxEntriesTable', 'Webhook inbox entries table'],
			['00000000_000030_add_service_account_fields_to_api_keys_table.ts', 'AddServiceAccountFieldsToApiKeysTable', 'API key service account fields'],
			['00000000_000031_create_team_role_has_permissions_table.ts', 'CreateTeamRoleHasPermissionsTable', 'Team role permissions table'],
			['00000000_000032_create_team_model_has_roles_table.ts', 'CreateTeamModelHasRolesTable', 'Team model roles table'],
			['00000000_000033_create_team_model_has_permissions_table.ts', 'CreateTeamModelHasPermissionsTable', 'Team model permissions table'],
			['00000000_000034_scope_webhook_inbox_idempotency.ts', 'ScopeWebhookInboxIdempotency', 'Tenant-scoped incoming webhook idempotency'],
			['00000000_000035_create_svelar_logs_table.ts', 'CreateSvelarLogsTable', 'Shared logs for web, workers and scheduler'],
			['00000000_000036_create_search_outbox_table.ts', 'CreateSearchOutboxTable', 'Durable search synchronization outbox'],
			['00000000_000037_add_webhook_inbox_processing.ts', 'AddWebhookInboxProcessing', 'Webhook inbox processing leases and version ordering'],
			['00000000_000038_add_queue_job_leases.ts', 'AddQueueJobLeases', 'Durable queue job leases and metadata'],
			['00000000_000039_add_failed_queue_replay.ts', 'AddFailedQueueReplay', 'Failed queue replay ownership and receipts'],
			['00000000_000040_create_role_capability_profiles_table.ts', 'CreateRoleCapabilityProfilesTable', 'Platform capability profiles'],
			['00000000_000041_create_team_role_capability_profiles_table.ts', 'CreateTeamRoleCapabilityProfilesTable', 'Team capability profiles'],
			['00000000_000043_create_queue_events_table.ts', 'CreateQueueEventsTable', 'Shared queue event timelines'],
			['00000000_000044_add_scheduler_settings_policy.ts', 'AddSchedulerSettingsPolicy', 'Persistent scheduler settings and missed-run policy'],
			['00000000_000045_add_api_key_rotation_state.ts', 'AddApiKeyRotationState', 'Atomic credential rotation overlap'],
			['00000000_000046_create_background_operations_table.ts', 'CreateBackgroundOperationsTable', 'Durable background operation progress'],
			['00000000_000047_create_scheduler_runtime_table.ts', 'CreateSchedulerRuntimeTable', 'Shared scheduler leases and health'],
			['00000000_000048_create_scheduler_requests_table.ts', 'CreateSchedulerRequestsTable', 'Durable scheduler run-now requests'],
			['00000000_000049_create_deployment_locks_table.ts', 'CreateDeploymentLocksTable', 'Exclusive deployment migration ownership'],
		] as const;

		return migrations.map(([file, className, label]) => ({
			path: `src/lib/database/migrations/${file}`,
			className,
			label,
			content: `import { ${className} as Svelar${className} } from '@beeblock/svelar/database';

export default class ${className} extends Svelar${className} {}
`,
		}));
	}

	static createUsersTable(): string {
		return `import { Migration } from '@beeblock/svelar/database';

export default class CreateUsersTable extends Migration {
  async up() {
    await this.schema.createTable('users', (table) => {
      table.id();
      table.string('name');
      table.string('email').unique();
      table.string('password');
      table.timestamp('email_verified_at').nullable();
      table.timestamp('disabled_at').nullable();
      table.timestamp('locked_until').nullable();
      table.timestamps();
    });
  }

  async down() {
    await this.schema.dropTable('users');
  }
}
`;
	}

	static createPostsTable(): string {
		return `import { Migration } from '@beeblock/svelar/database';

export default class CreatePostsTable extends Migration {
  async up() {
    await this.schema.createTable('posts', (table) => {
      table.id();
      table.string('title');
      table.string('slug').unique();
      table.text('body');
      table.boolean('published').default(false);
      table.foreignId('user_id').references('id', 'users');
      table.timestamps();
    });
  }

  async down() {
    await this.schema.dropTable('posts');
  }
}
`;
	}

	static addRoleToUsers(): string {
		return `import { Migration } from '@beeblock/svelar/database';

export default class AddRoleToUsers extends Migration {
  async up() {
    await this.schema.table('users', (table) => {
      table.string('role').default('user');
    });
  }

  async down() {
    await this.schema.table('users', (table) => {
      table.dropColumn('role');
    });
  }
}
`;
	}

	// ─── Seeders ───────────────────────────────────────────────

	static databaseSeeder(): string {
		return `import { Seeder } from '@beeblock/svelar/database';
import { Hash } from '@beeblock/svelar/hashing';
import { Permissions } from '@beeblock/svelar/permissions';
import { User } from '$lib/modules/auth/User.js';
import { Post } from '$lib/modules/posts/Post.js';
import { CapabilitySeeder } from './CapabilitySeeder.js';

export class DatabaseSeeder extends Seeder {
  async run(): Promise<void> {
    await new CapabilitySeeder().run();
    // ── Create Permissions ────────────────────────────────
    await Permissions.createPermission({ name: 'manage-users', description: 'Create, edit, delete users' });
    await Permissions.createPermission({ name: 'manage-roles', description: 'Assign and manage roles' });
    await Permissions.createPermission({ name: 'manage-posts', description: 'Edit or delete any post' });
    await Permissions.createPermission({ name: 'create-posts', description: 'Create new posts' });
    await Permissions.createPermission({ name: 'view-dashboard', description: 'Access the dashboard' });
    await Permissions.createPermission({ name: 'view-admin', description: 'Access admin panel' });

    // ── Create Roles ─────────────────────────────────────
    const adminRole = await Permissions.createRole({ name: 'admin', description: 'Full access to everything' });
    const editorRole = await Permissions.createRole({ name: 'editor', description: 'Can manage posts' });
    const userRole = await Permissions.createRole({ name: 'user', description: 'Regular user' });

    // ── Assign Permissions to Roles ──────────────────────
    const allPerms = await Permissions.allPermissions();
    for (const perm of allPerms) {
      await Permissions.giveRolePermission(adminRole.id, perm.id);
    }

    const editorPerms = ['manage-posts', 'create-posts', 'view-dashboard'];
    for (const permName of editorPerms) {
      const perm = allPerms.find((p) => p.name === permName);
      if (perm) await Permissions.giveRolePermission(editorRole.id, perm.id);
    }

    const userPerms = ['create-posts', 'view-dashboard'];
    for (const permName of userPerms) {
      const perm = allPerms.find((p) => p.name === permName);
      if (perm) await Permissions.giveRolePermission(userRole.id, perm.id);
    }

    // ── Create Admin User ────────────────────────────────
    // WARNING: Change these credentials before deploying to production!
    const adminPassword = await Hash.make('admin123');
    const admin = await User.create({
      name: 'Admin',
      email: 'admin@svelar.dev',
      password: adminPassword,
      role: 'admin',
    });
    await Permissions.assignRole('User', (admin as any).id, adminRole.id);

    // ── Create Demo User ─────────────────────────────────
    // WARNING: Remove this user before deploying to production!
    const demoPassword = await Hash.make('password');
    const demo = await User.create({
      name: 'Demo User',
      email: 'demo@svelar.dev',
      password: demoPassword,
      role: 'user',
    });
    await Permissions.assignRole('User', (demo as any).id, userRole.id);

    // ── Create Sample Posts ──────────────────────────────
    await Post.create({
      title: 'Getting Started with Svelar',
      slug: 'getting-started-with-svelar',
      body: 'Svelar brings Laravel-style conventions to SvelteKit. Models, migrations, middleware, and more.',
      published: true,
      user_id: (admin as any).id,
    });

    await Post.create({
      title: 'Eloquent-Style ORM in TypeScript',
      slug: 'eloquent-style-orm-in-typescript',
      body: 'Query your database with a fluent API: User.where("active", true).with("posts").orderBy("name").get().',
      published: true,
      user_id: (demo as any).id,
    });

    await Post.create({
      title: 'Draft Post',
      slug: 'draft-post',
      body: 'This is a draft post that is not published yet. It demonstrates the published/unpublished toggle.',
      published: false,
      user_id: (demo as any).id,
    });

    console.log('[Seeder] Database seeded successfully.');
    console.log('[Seeder] Admin: admin@svelar.dev / admin123');
    console.log('[Seeder] Demo:  demo@svelar.dev / password');
  }
}
`;
	}

	// ─── Auth Pages ────────────────────────────────────────────

	static loginPageServer(): string {
		return `import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { superValidate, message } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { ThrottleMiddleware } from '@beeblock/svelar/middleware';
import { authFailurePresentation } from '@beeblock/svelar/auth';
import { loginSchema } from '$lib/modules/auth/schemas';
import { LoginRequest } from '$lib/modules/auth/LoginRequest';
import { LoginAction } from '$lib/modules/auth/LoginAction';
import { authConfig, authRedirect } from '../../app.js';

const loginRequest = new LoginRequest();
const throttle = new ThrottleMiddleware({
  maxAttempts: 5,
  decayMinutes: 1,
  prefix: 'auth-login',
  store: process.env.RATE_LIMIT_STORE === 'cache' ? 'cache' : 'memory',
  cacheStore: process.env.RATE_LIMIT_CACHE_STORE || process.env.CACHE_DRIVER,
});

function throttleContext(event: any) {
  return { event, params: event.params ?? {}, locals: event.locals ?? {} };
}

export const load: PageServerLoad = async ({ locals, url }) => {
  if (locals.user) throw redirect(302, authRedirect(url));

  const form = await superValidate(zod4(loginSchema));
  return { form, appName: authConfig.appName, otpEnabled: authConfig.otpEnabled, rememberEnabled: authConfig.rememberEnabled,
    expiredSession: url.searchParams.get('reason') === 'session-expired', emailUnverified: url.searchParams.get('reason') === 'email-unverified',
    passwordReset: url.searchParams.get('reset') === 'success' };
};

export const actions: Actions = {
  default: async (event) => {
    const { request, locals } = event;
    const form = await superValidate(request, zod4(loginSchema));
    const input = { ...form.data };
    form.data.password = '';
    if (!await loginRequest.authorize(event)) {
      return message(form, 'Sign-in is not permitted.', { status: 403 });
    }
    const ctx = throttleContext(event);
    const block = await throttle.check(ctx);
    if (block.blocked) {
      return message(form, 'Too many attempts. Please try again later.', { status: 429 });
    }

    if (!form.valid) {
      await throttle.hit(ctx);
      return fail(400, { form });
    }

    const dto = loginRequest.passedValidation(input);
    if (dto.remember && !authConfig.rememberEnabled) return message(form, 'Persistent sign-in is unavailable.', { status: 422 });
    const result = await new LoginAction({ auth: locals.auth, session: locals.session }).run(dto);

    if (!result.success) {
      await throttle.hit(ctx);
      const reason = result.reason ?? 'invalid_credentials';
      const failure = authFailurePresentation(reason);
      const messages = {
        invalid_credentials: 'Invalid email or password.', session_expired: 'Your session expired. Sign in again.',
        account_disabled: 'This account is disabled.', account_locked: 'This account is temporarily locked.',
        email_unverified: 'Verify your email before signing in.', temporarily_unavailable: 'Sign-in is temporarily unavailable. Please retry.',
        rate_limited: 'Too many attempts. Please try again later.', provider_unavailable: 'This sign-in provider is temporarily unavailable.',
      };
      return message(form, messages[reason], { status: result.status ?? failure.status });
    }

    await throttle.clear(ctx);

    throw redirect(303, authRedirect(event.url));
  },
};
`;
	}

	static loginPageSvelte(): string {
		return `<script lang="ts">
  import { authPageHref } from '$lib/shared/components/auth-links.js';
  import { superForm } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import { loginSchema } from '$lib/modules/auth/schemas';
  import { Button, Input, Label, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Alert } from '@beeblock/svelar/ui';
  import Eye from '@lucide/svelte/icons/eye';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';

  let { data } = $props();
  let showPassword = $state(false);

  // svelte-ignore state_referenced_locally
  const { form, errors, message, enhance, submitting, delayed } = superForm(data.form, {
    validators: zod4Client(loginSchema),
    onUpdated: ({ form: updated }) => {
      if (!updated.valid) {
        $form.password = '';
      }
    },
    onError: () => {
      $form.password = '';
      $message = 'Unable to submit right now. Please try again.';
    },
  });
</script>

<svelte:head>
  <title>Sign In | {data.appName}</title>
</svelte:head>

<div class="flex items-center justify-center min-h-[calc(100vh-200px)]">
  <Card class="w-full max-w-md">
    <CardHeader>
      <p class="text-sm font-medium break-words">{data.appName}</p>
      <CardTitle>Sign In</CardTitle>
      <CardDescription>Enter your credentials to access your account</CardDescription>
    </CardHeader>

    <CardContent class="space-y-4">
      {#if data.expiredSession}<Alert>Your session expired. Sign in to continue.</Alert>{/if}
      {#if data.emailUnverified}<Alert>Check your inbox and verify your email before signing in.</Alert>{/if}
      {#if data.passwordReset}
        <Alert variant="success">Your password was reset. Sign in with your new password.</Alert>
      {/if}
      {#if $message}
        <Alert variant="destructive">
          <span class="text-sm">{$message}</span>
        </Alert>
      {/if}

      <form method="POST" use:enhance novalidate class="space-y-4">
        <div class="space-y-2">
          <Label for="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autocomplete="email"
            placeholder="you@example.com"
            bind:value={$form.email}
            aria-invalid={$errors.email ? 'true' : undefined}
            disabled={$submitting}
          />
          {#if $errors.email}
            <p class="text-sm text-red-600">{$errors.email[0]}</p>
          {/if}
        </div>

        <div class="space-y-2">
          <Label for="password">Password</Label>
          <div class="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autocomplete="current-password"
            placeholder="Enter your password"
            bind:value={$form.password}
            aria-invalid={$errors.password ? 'true' : undefined}
            disabled={$submitting}
            class="pr-12"
          />
          <button type="button" class="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-sm hover:bg-muted focus-visible:outline" disabled={$submitting}
            aria-label={showPassword ? 'Hide password' : 'Show password'} title={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onclick={() => showPassword = !showPassword}>
            {#if showPassword}<EyeOff class="h-4 w-4" />{:else}<Eye class="h-4 w-4" />{/if}
          </button>
          </div>
          {#if $errors.password}
            <p class="text-sm text-red-600">{$errors.password[0]}</p>
          {/if}
        </div>

        {#if data.rememberEnabled}
          <label class="flex items-center gap-2 text-sm" for="remember"><input id="remember" name="remember" type="checkbox" bind:checked={$form.remember} disabled={$submitting} />Remember me</label>
        {/if}

        <div class="flex items-center justify-between">
          <Button type="submit" class="w-full" disabled={$submitting} aria-busy={$submitting}>
            {#if $submitting}<LoaderCircle class="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />{/if}
            {$delayed ? 'Signing in...' : 'Sign In'}
          </Button>
        </div>

        <div class="text-center">
          <a href={authPageHref('/forgot-password', data.redirectTo)} class="text-sm text-muted-foreground hover:text-brand hover:underline">Forgot your password?</a>
        </div>

        {#if data.otpEnabled}
          <div class="text-center">
            <a href={authPageHref('/otp-login', data.redirectTo)} class="text-sm text-muted-foreground hover:text-brand hover:underline">Sign in with a code instead</a>
          </div>
        {/if}
      </form>
    </CardContent>

    <CardFooter class="border-t pt-6">
      <p class="text-sm text-center w-full text-muted-foreground">
        Don't have an account?
        <a href={authPageHref('/register', data.redirectTo)} class="font-medium text-brand hover:underline">Create one</a>
      </p>
    </CardFooter>
  </Card>
</div>
`;
	}

static registerPageServer(): string {
		return `import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { superValidate, message, setError } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { ThrottleMiddleware } from '@beeblock/svelar/middleware';
import { registerSchema } from '$lib/modules/auth/schemas';
import { RegisterRequest } from '$lib/modules/auth/RegisterRequest';
import { RegisterUserAction } from '$lib/modules/auth/RegisterUserAction';
import { authConfig, authRedirect } from '../../app.js';
import { authPageHref } from '$lib/shared/components/auth-links.js';

const registerRequest = new RegisterRequest();
const throttle = new ThrottleMiddleware({
  maxAttempts: 5,
  decayMinutes: 2,
  prefix: 'auth-register',
  store: process.env.RATE_LIMIT_STORE === 'cache' ? 'cache' : 'memory',
  cacheStore: process.env.RATE_LIMIT_CACHE_STORE || process.env.CACHE_DRIVER,
});

function throttleContext(event: any) {
  return { event, params: event.params ?? {}, locals: event.locals ?? {} };
}

export const load: PageServerLoad = async ({ locals, url }) => {
  if (locals.user) throw redirect(302, authRedirect(url));

  const form = await superValidate(zod4(registerSchema));
  return { form, appName: authConfig.appName };
};

export const actions: Actions = {
  default: async (event) => {
    const { request, locals } = event;
    const form = await superValidate(request, zod4(registerSchema));
    const input = { ...form.data };
    form.data.password = '';
    form.data.password_confirmation = '';
    if (!await registerRequest.authorize(event)) {
      return message(form, 'Registration is not permitted.', { status: 403 });
    }
    const ctx = throttleContext(event);
    const block = await throttle.check(ctx);
    if (block.blocked) {
      return message(form, 'Too many attempts. Please try again later.', { status: 429 });
    }

    if (!form.valid) {
      await throttle.hit(ctx);
      return fail(400, { form });
    }

    const result = await new RegisterUserAction({ auth: locals.auth, session: locals.session }).run(registerRequest.passedValidation(input));

    if (!result.success) {
      await throttle.hit(ctx);
      return result.errors?.email ? setError(form, 'email', result.errors.email)
        : message(form, result.error || 'Registration failed', { status: 422 });
    }

    await throttle.clear(ctx);
    if (result.reason === 'email_unverified') {
      throw redirect(303, authPageHref('/login', authRedirect(event.url), { reason: 'email-unverified' }));
    }

    if (!result.authenticated) return message(form, 'Your account cannot sign in right now.', { status: 403 });

    throw redirect(303, authRedirect(event.url));
  },
};
`;
	}

	static registerPageSvelte(): string {
		return `<script lang="ts">
  import { authPageHref } from '$lib/shared/components/auth-links.js';
  import { superForm } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import { registerSchema } from '$lib/modules/auth/schemas';
  import { Button, Input, Label, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Alert } from '@beeblock/svelar/ui';

  let { data } = $props();

  // svelte-ignore state_referenced_locally
  const { form, errors, message, enhance, submitting, delayed } = superForm(data.form, {
    validators: zod4Client(registerSchema),
    onUpdated: ({ form: updated }) => {
      if (!updated.valid) {
        $form.password = '';
        $form.password_confirmation = '';
      }
    },
    onError: () => {
      $form.password = '';
      $form.password_confirmation = '';
      $message = 'Unable to submit right now. Please try again.';
    },
  });
</script>

<svelte:head>
  <title>Create Account | {data.appName}</title>
</svelte:head>

<div class="flex items-center justify-center min-h-[calc(100vh-200px)]">
  <Card class="w-full max-w-md">
    <CardHeader>
      <p class="text-sm font-medium break-words">{data.appName}</p>
      <CardTitle>Create Account</CardTitle>
      <CardDescription>Fill in the details below to get started</CardDescription>
    </CardHeader>

    <CardContent class="space-y-4">
      {#if $message}
        <Alert variant="destructive">
          <span class="text-sm">{$message}</span>
        </Alert>
      {/if}

      <form method="POST" use:enhance novalidate class="space-y-4">
        <div class="space-y-2">
          <Label for="name">Name</Label>
          <Input
            id="name"
            name="name"
            type="text"
            placeholder="Your name"
            bind:value={$form.name}
            aria-invalid={$errors.name ? 'true' : undefined}
            disabled={$submitting}
          />
          {#if $errors.name}
            <p class="text-sm text-red-600">{$errors.name[0]}</p>
          {/if}
        </div>

        <div class="space-y-2">
          <Label for="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autocomplete="email"
            placeholder="you@example.com"
            bind:value={$form.email}
            aria-invalid={$errors.email ? 'true' : undefined}
            disabled={$submitting}
          />
          {#if $errors.email}
            <p class="text-sm text-red-600">{$errors.email[0]}</p>
          {/if}
        </div>

        <div class="space-y-2">
          <Label for="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autocomplete="new-password"
            placeholder="At least 8 characters"
            bind:value={$form.password}
            aria-invalid={$errors.password ? 'true' : undefined}
            disabled={$submitting}
          />
          {#if $errors.password}
            <p class="text-sm text-red-600">{$errors.password[0]}</p>
          {/if}
        </div>

        <div class="space-y-2">
          <Label for="password_confirmation">Confirm Password</Label>
          <Input
            id="password_confirmation"
            name="password_confirmation"
            type="password"
            autocomplete="new-password"
            placeholder="Repeat your password"
            bind:value={$form.password_confirmation}
            aria-invalid={$errors.password_confirmation ? 'true' : undefined}
            disabled={$submitting}
          />
          {#if $errors.password_confirmation}
            <p class="text-sm text-red-600">{$errors.password_confirmation[0]}</p>
          {/if}
        </div>

        <Button type="submit" class="w-full" disabled={$submitting}>
          {$delayed ? 'Creating account...' : 'Create Account'}
        </Button>
      </form>
    </CardContent>

    <CardFooter class="border-t pt-6">
      <p class="text-sm text-center w-full text-muted-foreground">
        Already have an account?
        <a href={authPageHref('/login', data.redirectTo)} class="font-medium text-brand hover:underline">Sign in</a>
      </p>
    </CardFooter>
  </Card>
</div>
`;
	}

	static logoutPageServer(): string {
		return `import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types.js';
import { LogoutRequest } from '$lib/modules/auth/LogoutRequest';
import { LogoutAction } from '$lib/modules/auth/LogoutAction';

export const actions: Actions = {
  default: async (event) => {
    const dto = await LogoutRequest.validate(event);
    await new LogoutAction({ auth: event.locals.auth, session: event.locals.session }).run(dto);
    throw redirect(303, '/');
  },
};
`;
	}

	// ─── Forgot Password ────────────────────────────────────────

	static forgotPasswordPageServer(): string {
		return `import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { superValidate, message } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { ThrottleMiddleware } from '@beeblock/svelar/middleware';
import { forgotPasswordSchema } from '$lib/modules/auth/schemas';
import { ForgotPasswordRequest } from '$lib/modules/auth/ForgotPasswordRequest';
import { ForgotPasswordAction } from '$lib/modules/auth/ForgotPasswordAction';
import { authConfig } from '../../app.js';

const forgotPasswordRequest = new ForgotPasswordRequest();

const throttle = new ThrottleMiddleware({
  maxAttempts: 3,
  decayMinutes: 5,
  prefix: 'auth-forgot-password',
  store: process.env.RATE_LIMIT_STORE === 'cache' ? 'cache' : 'memory',
  cacheStore: process.env.RATE_LIMIT_CACHE_STORE || process.env.CACHE_DRIVER,
});

function throttleContext(event: any) {
  return { event, params: event.params ?? {}, locals: event.locals ?? {} };
}

export const load: PageServerLoad = async () => {
  const form = await superValidate(zod4(forgotPasswordSchema));
  return { form, appName: authConfig.appName };
};

export const actions: Actions = {
  default: async (event) => {
    const { request } = event;
    const form = await superValidate(request, zod4(forgotPasswordSchema));
    if (!await forgotPasswordRequest.authorize(event)) {
      return message(form, { kind: 'error', text: 'Password recovery is not permitted.' }, { status: 403 });
    }
    const ctx = throttleContext(event);
    const block = await throttle.check(ctx);
    if (block.blocked) {
      return message(form, { kind: 'error', text: 'Too many attempts. Please try again later.' }, { status: 429 });
    }

    if (!form.valid) {
      await throttle.hit(ctx);
      return fail(400, { form });
    }

    await throttle.hit(ctx);
    const dto = forgotPasswordRequest.passedValidation(form.data);
    await new ForgotPasswordAction({ auth: event.locals.auth, session: event.locals.session }).run(dto);

    return message(form, { kind: 'success', text: 'If that email exists, a reset link has been sent. Check your inbox.' });
  },
};
`;
	}

	static forgotPasswordPageSvelte(): string {
		return `<script lang="ts">
  import { authPageHref } from '$lib/shared/components/auth-links.js';
  import { superForm } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import { forgotPasswordSchema } from '$lib/modules/auth/schemas';
  import { Button, Input, Label, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Alert } from '@beeblock/svelar/ui';

  let { data } = $props();

  // svelte-ignore state_referenced_locally
  const { form, errors, message, enhance, submitting, delayed } = superForm(data.form, {
    validators: zod4Client(forgotPasswordSchema),
    onError: () => {
      $message = { kind: 'error', text: 'Unable to send a reset link right now. Please try again.' };
    },
  });

  let submitted = $derived($message?.kind === 'success');
</script>

<svelte:head>
  <title>Forgot Password | {data.appName}</title>
</svelte:head>

<div class="flex items-center justify-center min-h-[calc(100vh-200px)]">
  <Card class="w-full max-w-md">
    <CardHeader>
      <p class="text-sm font-medium break-words">{data.appName}</p>
      <CardTitle>Forgot Password</CardTitle>
      <CardDescription>Enter your email and we'll send you a reset link</CardDescription>
    </CardHeader>

    <CardContent class="space-y-4">
      {#if $message}
        <Alert variant={submitted ? 'success' : 'destructive'}>
          <span class="text-sm">{$message.text}</span>
        </Alert>
      {/if}

      {#if !submitted}
        <form method="POST" use:enhance novalidate class="space-y-4">
          <div class="space-y-2">
            <Label for="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autocomplete="email"
              placeholder="you@example.com"
              bind:value={$form.email}
              aria-invalid={$errors.email ? 'true' : undefined}
              disabled={$submitting}
            />
            {#if $errors.email}
              <p class="text-sm text-red-600">{$errors.email[0]}</p>
            {/if}
          </div>

          <Button type="submit" class="w-full" disabled={$submitting}>
            {$delayed ? 'Sending...' : 'Send Reset Link'}
          </Button>
        </form>
      {/if}
    </CardContent>

    <CardFooter class="border-t pt-6">
      <p class="text-sm text-center w-full text-muted-foreground">
        Remember your password?
        <a href={authPageHref('/login', data.redirectTo)} class="font-medium text-brand hover:underline">Sign in</a>
      </p>
    </CardFooter>
  </Card>
</div>
`;
	}

	// ─── Reset Password ────────────────────────────────────────

static resetPasswordPageServer(): string {
		return `import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { superValidate, message } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { ThrottleMiddleware } from '@beeblock/svelar/middleware';
import { resetPasswordSchema } from '$lib/modules/auth/schemas';
import { ResetPasswordRequest } from '$lib/modules/auth/ResetPasswordRequest';
import { ResetPasswordAction } from '$lib/modules/auth/ResetPasswordAction';
import { authConfig, authRedirect } from '../../app.js';
import { authPageHref } from '$lib/shared/components/auth-links.js';

const resetPasswordRequest = new ResetPasswordRequest();

const throttle = new ThrottleMiddleware({
  maxAttempts: 5,
  decayMinutes: 5,
  prefix: 'auth-reset-password',
  store: process.env.RATE_LIMIT_STORE === 'cache' ? 'cache' : 'memory',
  cacheStore: process.env.RATE_LIMIT_CACHE_STORE || process.env.CACHE_DRIVER,
});

function throttleContext(event: any) {
  return { event, params: event.params ?? {}, locals: event.locals ?? {} };
}

export const load: PageServerLoad = async ({ url }) => {
  const token = url.searchParams.get('token') ?? '';
  const email = url.searchParams.get('email') ?? '';

  if (!token || !email) {
    throw redirect(302, authPageHref('/forgot-password', authRedirect(url)));
  }

  const form = await superValidate({ token, email, password: '', password_confirmation: '' }, zod4(resetPasswordSchema), { errors: false });
  return { form, appName: authConfig.appName };
};

export const actions: Actions = {
  default: async (event) => {
    const { request } = event;
    const form = await superValidate(request, zod4(resetPasswordSchema));
    const input = { ...form.data };
    form.data.password = '';
    form.data.password_confirmation = '';
    if (!await resetPasswordRequest.authorize(event)) {
      return message(form, 'Password reset is not permitted.', { status: 403 });
    }
    const ctx = throttleContext(event);
    const block = await throttle.check(ctx);
    if (block.blocked) {
      return message(form, 'Too many attempts. Please try again later.', { status: 429 });
    }

    if (!form.valid) {
      await throttle.hit(ctx);
      return fail(400, { form });
    }

    const dto = resetPasswordRequest.passedValidation(input);
    const result = await new ResetPasswordAction({ auth: event.locals.auth, session: event.locals.session }).run(dto);

    if (!result.success) {
      await throttle.hit(ctx);
      return message(form, 'Invalid or expired reset link. Please request a new one.', { status: 400 });
    }

    await throttle.clear(ctx);
    throw redirect(303, authPageHref('/login', authRedirect(event.url), { reset: 'success' }));
  },
};
`;
	}

	static resetPasswordPageSvelte(): string {
		return `<script lang="ts">
  import { superForm } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import { resetPasswordSchema } from '$lib/modules/auth/schemas';
  import { Button, Input, Label, Card, CardHeader, CardTitle, CardDescription, CardContent, Alert } from '@beeblock/svelar/ui';

  let { data } = $props();

  // svelte-ignore state_referenced_locally
  const { form, errors, message, enhance, submitting, delayed } = superForm(data.form, {
    validators: zod4Client(resetPasswordSchema),
    onUpdated: ({ form: updated }) => {
      if (!updated.valid) {
        $form.password = '';
        $form.password_confirmation = '';
      }
    },
    onError: () => {
      $form.password = '';
      $form.password_confirmation = '';
      $message = 'Unable to submit right now. Please try again.';
    },
  });
</script>

<svelte:head>
  <title>Reset Password | {data.appName}</title>
</svelte:head>

<div class="flex items-center justify-center min-h-[calc(100vh-200px)]">
  <Card class="w-full max-w-md">
    <CardHeader>
      <p class="text-sm font-medium break-words">{data.appName}</p>
      <CardTitle>Reset Password</CardTitle>
      <CardDescription>Enter your new password below</CardDescription>
    </CardHeader>

    <CardContent class="space-y-4">
      {#if $message}
        <Alert variant="destructive">
          <span class="text-sm">{$message}</span>
        </Alert>
      {/if}

      <form method="POST" use:enhance novalidate class="space-y-4">
        <input type="hidden" name="token" value={$form.token} />
        <input type="hidden" name="email" value={$form.email} />

        <div class="space-y-2">
          <Label for="password">New Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autocomplete="new-password"
            placeholder="At least 8 characters"
            bind:value={$form.password}
            aria-invalid={$errors.password ? 'true' : undefined}
            disabled={$submitting}
          />
          {#if $errors.password}
            <p class="text-sm text-red-600">{$errors.password[0]}</p>
          {/if}
        </div>

        <div class="space-y-2">
          <Label for="password_confirmation">Confirm Password</Label>
          <Input
            id="password_confirmation"
            name="password_confirmation"
            type="password"
            autocomplete="new-password"
            placeholder="Repeat your password"
            bind:value={$form.password_confirmation}
            aria-invalid={$errors.password_confirmation ? 'true' : undefined}
            disabled={$submitting}
          />
          {#if $errors.password_confirmation}
            <p class="text-sm text-red-600">{$errors.password_confirmation[0]}</p>
          {/if}
        </div>

        <Button type="submit" class="w-full" disabled={$submitting}>
          {$delayed ? 'Resetting...' : 'Reset Password'}
        </Button>
      </form>
    </CardContent>
  </Card>
</div>
`;
	}

	// ─── OTP Login ─────────────────────────────────────────────

static otpLoginPageServer(): string {
		return `import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { superValidate, message } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { ThrottleMiddleware } from '@beeblock/svelar/middleware';
import { otpRequestSchema, otpVerifySchema } from '$lib/modules/auth/schemas';
import { OtpSendRequest } from '$lib/modules/auth/OtpSendRequest';
import { OtpVerifyRequest } from '$lib/modules/auth/OtpVerifyRequest';
import { SendOtpAction } from '$lib/modules/auth/SendOtpAction';
import { VerifyOtpAction } from '$lib/modules/auth/VerifyOtpAction';
import { authConfig, authRedirect } from '../../app.js';
import { authPageHref } from '$lib/shared/components/auth-links.js';

const sendRequest = new OtpSendRequest();
const verifyRequest = new OtpVerifyRequest();

const sendThrottle = new ThrottleMiddleware({
  maxAttempts: 3,
  decayMinutes: 2,
  prefix: 'auth-otp-send',
  store: process.env.RATE_LIMIT_STORE === 'cache' ? 'cache' : 'memory',
  cacheStore: process.env.RATE_LIMIT_CACHE_STORE || process.env.CACHE_DRIVER,
});
const verifyThrottle = new ThrottleMiddleware({
  maxAttempts: 5,
  decayMinutes: 5,
  prefix: 'auth-otp-verify',
  store: process.env.RATE_LIMIT_STORE === 'cache' ? 'cache' : 'memory',
  cacheStore: process.env.RATE_LIMIT_CACHE_STORE || process.env.CACHE_DRIVER,
});

function throttleContext(event: any) {
  return { event, params: event.params ?? {}, locals: event.locals ?? {} };
}

function otpFailure(form: any, text: string, status: 400 | 401 | 403 | 422 | 429 | 503, codeSent = false) {
  message(form, text, { status });
  return fail(status, { [codeSent ? 'verifyForm' : 'requestForm']: form, codeSent, email: form.data.email });
}

export const load: PageServerLoad = async ({ locals, url }) => {
  if (!authConfig.otpEnabled) throw redirect(302, authPageHref('/login', authRedirect(url)));
  if (locals.user) throw redirect(302, authRedirect(url));

  const requestForm = await superValidate(zod4(otpRequestSchema), { id: 'otp-request' });
  const verifyForm = await superValidate(zod4(otpVerifySchema), { id: 'otp-verify' });
  return { requestForm, verifyForm, appName: authConfig.appName };
};

export const actions: Actions = {
  send: async (event) => {
    const { request } = event;
    const form = await superValidate(request, zod4(otpRequestSchema), { id: 'otp-request' });
    if (!authConfig.otpEnabled || !await sendRequest.authorize(event)) {
      return otpFailure(form, 'Code sign-in is disabled.', 403);
    }
    const ctx = throttleContext(event);
    const block = await sendThrottle.check(ctx);
    if (block.blocked) {
      return otpFailure(form, 'Too many attempts. Please try again later.', 429);
    }

    if (!form.valid) {
      await sendThrottle.hit(ctx);
      return fail(400, { requestForm: form });
    }

    await sendThrottle.hit(ctx);
    const dto = sendRequest.passedValidation(form.data);
    const result = await new SendOtpAction({ auth: event.locals.auth, session: event.locals.session }).run(dto);
    if (!result.success) return otpFailure(form, result.error ?? 'Code sign-in is unavailable.', result.status ?? 503);

    const verifyForm = await superValidate({ email: dto.email }, zod4(otpVerifySchema), { id: 'otp-verify', errors: false });
    return { requestForm: form, verifyForm, codeSent: true, email: dto.email };
  },

  verify: async (event) => {
    const { request, locals } = event;
    const form = await superValidate(request, zod4(otpVerifySchema), { id: 'otp-verify' });
    const input = { ...form.data };
    form.data.code = '';
    if (!authConfig.otpEnabled || !await verifyRequest.authorize(event)) {
      return otpFailure(form, 'Code sign-in is disabled.', 403, true);
    }
    const ctx = throttleContext(event);
    const block = await verifyThrottle.check(ctx);
    if (block.blocked) {
      return otpFailure(form, 'Too many attempts. Please try again later.', 429, true);
    }

    if (!form.valid) {
      await verifyThrottle.hit(ctx);
      return fail(400, { verifyForm: form, codeSent: true, email: form.data.email });
    }

    const dto = verifyRequest.passedValidation(input);
    const result = await new VerifyOtpAction({ auth: locals.auth, session: locals.session }).run(dto);

    if (!result.success) {
      await verifyThrottle.hit(ctx);
      return otpFailure(form, result.error ?? 'Invalid or expired code. Please try again.', result.status ?? 401, true);
    }

    await verifyThrottle.clear(ctx);
    throw redirect(303, authRedirect(event.url));
  },
};
`;
	}

	static otpLoginPageSvelte(): string {
		return `<script lang="ts">
  import { authPageHref } from '$lib/shared/components/auth-links.js';
  import { superForm } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import { otpRequestSchema, otpVerifySchema } from '$lib/modules/auth/schemas';
  import { Button, Input, Label, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Alert } from '@beeblock/svelar/ui';

  let { data, form: actionData } = $props();

  // Two-step form: request code, then verify code
  // svelte-ignore state_referenced_locally
  let codeSent = $state(actionData?.codeSent ?? false);
  // svelte-ignore state_referenced_locally
  let email = $state(actionData?.email ?? '');

  // svelte-ignore state_referenced_locally
  const { form: requestForm, errors: requestErrors, enhance: requestEnhance, submitting: requestSubmitting, delayed: requestDelayed, message: requestMessage } = superForm(actionData?.requestForm ?? data.requestForm, {
    validators: zod4Client(otpRequestSchema),
    onResult: ({ result }) => {
      if (result.type === 'success' && result.data?.codeSent) {
        codeSent = true;
        email = result.data.email;
        $verifyForm.email = email;
      }
    },
    onError: () => {
      $requestMessage = 'Unable to send a code right now. Please try again.';
    },
  });

  // svelte-ignore state_referenced_locally
  const { form: verifyForm, errors: verifyErrors, enhance: verifyEnhance, submitting: verifySubmitting, delayed: verifyDelayed, message: verifyMessage } = superForm(actionData?.verifyForm ?? data.verifyForm, {
    validators: zod4Client(otpVerifySchema),
    onUpdated: ({ form: updated }) => {
      if (!updated.valid) $verifyForm.code = '';
    },
    onError: () => {
      $verifyForm.code = '';
      $verifyMessage = 'Unable to verify the code right now. Please try again.';
    },
  });
</script>

<svelte:head>
  <title>Sign In with Code | {data.appName}</title>
</svelte:head>

<div class="flex items-center justify-center min-h-[calc(100vh-200px)]">
  <Card class="w-full max-w-md">
    <CardHeader>
      <p class="text-sm font-medium break-words">{data.appName}</p>
      <CardTitle>Sign In with Code</CardTitle>
      <CardDescription>
        {#if codeSent}
          Enter the 6-digit code sent to {email}
        {:else}
          We'll send a one-time code to your email
        {/if}
      </CardDescription>
    </CardHeader>

    <CardContent class="space-y-4">
      {#if !codeSent && $requestMessage}
        <Alert variant="destructive">
          <span class="text-sm">{$requestMessage}</span>
        </Alert>
      {/if}

      {#if codeSent && $verifyMessage}
        <Alert variant="destructive">
          <span class="text-sm">{$verifyMessage}</span>
        </Alert>
      {/if}

      {#if !codeSent}
        <form method="POST" action="?/send" use:requestEnhance novalidate class="space-y-4">
          <div class="space-y-2">
            <Label for="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autocomplete="email"
              placeholder="you@example.com"
              bind:value={$requestForm.email}
              aria-invalid={$requestErrors.email ? 'true' : undefined}
              disabled={$requestSubmitting}
            />
            {#if $requestErrors.email}
              <p class="text-sm text-red-600">{$requestErrors.email[0]}</p>
            {/if}
          </div>

          <Button type="submit" class="w-full" disabled={$requestSubmitting}>
            {$requestDelayed ? 'Sending...' : 'Send Code'}
          </Button>
        </form>
      {:else}
        <form method="POST" action="?/verify" use:verifyEnhance novalidate class="space-y-4">
          <input type="hidden" name="email" value={email} />

          <div class="space-y-2">
            <Label for="code">Verification Code</Label>
            <Input
              id="code"
              name="code"
              type="text"
              inputmode="numeric"
              autocomplete="one-time-code"
              pattern="[0-9]*"
              maxlength={6}
              placeholder="000000"
              bind:value={$verifyForm.code}
              aria-invalid={$verifyErrors.code ? 'true' : undefined}
              disabled={$verifySubmitting}
              class="text-center text-2xl tracking-[0.5em] font-mono"
            />
            {#if $verifyErrors.code}
              <p class="text-sm text-red-600">{$verifyErrors.code[0]}</p>
            {/if}
          </div>

          <Button type="submit" class="w-full" disabled={$verifySubmitting}>
            {$verifyDelayed ? 'Verifying...' : 'Verify & Sign In'}
          </Button>

          <button
            type="button"
            class="w-full text-sm text-muted-foreground hover:text-brand hover:underline"
            onclick={() => { codeSent = false; email = ''; $verifyForm.code = ''; $verifyMessage = undefined; }}
          >
            Use a different email
          </button>
        </form>
      {/if}
    </CardContent>

    <CardFooter class="border-t pt-6">
      <p class="text-sm text-center w-full text-muted-foreground">
        Prefer a password?
        <a href={authPageHref('/login', data.redirectTo)} class="font-medium text-brand hover:underline">Sign in with password</a>
      </p>
    </CardFooter>
  </Card>
</div>
`;
	}

	// ─── Verify Email ──────────────────────────────────────────

	static verifyEmailPageServer(): string {
		return `import type { PageServerLoad } from './$types';
import { FormValidationError } from '@beeblock/svelar/routing';
import { VerifyEmailRequest } from '$lib/modules/auth/VerifyEmailRequest';
import { VerifyEmailAction } from '$lib/modules/auth/VerifyEmailAction';
import { authConfig } from '../../app.js';

export const load: PageServerLoad = async (event) => {
  let dto;
  try { dto = await VerifyEmailRequest.validate(event); }
  catch (error) {
    if (!(error instanceof FormValidationError)) throw error;
    return { success: false, message: 'Invalid verification link.', appName: authConfig.appName };
  }
  const result = await new VerifyEmailAction({ auth: event.locals.auth, session: event.locals.session }).run(dto);
  return { success: result.success,
    message: result.success ? 'Your email has been verified!' : 'Invalid or expired verification link. Please request a new one.',
    appName: authConfig.appName };
};
`;
	}

	static verifyEmailPageSvelte(): string {
		return `<script lang="ts">
  import { authPageHref } from '$lib/shared/components/auth-links.js';
  import { Card, CardHeader, CardTitle, CardContent, CardFooter, Alert, Button } from '@beeblock/svelar/ui';

  let { data } = $props();
</script>

<svelte:head>
  <title>Verify Email | {data.appName}</title>
</svelte:head>

<div class="flex items-center justify-center min-h-[calc(100vh-200px)]">
  <Card class="w-full max-w-md">
    <CardHeader>
      <p class="text-sm font-medium break-words">{data.appName}</p>
      <CardTitle>Email Verification</CardTitle>
    </CardHeader>

    <CardContent>
      {#if data.success}
        <Alert variant="default">
          <span class="text-sm">{data.message}</span>
        </Alert>
      {:else}
        <Alert variant="destructive">
          <span class="text-sm">{data.message}</span>
        </Alert>
      {/if}
    </CardContent>

    <CardFooter class="border-t pt-6">
      <div class="w-full text-center">
        {#if data.success}
          <a href="/dashboard">
            <Button class="w-full">Go to Dashboard</Button>
          </a>
        {:else}
          <a href={authPageHref('/login', data.redirectTo)}>
            <Button variant="outline" class="w-full">Back to Sign In</Button>
          </a>
        {/if}
      </div>
    </CardFooter>
  </Card>
</div>
`;
	}
	static apiKeySchema(validation: ValidationProvider = 'zod'): string {
		if (validation === 'valibot') {
			return "import * as v from 'valibot';\n\nexport const createApiKeySchema = v.object({\n  name: v.pipe(v.string(), v.trim(), v.minLength(2, 'Key name must be at least 2 characters'), v.maxLength(120)),\n  permissions: v.pipe(v.string(), v.trim(), v.minLength(1, 'At least one permission is required')),\n});\n\nexport const revokeApiKeySchema = v.object({\n  keyId: v.pipe(v.string(), v.trim(), v.minLength(1, 'Key is required')),\n});\n\nexport type CreateApiKeyInput = v.InferOutput<typeof createApiKeySchema>;\nexport type RevokeApiKeyInput = v.InferOutput<typeof revokeApiKeySchema>;\n";
		}

		return "import { z } from '@beeblock/svelar/validation';\n\nexport const createApiKeySchema = z.object({\n  name: z.string().trim().min(2, 'Key name must be at least 2 characters').max(120),\n  permissions: z.string().trim().min(1, 'At least one permission is required'),\n});\n\nexport const revokeApiKeySchema = z.object({\n  keyId: z.string().trim().min(1, 'Key is required'),\n});\n\nexport type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;\nexport type RevokeApiKeyInput = z.infer<typeof revokeApiKeySchema>;\n";
	}

	static apiKeyDtos(): string {
		return "import type { CreateApiKeyInput, RevokeApiKeyInput } from './api-key.schema.js';\n\nexport class CreateApiKeyDto {\n  constructor(\n    public readonly name: string,\n    public readonly permissions: string[]\n  ) {}\n\n  static from(input: CreateApiKeyInput): CreateApiKeyDto {\n    return new CreateApiKeyDto(\n      input.name,\n      input.permissions.split(',').map((permission) => permission.trim()).filter(Boolean)\n    );\n  }\n}\n\nexport class RevokeApiKeyDto {\n  constructor(public readonly keyId: string) {}\n\n  static from(input: RevokeApiKeyInput): RevokeApiKeyDto {\n    return new RevokeApiKeyDto(input.keyId);\n  }\n}\n";
	}

	static apiKeyRequests(): string {
		return "import { FormRequest } from '@beeblock/svelar/forms';\nimport { createApiKeySchema, revokeApiKeySchema } from './api-key.schema.js';\nimport { CreateApiKeyDto, RevokeApiKeyDto } from './ApiKeyDtos.js';\n\nexport class CreateApiKeyRequest extends FormRequest {\n  rules() {\n    return createApiKeySchema;\n  }\n\n  authorize(event: any): boolean {\n    return !!event.locals.user;\n  }\n\n  passedValidation(data: any): CreateApiKeyDto {\n    return CreateApiKeyDto.from(data);\n  }\n}\n\nexport class RevokeApiKeyRequest extends FormRequest {\n  rules() {\n    return revokeApiKeySchema;\n  }\n\n  authorize(event: any): boolean {\n    return !!event.locals.user;\n  }\n\n  passedValidation(data: any): RevokeApiKeyDto {\n    return RevokeApiKeyDto.from(data);\n  }\n}\n";
	}

	static apiKeyActions(): string {
		return `import { Action } from '@beeblock/svelar/actions';
import { ApiKeys, type ApiKeyRecord } from '@beeblock/svelar/api-keys';
import type { CreateApiKeyDto, RevokeApiKeyDto } from './ApiKeyDtos.js';

export class CreateApiKeyAction extends Action<{ userId: string | number; dto: CreateApiKeyDto }, { plainTextKey: string; record: ApiKeyRecord }> {
  async execute(input: { userId: string | number; dto: CreateApiKeyDto }): Promise<{ plainTextKey: string; record: ApiKeyRecord }> {
    return ApiKeys.create({
      name: input.dto.name,
      userId: input.userId,
      permissions: input.dto.permissions,
    });
  }
}

export class RevokeApiKeyAction extends Action<{ userId: string | number; dto: RevokeApiKeyDto }, boolean> {
  async execute(input: { userId: string | number; dto: RevokeApiKeyDto }): Promise<boolean> {
    return ApiKeys.revokeForUser(input.dto.keyId, input.userId);
  }
}
`;
	}

	static teamSchema(validation: ValidationProvider = 'zod'): string {
		if (validation === 'valibot') {
			return "import * as v from 'valibot';\n\nexport const inviteTeamMemberSchema = v.object({\n  teamId: v.pipe(v.string(), v.trim(), v.minLength(1, 'Team is required')),\n  email: v.pipe(v.string(), v.trim(), v.email('Enter a valid email address')),\n  role: v.optional(v.picklist(['member', 'admin']), 'member'),\n});\n\nexport const updateTeamSchema = v.object({\n  teamId: v.pipe(v.string(), v.trim(), v.minLength(1, 'Team is required')),\n  name: v.pipe(v.string(), v.trim(), v.minLength(2, 'Team name must be at least 2 characters'), v.maxLength(120)),\n});\n\nexport const updateTeamMemberRoleSchema = v.object({\n  teamId: v.pipe(v.string(), v.trim(), v.minLength(1, 'Team is required')),\n  userId: v.pipe(v.string(), v.trim(), v.minLength(1, 'User is required')),\n  role: v.picklist(['member', 'admin']),\n});\n\nexport const removeTeamMemberSchema = v.object({\n  teamId: v.pipe(v.string(), v.trim(), v.minLength(1, 'Team is required')),\n  userId: v.pipe(v.string(), v.trim(), v.minLength(1, 'User is required')),\n});\n\nexport const cancelTeamInvitationSchema = v.object({\n  invitationId: v.pipe(v.string(), v.trim(), v.minLength(1, 'Invitation is required')),\n});\n\nexport type InviteTeamMemberInput = v.InferOutput<typeof inviteTeamMemberSchema>;\nexport type UpdateTeamInput = v.InferOutput<typeof updateTeamSchema>;\nexport type UpdateTeamMemberRoleInput = v.InferOutput<typeof updateTeamMemberRoleSchema>;\nexport type RemoveTeamMemberInput = v.InferOutput<typeof removeTeamMemberSchema>;\nexport type CancelTeamInvitationInput = v.InferOutput<typeof cancelTeamInvitationSchema>;\n";
		}

		return "import { z } from '@beeblock/svelar/validation';\n\nexport const inviteTeamMemberSchema = z.object({\n  teamId: z.string().trim().min(1, 'Team is required'),\n  email: z.string().trim().email('Enter a valid email address'),\n  role: z.enum(['member', 'admin']).default('member'),\n});\n\nexport const updateTeamSchema = z.object({\n  teamId: z.string().trim().min(1, 'Team is required'),\n  name: z.string().trim().min(2, 'Team name must be at least 2 characters').max(120),\n});\n\nexport const updateTeamMemberRoleSchema = z.object({\n  teamId: z.string().trim().min(1, 'Team is required'),\n  userId: z.string().trim().min(1, 'User is required'),\n  role: z.enum(['member', 'admin']),\n});\n\nexport const removeTeamMemberSchema = z.object({\n  teamId: z.string().trim().min(1, 'Team is required'),\n  userId: z.string().trim().min(1, 'User is required'),\n});\n\nexport const cancelTeamInvitationSchema = z.object({\n  invitationId: z.string().trim().min(1, 'Invitation is required'),\n});\n\nexport type InviteTeamMemberInput = z.infer<typeof inviteTeamMemberSchema>;\nexport type UpdateTeamInput = z.infer<typeof updateTeamSchema>;\nexport type UpdateTeamMemberRoleInput = z.infer<typeof updateTeamMemberRoleSchema>;\nexport type RemoveTeamMemberInput = z.infer<typeof removeTeamMemberSchema>;\nexport type CancelTeamInvitationInput = z.infer<typeof cancelTeamInvitationSchema>;\n";
	}

	static teamDtos(): string {
		return "import type {\n  CancelTeamInvitationInput,\n  InviteTeamMemberInput,\n  RemoveTeamMemberInput,\n  UpdateTeamInput,\n  UpdateTeamMemberRoleInput,\n} from './team.schema.js';\n\nexport class InviteTeamMemberDto {\n  constructor(\n    public readonly teamId: string,\n    public readonly email: string,\n    public readonly role: 'member' | 'admin'\n  ) {}\n\n  static from(input: InviteTeamMemberInput): InviteTeamMemberDto {\n    return new InviteTeamMemberDto(input.teamId, input.email, input.role);\n  }\n}\n\nexport class UpdateTeamDto {\n  constructor(\n    public readonly teamId: string,\n    public readonly name: string\n  ) {}\n\n  static from(input: UpdateTeamInput): UpdateTeamDto {\n    return new UpdateTeamDto(input.teamId, input.name);\n  }\n}\n\nexport class UpdateTeamMemberRoleDto {\n  constructor(\n    public readonly teamId: string,\n    public readonly userId: string,\n    public readonly role: 'member' | 'admin'\n  ) {}\n\n  static from(input: UpdateTeamMemberRoleInput): UpdateTeamMemberRoleDto {\n    return new UpdateTeamMemberRoleDto(input.teamId, input.userId, input.role);\n  }\n}\n\nexport class RemoveTeamMemberDto {\n  constructor(\n    public readonly teamId: string,\n    public readonly userId: string\n  ) {}\n\n  static from(input: RemoveTeamMemberInput): RemoveTeamMemberDto {\n    return new RemoveTeamMemberDto(input.teamId, input.userId);\n  }\n}\n\nexport class CancelTeamInvitationDto {\n  constructor(public readonly invitationId: string) {}\n\n  static from(input: CancelTeamInvitationInput): CancelTeamInvitationDto {\n    return new CancelTeamInvitationDto(input.invitationId);\n  }\n}\n";
	}

	static teamRequests(): string {
		return "import { FormRequest } from '@beeblock/svelar/forms';\nimport {\n  cancelTeamInvitationSchema,\n  inviteTeamMemberSchema,\n  removeTeamMemberSchema,\n  updateTeamMemberRoleSchema,\n  updateTeamSchema,\n} from './team.schema.js';\nimport {\n  CancelTeamInvitationDto,\n  InviteTeamMemberDto,\n  RemoveTeamMemberDto,\n  UpdateTeamDto,\n  UpdateTeamMemberRoleDto,\n} from './TeamDtos.js';\n\nfunction ownsRequest(event: any): boolean {\n  return !!event.locals.user;\n}\n\nexport class InviteTeamMemberRequest extends FormRequest {\n  rules() {\n    return inviteTeamMemberSchema;\n  }\n\n  authorize(event: any): boolean {\n    return ownsRequest(event);\n  }\n\n  passedValidation(data: any): InviteTeamMemberDto {\n    return InviteTeamMemberDto.from(data);\n  }\n}\n\nexport class UpdateTeamRequest extends FormRequest {\n  rules() {\n    return updateTeamSchema;\n  }\n\n  authorize(event: any): boolean {\n    return ownsRequest(event);\n  }\n\n  passedValidation(data: any): UpdateTeamDto {\n    return UpdateTeamDto.from(data);\n  }\n}\n\nexport class UpdateTeamMemberRoleRequest extends FormRequest {\n  rules() {\n    return updateTeamMemberRoleSchema;\n  }\n\n  authorize(event: any): boolean {\n    return ownsRequest(event);\n  }\n\n  passedValidation(data: any): UpdateTeamMemberRoleDto {\n    return UpdateTeamMemberRoleDto.from(data);\n  }\n}\n\nexport class RemoveTeamMemberRequest extends FormRequest {\n  rules() {\n    return removeTeamMemberSchema;\n  }\n\n  authorize(event: any): boolean {\n    return ownsRequest(event);\n  }\n\n  passedValidation(data: any): RemoveTeamMemberDto {\n    return RemoveTeamMemberDto.from(data);\n  }\n}\n\nexport class CancelTeamInvitationRequest extends FormRequest {\n  rules() {\n    return cancelTeamInvitationSchema;\n  }\n\n  authorize(event: any): boolean {\n    return ownsRequest(event);\n  }\n\n  passedValidation(data: any): CancelTeamInvitationDto {\n    return CancelTeamInvitationDto.from(data);\n  }\n}\n";
	}

	static teamActions(): string {
		return "import { Action } from '@beeblock/svelar/actions';\nimport { Teams } from '@beeblock/svelar/teams';\nimport type {\n  CancelTeamInvitationDto,\n  InviteTeamMemberDto,\n  RemoveTeamMemberDto,\n  UpdateTeamDto,\n  UpdateTeamMemberRoleDto,\n} from './TeamDtos.js';\n\nexport class InviteTeamMemberAction extends Action<InviteTeamMemberDto, void> {\n  async execute(dto: InviteTeamMemberDto): Promise<void> {\n    await Teams.invite(dto.teamId, dto.email, dto.role);\n  }\n}\n\nexport class UpdateTeamAction extends Action<UpdateTeamDto, void> {\n  async execute(dto: UpdateTeamDto): Promise<void> {\n    await Teams.update(dto.teamId, { name: dto.name });\n  }\n}\n\nexport class UpdateTeamMemberRoleAction extends Action<UpdateTeamMemberRoleDto, void> {\n  async execute(dto: UpdateTeamMemberRoleDto): Promise<void> {\n    await Teams.updateMemberRole(dto.teamId, dto.userId, dto.role);\n  }\n}\n\nexport class RemoveTeamMemberAction extends Action<RemoveTeamMemberDto, void> {\n  async execute(dto: RemoveTeamMemberDto): Promise<void> {\n    await Teams.removeMember(dto.teamId, dto.userId);\n  }\n}\n\nexport class CancelTeamInvitationAction extends Action<CancelTeamInvitationDto, void> {\n  async execute(dto: CancelTeamInvitationDto): Promise<void> {\n    await Teams.cancelInvitation(dto.invitationId);\n  }\n}\n";
	}


	// ─── Dashboard Pages ──────────────────────────────────────

	static dashboardLayoutServer(): string {
		return `import { guardAuth } from '@beeblock/svelar/auth';

export const load = guardAuth();
`;
	}

	static dashboardLayoutSvelte(): string {
		return `<script lang="ts">
  import { page } from '\$app/stores';
  import type { Snippet } from 'svelte';
  import { Icon } from '@beeblock/svelar/ui';
  import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
  import KeyRound from '@lucide/svelte/icons/key-round';
  import Users from '@lucide/svelte/icons/users';
  import Settings from '@lucide/svelte/icons/settings';

  interface Props {
    data: any;
    children: Snippet;
  }

  let { data, children }: Props = \$props();

  const navItems = [
    { href: '/dashboard', label: 'Overview', exact: true, icon: LayoutDashboard },
    { href: '/dashboard/api-keys', label: 'API Keys', exact: false, icon: KeyRound },
    { href: '/dashboard/team', label: 'Team', exact: false, icon: Users },
  ];

  function isActive(href: string, exact: boolean, pathname: string): boolean {
    return exact ? pathname === href : pathname.startsWith(href);
  }
</script>

<div class="flex min-h-[calc(100vh-130px)]">
  <aside class="w-64 border-r border-border bg-muted/50 hidden md:block">
    <nav class="p-4 space-y-1">
      {#each navItems as item}
        {@const active = isActive(item.href, item.exact, \$page.url.pathname)}
        <a
          href={item.href}
          class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors {active ? 'bg-brand/10 text-brand' : 'text-foreground hover:bg-muted hover:text-foreground'}"
        >
          <Icon icon={item.icon} size={20} class={active ? 'text-brand' : 'text-muted-foreground/70'} />
          {item.label}
        </a>
      {/each}
    </nav>

    {#if data.user?.role === 'admin'}
      <div class="border-t border-border mx-4 my-2"></div>
      <div class="p-4 pt-0">
        <a
          href="/admin"
          class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <Icon icon={Settings} size={20} class="text-muted-foreground/70" />
          Admin Panel
        </a>
      </div>
    {/if}
  </aside>

  <div class="flex-1 min-w-0 p-6 md:p-8">
    {@render children()}
  </div>
</div>
`;
	}

	static dashboardPageServer(): string {
		return `import type { PageServerLoad } from './$types';
import { ApiKeys } from '@beeblock/svelar/api-keys';
import { Teams } from '@beeblock/svelar/teams';

export const load: PageServerLoad = async ({ locals }) => {
  const user = locals.user as any;

  let apiKeyCount = 0;
  let teamCount = 0;

  try {
    const keys = await ApiKeys.listForUser(user.id);
    apiKeyCount = keys?.length ?? 0;
  } catch {}

  try {
    const teams = await Teams.getUserTeams(user.id);
    teamCount = teams?.length ?? 0;
  } catch {}

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role ?? 'user',
    },
    stats: {
      apiKeyCount,
      teamCount,
    },
  };
};
`;
	}

	static dashboardPageSvelte(): string {
		return `<script lang="ts">
  import { Button, Badge, Card, CardHeader, CardTitle, CardContent } from '@beeblock/svelar/ui';

  let { data } = $props();
</script>

<svelte:head>
  <title>Dashboard</title>
</svelte:head>

<div class="space-y-8">
  <div>
    <h1 class="text-3xl font-bold text-foreground mb-2">Dashboard</h1>
    <p class="text-muted-foreground">Welcome back, {data.user.name}</p>
  </div>

  <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
    <Card>
      <CardContent class="pt-6">
        <p class="text-sm text-muted-foreground">API Keys</p>
        <p class="text-3xl font-bold text-brand mt-2">{data.stats.apiKeyCount}</p>
        <a href="/dashboard/api-keys" class="text-sm text-brand hover:underline mt-2 inline-block">Manage keys</a>
      </CardContent>
    </Card>

    <Card>
      <CardContent class="pt-6">
        <p class="text-sm text-muted-foreground">Teams</p>
        <p class="text-3xl font-bold text-brand mt-2">{data.stats.teamCount}</p>
        <a href="/dashboard/team" class="text-sm text-brand hover:underline mt-2 inline-block">Manage team</a>
      </CardContent>
    </Card>

    <Card>
      <CardContent class="pt-6">
        <p class="text-sm text-muted-foreground">Account</p>
        <Badge variant="default" class="mt-2">{data.user.role}</Badge>
      </CardContent>
    </Card>
  </div>

  <Card>
    <CardHeader>
      <CardTitle>Quick Actions</CardTitle>
    </CardHeader>
    <CardContent class="flex flex-wrap gap-3">
      <a href="/dashboard/api-keys"><Button variant="outline">Create API Key</Button></a>
      <a href="/dashboard/team"><Button variant="outline">Invite Team Member</Button></a>
      {#if data.user.role === 'admin'}
        <a href="/admin"><Button variant="outline">Admin Panel</Button></a>
      {/if}
    </CardContent>
  </Card>
</div>
`;
	}

	static apiKeysPageServer(): string {
		return `import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { ApiKeys, type ApiKeyRecord } from '@beeblock/svelar/api-keys';
import { CreateApiKeyAction, RevokeApiKeyAction } from '$lib/modules/api-keys/ApiKeyActions.js';
import { CreateApiKeyRequest, RevokeApiKeyRequest } from '$lib/modules/api-keys/ApiKeyRequests.js';

const createApiKeyRequest = new CreateApiKeyRequest();
const revokeApiKeyRequest = new RevokeApiKeyRequest();
const createApiKeyAction = new CreateApiKeyAction();
const revokeApiKeyAction = new RevokeApiKeyAction();

export const load: PageServerLoad = async ({ locals }) => {
  const user = locals.user;
  if (!user) throw redirect(302, '/login');
  let keys: ApiKeyRecord[] = [];
  let loadError: string | null = null;

  try {
    keys = await ApiKeys.listForUser(user.id);
  } catch {
    loadError = 'API keys are temporarily unavailable. Please try again.';
  }

  return {
    user: { id: user.id, name: user.name, email: user.email },
    loadError,
    createKeyForm: await superValidate({ permissions: 'read' }, zod4(createApiKeyRequest.rules()), { id: 'create-api-key', errors: false }),
    revokeKeyForm: await superValidate(zod4(revokeApiKeyRequest.rules()), { id: 'revoke-api-key', errors: false }),
    apiKeys: keys.map((key) => ({
      id: key.id,
      name: key.name,
      prefix: key.prefix,
      permissions: key.permissions ?? [],
      lastUsedAt: key.lastUsedAt ?? null,
      createdAt: key.createdAt,
    })),
  };
};

export const actions: Actions = {
  create: async (event) => {
    const user = event.locals.user;
    const validated = await superValidate(event.request, zod4(createApiKeyRequest.rules()), { id: 'create-api-key' });
    if (!user || !await createApiKeyRequest.authorize(event)) {
      validated.message = 'This action is unauthorized.';
      return fail(403, { data: null, meta: { message: validated.message, form: validated }, createKeyForm: validated });
    }
    if (!validated.valid) return fail(422, { data: null, meta: { message: null, form: validated }, createKeyForm: validated });
    const dto = createApiKeyRequest.passedValidation(validated.data);
    try {
      const { plainTextKey, record } = await createApiKeyAction.run({ userId: user.id, dto });
      return { data: { plainTextKey, keyId: record.id }, meta: { message: 'API key created.', form: validated }, createKeyForm: validated };
    } catch {
      validated.message = 'Unable to create an API key right now. Please try again.';
      return fail(503, { data: null, meta: { message: validated.message, form: validated }, createKeyForm: validated });
    }
  },

  revoke: async (event) => {
    const user = event.locals.user;
    const validated = await superValidate(event.request, zod4(revokeApiKeyRequest.rules()), { id: 'revoke-api-key' });
    if (!user || !await revokeApiKeyRequest.authorize(event)) {
      validated.message = 'This action is unauthorized.';
      return fail(403, { data: null, meta: { message: validated.message, form: validated }, revokeKeyForm: validated });
    }
    if (!validated.valid) return fail(422, { data: null, meta: { message: null, form: validated }, revokeKeyForm: validated });
    const dto = revokeApiKeyRequest.passedValidation(validated.data);
    try {
      const revoked = await revokeApiKeyAction.run({ userId: user.id, dto });
      if (!revoked) {
        validated.message = 'This API key cannot be revoked.';
        return fail(403, { data: null, meta: { message: validated.message, form: validated }, revokeKeyForm: validated });
      }
      return { data: { revoked: true, keyId: dto.keyId }, meta: { message: 'API key revoked.', form: validated }, revokeKeyForm: validated };
    } catch {
      validated.message = 'Unable to revoke this API key right now. Please try again.';
      return fail(503, { data: null, meta: { message: validated.message, form: validated }, revokeKeyForm: validated });
    }
  },
};
`;
	}


	static apiKeysPageSvelte(): string {
		return `<script lang="ts">
  import type { PageProps } from './$types';
  import { superForm } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import { createApiKeySchema, revokeApiKeySchema } from '$lib/modules/api-keys/api-key.schema.js';
  import { Button, Badge, Card, CardHeader, CardTitle, CardContent, Input, Label, Alert } from '@beeblock/svelar/ui';

  let { data, form: actionData }: PageProps = $props();
  let apiKeys = $derived(data.apiKeys);
  // svelte-ignore state_referenced_locally
  let showCreateForm = $state(Boolean(actionData?.createKeyForm && actionData.data === null));
  // svelte-ignore state_referenced_locally
  let generatedKey = $state(actionData?.data && 'plainTextKey' in actionData.data ? actionData.data.plainTextKey : '');
  // svelte-ignore state_referenced_locally
  let feedback = $state(actionData?.meta.message ?? '');
  // svelte-ignore state_referenced_locally
  let failed = $state(actionData?.data === null);
  let showCopyAlert = $state(false);

  // svelte-ignore state_referenced_locally
  const {
    form: createKeyForm,
    errors: createKeyErrors,
    enhance: enhanceCreateKey,
    submitting: creatingKey,
  } = superForm(actionData?.createKeyForm ?? data.createKeyForm, {
    validators: zod4Client(createApiKeySchema),
    resetForm: true,
    onResult: ({ result }) => {
      if (result.type === 'success' || result.type === 'failure') {
        feedback = result.data?.meta?.message ?? '';
        failed = result.type === 'failure';
        if (result.type === 'success' && typeof result.data?.data?.plainTextKey === 'string') {
          generatedKey = result.data.data.plainTextKey;
          showCreateForm = false;
        }
      }
    },
    onError: () => {
      feedback = 'Unable to create an API key right now. Please try again.';
      failed = true;
    },
  });

  $effect(() => {
    if (actionData?.data && 'plainTextKey' in actionData.data) {
      generatedKey = actionData.data.plainTextKey;
      showCreateForm = false;
    }
  });

  // svelte-ignore state_referenced_locally
  const { form: revokeKeyForm, errors: revokeKeyErrors, enhance: enhanceRevoke, submitting: revoking } = superForm(actionData?.revokeKeyForm ?? data.revokeKeyForm, {
    validators: zod4Client(revokeApiKeySchema),
    onSubmit: ({ formData }) => {
      $revokeKeyForm.keyId = String(formData.get('keyId') ?? '');
    },
    onResult: ({ result }) => {
      if (result.type === 'success' || result.type === 'failure') {
        feedback = result.data?.meta?.message ?? '';
        failed = result.type === 'failure';
      }
    },
    onError: () => {
      feedback = 'Unable to revoke this API key right now. Please try again.';
      failed = true;
    },
  });

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    showCopyAlert = true;
    setTimeout(() => { showCopyAlert = false; }, 2000);
  }
</script>

<svelte:head>
  <title>API Keys</title>
</svelte:head>

<div class="space-y-8">
  <div>
    <h1 class="text-3xl font-bold text-foreground">API Keys</h1>
    <p class="text-muted-foreground mt-1">Manage your API keys for programmatic access</p>
  </div>

  {#if showCopyAlert}
    <Alert variant="default"><span class="text-sm">Copied to clipboard!</span></Alert>
  {/if}

  {#if feedback}
    <Alert variant={failed ? 'destructive' : 'default'}><span class="text-sm" role="status">{feedback}</span></Alert>
  {/if}
  {#if $revokeKeyErrors.keyId}
    <p class="text-xs text-red-600">{$revokeKeyErrors.keyId[0]}</p>
  {/if}

  {#if generatedKey}
    <Alert variant="default">
      <div class="space-y-2">
        <p class="font-medium">API Key Created</p>
        <p class="text-sm">Copy this key now. You won't be able to see it again.</p>
        <div class="flex gap-2 mt-3">
          <code class="flex-1 bg-muted px-3 py-2 rounded text-sm font-mono break-all">{generatedKey}</code>
          <Button size="sm" variant="outline" onclick={() => copyToClipboard(generatedKey)}>Copy</Button>
        </div>
      </div>
    </Alert>
  {/if}

  {#if showCreateForm}
    <Card>
      <CardHeader><CardTitle>Create New API Key</CardTitle></CardHeader>
      <CardContent>
        <form method="POST" action="?/create" use:enhanceCreateKey class="space-y-4">
          <div class="space-y-2">
            <Label for="keyName">Key Name</Label>
            <Input
              id="keyName"
              name="name"
              placeholder="My API Key"
              bind:value={$createKeyForm.name}
              aria-invalid={$createKeyErrors.name ? 'true' : undefined}
              disabled={$creatingKey}
            />
            {#if $createKeyErrors.name}<p class="text-xs text-red-600">{$createKeyErrors.name[0]}</p>{/if}
          </div>
          <div class="space-y-2">
            <Label for="permissions">Permissions</Label>
            <Input
              id="permissions"
              name="permissions"
              placeholder="read,write"
              bind:value={$createKeyForm.permissions}
              aria-invalid={$createKeyErrors.permissions ? 'true' : undefined}
              disabled={$creatingKey}
            />
            <p class="text-xs text-muted-foreground">Comma-separated: read, write, admin</p>
            {#if $createKeyErrors.permissions}<p class="text-xs text-red-600">{$createKeyErrors.permissions[0]}</p>{/if}
          </div>
          <div class="flex gap-2">
            <Button type="submit" disabled={$creatingKey}>{$creatingKey ? 'Creating...' : 'Create Key'}</Button>
            <Button type="button" variant="outline" disabled={$creatingKey} onclick={() => { showCreateForm = false; }}>Cancel</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  {:else}
    <Button onclick={() => (showCreateForm = true)}>Create New Key</Button>
  {/if}

  <div class="space-y-4">
    <h2 class="text-xl font-bold text-foreground">Your Keys ({apiKeys.length})</h2>

    {#if apiKeys.length === 0}
      <Card>
        <CardContent class="pt-8 text-center">
          <p class="text-muted-foreground text-sm">{data.loadError ?? 'No API keys yet. Create one to get started.'}</p>
        </CardContent>
      </Card>
    {:else}
      <div class="space-y-3">
        {#each apiKeys as key (key.id)}
          <Card>
            <CardContent class="pt-6">
              <div class="flex items-start justify-between gap-4">
                <div class="flex-1">
                  <div class="flex items-center gap-2 mb-2">
                    <h3 class="font-semibold text-foreground">{key.name}</h3>
                    <Badge variant="default">Active</Badge>
                  </div>
                  <p class="font-mono text-xs bg-muted px-2 py-1 rounded inline-block mb-2">{key.prefix}........</p>
                  <div class="flex gap-4 text-xs text-muted-foreground">
                    <span>Created {new Date(key.createdAt).toLocaleDateString()}</span>
                    <span>{key.lastUsedAt ? 'Last used ' + new Date(key.lastUsedAt).toLocaleDateString() : 'Never used'}</span>
                  </div>
                  {#if key.permissions.length > 0}
                    <div class="flex gap-1 mt-2">
                      {#each key.permissions as perm}
                        <Badge variant="secondary" class="text-xs">{perm}</Badge>
                      {/each}
                    </div>
                  {/if}
                </div>
                <form method="POST" action="?/revoke" use:enhanceRevoke>
                  <input type="hidden" name="keyId" value={key.id} />
                  <Button size="sm" variant="destructive" type="submit" disabled={$revoking}
                    onclick={(e) => { if (!confirm('Revoke key "' + key.name + '"?')) e.preventDefault(); }}>
                    {$revoking ? 'Revoking...' : 'Revoke'}
                  </Button>
                </form>
              </div>
            </CardContent>
          </Card>
        {/each}
      </div>
    {/if}
  </div>

  <Card>
    <CardHeader><CardTitle>Usage</CardTitle></CardHeader>
    <CardContent>
      <h4 class="font-medium text-foreground mb-2">Include your API key in the Authorization header</h4>
      <code class="block bg-muted px-4 py-3 rounded text-sm font-mono overflow-x-auto">
        curl -H "Authorization: Bearer sk_your_key_here" https://your-app.com/api/v1/data
      </code>
    </CardContent>
  </Card>
</div>
`;
	}


	static teamPageServer(): string {
		return "import type { Actions, PageServerLoad } from './$types';\nimport { fail } from '@sveltejs/kit';\nimport { superValidate } from 'sveltekit-superforms';\nimport { zod4 } from 'sveltekit-superforms/adapters';\nimport { Teams } from '@beeblock/svelar/teams';\nimport {\n  CancelTeamInvitationAction,\n  InviteTeamMemberAction,\n  RemoveTeamMemberAction,\n  UpdateTeamAction,\n  UpdateTeamMemberRoleAction,\n} from '$lib/modules/team/TeamActions.js';\nimport {\n  CancelTeamInvitationRequest,\n  InviteTeamMemberRequest,\n  RemoveTeamMemberRequest,\n  UpdateTeamMemberRoleRequest,\n  UpdateTeamRequest,\n} from '$lib/modules/team/TeamRequests.js';\n\nconst inviteTeamMemberRequest = new InviteTeamMemberRequest();\nconst updateTeamRequest = new UpdateTeamRequest();\nconst updateTeamMemberRoleRequest = new UpdateTeamMemberRoleRequest();\nconst removeTeamMemberRequest = new RemoveTeamMemberRequest();\nconst cancelTeamInvitationRequest = new CancelTeamInvitationRequest();\nconst inviteTeamMemberAction = new InviteTeamMemberAction();\nconst updateTeamAction = new UpdateTeamAction();\nconst updateTeamMemberRoleAction = new UpdateTeamMemberRoleAction();\nconst removeTeamMemberAction = new RemoveTeamMemberAction();\nconst cancelTeamInvitationAction = new CancelTeamInvitationAction();\n\nasync function authorize(dto: { authorize(event: any): boolean | Promise<boolean> }, event: any) {\n  if (!await dto.authorize(event)) {\n    return fail(403, { message: 'This action is unauthorized.' });\n  }\n  return null;\n}\n\nexport const load: PageServerLoad = async ({ locals }) => {\n  const user = locals.user as any;\n\n  let teams: any[] = [];\n  try {\n    teams = await Teams.getUserTeams(user.id);\n  } catch {}\n\n  if (teams.length === 0) {\n    try {\n      const team = await Teams.create({\n        name: user.name + \"'s Team\",\n        ownerId: user.id,\n        personalTeam: true,\n      });\n      teams = [team];\n    } catch {}\n  }\n\n  const currentTeam = teams[0] ?? null;\n  let members: any[] = [];\n  let invitations: any[] = [];\n\n  if (currentTeam) {\n    try { members = await Teams.getMembers(currentTeam.id); } catch {}\n    try { invitations = await Teams.getPendingInvitations(currentTeam.id); } catch {}\n  }\n\n  return {\n    user: { id: user.id, name: user.name, email: user.email },\n    team: currentTeam ? { id: currentTeam.id, name: currentTeam.name, slug: currentTeam.slug } : null,\n    members: members.map((m: any) => ({ id: m.id, userId: m.userId, role: m.role, joinedAt: m.joinedAt })),\n    invitations: invitations.map((i: any) => ({ id: i.id, email: i.email, role: i.role, createdAt: i.createdAt, expiresAt: i.expiresAt })),\n    inviteForm: await superValidate({ teamId: currentTeam?.id ?? '', role: 'member' }, zod4(inviteTeamMemberRequest.rules()), { id: 'invite-team-member' }),\n    updateTeamForm: await superValidate({ teamId: currentTeam?.id ?? '', name: currentTeam?.name ?? '' }, zod4(updateTeamRequest.rules()), { id: 'update-team' }),\n    updateRoleForm: await superValidate(zod4(updateTeamMemberRoleRequest.rules()), { id: 'update-team-role' }),\n    removeMemberForm: await superValidate(zod4(removeTeamMemberRequest.rules()), { id: 'remove-team-member' }),\n    cancelInvitationForm: await superValidate(zod4(cancelTeamInvitationRequest.rules()), { id: 'cancel-team-invitation' }),\n  };\n};\n\nexport const actions: Actions = {\n  invite: async (event) => {\n    const unauthorized = await authorize(inviteTeamMemberRequest, event);\n    if (unauthorized) return unauthorized;\n    const form = await event.request.formData();\n    const validated = await superValidate(form, zod4(inviteTeamMemberRequest.rules()), { id: 'invite-team-member' });\n    if (!validated.valid) return fail(422, { inviteForm: validated });\n    const dto = inviteTeamMemberRequest.passedValidation(validated.data);\n    try {\n      await inviteTeamMemberAction.run(dto);\n      return { success: true, inviteForm: validated, invited: dto.email };\n    } catch (err: any) {\n      return fail(500, { error: err.message || 'Failed to send invitation' });\n    }\n  },\n\n  updateRole: async (event) => {\n    const unauthorized = await authorize(updateTeamMemberRoleRequest, event);\n    if (unauthorized) return unauthorized;\n    const form = await event.request.formData();\n    const validated = await superValidate(form, zod4(updateTeamMemberRoleRequest.rules()), { id: 'update-team-role' });\n    if (!validated.valid) return fail(422, { updateRoleForm: validated });\n    try {\n      await updateTeamMemberRoleAction.run(updateTeamMemberRoleRequest.passedValidation(validated.data));\n      return { success: true };\n    } catch (err: any) {\n      return fail(500, { error: err.message || 'Failed to update role' });\n    }\n  },\n\n  removeMember: async (event) => {\n    const unauthorized = await authorize(removeTeamMemberRequest, event);\n    if (unauthorized) return unauthorized;\n    const form = await event.request.formData();\n    const validated = await superValidate(form, zod4(removeTeamMemberRequest.rules()), { id: 'remove-team-member' });\n    if (!validated.valid) return fail(422, { removeMemberForm: validated });\n    try {\n      await removeTeamMemberAction.run(removeTeamMemberRequest.passedValidation(validated.data));\n      return { success: true, removed: true };\n    } catch (err: any) {\n      return fail(500, { error: err.message || 'Failed to remove member' });\n    }\n  },\n\n  cancelInvitation: async (event) => {\n    const unauthorized = await authorize(cancelTeamInvitationRequest, event);\n    if (unauthorized) return unauthorized;\n    const form = await event.request.formData();\n    const validated = await superValidate(form, zod4(cancelTeamInvitationRequest.rules()), { id: 'cancel-team-invitation' });\n    if (!validated.valid) return fail(422, { cancelInvitationForm: validated });\n    try {\n      await cancelTeamInvitationAction.run(cancelTeamInvitationRequest.passedValidation(validated.data));\n      return { success: true, cancelled: true };\n    } catch (err: any) {\n      return fail(500, { error: err.message || 'Failed to cancel invitation' });\n    }\n  },\n\n  updateTeam: async (event) => {\n    const unauthorized = await authorize(updateTeamRequest, event);\n    if (unauthorized) return unauthorized;\n    const form = await event.request.formData();\n    const validated = await superValidate(form, zod4(updateTeamRequest.rules()), { id: 'update-team' });\n    if (!validated.valid) return fail(422, { updateTeamForm: validated });\n    try {\n      await updateTeamAction.run(updateTeamRequest.passedValidation(validated.data));\n      return { success: true, updateTeamForm: validated, updated: true };\n    } catch (err: any) {\n      return fail(500, { error: err.message || 'Failed to update team' });\n    }\n  },\n};\n";
	}


	static teamPageSvelte(): string {
		return "<script lang=\"ts\">\n  import { enhance } from '$app/forms';\n  import { superForm } from 'sveltekit-superforms';\n  import { Button, Badge, Card, CardHeader, CardTitle, CardDescription, CardContent, Input, Label, Alert } from '@beeblock/svelar/ui';\n\n  let { data, form: actionData } = $props();\n  let members = $state<any[]>([]);\n  let invitations = $state<any[]>([]);\n  let showInviteForm = $state(false);\n  let alertMessage = $state('');\n  let alertType = $state<'success' | 'error'>('success');\n\n  // svelte-ignore state_referenced_locally\n  const {\n    form: inviteForm,\n    errors: inviteErrors,\n    enhance: enhanceInvite,\n    delayed: inviting,\n  } = superForm(data.inviteForm, {\n    resetForm: true,\n  });\n\n  // svelte-ignore state_referenced_locally\n  const {\n    form: teamForm,\n    errors: teamErrors,\n    enhance: enhanceUpdateTeam,\n    delayed: updatingTeam,\n  } = superForm(data.updateTeamForm);\n\n  $effect(() => {\n    members = data.members;\n    invitations = data.invitations;\n    if (data.team) {\n      $inviteForm.teamId = data.team.id;\n      $teamForm.teamId = data.team.id;\n      $teamForm.name = data.team.name ?? '';\n    }\n  });\n\n  $effect(() => {\n    if (actionData?.invited) { alertMessage = 'Invitation sent to ' + actionData.invited; alertType = 'success'; showInviteForm = false; }\n    if (actionData?.removed) { alertMessage = 'Member removed'; alertType = 'success'; }\n    if (actionData?.cancelled) { alertMessage = 'Invitation cancelled'; alertType = 'success'; }\n    if (actionData?.updated) { alertMessage = 'Team updated'; alertType = 'success'; }\n    if (actionData?.error) { alertMessage = actionData.error; alertType = 'error'; }\n  });\n</script>\n\n<svelte:head>\n  <title>Team</title>\n</svelte:head>\n\n<div class=\"space-y-8\">\n  <div>\n    <h1 class=\"text-3xl font-bold text-foreground\">Team</h1>\n    <p class=\"text-muted-foreground mt-1\">Manage your team members and invitations</p>\n  </div>\n\n  {#if alertMessage}\n    <Alert variant={alertType === 'error' ? 'destructive' : 'default'}>\n      <span class=\"text-sm\">{alertMessage}</span>\n    </Alert>\n  {/if}\n\n  {#if data.team}\n    <Card>\n      <CardHeader><CardTitle>Team Info</CardTitle></CardHeader>\n      <CardContent>\n        <form method=\"POST\" action=\"?/updateTeam\" use:enhanceUpdateTeam novalidate class=\"space-y-4\">\n          <input type=\"hidden\" name=\"teamId\" bind:value={$teamForm.teamId} />\n          <div>\n            <Label for=\"teamName\">Team Name</Label>\n            <div class=\"flex gap-2 mt-2\">\n              <Input\n                id=\"teamName\"\n                name=\"name\"\n                bind:value={$teamForm.name}\n                aria-invalid={$teamErrors.name ? 'true' : undefined}\n                disabled={$updatingTeam}\n                class=\"flex-1\"\n              />\n              <Button type=\"submit\" disabled={$updatingTeam}>{$updatingTeam ? 'Saving...' : 'Save'}</Button>\n            </div>\n            {#if $teamErrors.name}<p class=\"mt-1 text-xs text-red-600\">{$teamErrors.name[0]}</p>{/if}\n          </div>\n        </form>\n      </CardContent>\n    </Card>\n\n    <Card>\n      <CardHeader>\n        <CardTitle>Invite Member</CardTitle>\n        <CardDescription>Invite someone to join your team</CardDescription>\n      </CardHeader>\n      <CardContent>\n        {#if showInviteForm}\n          <form method=\"POST\" action=\"?/invite\" use:enhanceInvite novalidate class=\"space-y-4\">\n            <input type=\"hidden\" name=\"teamId\" bind:value={$inviteForm.teamId} />\n            <div>\n              <Label for=\"email\">Email</Label>\n              <Input\n                id=\"email\"\n                name=\"email\"\n                type=\"email\"\n                placeholder=\"member@example.com\"\n                bind:value={$inviteForm.email}\n                aria-invalid={$inviteErrors.email ? 'true' : undefined}\n                disabled={$inviting}\n                class=\"mt-2\"\n              />\n              {#if $inviteErrors.email}<p class=\"mt-1 text-xs text-red-600\">{$inviteErrors.email[0]}</p>{/if}\n            </div>\n            <div>\n              <Label for=\"role\">Role</Label>\n              <select\n                id=\"role\"\n                name=\"role\"\n                bind:value={$inviteForm.role}\n                disabled={$inviting}\n                class=\"mt-2 w-full px-3 py-2 border border-border rounded-md text-sm\"\n              >\n                <option value=\"member\">Member</option>\n                <option value=\"admin\">Admin</option>\n              </select>\n            </div>\n            <div class=\"flex gap-2\">\n              <Button type=\"submit\" disabled={$inviting}>{$inviting ? 'Sending...' : 'Send Invite'}</Button>\n              <Button type=\"button\" variant=\"outline\" disabled={$inviting} onclick={() => (showInviteForm = false)}>Cancel</Button>\n            </div>\n          </form>\n        {:else}\n          <Button onclick={() => (showInviteForm = true)}>Invite Member</Button>\n        {/if}\n      </CardContent>\n    </Card>\n\n    <Card>\n      <CardHeader>\n        <CardTitle>Members</CardTitle>\n        <CardDescription>{members.length} member(s)</CardDescription>\n      </CardHeader>\n      <CardContent>\n        {#if members.length > 0}\n          <div class=\"space-y-3\">\n            {#each members as member (member.id)}\n              <div class=\"flex items-center justify-between p-3 border border-border rounded-lg\">\n                <div>\n                  <p class=\"font-medium text-foreground\">\n                    {member.userId == data.user.id ? data.user.name + ' (you)' : 'User #' + member.userId}\n                  </p>\n                  <p class=\"text-xs text-muted-foreground\">Joined {new Date(member.joinedAt).toLocaleDateString()}</p>\n                </div>\n                <div class=\"flex items-center gap-2\">\n                  <Badge variant={member.role === 'owner' ? 'destructive' : 'default'}>\n                    {member.role.charAt(0).toUpperCase() + member.role.slice(1)}\n                  </Badge>\n                  {#if member.role !== 'owner' && member.userId != data.user.id}\n                    <form method=\"POST\" action=\"?/removeMember\" use:enhance novalidate>\n                      <input type=\"hidden\" name=\"teamId\" value={data.team.id} />\n                      <input type=\"hidden\" name=\"userId\" value={member.userId} />\n                      <Button size=\"sm\" variant=\"destructive\" type=\"submit\"\n                        onclick={(e) => { if (!confirm('Remove this member?')) e.preventDefault(); }}>\n                        Remove\n                      </Button>\n                    </form>\n                  {/if}\n                </div>\n              </div>\n            {/each}\n          </div>\n        {:else}\n          <p class=\"text-sm text-muted-foreground text-center py-4\">No members yet</p>\n        {/if}\n      </CardContent>\n    </Card>\n\n    {#if invitations.length > 0}\n      <Card>\n        <CardHeader>\n          <CardTitle>Pending Invitations</CardTitle>\n          <CardDescription>{invitations.length} pending</CardDescription>\n        </CardHeader>\n        <CardContent>\n          <div class=\"space-y-2\">\n            {#each invitations as inv (inv.id)}\n              <div class=\"flex items-center justify-between p-3 border border-border rounded-lg bg-muted/50\">\n                <div>\n                  <p class=\"font-medium text-foreground\">{inv.email}</p>\n                  <p class=\"text-xs text-muted-foreground\">Expires {new Date(inv.expiresAt).toLocaleDateString()}</p>\n                </div>\n                <div class=\"flex items-center gap-2\">\n                  <Badge variant=\"secondary\">{inv.role}</Badge>\n                  <form method=\"POST\" action=\"?/cancelInvitation\" use:enhance novalidate>\n                    <input type=\"hidden\" name=\"invitationId\" value={inv.id} />\n                    <Button size=\"sm\" variant=\"outline\" type=\"submit\">Cancel</Button>\n                  </form>\n                </div>\n              </div>\n            {/each}\n          </div>\n        </CardContent>\n      </Card>\n    {/if}\n  {:else}\n    <Card>\n      <CardContent class=\"pt-8 text-center\">\n        <p class=\"text-muted-foreground\">Could not load team data. Try refreshing the page.</p>\n      </CardContent>\n    </Card>\n  {/if}\n</div>\n";
	}


	// ─── Admin Pages ──────────────────────────────────────────

	static adminLayoutServer(): string {
		return `import { error, redirect } from '@sveltejs/kit';
import { capabilityAccess, resolveCapabilityInput } from '$lib/shared/permissions/access.server.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async (event) => {
  if (!event.locals.user) redirect(302, '/login');
  if (!await capabilityAccess.can('screen.operations.view', resolveCapabilityInput(event))) error(403, 'Console access denied.');
  return {};
};
`;
	}

	static adminLayoutSvelte(): string {
		return `<script lang="ts">
  import type { Snippet } from 'svelte';
  let { children }: { children: Snippet } = $props();
</script>

{@render children()}
`;
	}

	static adminPageServer(): string {
		return `import { error, redirect } from '@sveltejs/kit';
import { capabilityAccess, resolveCapabilityInput } from '$lib/shared/permissions/access.server.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  if (!event.locals.user) redirect(302, '/login');
  if (!await capabilityAccess.can('screen.operations.view', resolveCapabilityInput(event))) error(403, 'Console access denied.');
  const target = new URL(event.url);
  target.pathname = '/admin/dashboard';
  const aliases: Record<string, string> = { queue: 'queues', jobs: 'queues', roles: 'permissions', schedule: 'scheduler', tasks: 'scheduler' };
  const tab = target.searchParams.get('tab');
  if (tab && aliases[tab]) target.searchParams.set('tab', aliases[tab]);
  redirect(302, target.pathname + target.search);
};
`;
	}


	static adminPageSvelte(): string {
		return `<svelte:head><title>Operations</title></svelte:head>
<p role="status">Redirecting...</p>
`;
	}


	// ─── API Routes ───────────────────────────────────────────

	static apiHealth(): string {
		return `import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';

export const GET: RequestHandler = async () => {
  return json({
    status: 'ok',
    framework: 'svelar',
    timestamp: new Date().toISOString(),
  });
};
`;
	}

	static apiReadiness(): string {
		return `// svelar:public - read-only dependency readiness; no secrets or control operations.
import { DeploymentController } from '@beeblock/svelar/deployment';
import '../../../app.js';
const controller = new DeploymentController();
export const GET = controller.handle('ready');
`;
	}

	static apiTraffic(): string {
		return `// svelar:public - read-only deployment eligibility; no HTTP control operations.
import { DeploymentController } from '@beeblock/svelar/deployment';
import '../../../app.js';
const controller = new DeploymentController();
export const GET = controller.handle('traffic');
`;
	}

	static apiOperations(single = false): string {
		return `// svelar:public - personal operations retain authentication, actor/tenant ownership and CSRF.
import { OperationsController } from '@beeblock/svelar/operations';
const controller = new OperationsController();
export const GET = controller.handle('${single ? 'show' : 'index'}');
`;
	}

	static apiOperationCancel(): string {
		return `// svelar:public - personal cancellation retains authentication, actor/tenant ownership and CSRF.
import { OperationsController } from '@beeblock/svelar/operations';
const controller = new OperationsController();
export const POST = controller.handle('cancel');
`;
	}

	static authFrame(): string {
		return `<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { AuthPresentation } from '@beeblock/svelar/auth';
  let { presentation, showProviders = false, children }: { presentation: AuthPresentation; showProviders?: boolean; children: Snippet } = $props();
  const providers = $derived(presentation.providers.filter((provider) => provider.available));
</script>

<main class="auth-frame" class:illustrated={!!presentation.brand.imageUrl} style:--auth-accent={presentation.brand.accentColor ?? '#206052'}>
  <section class="auth-content" aria-label="Authentication">
    <header>
      {#if presentation.brand.logoUrl}<img class="logo" src={presentation.brand.logoUrl} alt={presentation.brand.logoAlt ?? presentation.brand.name} />{/if}
      <h1>{presentation.brand.title ?? presentation.brand.name}</h1>
      {#if presentation.brand.description}<p>{presentation.brand.description}</p>{/if}
    </header>
    <div class="form-area">{@render children()}</div>
    {#if showProviders && providers.length}
      <nav class="providers" aria-label="Other sign-in methods">
        {#each providers as provider (provider.id)}
          <a href={provider.loginUrl}>{#if provider.iconUrl}<img src={provider.iconUrl} alt="" />{/if}{provider.label}</a>
        {/each}
      </nav>
    {/if}
  </section>
  {#if presentation.brand.imageUrl}<img class="institutional" src={presentation.brand.imageUrl} alt={presentation.brand.imageAlt ?? ''} />{/if}
</main>

<style>
  .auth-frame { display: grid; min-height: 100dvh; background: #f6f8fa; color: #20252b; }
  .auth-content { width: min(100%, 36rem); margin: auto; padding: 2rem 1.25rem; box-sizing: border-box; min-width: 0; }
  header { margin: 0 auto 1rem; max-width: 28rem; overflow-wrap: anywhere; }
  h1 { font-size: 1.5rem; line-height: 1.25; margin: .75rem 0; }
  header p { color: #4f5964; font-size: .875rem; line-height: 1.5; }
  .logo { display: block; width: auto; height: 2.5rem; max-width: 100%; object-fit: contain; }
  .form-area :global(> div) { min-height: 0; }
  .form-area :global(button[type="submit"]) { background: var(--auth-accent); }
  .providers { display: grid; gap: .75rem; max-width: 28rem; margin: 1.5rem auto 0; }
  .providers a { display: flex; align-items: center; justify-content: center; gap: .75rem; min-height: 2.75rem; padding: .5rem .75rem; border: 1px solid #b9c5d0; border-radius: 4px; color: #20252b; background: #fff; font-size: .875rem; overflow-wrap: anywhere; }
  .providers a:focus-visible { outline: 2px solid var(--auth-accent); outline-offset: 3px; }
  .providers img { width: 1.25rem; height: 1.25rem; object-fit: contain; }
  .institutional { display: none; }
  @media (min-width: 960px) { .illustrated { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } .institutional { display: block; width: 100%; height: 100dvh; object-fit: cover; } }
</style>
`;
	}

	static operationsWidget(): string {
		return `<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch } from '@beeblock/svelar/http';
  import OperationTray from '$lib/shared/components/patterns/OperationTray.svelte';
  import type { OperationSummary } from '$lib/shared/components/patterns/contracts.js';
  import { Popover, PopoverContent, PopoverTrigger } from '$lib/components/ui/popover/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import ListTodo from '@lucide/svelte/icons/list-todo';

  const endpoint = '/api/operations';
  let operations = $state<OperationSummary[]>([]);
  let loading = $state(true);
  let failure = $state('');
  let active = $state(false);
  let flight: Promise<void> | null = null;
  let refetch = false;
  let stream: EventSource | null = null;
  let channel = '';
  const pending = $derived(operations.filter((operation) => ['queued', 'running'].includes(operation.state)).length);

  async function refresh(): Promise<void> {
    if (!active) return;
    if (flight) { refetch = true; return flight; }
    loading = true;
    flight = (async () => {
      try {
        const response = await apiFetch(endpoint, { showToast: false, headers: { 'X-Svelar-Session-Activity': 'false' } });
        if (!response.ok) throw new Error('Operations unavailable.');
        const payload = await response.json();
        if (!Array.isArray(payload.data)) throw new Error('Invalid operation response.');
        if (!active) return;
        operations = payload.data; failure = '';
        if (typeof payload.meta?.channel === 'string' && payload.meta.channel !== channel) {
          stream?.close(); channel = payload.meta.channel;
          stream = new EventSource('/api/broadcasting/' + encodeURIComponent(channel));
          stream.addEventListener('operation.changed', () => { void refresh(); });
        }
      } catch { if (active) failure = 'Unable to load operations. Please retry.'; }
      finally { loading = false; }
    })();
    try { await flight; }
    finally {
      flight = null;
      if (refetch && active) { refetch = false; void refresh(); }
    }
  }
  async function cancel(id: string) {
    const response = await apiFetch(endpoint + '/' + encodeURIComponent(id) + '/cancel', { method: 'POST', showToast: false });
    if (!response.ok) throw new Error('Cancellation unavailable.');
    await refresh();
  }
  onMount(() => {
    active = true; void refresh();
    const timer = setInterval(() => { void refresh(); }, 10000);
    return () => { active = false; clearInterval(timer); stream?.close(); };
  });
</script>

<Popover>
  <PopoverTrigger>
    {#snippet child({ props })}
      <Button {...props} variant="ghost" size="icon" title="Operations" aria-label={pending ? 'Operations: ' + pending + ' pending' : 'Operations'}>
        <ListTodo class="size-4" /><span class="sr-only">{pending} pending</span>
      </Button>
    {/snippet}
  </PopoverTrigger>
  <PopoverContent align="end" class="w-80 max-w-[calc(100vw-2rem)] max-h-[70vh] overflow-y-auto">
    <OperationTray {operations} {loading} error={failure} onrefresh={refresh} oncancel={cancel} />
  </PopoverContent>
</Popover>
`;
	}

	static apiAuthRegister(): string {
		return `import { ThrottleMiddleware } from '@beeblock/svelar/middleware';
import { AuthController } from '$lib/modules/auth/AuthController.js';

const throttleOptions = {
  store: process.env.RATE_LIMIT_STORE === 'cache' ? 'cache' as const : 'memory' as const,
  cacheStore: process.env.RATE_LIMIT_CACHE_STORE || process.env.CACHE_DRIVER,
};
const throttle = new ThrottleMiddleware({ maxAttempts: 5, decayMinutes: 2, ...throttleOptions });
const ctrl = new AuthController();

export async function POST(event: any) {
  return throttle.handle(
    { event, params: event.params, locals: event.locals },
    () => ctrl.handle('register')(event)
  );
}
`;
	}

	static apiAuthLogin(): string {
		return `import { ThrottleMiddleware } from '@beeblock/svelar/middleware';
import { AuthController } from '$lib/modules/auth/AuthController.js';

const throttleOptions = {
  store: process.env.RATE_LIMIT_STORE === 'cache' ? 'cache' as const : 'memory' as const,
  cacheStore: process.env.RATE_LIMIT_CACHE_STORE || process.env.CACHE_DRIVER,
};
const throttle = new ThrottleMiddleware({ maxAttempts: 5, decayMinutes: 1, ...throttleOptions });
const ctrl = new AuthController();

export async function POST(event: any) {
  return throttle.handle(
    { event, params: event.params, locals: event.locals },
    () => ctrl.handle('login')(event)
  );
}
`;
	}

	static apiAuthLogout(): string {
		return `import { AuthController } from '$lib/modules/auth/AuthController.js';

const ctrl = new AuthController();
export const POST = ctrl.handle('logout');
`;
	}

	static apiAuthMe(): string {
		return `import { AuthController } from '$lib/modules/auth/AuthController.js';

const ctrl = new AuthController();
export const GET = ctrl.handle('me');
`;
	}

	static apiAuthForgotPassword(): string {
		return `import { ThrottleMiddleware } from '@beeblock/svelar/middleware';
import { AuthController } from '$lib/modules/auth/AuthController.js';

const throttleOptions = {
  store: process.env.RATE_LIMIT_STORE === 'cache' ? 'cache' as const : 'memory' as const,
  cacheStore: process.env.RATE_LIMIT_CACHE_STORE || process.env.CACHE_DRIVER,
};
const throttle = new ThrottleMiddleware({ maxAttempts: 3, decayMinutes: 5, ...throttleOptions });
const ctrl = new AuthController();

export async function POST(event: any) {
  return throttle.handle(
    { event, params: event.params, locals: event.locals },
    () => ctrl.handle('forgotPassword')(event)
  );
}
`;
	}

	static apiAuthResetPassword(): string {
		return `import { ThrottleMiddleware } from '@beeblock/svelar/middleware';
import { AuthController } from '$lib/modules/auth/AuthController.js';

const throttleOptions = {
  store: process.env.RATE_LIMIT_STORE === 'cache' ? 'cache' as const : 'memory' as const,
  cacheStore: process.env.RATE_LIMIT_CACHE_STORE || process.env.CACHE_DRIVER,
};
const throttle = new ThrottleMiddleware({ maxAttempts: 5, decayMinutes: 5, ...throttleOptions });
const ctrl = new AuthController();

export async function POST(event: any) {
  return throttle.handle(
    { event, params: event.params, locals: event.locals },
    () => ctrl.handle('resetPassword')(event)
  );
}
`;
	}

	static apiAuthOtpSend(): string {
		return `import { ThrottleMiddleware } from '@beeblock/svelar/middleware';
import { AuthController } from '$lib/modules/auth/AuthController.js';

const throttleOptions = {
  store: process.env.RATE_LIMIT_STORE === 'cache' ? 'cache' as const : 'memory' as const,
  cacheStore: process.env.RATE_LIMIT_CACHE_STORE || process.env.CACHE_DRIVER,
};
const throttle = new ThrottleMiddleware({ maxAttempts: 3, decayMinutes: 2, ...throttleOptions });
const ctrl = new AuthController();

export async function POST(event: any) {
  return throttle.handle(
    { event, params: event.params, locals: event.locals },
    () => ctrl.handle('sendOtp')(event)
  );
}
`;
	}

	static apiAuthOtpVerify(): string {
		return `import { ThrottleMiddleware } from '@beeblock/svelar/middleware';
import { AuthController } from '$lib/modules/auth/AuthController.js';

const throttleOptions = {
  store: process.env.RATE_LIMIT_STORE === 'cache' ? 'cache' as const : 'memory' as const,
  cacheStore: process.env.RATE_LIMIT_CACHE_STORE || process.env.CACHE_DRIVER,
};
const throttle = new ThrottleMiddleware({ maxAttempts: 5, decayMinutes: 5, ...throttleOptions });
const ctrl = new AuthController();

export async function POST(event: any) {
  return throttle.handle(
    { event, params: event.params, locals: event.locals },
    () => ctrl.handle('verifyOtp')(event)
  );
}
`;
	}

	static apiAuthVerifyEmail(): string {
		return `import { AuthController } from '$lib/modules/auth/AuthController.js';

const ctrl = new AuthController();
export const GET = ctrl.handle('verifyEmail');
`;
	}

	static apiPosts(): string {
		return `import { PostController } from '$lib/modules/posts/PostController.js';

const ctrl = new PostController();
export const GET = ctrl.handle('index');
export const POST = ctrl.handle('store');
`;
	}

	static apiPostsSingle(): string {
		return `import { PostController } from '$lib/modules/posts/PostController.js';

const ctrl = new PostController();
export const GET = ctrl.handle('show');
export const PUT = ctrl.handle('update');
export const DELETE = ctrl.handle('destroy');
`;
	}

	static apiPostsMine(): string {
		return `import { PostController } from '$lib/modules/posts/PostController.js';

const ctrl = new PostController();
export const GET = ctrl.handle('mine');
`;
	}

	static apiBroadcasting(): string {
		return `// svelar:public - private/presence subscriptions still require channel authorization.
import { BroadcastingController } from '@beeblock/svelar/broadcasting';

const controller = new BroadcastingController();
export const GET = controller.handle('stream');
`;
	}

	static apiIncomingWebhooks(): string {
		return `import { IncomingWebhookController } from '@beeblock/svelar/webhooks';

const controller = new IncomingWebhookController();
export const POST = controller.handle('receive');
`;
	}

	static apiPusherAuth(): string {
		return `// svelar:public - authenticated users still require channel authorization and browser CSRF.
import { BroadcastingController } from '@beeblock/svelar/broadcasting';

const controller = new BroadcastingController();
export const POST = controller.handle('authenticate');
`;
	}

	static apiSessionActivity(): string {
		return `import { SessionActivityController } from '@beeblock/svelar/auth';

const controller = new SessionActivityController();
export const GET = controller.handle('status');
export const POST = controller.handle('renew');
`;
	}

	static apiInternalBroadcast(): string {
		return `// svelar:public - the controller verifies the server-only internal credential.
import { BroadcastingController } from '@beeblock/svelar/broadcasting';

const controller = new BroadcastingController();
export const POST = controller.handle('publish');
`;
	}

	static apiAdminUsers(): string {
		return `import { AdminController } from '$lib/modules/admin/AdminController.js';

const ctrl = new AdminController();
export const GET = ctrl.handle('listUsers');
export const PUT = ctrl.handle('updateUserRole');
export const DELETE = ctrl.handle('deleteUser');
`;
	}

	static apiAdminRoles(): string {
		return `import { AdminController } from '$lib/modules/admin/AdminController.js';

const ctrl = new AdminController();
export const POST = ctrl.handle('createRole');
export const DELETE = ctrl.handle('deleteRole');
`;
	}

	static apiAdminPermissions(): string {
		return `import { AdminController } from '$lib/modules/admin/AdminController.js';

const ctrl = new AdminController();
export const POST = ctrl.handle('createPermission');
export const DELETE = ctrl.handle('deletePermission');
`;
	}

	static apiAdminRolePermissions(): string {
		return `import { AdminController } from '$lib/modules/admin/AdminController.js';

const ctrl = new AdminController();
export const POST = ctrl.handle('attachRolePermission');
export const DELETE = ctrl.handle('detachRolePermission');
`;
	}

	static apiAdminUserRoles(): string {
		return `import { AdminController } from '$lib/modules/admin/AdminController.js';

const ctrl = new AdminController();
export const POST = ctrl.handle('assignUserRole');
export const DELETE = ctrl.handle('removeUserRole');
`;
	}

	static apiAdminUserPermissions(): string {
		return `import { AdminController } from '$lib/modules/admin/AdminController.js';

const ctrl = new AdminController();
export const POST = ctrl.handle('grantUserPermission');
export const DELETE = ctrl.handle('revokeUserPermission');
`;
	}

	static apiAdminExport(): string {
		return `import { AdminController } from '$lib/modules/admin/AdminController.js';

const ctrl = new AdminController();
export const POST = ctrl.handle('exportData');
`;
	}

	// ─── Admin Dashboard API Routes ──────────────────────────










	// ─── Jobs ─────────────────────────────────────────────────

	static backgroundWorkRepository(): string {
		return `import { User } from '$lib/modules/auth/User.js';
import { Post } from '$lib/modules/posts/Post.js';

export class BackgroundWorkRepository {
  async dailyDigest(): Promise<{ userCount: number; postCount: number; recentPosts: Post[]; admins: User[] }> {
    const userCount = await User.count();
    const postCount = await Post.count();
    const recentPosts = await Post.where('published', true).orderBy('created_at', 'desc').limit(5).get();
    const admins = await User.where('role', 'admin').get();
    return { userCount, postCount, recentPosts, admins };
  }

  async exportPosts(userId: number): Promise<Post[] | null> {
    if (!await User.find(userId)) return null;
    return Post.where('user_id', userId).get();
  }
}
`;
	}

	static sendWelcomeEmail(): string {
		return `import { Job } from '@beeblock/svelar/queue';
import { EmailTemplates } from '@beeblock/svelar/email-templates';
import { Mailer } from '@beeblock/svelar/mail';

export class SendWelcomeEmail extends Job {
  maxAttempts = 3;
  retryDelay = 30;

  userId: number;
  email: string;
  name: string;

  constructor(userId: number, email: string, name: string) {
    super();
    this.userId = userId;
    this.email = email;
    this.name = name;
  }

  async handle(): Promise<void> {
    const appName = process.env.APP_NAME ?? 'Svelar';
    const appUrl = process.env.APP_URL ?? 'http://localhost:5173';

    const rendered = await EmailTemplates.render('welcome', {
      appName,
      user: { name: this.name, email: this.email },
      confirmUrl: \`\${appUrl}/verify-email\`,
    });

    await Mailer.send({
      to: this.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  failed(error: Error): void {
    console.error(\`[Job] Failed to send welcome email to \${this.email}:\`, error.message);
  }
}
`;
	}

	static dailyDigestJob(): string {
		return `import { Job } from '@beeblock/svelar/queue';
import { Mailer } from '@beeblock/svelar/mail';
import { BackgroundWorkRepository } from '$lib/modules/admin/BackgroundWorkRepository.js';

export class DailyDigestJob extends Job {
  maxAttempts = 3;
  retryDelay = 60;

  declare date: string;

  constructor(date?: string) {
    super();
    this.date = date ?? new Date().toISOString().split('T')[0];
  }

  async handle(): Promise<void> {
    const appName = process.env.APP_NAME ?? 'Svelar';
    const { userCount, postCount, recentPosts, admins } = await new BackgroundWorkRepository().dailyDigest();

    const postList = recentPosts.length > 0
      ? recentPosts.map((post) => \`- \${post.title}\`).join('\\n')
      : 'No new posts today.';

    for (const admin of admins) {
      try {
        await Mailer.send({
          to: admin.email,
          subject: \`[\${appName}] Daily Digest — \${this.date}\`,
          html: \`
            <h2>\${appName} Daily Digest</h2>
            <p><strong>Date:</strong> \${this.date}</p>
            <p><strong>Total Users:</strong> \${userCount}</p>
            <p><strong>Total Posts:</strong> \${postCount}</p>
            <h3>Recent Posts</h3>
            <pre>\${postList}</pre>
          \`,
        });
      } catch {
        console.warn(\`[DailyDigestJob] Failed to send digest to \${admin.email}\`);
      }
    }

    console.log(\`[DailyDigestJob] Digest sent to \${admins.length} admins\`);
  }

  failed(error: Error): void {
    console.error(\`[DailyDigestJob] Failed to generate digest for \${this.date}:\`, error.message);
  }

  serialize(): string {
    return JSON.stringify({ date: this.date });
  }

  restore(data: Record<string, any>): void {
    this.date = data.date;
  }
}
`;
	}

	static exportDataJob(): string {
		return `import { Job } from '@beeblock/svelar/queue';
import { Storage } from '@beeblock/svelar/storage';
import { BackgroundWorkRepository } from '$lib/modules/admin/BackgroundWorkRepository.js';

export class ExportDataJob extends Job {
  maxAttempts = 2;
  retryDelay = 120;

  declare userId: number;
  declare format: 'csv' | 'json';

  constructor(userId?: number, format: 'csv' | 'json' = 'csv') {
    super();
    this.userId = userId ?? 0;
    this.format = format;
  }

  async handle(): Promise<void> {
    if (!this.userId) throw new Error('User ID is required for export');

    const posts = await new BackgroundWorkRepository().exportPosts(this.userId);
    if (!posts) throw new Error(\`User #\${this.userId} not found\`);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = \`exports/user-\${this.userId}-\${timestamp}.\${this.format}\`;

    let content: string;

    if (this.format === 'csv') {
      const rows = [
        'ID,Title,Slug,Published,Created At',
        ...posts.map((p) =>
          \`\${p.id},"\${p.title}","\${p.slug}",\${p.published},\${p.created_at}\`
        ),
      ];
      content = rows.join('\\n');
    } else {
      content = JSON.stringify(
        posts.map((p) => ({
          id: p.id,
          title: p.title,
          slug: p.slug,
          body: p.body,
          published: p.published,
          created_at: p.created_at,
        })),
        null,
        2
      );
    }

    await Storage.put(filename, content);
    console.log(\`[ExportDataJob] Exported \${posts.length} posts to \${filename}\`);
  }

  failed(error: Error): void {
    console.error(\`[ExportDataJob] Failed for user #\${this.userId}:\`, error.message);
  }

  serialize(): string {
    return JSON.stringify({ userId: this.userId, format: this.format });
  }

  restore(data: Record<string, any>): void {
    this.userId = data.userId;
    this.format = data.format ?? 'csv';
  }
}
`;
	}

	// ─── Scheduled Tasks ──────────────────────────────────────

static cleanupExpiredTokens(): string {
		return `import { ScheduledTask } from '@beeblock/svelar/scheduler';
import { container } from '@beeblock/svelar/container';
import type { AuthManager } from '@beeblock/svelar/auth';

export default class CleanupExpiredTokens extends ScheduledTask {
  name = 'cleanup-expired-tokens';

  schedule() {
    return this.daily();
  }

  async handle(): Promise<void> {
    const auth = await container.make<Pick<AuthManager, 'cleanupExpiredTokens'>>('auth');
    const result = await auth.cleanupExpiredTokens();

    console.log(
      \`[CleanupExpiredTokens] Deleted: \${result.passwordResets} password resets, \` +
      \`\${result.verifications} email verifications, \${result.otpCodes} OTP codes\`
    );
  }
}
`;
	}

	static schedulerIndex(): string {
		return `import { Scheduler } from '@beeblock/svelar/scheduler';
import { ScheduleMonitor } from '@beeblock/svelar/scheduler/ScheduleMonitor';
import { SearchOutboxSweep } from '@beeblock/svelar/search';
import { WebhookInboxSweep } from '@beeblock/svelar/webhooks';
import { BackgroundOperationSweep } from '@beeblock/svelar/operations';
import CleanupExpiredTokens from './CleanupExpiredTokens.js';
import CleanExpiredSessions from './CleanExpiredSessions.js';
import DailyDigestEmail from './DailyDigestEmail.js';
import PruneAuditLogs from './PruneAuditLogs.js';
import QueueHealthCheck from './QueueHealthCheck.js';

export function createScheduler(): Scheduler {
  const scheduler = new Scheduler({ persistent: true });

  scheduler.registerMany([
    new CleanupExpiredTokens(),
    new CleanExpiredSessions(),
    new DailyDigestEmail(),
    new PruneAuditLogs(),
    new QueueHealthCheck(),
    new SearchOutboxSweep(),
    new WebhookInboxSweep(),
    new BackgroundOperationSweep(),
  ]);

  ScheduleMonitor.configure(scheduler);
  return scheduler;
}
`;
	}

static cleanExpiredSessions(): string {
		return `import { ScheduledTask } from '@beeblock/svelar/scheduler';
import { DatabaseSessionStore } from '@beeblock/svelar/session';

export default class CleanExpiredSessions extends ScheduledTask {
  name = 'clean-expired-sessions';

  schedule() {
    return this.daily();
  }

  async handle(): Promise<void> {
    await new DatabaseSessionStore().gc(Number(process.env.SESSION_LIFETIME ?? 86400));
    console.log('[CleanExpiredSessions] Expired sessions cleaned');
  }
}
`;
	}

	static dailyDigestEmail(): string {
		return `import { ScheduledTask } from '@beeblock/svelar/scheduler';
import { Queue } from '@beeblock/svelar/queue';
import { DailyDigestJob } from '$lib/shared/jobs/DailyDigestJob.js';

export default class DailyDigestEmail extends ScheduledTask {
  name = 'daily-digest-email';

  schedule() {
    return this.dailyAt('09:00');
  }

  async handle(): Promise<void> {
    await Queue.dispatch(new DailyDigestJob());
  }
}
`;
	}

	static pruneAuditLogs(): string {
		return `import { ScheduledTask } from '@beeblock/svelar/scheduler';
import { Audit } from '@beeblock/svelar/audit';

export default class PruneAuditLogs extends ScheduledTask {
  name = 'prune-audit-logs';

  schedule() {
    return this.weeklyOn(0, '02:00');
  }

  async handle(): Promise<void> {
    const ninetyDaysAgo = Date.now() - (90 * 24 * 60 * 60 * 1000);

    const pruned = await Audit.pruneBefore(ninetyDaysAgo);
    console.log(\`[PruneAuditLogs] Pruned \${pruned} audit logs older than 90 days\`);
  }
}
`;
	}

	static queueHealthCheck(): string {
		return `import { ScheduledTask } from '@beeblock/svelar/scheduler';
import { Queue } from '@beeblock/svelar/queue';

export default class QueueHealthCheck extends ScheduledTask {
  name = 'queue-health-check';

  schedule() {
    return this.everyFiveMinutes();
  }

  async handle(): Promise<void> {
    const pending = await Queue.size();
    const failed = (await Queue.failed()).length;

    if (failed > 0) {
      console.warn(\`[QueueHealthCheck] \${failed} failed jobs in queue\`);
    }

    if (pending > 100) {
      console.warn(\`[QueueHealthCheck] Queue backlog: \${pending} pending jobs\`);
    }

    console.log(\`[QueueHealthCheck] Queue stats: \${pending} pending, \${failed} failed\`);
  }
}
`;
	}

	// ─── Layout & Other ───────────────────────────────────────

	static rootLayoutSvelte(name: string): string {
		return `<script lang="ts">
  import '../app.css';
  import { Button, Toaster, toast, Seo, SessionWarning } from '@beeblock/svelar/ui';
  import { getCsrfToken, registerToast } from '@beeblock/svelar/http';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import OperationsWidget from '$lib/shared/components/OperationsWidget.svelte';
  import AuthFrame from '$lib/shared/components/AuthFrame.svelte';
  import { authPageHref } from '$lib/shared/components/auth-links.js';

  // Wire apiFetch error handling to the toast UI
  registerToast((variant: string, title: string, opts?: any) => {
    const fn = (toast as any)[variant] ?? toast;
    fn(title, opts);
  });

  let { data, children } = $props();
  const operational = $derived(page.url.pathname === '/admin' || page.url.pathname.startsWith('/admin/dashboard'));
  const authentication = $derived(['/login', '/register', '/forgot-password', '/reset-password', '/otp-login', '/verify-email'].includes(page.url.pathname) || page.url.pathname.startsWith('/invitations/'));
  const signInUrl = $derived(authPageHref('/login', authentication ? data.redirectTo : page.url.pathname + page.url.search, { reason: 'session-expired' }));
  const year = new Date().getFullYear();

  onMount(() => {
    const syncCsrfToken = (event: SubmitEvent) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      if ((form.method || 'GET').toUpperCase() !== 'POST') return;

      const token = getCsrfToken();
      if (!token) return;

      let field = form.querySelector<HTMLInputElement>('input[name="_csrf"]');
      if (!field) {
        field = document.createElement('input');
        field.type = 'hidden';
        field.name = '_csrf';
        form.prepend(field);
      }
      field.value = token;
    };

    document.addEventListener('submit', syncCsrfToken, true);
    return () => document.removeEventListener('submit', syncCsrfToken, true);
  });
</script>

<!-- Site-wide SEO defaults — override per page with another <Seo> -->
<Seo
  title="${name}"
  description="${name} — built with Svelar, the Laravel of SvelteKit."
  ogSiteName="${name}"
  ogType="website"
/>

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
</svelte:head>

{#if operational}
  {@render children()}
{:else if authentication}
  <AuthFrame presentation={data.authPresentation} showProviders={page.url.pathname === '/login'}>{@render children()}</AuthFrame>
{:else}
<div class="flex flex-col min-h-screen bg-background text-foreground">
  <nav class="border-b border-border bg-card shadow-sm sticky top-0 z-50">
    <div class="px-4 sm:px-6 lg:px-8 py-4 flex flex-wrap gap-3 justify-between items-center">
      <div class="flex flex-wrap items-center gap-x-6 gap-y-2 min-w-0 max-w-full">
        <a href="/" class="flex items-center gap-2 min-w-0 max-w-full">
          <div class="w-8 h-8 shrink-0 bg-brand rounded-md flex items-center justify-center">
            <span class="text-white font-bold text-sm">&lt;/&gt;</span>
          </div>
          <span class="min-w-0 font-bold text-lg [overflow-wrap:anywhere]">${name}</span>
        </a>
        {#if data.user}
          <a href="/dashboard" class="text-muted-foreground hover:text-foreground text-sm font-medium">Dashboard</a>
          {#if data.canOperate}
            <a href="/admin" class="text-muted-foreground hover:text-foreground text-sm font-medium">Admin</a>
          {/if}
        {/if}
      </div>

      <div class="flex flex-wrap items-center gap-3 min-w-0 max-w-full">
        {#if data.user}
          <OperationsWidget />
          <span class="text-sm text-muted-foreground hidden sm:inline max-w-48 truncate">{data.user.name}</span>
          <form method="POST" action="/logout">
            <Button type="submit" variant="ghost" size="sm">Logout</Button>
          </form>
        {:else}
          <a href="/login"><Button variant="outline" size="sm">Login</Button></a>
          <a href="/register" class="hidden sm:inline"><Button size="sm">Register</Button></a>
        {/if}
      </div>
    </div>
  </nav>

  <main class="flex-1 px-4 sm:px-6 lg:px-8 py-8">
    {@render children()}
  </main>

  <footer class="border-t border-border bg-card py-8 text-center text-sm text-muted-foreground">
    <p>&copy; {year} ${name}. All rights reserved.</p>
  </footer>
</div>
{/if}

<Toaster position="bottom-right" />
{#if data.user && data.sessionActivity}
  <SessionWarning statusUrl="/api/auth/session" renewUrl="/api/auth/session" initial={data.sessionActivity} {signInUrl} />
{/if}

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
</style>
`;
	}

	static rootLayoutServer(): string {
		return `import type { ServerLoadEvent } from '@sveltejs/kit';
import { capabilityAccess, resolveCapabilityInput } from '$lib/shared/permissions/access.server.js';
import { auth, authRedirect } from '../app.js';

export async function load(event: ServerLoadEvent) {
  const user = event.locals.user;

  return {
    user: user
      ? {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role ?? 'user',
        }
      : null,
    sessionActivity: user ? event.locals.session.getActivityStatus() : null,
    canOperate: !!user && await capabilityAccess.can('screen.operations.view', resolveCapabilityInput(event)),
    authPresentation: auth.presentation(),
    redirectTo: authRedirect(event.url),
  };
}
`;
	}

	static authLinkHelper(): string {
		return `const paths = ['/login', '/register', '/forgot-password', '/otp-login'] as const;
type AuthPath = typeof paths[number];

export function authPageHref(path: AuthPath, destination?: string, query: Record<string, string> = {}): string {
  if (!paths.some((allowed) => allowed === path)) throw new TypeError('Unknown authentication page.');
  const parameters = new URLSearchParams(query);
  if (destination && destination !== '/dashboard') parameters.set('redirectTo', destination);
  const search = parameters.toString();
  return path + (search ? '?' + search : '');
}
`;
	}

	static errorSvelte(): string {
		return `<script lang="ts">
  import { page } from '$app/state';
  import { Button } from '@beeblock/svelar/ui';
</script>

<svelte:head>
  <title>{page.status} — Error</title>
</svelte:head>

<div class="flex items-center justify-center min-h-[calc(100vh-200px)] px-4">
  <div class="text-center max-w-md">
    <h1 class="text-7xl font-bold text-muted mb-4">{page.status}</h1>
    <p class="text-xl font-semibold text-foreground mb-2">
      {page.status === 404 ? 'Page Not Found' : page.status === 403 ? 'Forbidden' : page.status === 401 ? 'Unauthorized' : 'Something Went Wrong'}
    </p>
    <p class="text-muted-foreground mb-8">
      {page.error?.message || 'An unexpected error occurred. Please try again.'}
    </p>
    <div class="flex gap-3 justify-center">
      <Button href="/">Go Home</Button>
      <Button variant="outline" onclick={() => history.back()}>Go Back</Button>
    </div>
  </div>
</div>
`;
	}

	static userRegisteredEvent(): string {
		return `export class UserRegistered {
  readonly user: any;
  constructor(user: any) {
    this.user = user;
  }
}
`;
	}

	static sendWelcomeEmailListener(): string {
		return `import { Queue } from '@beeblock/svelar/queue';
import { Notifier } from '@beeblock/svelar/notifications';
import { SendWelcomeEmail } from '$lib/shared/jobs/SendWelcomeEmail.js';
import { WelcomeNotification } from './WelcomeNotification.js';

export class SendWelcomeEmailListener {
  async handle(event: any): Promise<void> {
    const user = event.user;

    // Dispatch welcome email job to the queue
    await Queue.dispatch(new SendWelcomeEmail(user.id, user.email, user.name));

    // Send welcome notification (persisted to database)
    await Notifier.notify(user, new WelcomeNotification(user));
  }
}
`;
	}

	static welcomeNotification(): string {
		return `import { Notification, type NotificationChannel } from '@beeblock/svelar/notifications';
import type { User } from '$lib/modules/auth/User.js';

export class WelcomeNotification extends Notification {
  user: User;

  constructor(user: User) {
    super();
    this.user = user;
  }

  channels(): NotificationChannel[] {
    return ['database'];
  }

  toDatabase() {
    return {
      type: 'welcome',
      data: {
        message: \`Welcome to \${process.env.APP_NAME ?? 'Svelar'}, \${this.user.name}!\`,
        userId: this.user.id,
      },
    };
  }
}
`;
	}

	static eventServiceProvider(): string {
		return `import { EventServiceProvider as BaseProvider } from '@beeblock/svelar/events';
import { UserRegistered } from '$lib/modules/auth/UserRegistered.js';
import { SendWelcomeEmailListener } from '$lib/modules/auth/SendWelcomeEmailListener.js';

export class EventServiceProvider extends BaseProvider {
  protected listen = {
    [UserRegistered.name]: [SendWelcomeEmailListener],
  };

  protected observers = {};
  protected subscribe = [];
}
`;
	}

	static homePage(name: string): string {
		return `<script lang="ts">
  import { Button, Card, Badge, Separator, Seo } from '@beeblock/svelar/ui';
</script>

<Seo
  title="${name} — Powered by Svelar"
  description="Welcome to ${name}. A modern SaaS application built with Svelar and SvelteKit."
/>

<div class="min-h-screen flex flex-col items-center justify-center px-4">
  <div class="text-center max-w-lg">
    <div class="w-16 h-16 bg-brand rounded-2xl flex items-center justify-center mx-auto mb-6">
      <span class="text-white font-bold text-2xl">&lt;/&gt;</span>
    </div>

    <Badge variant="outline" class="mb-4">Svelar + SvelteKit</Badge>

    <h1 class="text-4xl font-extrabold mb-4">
      Welcome to <span class="text-brand">${name}</span>
    </h1>

    <p class="text-muted-foreground mb-8 leading-relaxed">
      Your new Svelar project is ready. Edit
      <code class="bg-muted px-1.5 py-0.5 rounded text-sm text-brand">src/routes/+page.svelte</code>
      to get started.
    </p>

    <div class="flex items-center justify-center gap-3">
      <a href="/register"><Button>Get Started</Button></a>
      <a href="/login"><Button variant="outline">Sign In</Button></a>
    </div>
  </div>

  <Separator class="my-12 max-w-sm w-full" />

  <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl w-full">
    <Card class="p-5 text-center">
      <h3 class="font-semibold mb-1">ORM</h3>
      <p class="text-sm text-muted-foreground">Eloquent-style models with Drizzle</p>
    </Card>
    <Card class="p-5 text-center">
      <h3 class="font-semibold mb-1">Auth</h3>
      <p class="text-sm text-muted-foreground">Sessions, JWT, API tokens</p>
    </Card>
    <Card class="p-5 text-center">
      <h3 class="font-semibold mb-1">Middleware</h3>
      <p class="text-sm text-muted-foreground">CORS, CSRF, rate limiting</p>
    </Card>
  </div>
</div>
`;
	}

	// ─── Testing ──────────────────────────────────────────────────

	static vitestConfig(): string {
		return `import { defineConfig } from 'vitest/config';
import { createRequire } from 'module';
import { dirname, resolve } from 'path';

const require_ = createRequire(import.meta.url);
const svelarRoot = dirname(require_.resolve('@beeblock/svelar/package.json'));

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/unit/**/*.test.ts', 'tests/feature/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
    alias: {
      '$lib': resolve('./src/lib'),
      '$lib/*': resolve('./src/lib/*'),
      '@beeblock/svelar/actions': resolve(svelarRoot, 'dist/actions/index.js'),
      '@beeblock/svelar/api-keys': resolve(svelarRoot, 'dist/api-keys/index.js'),
      '@beeblock/svelar/audit': resolve(svelarRoot, 'dist/audit/index.js'),
      '@beeblock/svelar/auth': resolve(svelarRoot, 'dist/auth/index.js'),
      '@beeblock/svelar/broadcasting/client': resolve(svelarRoot, 'dist/broadcasting/client.js'),
      '@beeblock/svelar/broadcasting': resolve(svelarRoot, 'dist/broadcasting/index.js'),
      '@beeblock/svelar/cache': resolve(svelarRoot, 'dist/cache/index.js'),
      '@beeblock/svelar/cli': resolve(svelarRoot, 'dist/cli/index.js'),
      '@beeblock/svelar/config': resolve(svelarRoot, 'dist/config/index.js'),
      '@beeblock/svelar/container': resolve(svelarRoot, 'dist/container/index.js'),
      '@beeblock/svelar/dashboard/schemas': resolve(svelarRoot, 'dist/dashboard/schemas.js'),
      '@beeblock/svelar/dashboard': resolve(svelarRoot, 'dist/dashboard/index.js'),
      '@beeblock/svelar/database': resolve(svelarRoot, 'dist/database/index.js'),
      '@beeblock/svelar/deployment': resolve(svelarRoot, 'dist/deployment/index.js'),
      '@beeblock/svelar/dates': resolve(svelarRoot, 'dist/support/date.js'),
      '@beeblock/svelar/email-templates': resolve(svelarRoot, 'dist/email-templates/index.js'),
      '@beeblock/svelar/errors': resolve(svelarRoot, 'dist/errors/index.js'),
      '@beeblock/svelar/events': resolve(svelarRoot, 'dist/events/index.js'),
      '@beeblock/svelar/excel': resolve(svelarRoot, 'dist/excel/index.js'),
      '@beeblock/svelar/feature-flags': resolve(svelarRoot, 'dist/feature-flags/index.js'),
      '@beeblock/svelar/forms': resolve(svelarRoot, 'dist/forms/index.js'),
      '@beeblock/svelar/hashing': resolve(svelarRoot, 'dist/hashing/index.js'),
      '@beeblock/svelar/hooks': resolve(svelarRoot, 'dist/hooks/index.js'),
      '@beeblock/svelar/http': resolve(svelarRoot, 'dist/http/index.js'),
      '@beeblock/svelar/i18n/LanguageSwitcher.svelte': resolve(svelarRoot, 'src/i18n/LanguageSwitcher.svelte'),
      '@beeblock/svelar/i18n': resolve(svelarRoot, 'dist/i18n/index.js'),
      '@beeblock/svelar/logging/LogViewer': resolve(svelarRoot, 'dist/logging/LogViewer.js'),
      '@beeblock/svelar/logging': resolve(svelarRoot, 'dist/logging/index.js'),
      '@beeblock/svelar/mail': resolve(svelarRoot, 'dist/mail/index.js'),
      '@beeblock/svelar/middleware': resolve(svelarRoot, 'dist/middleware/index.js'),
      '@beeblock/svelar/notifications': resolve(svelarRoot, 'dist/notifications/index.js'),
      '@beeblock/svelar/operations': resolve(svelarRoot, 'dist/operations/index.js'),
      '@beeblock/svelar/orm': resolve(svelarRoot, 'dist/orm/index.js'),
      '@beeblock/svelar/pagination': resolve(svelarRoot, 'src/pagination'),
      '@beeblock/svelar/pdf/GeneratePdfJob': resolve(svelarRoot, 'dist/pdf/GeneratePdfJob.js'),
      '@beeblock/svelar/pdf': resolve(svelarRoot, 'dist/pdf/index.js'),
      '@beeblock/svelar/permissions/client': resolve(svelarRoot, 'dist/permissions/client.js'),
      '@beeblock/svelar/permissions': resolve(svelarRoot, 'dist/permissions/index.js'),
      '@beeblock/svelar/plugins/PluginInstaller': resolve(svelarRoot, 'dist/plugins/PluginInstaller.js'),
      '@beeblock/svelar/plugins/PluginPublisher': resolve(svelarRoot, 'dist/plugins/PluginPublisher.js'),
      '@beeblock/svelar/plugins/PluginRegistry': resolve(svelarRoot, 'dist/plugins/PluginRegistry.js'),
      '@beeblock/svelar/plugins': resolve(svelarRoot, 'dist/plugins/index.js'),
      '@beeblock/svelar/queue/JobMonitor': resolve(svelarRoot, 'dist/queue/JobMonitor.js'),
      '@beeblock/svelar/queue': resolve(svelarRoot, 'dist/queue/index.js'),
      '@beeblock/svelar/repositories': resolve(svelarRoot, 'dist/repositories/index.js'),
      '@beeblock/svelar/routing': resolve(svelarRoot, 'dist/routing/index.js'),
      '@beeblock/svelar/scheduler/ScheduleMonitor': resolve(svelarRoot, 'dist/scheduler/ScheduleMonitor.js'),
      '@beeblock/svelar/scheduler': resolve(svelarRoot, 'dist/scheduler/index.js'),
      '@beeblock/svelar/search': resolve(svelarRoot, 'dist/search/index.js'),
      '@beeblock/svelar/services': resolve(svelarRoot, 'dist/services/index.js'),
      '@beeblock/svelar/session': resolve(svelarRoot, 'dist/session/index.js'),
      '@beeblock/svelar/storage': resolve(svelarRoot, 'dist/storage/index.js'),
      '@beeblock/svelar/support': resolve(svelarRoot, 'dist/support/index.js'),
      '@beeblock/svelar/teams': resolve(svelarRoot, 'dist/teams/index.js'),
      '@beeblock/svelar/testing': resolve(svelarRoot, 'dist/testing/index.js'),
      '@beeblock/svelar/uploads': resolve(svelarRoot, 'dist/uploads/index.js'),
      '@beeblock/svelar/validation/valibot': resolve(svelarRoot, 'dist/validation/valibot.js'),
      '@beeblock/svelar/validation': resolve(svelarRoot, 'dist/validation/index.js'),
      '@beeblock/svelar/webhooks': resolve(svelarRoot, 'dist/webhooks/index.js'),
      '@beeblock/svelar': resolve(svelarRoot, 'dist/index.js'),
    },
  },
});
`;
	}

	static playwrightConfig(): string {
		return `import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
});
`;
	}

	static exampleUnitTest(): string {
		return `import { describe, it, expect } from 'vitest';
import { superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { loginSchema, registerSchema, otpVerifySchema } from '$lib/modules/auth/schemas.js';
import { LoginRequest } from '$lib/modules/auth/LoginRequest.js';

describe('Shared authentication contracts', () => {
  it('preserves false remember intent in the validated DTO', async () => {
    const form = await superValidate({ email: 'fixture@example.test', password: 'fixture-password', remember: false }, zod4(loginSchema));
    expect(form.valid).toBe(true);
    expect(new LoginRequest().passedValidation(form.data).remember).toBe(false);
  });

  it('defaults remember to false instead of creating persistent sessions implicitly', async () => {
    const form = await superValidate({ email: 'fixture@example.test', password: 'fixture-password' }, zod4(loginSchema));
    expect(form.valid).toBe(true);
    expect(form.data.remember).toBe(false);
  });

  it('rejects invalid login email and empty password through the same frontend contract', async () => {
    const form = await superValidate({ email: 'invalid', password: '' }, zod4(loginSchema));
    expect(form.valid).toBe(false);
    expect(form.errors.email?.length).toBeGreaterThan(0);
    expect(form.errors.password?.length).toBeGreaterThan(0);
  });

  it('attaches password confirmation mismatch to its field', async () => {
    const form = await superValidate({ name: 'Fixture User', email: 'fixture@example.test', password: 'fixture-password', password_confirmation: 'different-password' }, zod4(registerSchema));
    expect(form.valid).toBe(false);
    expect(form.errors.password_confirmation?.length).toBeGreaterThan(0);
  });

  it('requires the exact six-digit OTP contract', async () => {
    const form = await superValidate({ email: 'fixture@example.test', code: '12x456' }, zod4(otpVerifySchema));
    expect(form.valid).toBe(false);
    expect(form.errors.code?.length).toBeGreaterThan(0);
  });
});
`;
	}

	static exampleFeatureTest(): string {
		return `import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { Connection, Migrator, svelarCoreMigrations } from '@beeblock/svelar/database';
import { AuthManager, SessionActivityController } from '@beeblock/svelar/auth';
import { Hash } from '@beeblock/svelar/hashing';
import { createSvelarApp } from '@beeblock/svelar/hooks';
import { ThrottleMiddleware } from '@beeblock/svelar/middleware';
import { DatabaseSessionStore } from '@beeblock/svelar/session';
import { assertDatabaseHas, createRequestEvent, fakeClock, fakeMail, runWithContext, useSvelarTest } from '@beeblock/svelar/testing';
import UserFactory, { USER_FACTORY_PASSWORD } from '$lib/factories/UserFactory.js';
import { LoginRequest } from '$lib/modules/auth/LoginRequest.js';
import { LoginAction } from '$lib/modules/auth/LoginAction.js';

describe('Authentication on an isolated migrated database', () => {
  // Never import src/app.ts here: its bootstrap owns application/production connections.
  useSvelarTest({ database: { driver: 'sqlite', filename: ':memory:' }, refreshDatabase: true, migrationsPath: 'src/lib/database/migrations' });
  beforeEach(async () => { await new Migrator().run(svelarCoreMigrations()); });
  afterEach(async () => { await Connection.disconnect(); });

  function runtime(throttle?: ThrottleMiddleware) {
    const auth = new AuthManager({ guard: 'session', model: UserFactory.model(), jwt: { secret: randomBytes(32).toString('hex') },
      appUrl: 'http://localhost', eligibility: { disabledAtColumn: 'disabled_at', lockedUntilColumn: 'locked_until', requireVerifiedEmail: true } });
    const store = new DatabaseSessionStore();
    const app = createSvelarApp({ auth, secret: randomBytes(32).toString('hex'), sessionStore: store,
      sessionLifetime: 60, sessionIdleLifetime: 60, sessionAbsoluteLifetime: 180,
      sessionRememberLifetime: 120, sessionRememberAbsoluteLifetime: 300, sessionWarningBefore: 10,
      middleware: throttle ? [async (context, next) => context.event.request.method === 'POST' ? throttle.handle(context, next) : next()] : [] });
    return { auth, store, app };
  }

  function cookieHeader(response: Response, previous = ''): string {
    const cookies = new Map(previous.split('; ').filter(Boolean).map((value) => [value.slice(0, value.indexOf('=')), value]));
    for (const header of response.headers.getSetCookie()) {
      const value = header.split(';')[0];
      cookies.set(value.slice(0, value.indexOf('=')), value);
    }
    return [...cookies.values()].join('; ');
  }

  async function signIn(environment: ReturnType<typeof runtime>, email: string, password = USER_FACTORY_PASSWORD, remember = false) {
    const anonymous = await environment.app.handle({ event: createRequestEvent({ url: 'http://localhost/login' }), resolve: async () => new Response('Sign in') });
    const cookies = cookieHeader(anonymous);
    const csrf = /(?:^|;\\s*)XSRF-TOKEN=([^;]+)/.exec(cookies)?.[1];
    if (!csrf) throw new Error('Missing anonymous CSRF token');
    const event = createRequestEvent({ method: 'POST', url: 'http://localhost/login',
      headers: { cookie: cookies, origin: 'http://localhost', 'x-csrf-token': decodeURIComponent(csrf) }, body: { email, password, remember } });
    const response = await environment.app.handle({ event, resolve: async () => {
      const dto = await LoginRequest.validate(event);
      const result = await new LoginAction({ auth: event.locals.auth, session: event.locals.session }).run(dto);
      return Response.json({ success: result.success, reason: result.reason, id: result.data?.getAttribute('id') }, { status: result.status ?? 200 });
    } });
    return { response, session: event.locals.session, cookie: cookieHeader(response, cookies) };
  }

  it('creates real hashed factory credentials and authenticates through request/DTO/action/session', async () => runWithContext({}, async () => {
    const user = await UserFactory.create();
    expect(user.password).not.toBe(USER_FACTORY_PASSWORD);
    expect(await Hash.verify(USER_FACTORY_PASSWORD, user.password)).toBe(true);
    await assertDatabaseHas('users', { email: user.email });
    const auth = runtime();
    const login = await signIn(auth, user.email);
    expect(login.response.status).toBe(200);
    expect((await login.response.json()).id).toBe(user.id);
    expect(login.session.get('auth_user_id')).toBe(user.id);
    const persisted = await auth.store.read(login.session.id);
    expect(persisted?.auth_user_id).toBe(user.id);
    expect(persisted?._svelar_remember).toBe(false);
  }));

  it('rejects wrong credentials without an authenticated session', async () => runWithContext({}, async () => {
    const user = await UserFactory.create();
    const login = await signIn(runtime(), user.email, 'incorrect-fixture-password');
    expect(login.response.status).toBe(401);
    expect((await login.response.json()).reason).toBe('invalid_credentials');
    expect(login.session.get('auth_user_id')).toBeUndefined();
  }));

  it.each([
    { patch: { disabled_at: new Date().toISOString() }, reason: 'account_disabled' },
    { patch: { locked_until: new Date(Date.now() + 3600000).toISOString() }, reason: 'account_locked' },
    { patch: { email_verified_at: null }, reason: 'email_unverified' },
  ])('rechecks persisted eligibility: $reason', async ({ patch, reason }) => runWithContext({}, async () => {
    const user = await UserFactory.create(patch);
    const login = await signIn(runtime(), user.email);
    expect(login.response.status).toBe(403);
    expect((await login.response.json()).reason).toBe(reason);
    expect(login.session.get('auth_user_id')).toBeUndefined();
  }));

  it('enforces a failure throttle and recovers only after its real clock window', async (testContext) => runWithContext({}, async () => {
    const user = await UserFactory.create();
    await fakeClock(async (clock) => {
      const throttle = new ThrottleMiddleware({ store: 'memory', maxAttempts: 2, decayMinutes: 1, prefix: 'auth-feature' });
      const auth = runtime(throttle);
      const attempt = () => signIn(auth, user.email, 'incorrect-fixture-password');
      const first = await attempt();
      expect(first.response.status).toBe(401);
      expect((await first.response.json()).reason).toBe('invalid_credentials');
      expect((await attempt()).response.status).toBe(401);
      expect((await attempt()).response.status).toBe(429);
      await clock.tick(60001);
      expect((await attempt()).response.status).toBe(401);
    }, { testContext });
  }));

  it('captures password recovery mail, updates the real hash and refuses token replay', async () => runWithContext({}, async () => {
    const user = await UserFactory.create();
    const auth = runtime().auth;
    await fakeMail(async (mail) => {
      expect(await auth.sendPasswordReset(user.email)).toBe(true);
      mail.assertSent((record) => record.message.to === user.email);
      const text = mail.sent()[0].message.text ?? '';
      const link = text.match(/https?:\\/\\/[^\\s<>]+/)?.[0];
      if (!link) throw new Error('Missing captured recovery link');
      const token = new URL(link).searchParams.get('token');
      if (!token) throw new Error('Missing captured recovery token');
      const replacement = 'replacement-fixture-password';
      expect(await auth.resetPassword(token, user.email, replacement)).toBe(true);
      await user.refresh();
      expect(await Hash.verify(replacement, user.password)).toBe(true);
      expect(await auth.resetPassword(token, user.email, replacement)).toBe(false);
      mail.assertNotSent((record) => record.message.text?.includes(replacement) === true);
    });
  }));

  it('verifies the real delivered OTP once and rejects an expired code', async (testContext) => runWithContext({}, async () => {
    const user = await UserFactory.create();
    const auth = runtime().auth;
    await fakeMail(async (mail) => {
      await fakeClock(async (clock) => {
        expect(await auth.sendOtp(user.email)).toBe(true);
        const code = mail.sent()[0].message.text?.match(/\\b[0-9]{6}\\b/)?.[0];
        if (!code) throw new Error('Missing captured OTP');
        expect((await auth.verifyOtp(user.email, code))?.getAttribute('id')).toBe(user.id);
        expect(await auth.verifyOtp(user.email, code)).toBeNull();
        expect(await auth.sendOtp(user.email)).toBe(true);
        const expired = mail.sent()[1].message.text?.match(/\\b[0-9]{6}\\b/)?.[0];
        if (!expired) throw new Error('Missing second captured OTP');
        await clock.tick(600001);
        expect(await auth.verifyOtp(user.email, expired)).toBeNull();
      }, { testContext });
    });
  }));

  it('persists remember intent and expires the authenticated session at its absolute limit', async (testContext) => runWithContext({}, async () => {
    const user = await UserFactory.create();
    await fakeClock(async (clock) => {
      const auth = runtime();
      const login = await signIn(auth, user.email, USER_FACTORY_PASSWORD, true);
      expect(login.response.status).toBe(200);
      expect(login.session.getActivityStatus()?.remembered).toBe(true);
      const status = login.session.getActivityStatus();
      if (!status || status.absoluteExpiresAt === null) throw new Error('Missing absolute session policy');
      expect(status.absoluteExpiresAt - status.createdAt).toBe(300000);
      let cookies = login.cookie;
      for (let renewal = 0; renewal < 3; renewal++) {
        await clock.tick(90000);
        const csrf = /(?:^|;\\s*)XSRF-TOKEN=([^;]+)/.exec(cookies)?.[1];
        if (!csrf) throw new Error('Missing session CSRF token');
        const event = createRequestEvent({ method: 'POST', url: 'http://localhost/api/auth/session', body: {},
          headers: { cookie: cookies, origin: 'http://localhost', 'x-csrf-token': decodeURIComponent(csrf) } });
        const response = await auth.app.handle({ event, resolve: new SessionActivityController().handle('renew') });
        expect(response.status).toBe(200);
        const renewed = event.locals.session.getActivityStatus();
        expect(renewed?.absoluteExpiresAt).toBe(status.absoluteExpiresAt);
        expect(renewed?.expiresAt).toBeLessThanOrEqual(status.absoluteExpiresAt);
        cookies = cookieHeader(response, cookies);
      }
      await clock.tick(30001);
      const event = createRequestEvent({ url: 'http://localhost/api/auth/me', headers: { cookie: cookies } });
      await auth.app.handle({ event, resolve: async () => Response.json({ id: event.locals.user?.getAttribute('id') ?? null }) });
      expect(event.locals.user).toBeNull();
      expect(await auth.store.read(login.session.id)).toBeNull();
    }, { testContext });
  }));
});
`;
	}

	static scaffoldUserFactory(): string {
		return `import { Factory } from '@beeblock/svelar/testing';
import { Hash } from '@beeblock/svelar/hashing';
import { User } from '$lib/modules/auth/User.js';

export const USER_FACTORY_PASSWORD = 'test-fixture-password';

export class UserFactory extends Factory<User> {
  model() {
    return User;
  }

  async definition() {
    const sequence = this.sequence;
    return {
      name: \`User \${sequence}\`,
      email: \`user\${sequence}@example.test\`,
      password: await Hash.make(USER_FACTORY_PASSWORD),
      role: 'user',
      email_verified_at: new Date().toISOString(),
      disabled_at: null,
      locked_until: null,
    };
  }
}

// Singleton instance for convenience
export default new UserFactory();
`;
		}

	static exampleE2ETest(): string {
		return `import { expect, test } from '@playwright/test';

test.describe('Authentication pages', () => {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    test('labels, keyboard and password visibility at ' + viewport.width, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/login');
      await expect(page.getByRole('checkbox', { name: 'Remember me' })).not.toBeChecked();
      const password = page.getByLabel('Password', { exact: true });
      await password.fill('visibility-fixture');
      await page.getByRole('button', { name: 'Show password', exact: true }).click();
      await expect(password).toHaveAttribute('type', 'text');
      await page.getByRole('button', { name: 'Hide password', exact: true }).click();
      await expect(password).toHaveAttribute('type', 'password');
      await password.fill('');
      await page.getByLabel('Email', { exact: true }).focus();
      await page.keyboard.press('Tab');
      await expect(password).toBeFocused();
      await expect(page.locator('form')).toHaveAttribute('novalidate', '');
      await expect(page.locator('input[required]')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    });
  }
});

test.describe('Owned isolated-app authentication', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(() => {
    expect(process.env.SVELAR_E2E_ISOLATED_APP, 'Use a fresh isolated migrated/seeded test app, never a production server.').toBe('1');
    expect(process.env.SVELAR_E2E_USER_EMAIL, 'Provide a fixture-owned account.').toBeTruthy();
    expect(process.env.SVELAR_E2E_USER_PASSWORD, 'Provide its test-only password.').toBeTruthy();
  });

  for (const target of ['/dashboard?view=profile', 'https://attacker.invalid', '//attacker.invalid', '/%2f%2fattacker.invalid']) {
    test('sign-in accepts only a local redirect: ' + target, async ({ page }) => {
      await page.goto('/login?redirectTo=' + encodeURIComponent(target));
      const origin = new URL(page.url()).origin;
      await page.getByLabel('Email', { exact: true }).fill(process.env.SVELAR_E2E_USER_EMAIL!);
      await page.getByLabel('Password', { exact: true }).fill(process.env.SVELAR_E2E_USER_PASSWORD!);
      await page.getByRole('button', { name: 'Sign In', exact: true }).click();
      await page.waitForURL((url) => url.pathname !== '/login');
      expect(new URL(page.url()).origin).toBe(origin);
      expect(new URL(page.url()).pathname).toBe('/dashboard');
      if (target.startsWith('/dashboard?')) expect(new URL(page.url()).search).toBe('?view=profile');
    });
  }

  test('wrong credentials have one visible error and no retained password', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill(process.env.SVELAR_E2E_USER_EMAIL!);
    await page.getByLabel('Password', { exact: true }).fill('incorrect-fixture-password');
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(1);
    await expect(page.getByRole('alert')).toContainText('Invalid email or password');
    await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
  });
});
`;
	}

	static invitationWorkflowFiles(provider: ValidationProvider = 'zod'): Array<{ path: string; content: string }> {
		const t = NewCommandTemplates;
		const artifacts: Array<[string, string]> = [
			['Invitation', t.invitationModel()], ['InvitationRepository', t.invitationRepository()],
			['InvitationDto', t.invitationDto()], ['InvitationRequest', t.invitationRequest()],
			['InvitationResource', t.invitationResource()], ['InvitationService', t.invitationService()],
			['AcceptInvitationAction', t.invitationAction('accept')], ['DeclineInvitationAction', t.invitationAction('decline')],
			['InvitationController', t.invitationController()], ['invitation.schema', t.invitationSchema(provider)],
		];
		return [
			...artifacts.map(([name, content]) => ({ path: `src/lib/modules/team/${name}.ts`, content })),
			{ path: 'src/routes/invitations/[token]/+page.server.ts', content: t.invitationPageServer() },
			{ path: 'src/routes/invitations/[token]/+page.svelte', content: t.invitationPageSvelte() },
			{ path: 'src/routes/api/invitations/[token]/+server.ts', content: t.invitationApiRoute('preview') },
			{ path: 'src/routes/api/invitations/[token]/accept/+server.ts', content: t.invitationApiRoute('accept') },
			{ path: 'src/routes/api/invitations/[token]/decline/+server.ts', content: t.invitationApiRoute('decline') },
		];
	}

	static invitationSchema(provider: ValidationProvider = 'zod'): string {
		return provider === 'valibot' ? `import * as v from 'valibot';
export const invitationSchema = v.object({ token: v.pipe(v.string(), v.uuid('Invalid invitation link')) });
export type InvitationInput = v.InferOutput<typeof invitationSchema>;
` : `import { z } from '@beeblock/svelar/validation';
export const invitationSchema = z.object({ token: z.string().uuid('Invalid invitation link') });
export type InvitationInput = z.output<typeof invitationSchema>;
`;
	}

	static invitationModel(): string {
		return `import { Model } from '@beeblock/svelar/orm';

export class Invitation extends Model {
  static table = 'team_invitations';
  static timestamps = false;
  static incrementing = false;
  static fillable = ['id', 'team_id', 'email', 'role', 'token', 'expires_at', 'accepted_at'];
  static hidden = ['email', 'token'];
  declare id: string;
  declare team_id: string | number;
  declare email: string;
  declare role: string;
  declare token: string;
  declare expires_at: number;
  declare accepted_at: number | undefined;
}
`;
	}

	static invitationRepository(): string {
		return `import { Repository } from '@beeblock/svelar/repositories';
import { Teams, type TeamInvitationLookup } from '@beeblock/svelar/teams';
import { Invitation } from '$lib/modules/team/Invitation.js';

export interface InvitationLookup {
  record: Invitation;
  team: TeamInvitationLookup['team'];
  state: TeamInvitationLookup['state'];
}
export interface InvitationActor { id: string | number; email: string }

export class InvitationRepository extends Repository<Invitation> {
  model() { return Invitation; }
  async lookup(token: string): Promise<InvitationLookup | null> {
    const result = await Teams.lookupInvitation(token);
    if (!result) return null;
    const invitation = result.invitation;
    return { team: result.team, state: result.state, record: new Invitation({
      id: invitation.id, team_id: invitation.teamId, email: invitation.email, role: invitation.role,
      token: invitation.token, expires_at: invitation.expiresAt, accepted_at: invitation.acceptedAt,
    }) };
  }
  async accept(token: string, actor: InvitationActor): Promise<boolean> {
    return Teams.acceptInvitation(token, actor.id, actor.email);
  }
  async decline(token: string, actor: InvitationActor): Promise<boolean> {
    return Teams.declineInvitation(token, actor.email);
  }
}
`;
	}

	static invitationDto(): string {
		return `import type { InvitationInput } from '$lib/modules/team/invitation.schema.js';
export class InvitationDto {
  readonly token: InvitationInput['token'];
  constructor(data: InvitationInput) { this.token = data.token; }
}
`;
	}

	static invitationRequest(): string {
		return `import { FormRequest, type RequestEvent } from '@beeblock/svelar/routing';
import { invitationSchema, type InvitationInput } from '$lib/modules/team/invitation.schema.js';
import { InvitationDto } from '$lib/modules/team/InvitationDto.js';

export class InvitationRequest extends FormRequest<typeof invitationSchema, InvitationDto> {
  rules() { return invitationSchema; }
  authorize(event: RequestEvent): boolean {
    const user = event.locals.user as App.Locals['user'];
    const id: unknown = (event.locals.auth as App.Locals['auth'])?.id();
    return !!user && (typeof id === 'string' ? id.trim().length > 0 : typeof id === 'number' && Number.isSafeInteger(id))
      && typeof user.email === 'string' && user.email.trim().length > 0;
  }
  protected async parseBody(event: RequestEvent) { return { token: event.params.token }; }
  passedValidation(data: InvitationInput): InvitationDto { return new InvitationDto(data); }
}
`;
	}

	static invitationResource(): string {
		return `import { Resource } from '@beeblock/svelar/routing';
import type { InvitationLookup } from '$lib/modules/team/InvitationRepository.js';

export interface InvitationDetails { team: { id: string | number; name: string; slug: string }; role: string; expiresAt: number }
export class InvitationResource extends Resource<InvitationLookup, InvitationDetails> {
  toJSON(): InvitationDetails {
    return { team: { ...this.data.team }, role: this.data.record.role, expiresAt: this.data.record.expires_at };
  }
}
`;
	}

	static invitationService(): string {
		return `import { Service, type ServiceResult } from '@beeblock/svelar/services';
import { Teams } from '@beeblock/svelar/teams';
import { InvitationRepository, type InvitationActor } from '$lib/modules/team/InvitationRepository.js';
import { InvitationResource, type InvitationDetails } from '$lib/modules/team/InvitationResource.js';
import type { InvitationDto } from '$lib/modules/team/InvitationDto.js';

export interface InvitationView {
  state: 'pending' | 'expired' | 'accepted' | 'declined' | 'missing' | 'forbidden' | 'changed' | 'authentication_required';
  invitation: InvitationDetails | null;
  loginPath?: string;
}
export type InvitationResult = ServiceResult<InvitationView> & { status: number };

export class InvitationService extends Service {
  constructor(private readonly actor: InvitationActor, private readonly invitations = new InvitationRepository()) { super(); }
  async preview(dto: InvitationDto): Promise<InvitationResult> {
    const lookup = await this.invitations.lookup(dto.token);
    if (!lookup) return { ...this.fail('This invitation could not be found.'), status: 404, data: { state: 'missing', invitation: null } };
    if (lookup.record.email.trim().toLowerCase() !== this.actor.email.trim().toLowerCase()
      || !Teams.isAssignableRole(lookup.record.role)) {
      return { ...this.fail('This invitation is not available to this account.'), status: 403, data: { state: 'forbidden', invitation: null } };
    }
    const data: InvitationView = { state: lookup.state, invitation: new InvitationResource(lookup).toJSON() };
    if (lookup.state === 'expired') return { ...this.fail('This invitation has expired.'), status: 410, data };
    if (lookup.state === 'accepted') return { ...this.fail('This invitation has already been accepted.'), status: 409, data };
    return { ...this.ok(data), status: 200 };
  }
  async accept(dto: InvitationDto): Promise<InvitationResult> { return this.respond(dto, 'accept'); }
  async decline(dto: InvitationDto): Promise<InvitationResult> { return this.respond(dto, 'decline'); }
  private async respond(dto: InvitationDto, decision: 'accept' | 'decline'): Promise<InvitationResult> {
    const preview = await this.preview(dto);
    if (!preview.success) return preview;
    const changed = decision === 'accept' ? await this.invitations.accept(dto.token, this.actor) : await this.invitations.decline(dto.token, this.actor);
    if (!changed) {
      const current = await this.preview(dto);
      return current.success ? { ...this.fail('This invitation changed. Refresh before responding.'), status: 409,
        data: { state: 'changed', invitation: null } } : current;
    }
    const data: InvitationView = { state: decision === 'accept' ? 'accepted' : 'declined', invitation: preview.data!.invitation };
    return { ...this.ok(data), status: 200 };
  }
}
`;
	}

	static invitationAction(decision: 'accept' | 'decline'): string {
		const name = decision === 'accept' ? 'AcceptInvitationAction' : 'DeclineInvitationAction';
		return `import { Action } from '@beeblock/svelar/actions';
import { InvitationService } from '$lib/modules/team/InvitationService.js';
import type { InvitationActor } from '$lib/modules/team/InvitationRepository.js';
import type { InvitationDto } from '$lib/modules/team/InvitationDto.js';

export class ${name} extends Action<InvitationDto, Awaited<ReturnType<InvitationService['${decision}']>>> {
  constructor(actor: InvitationActor, private readonly service = new InvitationService(actor)) { super(); }
  async execute(dto: InvitationDto) { return this.service.${decision}(dto); }
}
`;
	}

	static acceptInvitationAction(): string { return NewCommandTemplates.invitationAction('accept'); }
	static declineInvitationAction(): string { return NewCommandTemplates.invitationAction('decline'); }

	static invitationController(): string {
		return `import { Controller, FormAuthorizationError, FormValidationError, type RequestEvent } from '@beeblock/svelar/routing';
import { CsrfMiddleware } from '@beeblock/svelar/middleware';
import { config } from '@beeblock/svelar/config';
import { fail } from '@sveltejs/kit';
import { superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { invitationSchema } from '$lib/modules/team/invitation.schema.js';
import { InvitationRequest } from '$lib/modules/team/InvitationRequest.js';
import { InvitationService, type InvitationView } from '$lib/modules/team/InvitationService.js';
import { AcceptInvitationAction } from '$lib/modules/team/AcceptInvitationAction.js';
import { DeclineInvitationAction } from '$lib/modules/team/DeclineInvitationAction.js';
import type { InvitationActor } from '$lib/modules/team/InvitationRepository.js';

type InvitationEvent = Omit<RequestEvent, 'locals'> & { locals: App.Locals };

export class InvitationController extends Controller {
  private actor(event: InvitationEvent): InvitationActor | null {
    const user = event.locals.user;
    const id: unknown = event.locals.auth?.id();
    return user && typeof user.email === 'string' && user.email.trim()
      && (typeof id === 'string' && id.trim() || typeof id === 'number' && Number.isSafeInteger(id)) ? { id: id as string | number, email: user.email } : null;
  }
  async previewPage(event: InvitationEvent) {
    const form = await superValidate({ token: event.params.token }, zod4(invitationSchema), { id: 'team-invitation' });
    const appName = config.get('app.name', process.env.APP_NAME ?? 'Svelar');
    const actor = this.actor(event);
    if (!actor) return { appName, data: { state: 'authentication_required', invitation: null,
      loginPath: '/login?redirectTo=' + encodeURIComponent(event.url.pathname) } satisfies InvitationView,
      meta: { status: 401, message: 'Sign in to review this invitation.', form } };
    if (!form.valid) return { appName, data: { state: 'missing', invitation: null } satisfies InvitationView,
      meta: { status: 404, message: 'This invitation could not be found.', form } };
    const dto = await InvitationRequest.validate(event);
    const result = await new InvitationService(actor).preview(dto);
    return { appName, data: result.data!, meta: { status: result.status, message: result.error ?? '', form } };
  }
  async preview(event: InvitationEvent) {
    const { data, meta } = await this.previewPage(event);
    return this.json({ data, meta }, meta.status, { 'Cache-Control': 'no-store' });
  }
  private async csrf(event: InvitationEvent): Promise<boolean> {
    const request = new Request(event.request.clone(), { headers: event.request.headers });
    request.headers.delete('authorization');
    let allowed = false;
    await new CsrfMiddleware().handle({ event: { ...event, request }, params: event.params, locals: event.locals },
      async () => { allowed = true; });
    return allowed;
  }
  private async respond(event: InvitationEvent, decision: 'accept' | 'decline') {
    const form = await superValidate({ token: event.params.token }, zod4(invitationSchema), { id: 'team-invitation' });
    const rejected = (status: number, message: string, state: InvitationView['state'] = 'forbidden') => ({
      data: { state, invitation: null } satisfies InvitationView, meta: { status, message, form },
    });
    const actor = this.actor(event);
    if (!actor) return rejected(401, 'Sign in before responding to an invitation.', 'authentication_required');
    if (!await this.csrf(event)) return rejected(419, 'Your form expired. Refresh before trying again.');
    if (!form.valid) return rejected(422, 'Invalid invitation link.', 'missing');
    try {
      const dto = await InvitationRequest.validate(event);
      const result = decision === 'accept' ? await new AcceptInvitationAction(actor).run(dto) : await new DeclineInvitationAction(actor).run(dto);
      return { data: result.data!, meta: { status: result.status,
        message: result.error ?? (decision === 'accept' ? 'Invitation accepted.' : 'Invitation declined.'), form } };
    } catch (error) {
      if (error instanceof FormAuthorizationError) return rejected(403, 'This invitation is not available to this account.');
      if (error instanceof FormValidationError) return rejected(422, 'Invalid invitation link.', 'missing');
      throw error;
    }
  }
  async accept(event: InvitationEvent) { const result = await this.respond(event, 'accept'); return this.json(result, result.meta.status, { 'Cache-Control': 'no-store' }); }
  async decline(event: InvitationEvent) { const result = await this.respond(event, 'decline'); return this.json(result, result.meta.status, { 'Cache-Control': 'no-store' }); }
  async acceptPage(event: InvitationEvent) { const result = await this.respond(event, 'accept'); return result.meta.status >= 400 ? fail(result.meta.status, result) : result; }
  async declinePage(event: InvitationEvent) { const result = await this.respond(event, 'decline'); return result.meta.status >= 400 ? fail(result.meta.status, result) : result; }
}
`;
	}

	static invitationPageServer(): string {
		return `// svelar:public - recipient-bound invitation flow retains authentication, validation and CSRF.
import type { Actions, PageServerLoad } from './$types';
import { InvitationController } from '$lib/modules/team/InvitationController.js';
const controller = new InvitationController();
export const load: PageServerLoad = (event) => controller.previewPage(event);
export const actions: Actions = {
  accept: (event) => controller.acceptPage(event),
  decline: (event) => controller.declinePage(event),
};
`;
	}

	static invitationApiRoute(operation: 'preview' | 'accept' | 'decline' = 'preview'): string {
		return `// svelar:public - recipient-bound invitation flow retains authentication, validation and CSRF.
import { InvitationController } from '$lib/modules/team/InvitationController.js';
const controller = new InvitationController();
export const ${operation === 'preview' ? 'GET' : 'POST'} = controller.handle('${operation}');
`;
	}

	static invitationPageSvelte(): string {
		return `<script lang="ts">
  import { superForm } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import { invitationSchema } from '$lib/modules/team/invitation.schema.js';
  import type { InvitationView } from '$lib/modules/team/InvitationService.js';
  import Button from '$lib/components/ui/button/button.svelte';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  let { data } = $props();
  let response = $state<{ data: InvitationView; message: string; token: string } | null>(null);
  const view: InvitationView = $derived(response && response.token === data.meta.form.data.token ? response.data : data.data);
  const feedback = $derived(response && response.token === data.meta.form.data.token ? response.message : data.meta.message);
  let decision = $state<'accept' | 'decline'>('accept');
  // svelte-ignore state_referenced_locally
  const { form, errors, enhance, submitting } = superForm(data.meta.form, {
    validators: zod4Client(invitationSchema), invalidateAll: false, resetForm: false,
    onResult: ({ result }) => {
      if (result.type === 'success' || result.type === 'failure') {
        const envelope = result.data as { data: InvitationView; meta: { message: string; form: typeof data.meta.form } };
        updateResponse(envelope.data, envelope.meta.message);
        // Superforms discovers a top-level form; the server contract stays { data, meta }.
        result.data = { ...envelope, form: envelope.meta.form };
      }
    },
    onError: () => { updateResponse(view, 'Unable to respond right now. Please try again.'); },
  });
  function updateResponse(view: InvitationView, message: string) {
    response = { data: view, message, token: data.meta.form.data.token };
  }
</script>

<svelte:head><title>Team invitation | {data.appName}</title></svelte:head>
<section class="w-full min-w-0 space-y-5" aria-labelledby="invitation-title">
  <h2 id="invitation-title" class="text-xl font-semibold">Team invitation</h2>
  {#if view.invitation}
    <dl class="space-y-2 break-words"><div><dt class="text-sm text-muted-foreground">Team</dt><dd>{view.invitation.team.name}</dd></div>
      <div><dt class="text-sm text-muted-foreground">Role</dt><dd>{view.invitation.role}</dd></div>
      <div><dt class="text-sm text-muted-foreground">Expires</dt><dd><time datetime={new Date(view.invitation.expiresAt).toISOString()}>{new Date(view.invitation.expiresAt).toLocaleString()}</time></dd></div></dl>
  {/if}
  {#if feedback}<p role={view.state === 'pending' || view.state === 'accepted' || view.state === 'declined' ? 'status' : 'alert'} class="text-sm break-words">{feedback}</p>{/if}
  {#if view.state === 'authentication_required' && view.loginPath}<a href={view.loginPath} class="text-sm font-medium underline">Sign in</a>{/if}
  {#if view.state === 'pending'}
    <form method="POST" action="?/accept" use:enhance novalidate class="space-y-3">
      <input type="hidden" name="token" bind:value={$form.token}/>
      {#if $errors.token}<p class="text-sm text-destructive" role="alert">{$errors.token[0]}</p>{/if}
      <div class="flex flex-wrap gap-3">
        <Button type="submit" disabled={$submitting} aria-busy={$submitting && decision === 'accept'} onclick={() => decision = 'accept'}>{#if $submitting && decision === 'accept'}<LoaderCircle class="size-4 animate-spin"/>{/if}Accept invitation</Button>
        <Button type="submit" formaction="?/decline" variant="outline" style="background: transparent; color: inherit" disabled={$submitting} aria-busy={$submitting && decision === 'decline'} onclick={() => decision = 'decline'}>{#if $submitting && decision === 'decline'}<LoaderCircle class="size-4 animate-spin"/>{/if}Decline</Button>
      </div>
    </form>
  {/if}
  {#if view.state === 'accepted' || view.state === 'declined'}<a href="/dashboard/team" class="text-sm font-medium underline">Return to teams</a>{/if}
</section>
`;
	}
}
