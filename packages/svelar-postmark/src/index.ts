/**
 * Svelar Postmark Plugin
 *
 * Email delivery through Postmark's reliable email service.
 *
 * @example
 * ```ts
 * import { PostmarkPlugin } from 'svelar-postmark';
 * import { PluginManager } from 'svelar/plugins';
 *
 * const plugins = new PluginManager(app);
 * plugins.use(new PostmarkPlugin());
 * await plugins.boot();
 *
 * // Send email
 * import { Mailer } from 'svelar/mail';
 * await Mailer.send({
 *   to: 'user@example.com',
 *   subject: 'Welcome!',
 *   html: '<h1>Welcome!</h1>',
 * }, 'postmark');
 * ```
 */

// Plugin
export { PostmarkPlugin, default } from './PostmarkPlugin.js';

// Driver
export { PostmarkMailDriver } from './drivers/PostmarkMailDriver.js';

// Config
export { default as postmarkConfig, type PostmarkConfig } from './config/postmark.js';
