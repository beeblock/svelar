// Social auth redirect endpoint for @beeblock/svelar-social-auth
// Copy to: src/routes/auth/[provider]/redirect/+server.ts

import { SocialAuth } from '@beeblock/svelar-social-auth';
import { SocialAuthController } from '@beeblock/svelar-social-auth/server';
import type { RequestHandler } from './$types';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
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

  return SocialAuthController.redirect(provider, event);
};
