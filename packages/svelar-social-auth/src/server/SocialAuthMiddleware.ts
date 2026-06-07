import { SocialAuth } from '../SocialAuth.js';
import type { ProviderName } from '../types.js';

interface MiddlewareEvent {
  url: URL;
  locals: Record<string, unknown>;
}

type ResolveFunction = (event: MiddlewareEvent) => Promise<Response> | Response;

// Optional middleware that validates a social auth provider is configured
// before allowing the request to proceed to the callback/redirect route.
export class SocialAuthMiddleware {
  static handle(allowedProviders?: ProviderName[]) {
    return async (event: MiddlewareEvent, resolve: ResolveFunction): Promise<Response> => {
      const url = event.url;
      const pathParts = url.pathname.split('/').filter(Boolean);

      // Match patterns like /auth/:provider/redirect or /auth/:provider/callback
      const authIndex = pathParts.indexOf('auth');
      if (authIndex === -1 || authIndex + 1 >= pathParts.length) {
        return resolve(event);
      }

      const providerName = pathParts[authIndex + 1] as ProviderName;

      if (!SocialAuth.isConfigured(providerName)) {
        return new Response(JSON.stringify({ error: `Provider "${providerName}" is not configured` }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (allowedProviders && !allowedProviders.includes(providerName)) {
        return new Response(JSON.stringify({ error: `Provider "${providerName}" is not allowed` }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      event.locals.socialAuthProvider = providerName;
      return resolve(event);
    };
  }
}
