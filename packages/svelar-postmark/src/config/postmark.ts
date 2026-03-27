/**
 * Postmark Email Driver Configuration
 *
 * Configuration for the Postmark email service integration.
 *
 * @example
 * ```ts
 * export default {
 *   serverToken: process.env.POSTMARK_SERVER_TOKEN,
 *   from: 'noreply@example.com',
 *   messageStream: 'outbound',
 * };
 * ```
 */

export interface PostmarkConfig {
  serverToken: string;
  from: string;
  messageStream: string;
}

const config: PostmarkConfig = {
  serverToken: process.env.POSTMARK_SERVER_TOKEN ?? '',
  from: process.env.MAIL_FROM ?? 'hello@example.com',
  messageStream: 'outbound',
};

export default config;
