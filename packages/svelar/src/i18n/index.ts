/**
 * Svelar i18n Integration
 *
 * Helpers for integrating paraglide-js 2.x with SvelteKit.
 * Provides middleware composers, reroute hook creators, and the LanguageSwitcher component.
 *
 * @module @beeblock/svelar/i18n
 *
 * @example
 * ```ts
 * // hooks.server.ts
 * import { createI18nHandle } from '@beeblock/svelar/i18n';
 * import { paraglideMiddleware } from '$lib/paraglide/server';
 * import { getTextDirection } from '$lib/paraglide/runtime';
 *
 * const i18nHandle = createI18nHandle({ paraglideMiddleware, getTextDirection });
 * ```
 */

import type { Handle } from '@sveltejs/kit';

// ── Types ──────────────────────────────────────────────────

export interface I18nHandleConfig {
  /**
   * The paraglide middleware function from `$lib/paraglide/server`.
   * Signature: (request, callback) => Response
   */
  paraglideMiddleware: (
    request: Request,
    callback: (args: { request: Request; locale: string }) => Response | Promise<Response>,
  ) => Response | Promise<Response>;

  /**
   * The getTextDirection function from `$lib/paraglide/runtime`.
   * Returns 'ltr' or 'rtl' for a given locale.
   */
  getTextDirection?: (locale: string) => string;

  /**
   * HTML lang attribute placeholder (default: '%lang%')
   */
  langPlaceholder?: string;

  /**
   * HTML dir attribute placeholder (default: '%dir%')
   */
  dirPlaceholder?: string;
}

export interface RerouteConfig {
  /**
   * The deLocalizeUrl function from `$lib/paraglide/runtime`.
   * Strips the locale prefix from URLs for SvelteKit routing.
   */
  deLocalizeUrl: (url: URL) => { pathname: string };
}

// ── i18n Handle Creator ───────────────────────────────────

/**
 * Creates a SvelteKit `Handle` hook that wires paraglide-js middleware
 * for server-side locale detection and HTML attribute injection.
 *
 * @example
 * ```ts
 * import { createI18nHandle } from '@beeblock/svelar/i18n';
 * import { paraglideMiddleware } from '$lib/paraglide/server';
 * import { getTextDirection } from '$lib/paraglide/runtime';
 *
 * export const i18nHandle = createI18nHandle({ paraglideMiddleware, getTextDirection });
 * ```
 */
export function createI18nHandle(config: I18nHandleConfig): Handle {
  const {
    paraglideMiddleware,
    getTextDirection = () => 'ltr',
    langPlaceholder = '%lang%',
    dirPlaceholder = '%dir%',
  } = config;

  return ({ event, resolve }) =>
    paraglideMiddleware(event.request, ({ request: localizedRequest, locale }) => {
      event.request = localizedRequest;
      return resolve(event, {
        transformPageChunk: ({ html }) =>
          html.replace(langPlaceholder, locale).replace(dirPlaceholder, getTextDirection(locale)),
      });
    });
}

/**
 * Creates a SvelteKit `Reroute` function that strips locale prefixes
 * from URLs so SvelteKit's file-based routing works correctly.
 *
 * @example
 * ```ts
 * // hooks.ts (client-side)
 * import { createReroute } from '@beeblock/svelar/i18n';
 * import { deLocalizeUrl } from '$lib/paraglide/runtime';
 *
 * export const reroute = createReroute({ deLocalizeUrl });
 * ```
 */
export function createReroute(config: RerouteConfig) {
  return (request: { url: URL }) => {
    return config.deLocalizeUrl(request.url).pathname;
  };
}

// Note: LanguageSwitcher is a Svelte component, imported separately:
// import LanguageSwitcher from '@beeblock/svelar/i18n/LanguageSwitcher.svelte';
// or via the Svelte-aware entry point (svelte condition in package.json)
