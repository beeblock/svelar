/**
 * StripePlugin
 *
 * Main plugin class that extends the Svelar Plugin base class.
 * Registers the Stripe service, configuration, migrations, and webhook handlers.
 */

import type { Container } from 'svelar/plugins';
import { Plugin, type PluginConfig } from 'svelar/plugins';
import { StripeService, type StripeConfig } from './StripeService.js';
import { SubscriptionManager } from './SubscriptionManager.js';
import { StripeWebhookHandler } from './webhooks/StripeWebhookHandler.js';

export class StripePlugin extends Plugin {
  name = 'svelar-stripe';
  version = '0.1.0';
  description = 'Stripe billing and subscription plugin for Svelar';

  /**
   * Register services into the container
   */
  async register(app: Container): Promise<void> {
    // Register StripeService as singleton
    app.singleton('stripe', () => {
      const service = StripeService.getInstance();
      const config = app.make('config.stripe') as StripeConfig;
      if (config && config.secretKey) {
        service.configure(config);
      }
      return service;
    });

    // Register SubscriptionManager as singleton
    app.singleton('subscriptions', (container: Container) => {
      const stripeService = container.make('stripe') as StripeService;
      return new SubscriptionManager({
        stripeService,
      });
    });

    // Register webhook handler as singleton
    app.singleton('stripe-webhooks', () => {
      return new StripeWebhookHandler();
    });
  }

  /**
   * Bootstrap the plugin after all plugins are registered
   */
  async boot(app: Container): Promise<void> {
    // Get the Stripe service and ensure it's configured
    const stripeService = app.make('stripe') as StripeService;
    const config = app.make('config.stripe') as StripeConfig;

    if (config && config.secretKey) {
      stripeService.configure(config);
    }

    // Register webhook route (apps can override this)
    // The webhook handler is available in the container
  }

  /**
   * Get the default configuration for this plugin
   */
  config(): PluginConfig {
    return {
      key: 'stripe',
      defaults: {
        secretKey: process.env.STRIPE_SECRET_KEY ?? '',
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? '',
        webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
        currency: 'usd',
        trialDays: 14,
        webhookPath: '/api/webhooks/stripe',
        portalReturnUrl: '/dashboard/billing',
        checkoutSuccessUrl: '/dashboard/billing?success=true',
        checkoutCancelUrl: '/dashboard/billing?canceled=true',
      },
    };
  }

  /**
   * Get publishable files (config, migrations, etc.)
   */
  publishables?(): Record<
    string,
    Array<{ source: string; dest: string; type?: 'config' | 'migration' | 'asset' }>
  > {
    return {
      config: [
        {
          source: './config/stripe.ts',
          dest: 'config/plugins/stripe.ts',
          type: 'config',
        },
      ],
      migrations: [
        {
          source: './migrations/create_subscription_plans.ts',
          dest: 'auto',
          type: 'migration',
        },
        {
          source: './migrations/create_subscriptions.ts',
          dest: 'auto',
          type: 'migration',
        },
        {
          source: './migrations/create_invoices.ts',
          dest: 'auto',
          type: 'migration',
        },
        {
          source: './migrations/add_stripe_to_users.ts',
          dest: 'auto',
          type: 'migration',
        },
      ],
    };
  }
}

export default StripePlugin;
