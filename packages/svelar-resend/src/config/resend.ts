/**
 * Resend Email Driver Configuration
 *
 * Configuration for the Resend email service integration.
 *
 * @example
 * ```ts
 * export default {
 *   apiKey: process.env.RESEND_API_KEY,
 *   from: 'noreply@example.com',
 * };
 * ```
 */

export interface ResendConfig {
  apiKey: string;
  from: string;
}

const config: ResendConfig = {
  apiKey: process.env.RESEND_API_KEY ?? '',
  from: process.env.MAIL_FROM ?? 'hello@example.com',
};

export default config;
