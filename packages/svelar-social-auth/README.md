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
import type { AuthPresentationConfig } from '@beeblock/svelar/auth';
import { SvelarSocialAuthPlugin } from '@beeblock/svelar-social-auth/plugin';

const googleConfigured = Boolean(env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET'));
const githubConfigured = Boolean(env('GITHUB_CLIENT_ID') && env('GITHUB_CLIENT_SECRET'));

// Set presentation: authPresentation in your existing AuthManager configuration.
export const authPresentation = {
  providers: [
    { id: 'google', label: 'Google', protocol: 'oauth2', configured: googleConfigured,
      available: googleConfigured, loginUrl: '/auth/google/redirect' },
    { id: 'github', label: 'GitHub', protocol: 'oauth2', configured: githubConfigured,
      available: githubConfigured, loginUrl: '/auth/github/redirect' },
  ],
} satisfies AuthPresentationConfig;

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

The callback route intentionally returns `501` after verifying the OAuth callback. Replace the TODO with your app's FormRequest/DTO/action account lookup or explicit account-linking flow, then call `SocialAuthController.login(provider, event, user)`. A `null` result means sign-in was denied. Do not write session authentication fields directly or automatically link accounts by unverified email.

The bridge always supplies `providerId` to request-local `event.locals.auth.login`. The matching provider must be configured and available in the existing Core Auth `presentation.providers`, as well as configured in this plugin. Core Auth rechecks account eligibility, rotates the managed session, applies real remember-me policy, and audits the attempt. Do not create a second auth manager in the callback or omit the provider ID to bypass this policy.

## UI

```svelte
<script lang="ts">
  import { SocialLoginButtons } from '@beeblock/svelar-social-auth/ui';
  let { data } = $props();
</script>

<SocialLoginButtons providers={data.socialProviders} redirectBase="/auth" />
```

Supply `socialProviders` from the server's `event.locals.auth.presentation().providers`, filtered to available Google/GitHub entries. Do not advertise missing credentials or disabled providers.

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
- `SocialAuthController.login(provider, event, user, { remember })` (server entry) — establish an eligible local account session through Core Auth after mapping the verified provider identity.

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
