# Social Auth Plugin

OAuth 2.0 social authentication plugin for Svelar/SvelteKit with built-in support for Google, GitHub, Discord, Apple, Microsoft, Facebook, and Twitter/X. Includes a fluent driver API, CSRF-safe state verification, and pre-built login button components.

**Package:** `@beeblock/svelar-social-auth`

**Install:**

```bash
npx svelar plugin:install @beeblock/svelar-social-auth
```

**Imports:**

```ts
// Plugin registration
import { SvelarSocialAuthPlugin } from '@beeblock/svelar-social-auth/server';

// Core API
import { SocialAuth, SocialUser } from '@beeblock/svelar-social-auth';

// Individual providers
import {
  Provider,
  GoogleProvider,
  GitHubProvider,
  DiscordProvider,
  AppleProvider,
  MicrosoftProvider,
  FacebookProvider,
  TwitterProvider,
} from '@beeblock/svelar-social-auth';

// Server-side (controller, middleware)
import { SocialAuthController, SocialAuthMiddleware } from '@beeblock/svelar-social-auth/server';

// UI components
import { SocialLoginButton, SocialLoginButtons } from '@beeblock/svelar-social-auth/ui';

// Types
import type { ProviderName, ProviderConfig, SocialAuthConfig, SocialUser as SocialUserData } from '@beeblock/svelar-social-auth';
```

---

## Quick Start

### 1. Register the Plugin

```ts
// src/lib/plugins.ts
import { SvelarSocialAuthPlugin } from '@beeblock/svelar-social-auth/server';

export const socialAuth = new SvelarSocialAuthPlugin({
  providers: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      redirectUrl: '/auth/google/callback',
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      redirectUrl: '/auth/github/callback',
    },
  },
  stateCookieName: 'social_auth_state',
  stateCookieMaxAge: 300,
});
```

### 2. Create Redirect and Callback Routes

```ts
// src/routes/auth/[provider]/redirect/+server.ts
import { SocialAuthController } from '@beeblock/svelar-social-auth/server';
import type { RequestEvent } from '@sveltejs/kit';

export const GET = async (event: RequestEvent) => {
  const provider = event.params.provider as any;
  return SocialAuthController.redirect(provider, event);
};
```

```ts
// src/routes/auth/[provider]/callback/+server.ts
import { SocialAuthController } from '@beeblock/svelar-social-auth/server';
import { redirect } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

export const GET = async (event: RequestEvent) => {
  const provider = event.params.provider as any;

  try {
    const socialUser = await SocialAuthController.callback(provider, event);

    // Find or create user in your database
    let user = await User.where('email', socialUser.email).first();

    if (!user) {
      user = await User.create({
        name: socialUser.name,
        email: socialUser.email,
        avatar: socialUser.avatar,
        provider: socialUser.provider,
        provider_id: socialUser.id,
      });
    }

    // Create session
    const session = event.locals.session;
    session.set('user_id', user.id);

    return redirect(302, '/dashboard');
  } catch (err: any) {
    return redirect(302, `/login?error=${encodeURIComponent(err.message)}`);
  }
};
```

---

## Configuration

### Provider Configuration

Each provider accepts the following configuration:

| Option | Type | Required | Description |
|---|---|---|---|
| `clientId` | `string` | Yes | OAuth client ID |
| `clientSecret` | `string` | Yes | OAuth client secret |
| `redirectUrl` | `string` | Yes | Callback URL (absolute or relative) |
| `scopes` | `string[]` | No | Override default scopes |
| `teamId` | `string` | No | Apple only: team ID |
| `keyId` | `string` | No | Apple only: key ID |
| `privateKey` | `string` | No | Apple only: ES256 private key |

### Plugin-Level Options

| Option | Type | Default | Description |
|---|---|---|---|
| `providers` | `Record<ProviderName, ProviderConfig>` | `{}` | Provider configurations |
| `stateCookieName` | `string` | `'social_auth_state'` | Cookie name for CSRF state |
| `stateCookieMaxAge` | `number` | `300` | State cookie max age in seconds |

### Supported Providers

| Provider | Name | Default Scopes |
|---|---|---|
| Google | `'google'` | `openid`, `email`, `profile` |
| GitHub | `'github'` | `read:user`, `user:email` |
| Discord | `'discord'` | `identify`, `email` |
| Apple | `'apple'` | `name`, `email` |
| Microsoft | `'microsoft'` | `openid`, `email`, `profile`, `User.Read` |
| Facebook | `'facebook'` | `email`, `public_profile` |
| Twitter/X | `'twitter'` | `tweet.read`, `users.read`, `offline.access` |

---

## Core API

### SocialAuth Facade

```ts
import { SocialAuth } from '@beeblock/svelar-social-auth';

// Configure manually (done automatically by the plugin)
SocialAuth.configure({
  providers: { google: { ... } },
});

// Get a provider driver
const google = SocialAuth.driver('google');

// List configured providers
const providers: ProviderName[] = SocialAuth.configuredProviders();
// => ['google', 'github']

// Check if a provider is configured
SocialAuth.isConfigured('google'); // true
```

### Provider API

Each provider has a fluent API:

```ts
const driver = SocialAuth.driver('github');

// Add custom scopes
driver.scopes(['read:user', 'user:email', 'repo']);

// Add extra query parameters
driver.with({ prompt: 'consent' });

// Disable CSRF state verification (for API-only flows)
driver.stateless();

// Generate redirect response
const response: Response = driver.redirect(event);

// Handle callback and retrieve user
const socialUser: SocialUser = await driver.callback(event);
```

### SocialUser

The `SocialUser` object returned from `callback()`:

```ts
const user = await SocialAuth.driver('google').callback(event);

user.id;           // Provider user ID (string)
user.name;         // Display name
user.email;        // Email (string | null)
user.avatar;       // Avatar URL (string | null)
user.provider;     // Provider name ('google', 'github', etc.)
user.accessToken;  // OAuth access token
user.refreshToken; // OAuth refresh token (string | null)
user.expiresIn;    // Token expiry in seconds (number | null)
user.raw;          // Raw provider response data
```

---

## Server-Side

### SocialAuthController

Convenience controller for redirect and callback:

```ts
import { SocialAuthController } from '@beeblock/svelar-social-auth/server';

// Redirect with custom scopes and params
SocialAuthController.redirect('google', event, {
  scopes: ['openid', 'email', 'profile'],
  params: { prompt: 'select_account' },
});

// Handle callback (stateless mode)
const socialUser = await SocialAuthController.callback('google', event, {
  stateless: true,
});
```

### SocialAuthMiddleware

Optional middleware that validates a social auth provider is configured before allowing access:

```ts
import { SocialAuthMiddleware } from '@beeblock/svelar-social-auth/server';

// In hooks.server.ts or middleware chain
const middleware = SocialAuthMiddleware.handle(['google', 'github']);
```

The middleware:
- Extracts the provider name from the URL path (e.g., `/auth/google/redirect`)
- Returns 400 if the provider is not configured
- Returns 403 if the provider is not in the allowed list
- Sets `event.locals.socialAuthProvider` to the provider name

---

## UI Components

### SocialLoginButton

A single provider login button:

```svelte
<script lang="ts">
  import { SocialLoginButton } from '@beeblock/svelar-social-auth/ui';
</script>

<SocialLoginButton provider="google" href="/auth/google/redirect" />
<SocialLoginButton provider="github" href="/auth/github/redirect" />
```

### SocialLoginButtons

Renders buttons for all configured providers:

```svelte
<script lang="ts">
  import { SocialLoginButtons } from '@beeblock/svelar-social-auth/ui';
</script>

<SocialLoginButtons
  providers={['google', 'github', 'discord']}
  baseHref="/auth"
/>
```

---

## Migration SQL

Add social auth columns to your `users` table:

```sql
ALTER TABLE users ADD COLUMN provider TEXT;
ALTER TABLE users ADD COLUMN provider_id TEXT;
ALTER TABLE users ADD COLUMN avatar TEXT;

-- Optional: social auth accounts table for linking multiple providers
CREATE TABLE IF NOT EXISTS social_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  expires_at TEXT,
  raw TEXT DEFAULT '{}',
  created_at TEXT,
  updated_at TEXT,
  UNIQUE(provider, provider_id)
);

CREATE INDEX IF NOT EXISTS idx_social_accounts_user ON social_accounts(user_id);
```

---

## Full Working Example

```ts
// src/lib/plugins.ts
import { SvelarSocialAuthPlugin } from '@beeblock/svelar-social-auth/server';

export const socialAuth = new SvelarSocialAuthPlugin({
  providers: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      redirectUrl: '/auth/google/callback',
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      redirectUrl: '/auth/github/callback',
    },
    discord: {
      clientId: process.env.DISCORD_CLIENT_ID!,
      clientSecret: process.env.DISCORD_CLIENT_SECRET!,
      redirectUrl: '/auth/discord/callback',
    },
  },
});
```

```svelte
<!-- src/routes/login/+page.svelte -->
<script lang="ts">
  import { SocialLoginButtons } from '@beeblock/svelar-social-auth/ui';
</script>

<h1>Login</h1>

<form method="POST" action="/login">
  <!-- Email/password login form -->
</form>

<div class="divider">or continue with</div>

<SocialLoginButtons
  providers={['google', 'github', 'discord']}
  baseHref="/auth"
/>
```

```ts
// src/routes/auth/[provider]/redirect/+server.ts
import { SocialAuthController } from '@beeblock/svelar-social-auth/server';

export const GET = async (event) => {
  return SocialAuthController.redirect(event.params.provider as any, event);
};
```

```ts
// src/routes/auth/[provider]/callback/+server.ts
import { SocialAuthController } from '@beeblock/svelar-social-auth/server';
import { redirect } from '@sveltejs/kit';

export const GET = async (event) => {
  try {
    const socialUser = await SocialAuthController.callback(
      event.params.provider as any,
      event,
    );

    // Look up or create user, establish session...
    let user = await User.where('email', socialUser.email).first();

    if (!user) {
      user = await User.create({
        name: socialUser.name,
        email: socialUser.email,
        avatar: socialUser.avatar,
      });
    }

    event.locals.session.set('user_id', user.id);
    return redirect(302, '/dashboard');
  } catch (err: any) {
    return redirect(302, `/login?error=${encodeURIComponent(err.message)}`);
  }
};
```
