# @beeblock/svelar-social-auth

OAuth social authentication plugin for Svelar. The production support matrix is Google and GitHub.

Inspired by Laravel Socialite. Zero external OAuth dependencies.

## Installation

```bash
npm install @beeblock/svelar-social-auth
npx svelar plugin:install @beeblock/svelar-social-auth
```

## Setup

Configure providers in `src/app.ts` or your app bootstrap:

```ts
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

The plugin publishes:

- `src/routes/auth/[provider]/redirect/+server.ts`
- `src/routes/auth/[provider]/callback/+server.ts`

The callback route intentionally returns `501` after verifying the OAuth callback. Replace the TODO with your app's local user lookup/create flow, set `auth_user_id`, regenerate the session ID, and redirect.

## UI

```svelte
<script lang="ts">
  import { SocialLoginButtons } from '@beeblock/svelar-social-auth/ui';
</script>

<SocialLoginButtons providers={['google', 'github']} redirectBase="/auth" />
```

## Security

- Stateful OAuth uses an HTTP-only `social_auth_state` cookie and verifies callback state before token exchange.
- Provider-specific `.with()` params cannot override reserved OAuth params such as `state`, `client_id`, `redirect_uri`, `response_type`, or `scope`.
- The published callback route maps invalid or missing OAuth state/code to `400`, provider/network exchange failures to `502`, and does not create a local app session until you implement the TODO.

## API

- `SocialAuth.configure(config)` — set up providers.
- `SocialAuth.driver('google' | 'github')` — get a provider instance.
- `SocialAuth.configuredProviders()` — list configured provider names.
- `SocialAuth.isConfigured(name)` — check if a provider is configured.
- `SocialAuth.supportedProviders()` — returns `['google', 'github']`.
- `SocialAuth.isProviderName(name)` — runtime guard for provider route params.

Provider methods:

- `.redirect(event)` — redirect to OAuth authorization URL.
- `.callback(event)` — handle OAuth callback and return `SocialUser`.
- `.scopes(scopes)` — override default scopes.
- `.with(params)` — add provider-specific query params.

## Supported Providers

| Provider | Default scopes |
| --- | --- |
| Google | `openid`, `email`, `profile` |
| GitHub | `read:user`, `user:email` |

## License

MIT
