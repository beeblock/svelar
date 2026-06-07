# Social Auth Plugin

OAuth 2.0 social authentication plugin for Svelar/SvelteKit. The production support matrix is Google and GitHub.

**Package:** `@beeblock/svelar-social-auth`

The package is inspired by Laravel Socialite and has no external OAuth runtime dependencies.

## Installation

```bash
npm install @beeblock/svelar-social-auth
npx svelar plugin:install @beeblock/svelar-social-auth
```

## Imports

```ts
import { SvelarSocialAuthPlugin } from '@beeblock/svelar-social-auth/plugin';
import { SocialAuth, SocialUser, GoogleProvider, GitHubProvider } from '@beeblock/svelar-social-auth';
import { SocialAuthController, SocialAuthMiddleware } from '@beeblock/svelar-social-auth/server';
import { SocialLoginButton, SocialLoginButtons } from '@beeblock/svelar-social-auth/ui';
import type { ProviderName, ProviderConfig, SocialAuthConfig } from '@beeblock/svelar-social-auth';
```

## Quick Start

Configure providers during app bootstrap:

```ts
// src/app.ts
import { env } from '@beeblock/svelar/config';
import { SvelarSocialAuthPlugin } from '@beeblock/svelar-social-auth/plugin';

export const socialAuth = new SvelarSocialAuthPlugin({
  providers: {
    google: {
      clientId: env('GOOGLE_CLIENT_ID'),
      clientSecret: env('GOOGLE_CLIENT_SECRET'),
      redirectUrl: '/auth/google/callback',
      scopes: ['openid', 'email', 'profile'],
    },
    github: {
      clientId: env('GITHUB_CLIENT_ID'),
      clientSecret: env('GITHUB_CLIENT_SECRET'),
      redirectUrl: '/auth/github/callback',
    },
  },
});
```

Publish the package routes:

```bash
npx svelar plugin:publish @beeblock/svelar-social-auth --only assets
```

This publishes:

- `src/routes/auth/[provider]/redirect/+server.ts`
- `src/routes/auth/[provider]/callback/+server.ts`

The callback route intentionally returns `501` after verifying the OAuth callback and returning a sanitized provider user summary. Replace the TODO with your app's local user lookup/create flow, set the authenticated user in the session, regenerate the session ID, and redirect.

## Configuration

### Provider Options

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `clientId` | `string` | Yes | OAuth client ID |
| `clientSecret` | `string` | Yes | OAuth client secret |
| `redirectUrl` | `string` | Yes | Callback URL, absolute or relative |
| `scopes` | `string[]` | No | Override default scopes |

### Plugin Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `providers` | `Partial<Record<ProviderName, ProviderConfig>>` | `{}` | Configured Google/GitHub providers |
| `stateCookieName` | `string` | `social_auth_state` | HTTP-only OAuth state cookie name |
| `stateCookieMaxAge` | `number` | `300` | State cookie max age in seconds |

### Supported Providers

| Provider | Name | Default scopes |
| --- | --- | --- |
| Google | `google` | `openid`, `email`, `profile` |
| GitHub | `github` | `read:user`, `user:email` |

## Core API

```ts
import { SocialAuth } from '@beeblock/svelar-social-auth';

SocialAuth.configure({
  providers: {
    google: {
      clientId: '...',
      clientSecret: '...',
      redirectUrl: '/auth/google/callback',
    },
  },
});

const google = SocialAuth.driver('google');
const configured = SocialAuth.configuredProviders();
const supported = SocialAuth.supportedProviders();

SocialAuth.isConfigured('google'); // true
SocialAuth.isProviderName('github'); // true
SocialAuth.isProviderName('discord'); // false
```

Provider drivers expose a fluent API:

```ts
const driver = SocialAuth.driver('github');

driver.scopes(['read:user', 'user:email']);
driver.with({ prompt: 'consent' });
driver.stateless();

const redirectResponse = driver.redirect(event);
const socialUser = await driver.callback(event);
```

## Server API

```ts
import { SocialAuthController } from '@beeblock/svelar-social-auth/server';

export const GET = async (event) => {
  const provider = event.params.provider;
  if (!SocialAuth.isProviderName(provider)) {
    return Response.json({ data: null, meta: { error: 'Unsupported provider' } }, { status: 404 });
  }

  return SocialAuthController.redirect(provider, event, {
    params: { prompt: 'select_account' },
  });
};
```

`SocialAuthMiddleware.handle(['google', 'github'])` can be used to reject unsupported or unconfigured provider route access before controller code runs.

## UI Components

```svelte
<script lang="ts">
  import { SocialLoginButton, SocialLoginButtons } from '@beeblock/svelar-social-auth/ui';
</script>

<SocialLoginButton provider="google" href="/auth/google/redirect" />
<SocialLoginButton provider="github" href="/auth/github/redirect" />

<SocialLoginButtons providers={['google', 'github']} redirectBase="/auth" />
```

## Security Behavior

- Stateful OAuth uses an HTTP-only `social_auth_state` cookie and verifies callback state before token exchange.
- Local HTTP development origins set the state cookie with `secure: false`; HTTPS origins set `secure: true`.
- Provider-specific `.with()` params cannot override reserved OAuth params such as `state`, `client_id`, `redirect_uri`, `response_type`, or `scope`.
- The published callback route maps invalid or missing OAuth state/code to `400`, provider/network exchange failures to `502`, and does not create a local app session until you implement the callback TODO.
- Use `stateless()` only for flows where you have another CSRF/session binding strategy.

## Local User Linking

Use a focused migration for social account links if users can attach more than one provider account. Keep the migration in `src/lib/database/migrations/` and create it through the Svelar migration generator.

```bash
npx svelar make:migration CreateSocialAccountsTable
```

```ts
import { Migration } from '@beeblock/svelar/database';

export default class CreateSocialAccountsTable extends Migration {
  async up() {
    await this.schema.createTable('social_accounts', (table) => {
      table.id();
      table.integer('user_id').references('id').on('users').onDelete('cascade');
      table.string('provider');
      table.string('provider_id');
      table.text('access_token').nullable();
      table.text('refresh_token').nullable();
      table.timestamp('expires_at').nullable();
      table.json('raw').default({});
      table.timestamps();

      table.unique(['provider', 'provider_id']);
      table.index('user_id');
    });
  }

  async down() {
    await this.schema.dropTable('social_accounts');
  }
}
```
