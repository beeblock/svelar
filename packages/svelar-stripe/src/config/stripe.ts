/**
 * Default Stripe Plugin Configuration
 *
 * This is the default configuration that will be published to the app's
 * config/plugins/stripe.ts file. Users can customize these values.
 */

export default {
  /**
   * Stripe Secret Key (from environment variable)
   */
  secretKey: process.env.STRIPE_SECRET_KEY ?? '',

  /**
   * Stripe Publishable Key (from environment variable)
   */
  publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? '',

  /**
   * Stripe Webhook Secret (from environment variable)
   */
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',

  /**
   * Default currency for new subscriptions (ISO 4217 code)
   */
  currency: 'usd',

  /**
   * Default trial period duration in days
   */
  trialDays: 14,

  /**
   * Path where the Stripe webhook will be received
   */
  webhookPath: '/api/webhooks/stripe',

  /**
   * URL to redirect to in the billing portal return
   */
  portalReturnUrl: '/dashboard/billing',

  /**
   * URL to redirect to after successful checkout
   */
  checkoutSuccessUrl: '/dashboard/billing?success=true',

  /**
   * URL to redirect to after canceled checkout
   */
  checkoutCancelUrl: '/dashboard/billing?canceled=true',
};
