/**
 * Svelar Resend Plugin
 *
 * Email delivery through Resend's transactional email service.
 *
 * @example
 * ```ts
 * import { ResendPlugin } from 'svelar-resend';
 * import { PluginManager } from 'svelar/plugins';
 *
 * const plugins = new PluginManager(app);
 * plugins.use(new ResendPlugin());
 * await plugins.boot();
 *
 * // Send email
 * import { Mailer } from 'svelar/mail';
 * await Mailer.send({
 *   to: 'user@example.com',
 *   subject: 'Welcome!',
 *   html: '<h1>Welcome!</h1>',
 * }, 'resend');
 * ```
 */

// Plugin
export { ResendPlugin, default } from './ResendPlugin.js';

// Driver
export { ResendMailDriver } from './drivers/ResendMailDriver.js';

// Config
export { default as resendConfig, type ResendConfig } from './config/resend.js';
