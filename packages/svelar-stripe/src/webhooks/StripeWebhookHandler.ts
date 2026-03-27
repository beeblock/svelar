/**
 * StripeWebhookHandler
 *
 * Processes incoming Stripe webhook events and dispatches them to handlers.
 */

import type Stripe from 'stripe';

export type WebhookEventType =
  | 'customer.subscription.created'
  | 'customer.subscription.updated'
  | 'customer.subscription.deleted'
  | 'invoice.payment_succeeded'
  | 'invoice.payment_failed'
  | 'customer.created'
  | 'customer.updated'
  | 'customer.deleted'
  | 'checkout.session.completed'
  | 'invoice.created'
  | 'invoice.finalized'
  | 'charge.refunded'
  | string;

export type WebhookHandler = (event: Stripe.Event) => Promise<void>;

/**
 * Handles Stripe webhook events
 */
export class StripeWebhookHandler {
  private handlers = new Map<WebhookEventType, WebhookHandler[]>();

  constructor() {
    this.registerDefaultHandlers();
  }

  /**
   * Register default event handlers (no-ops that can be overridden)
   */
  private registerDefaultHandlers(): void {
    // Default handlers do nothing - users can override with .on()
    this.on('customer.subscription.created', async () => {});
    this.on('customer.subscription.updated', async () => {});
    this.on('customer.subscription.deleted', async () => {});
    this.on('invoice.payment_succeeded', async () => {});
    this.on('invoice.payment_failed', async () => {});
    this.on('customer.created', async () => {});
    this.on('checkout.session.completed', async () => {});
  }

  /**
   * Register a handler for a webhook event
   */
  on(eventType: WebhookEventType, handler: WebhookHandler): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    this.handlers.get(eventType)!.push(handler);
  }

  /**
   * Register a handler that will only run once
   */
  once(eventType: WebhookEventType, handler: WebhookHandler): void {
    const wrapper: WebhookHandler = async (event) => {
      await handler(event);
      this.off(eventType, wrapper);
    };
    this.on(eventType, wrapper);
  }

  /**
   * Remove a specific handler
   */
  off(eventType: WebhookEventType, handler: WebhookHandler): void {
    const handlers = this.handlers.get(eventType);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * Remove all handlers for an event type
   */
  removeAllListeners(eventType?: WebhookEventType): void {
    if (eventType) {
      this.handlers.delete(eventType);
    } else {
      this.handlers.clear();
    }
  }

  /**
   * Process an incoming webhook event
   */
  async handle(event: Stripe.Event): Promise<void> {
    const handlers = this.handlers.get(event.type as WebhookEventType) || [];

    // Execute all handlers for this event type
    for (const handler of handlers) {
      try {
        await handler(event);
      } catch (error) {
        console.error(`Error handling webhook event ${event.type}:`, error);
        throw error;
      }
    }
  }

  /**
   * Get all registered handlers for an event type
   */
  getHandlers(eventType: WebhookEventType): WebhookHandler[] {
    return this.handlers.get(eventType) || [];
  }

  /**
   * Get all registered event types
   */
  getEventTypes(): WebhookEventType[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Check if there are handlers for an event type
   */
  hasHandlers(eventType: WebhookEventType): boolean {
    const handlers = this.handlers.get(eventType);
    return handlers && handlers.length > 0;
  }

  /**
   * Create a SvelteKit request handler for webhook route
   */
  createRequestHandler(
    secret: string,
  ): (event: any) => Promise<Response> {
    return async (event: any): Promise<Response> => {
      try {
        // Get raw body and signature
        let body: string | Buffer;
        if (event.request.body instanceof ReadableStream) {
          const chunks: Uint8Array[] = [];
          const reader = event.request.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
          }
          body = Buffer.concat(chunks);
        } else if (typeof event.request.body === 'string') {
          body = event.request.body;
        } else if (event.request.body instanceof Buffer) {
          body = event.request.body;
        } else {
          body = JSON.stringify(event.request.body);
        }

        const signature = event.request.headers.get('stripe-signature');
        if (!signature) {
          return new Response('No Stripe signature header', { status: 400 });
        }

        // This would be implemented by the app using this handler
        // The app needs to call stripeService.constructWebhookEvent()
        // and then handler.handle(event)
        return new Response(
          JSON.stringify({ received: true }),
          { status: 200 },
        );
      } catch (error) {
        console.error('Webhook error:', error);
        return new Response('Webhook processing failed', { status: 500 });
      }
    };
  }
}

export const createWebhookHandler = (): StripeWebhookHandler => {
  return new StripeWebhookHandler();
};
