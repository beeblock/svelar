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

export class StripeWebhookHandler {
  private handlers = new Map<WebhookEventType, WebhookHandler[]>();

  on(eventType: WebhookEventType, handler: WebhookHandler): this {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    this.handlers.get(eventType)!.push(handler);
    return this;
  }

  once(eventType: WebhookEventType, handler: WebhookHandler): this {
    const wrapper: WebhookHandler = async (event) => {
      await handler(event);
      this.off(eventType, wrapper);
    };
    return this.on(eventType, wrapper);
  }

  off(eventType: WebhookEventType, handler: WebhookHandler): void {
    const handlers = this.handlers.get(eventType);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) handlers.splice(index, 1);
    }
  }

  removeAllListeners(eventType?: WebhookEventType): void {
    if (eventType) {
      this.handlers.delete(eventType);
    } else {
      this.handlers.clear();
    }
  }

  async handle(event: Stripe.Event): Promise<void> {
    const handlers = this.handlers.get(event.type as WebhookEventType) || [];
    for (const handler of handlers) {
      try {
        await handler(event);
      } catch (error) {
        console.error(`Error handling webhook event ${event.type}:`, error);
        throw error;
      }
    }
  }

  getHandlers(eventType: WebhookEventType): WebhookHandler[] {
    return this.handlers.get(eventType) || [];
  }

  getEventTypes(): WebhookEventType[] {
    return Array.from(this.handlers.keys());
  }

  hasHandlers(eventType: WebhookEventType): boolean {
    const handlers = this.handlers.get(eventType);
    return !!handlers && handlers.length > 0;
  }
}
