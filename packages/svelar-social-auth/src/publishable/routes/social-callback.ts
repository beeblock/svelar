// Social auth callback endpoint for @beeblock/svelar-social-auth
// Copy to: src/routes/auth/[provider]/callback/+server.ts

import { SocialAuth } from '@beeblock/svelar-social-auth';
import { SocialAuthController } from '@beeblock/svelar-social-auth/server';
import type { RequestHandler } from './$types';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function oauthErrorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('Invalid OAuth state') || message.includes('possible CSRF')) return 400;
  if (message.includes('no code received')) return 400;
  return 502;
}

export const GET: RequestHandler = async (event) => {
  const provider = event.params.provider;

  if (!provider || !SocialAuth.isProviderName(provider)) {
    return json({
      data: null,
      meta: {
        message: 'Unsupported social auth provider',
        provider,
      },
    }, 400);
  }

  if (!SocialAuth.isConfigured(provider)) {
    return json({
      data: null,
      meta: {
        message: 'Social auth provider is not configured',
        provider,
      },
    }, 400);
  }

  try {
    const socialUser = await SocialAuthController.callback(provider, event);

    // TODO: Find or create your local user, regenerate the session ID, then redirect.
    // Example:
    // const user = await UpsertSocialUserAction.handle(SocialLoginDto.from(provider, socialUser));
    // event.locals.session.set('auth_user_id', user.id);
    // event.locals.session.regenerateId();
    // throw redirect(303, '/dashboard');

    return json({
      data: null,
      meta: {
        message: 'Social auth callback verified. Implement local user lookup/session creation in this route stub.',
        provider,
        socialUser: {
          provider: socialUser.provider,
          id: socialUser.id,
          email: socialUser.email,
          name: socialUser.name,
          avatar: socialUser.avatar,
        },
      },
    }, 501);
  } catch (error: unknown) {
    return json({
      data: null,
      meta: {
        message: error instanceof Error ? error.message : 'OAuth callback failed',
        provider,
      },
    }, oauthErrorStatus(error));
  }
};
