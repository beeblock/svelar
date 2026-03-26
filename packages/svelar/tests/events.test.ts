import { describe, it, expect, beforeEach } from 'vitest';
import { EventDispatcher } from '../src/events/index';
import type { Subscriber } from '../src/events/index';

describe('EventDispatcher', () => {
  let dispatcher: EventDispatcher;

  beforeEach(() => {
    dispatcher = new EventDispatcher();
  });

  describe('listen', () => {
    it('should register an event listener', () => {
      const listener = () => {};
      dispatcher.listen('test-event', listener);

      expect(dispatcher.hasListeners('test-event')).toBe(true);
    });

    it('should support class-based events', () => {
      class UserCreated {
        constructor(public userId: number) {}
      }

      const listener = () => {};
      dispatcher.listen(UserCreated, listener);

      expect(dispatcher.hasListeners(UserCreated)).toBe(true);
    });

    it('should return an unsubscribe function', async () => {
      let called = false;
      const listener = () => {
        called = true;
      };

      const unsubscribe = dispatcher.listen('event', listener);
      expect(dispatcher.hasListeners('event')).toBe(true);

      await dispatcher.emit('event');
      expect(called).toBe(true);

      called = false;
      unsubscribe();
      await dispatcher.emit('event');
      expect(called).toBe(false);
    });

    it('should support multiple listeners for the same event', async () => {
      const calls: string[] = [];

      dispatcher.listen('event', () => calls.push('first'));
      dispatcher.listen('event', () => calls.push('second'));

      await dispatcher.emit('event');

      expect(calls).toEqual(['first', 'second']);
    });

    it('should call listeners with event data', async () => {
      class OrderPlaced {
        constructor(public orderId: number) {}
      }

      let capturedEvent: OrderPlaced | null = null;

      dispatcher.listen(OrderPlaced, (event) => {
        capturedEvent = event;
      });

      const event = new OrderPlaced(123);
      await dispatcher.dispatch(event);

      expect(capturedEvent).toBe(event);
      expect(capturedEvent?.orderId).toBe(123);
    });
  });

  describe('once', () => {
    it('should register a one-time listener', async () => {
      let callCount = 0;
      dispatcher.once('event', () => {
        callCount++;
      });

      await dispatcher.emit('event');
      await dispatcher.emit('event');
      await dispatcher.emit('event');

      expect(callCount).toBe(1);
    });

    it('should work with class-based events', async () => {
      class NotificationSent {
        constructor(public userId: number) {}
      }

      let callCount = 0;
      dispatcher.once(NotificationSent, () => {
        callCount++;
      });

      await dispatcher.dispatch(new NotificationSent(1));
      await dispatcher.dispatch(new NotificationSent(1));

      expect(callCount).toBe(1);
    });

    it('should return an unsubscribe function', async () => {
      let called = false;
      const unsubscribe = dispatcher.once('event', () => {
        called = true;
      });

      unsubscribe();
      await dispatcher.emit('event');

      expect(called).toBe(false);
    });

    it('should auto-unsubscribe after first dispatch', async () => {
      let callCount = 0;
      dispatcher.once('event', () => {
        callCount++;
      });

      await dispatcher.emit('event');
      expect(dispatcher.hasListeners('event')).toBe(false);
    });
  });

  describe('onAny', () => {
    it('should call wildcard listener for any event', async () => {
      const events: Array<[string, any]> = [];

      dispatcher.onAny((eventName, payload) => {
        events.push([eventName, payload]);
      });

      await dispatcher.emit('event1', { data: 1 });
      await dispatcher.emit('event2', { data: 2 });

      expect(events).toHaveLength(2);
      expect(events[0]).toEqual(['event1', { data: 1 }]);
      expect(events[1]).toEqual(['event2', { data: 2 }]);
    });

    it('should work with dispatched class events', async () => {
      class UserRegistered {
        constructor(public userId: number) {}
      }

      const events: string[] = [];
      dispatcher.onAny((eventName) => {
        events.push(eventName);
      });

      await dispatcher.dispatch(new UserRegistered(1));

      expect(events).toContain('UserRegistered');
    });

    it('should return an unsubscribe function', async () => {
      let called = false;
      const listener = () => {
        called = true;
      };

      const unsubscribe = dispatcher.onAny(listener);
      unsubscribe();

      await dispatcher.emit('event');

      expect(called).toBe(false);
    });
  });

  describe('dispatch', () => {
    it('should dispatch class-based events', async () => {
      class PaymentProcessed {
        constructor(public amount: number) {}
      }

      let received: PaymentProcessed | null = null;

      dispatcher.listen(PaymentProcessed, (event) => {
        received = event;
      });

      const event = new PaymentProcessed(100);
      await dispatcher.dispatch(event);

      expect(received).toBe(event);
      expect(received?.amount).toBe(100);
    });

    it('should call wildcard listeners during dispatch', async () => {
      class ItemShipped {}

      const wildcardEvents: string[] = [];
      dispatcher.onAny((eventName) => {
        wildcardEvents.push(eventName);
      });

      await dispatcher.dispatch(new ItemShipped());

      expect(wildcardEvents).toContain('ItemShipped');
    });

    it('should call both regular and once listeners', async () => {
      class Event {}

      const calls: string[] = [];

      dispatcher.listen(Event, () => calls.push('regular'));
      dispatcher.once(Event, () => calls.push('once'));

      await dispatcher.dispatch(new Event());
      await dispatcher.dispatch(new Event());

      expect(calls).toEqual(['regular', 'once', 'regular']);
    });
  });

  describe('emit', () => {
    it('should emit events by string name', async () => {
      let received: any = null;

      dispatcher.listen('custom-event', (payload) => {
        received = payload;
      });

      await dispatcher.emit('custom-event', { userId: 1 });

      expect(received).toEqual({ userId: 1 });
    });

    it('should emit without payload', async () => {
      let called = false;

      dispatcher.listen('simple', () => {
        called = true;
      });

      await dispatcher.emit('simple');

      expect(called).toBe(true);
    });

    it('should call once listeners for string events', async () => {
      let callCount = 0;

      dispatcher.once('temporary', () => {
        callCount++;
      });

      await dispatcher.emit('temporary');
      await dispatcher.emit('temporary');

      expect(callCount).toBe(1);
    });
  });

  describe('subscribe', () => {
    it('should subscribe a subscriber object', () => {
      const subscriber: Subscriber = {
        subscribe(events) {
          events.listen('user-created', () => {});
          events.listen('user-deleted', () => {});
        },
      };

      dispatcher.subscribe(subscriber);

      expect(dispatcher.hasListeners('user-created')).toBe(true);
      expect(dispatcher.hasListeners('user-deleted')).toBe(true);
    });

    it('should pass the dispatcher to the subscriber', () => {
      let receivedDispatcher: EventDispatcher | null = null;

      const subscriber: Subscriber = {
        subscribe(events) {
          receivedDispatcher = events;
        },
      };

      dispatcher.subscribe(subscriber);

      expect(receivedDispatcher).toBe(dispatcher);
    });
  });

  describe('forget', () => {
    it('should remove all listeners for a string event', async () => {
      dispatcher.listen('event', () => {});
      dispatcher.listen('event', () => {});

      expect(dispatcher.hasListeners('event')).toBe(true);

      dispatcher.forget('event');

      expect(dispatcher.hasListeners('event')).toBe(false);
    });

    it('should remove all listeners for a class event', async () => {
      class Event {}

      dispatcher.listen(Event, () => {});
      dispatcher.once(Event, () => {});

      expect(dispatcher.hasListeners(Event)).toBe(true);

      dispatcher.forget(Event);

      expect(dispatcher.hasListeners(Event)).toBe(false);
    });

    it('should not affect other events', () => {
      dispatcher.listen('event1', () => {});
      dispatcher.listen('event2', () => {});

      dispatcher.forget('event1');

      expect(dispatcher.hasListeners('event1')).toBe(false);
      expect(dispatcher.hasListeners('event2')).toBe(true);
    });
  });

  describe('flush', () => {
    it('should remove all listeners', () => {
      dispatcher.listen('event1', () => {});
      dispatcher.listen('event2', () => {});
      dispatcher.onAny(() => {});

      dispatcher.flush();

      expect(dispatcher.hasListeners('event1')).toBe(false);
      expect(dispatcher.hasListeners('event2')).toBe(false);
    });

    it('should clear wildcard listeners', async () => {
      let wildCardCalled = false;
      dispatcher.onAny(() => {
        wildCardCalled = true;
      });

      dispatcher.flush();

      await dispatcher.emit('event');

      expect(wildCardCalled).toBe(false);
    });
  });

  describe('hasListeners', () => {
    it('should return true if event has listeners', () => {
      dispatcher.listen('event', () => {});

      expect(dispatcher.hasListeners('event')).toBe(true);
    });

    it('should return false if event has no listeners', () => {
      expect(dispatcher.hasListeners('unknown')).toBe(false);
    });

    it('should return true if wildcard listeners exist', () => {
      dispatcher.onAny(() => {});

      expect(dispatcher.hasListeners('any-event')).toBe(true);
    });

    it('should work with class events', () => {
      class Event {}

      dispatcher.listen(Event, () => {});

      expect(dispatcher.hasListeners(Event)).toBe(true);
    });
  });

  describe('listenerCount', () => {
    it('should return the count of listeners for an event', () => {
      dispatcher.listen('event', () => {});
      dispatcher.listen('event', () => {});
      dispatcher.once('event', () => {});

      expect(dispatcher.listenerCount('event')).toBe(3);
    });

    it('should return 0 for unknown events', () => {
      expect(dispatcher.listenerCount('unknown')).toBe(0);
    });

    it('should work with class events', () => {
      class Event {}

      dispatcher.listen(Event, () => {});
      dispatcher.listen(Event, () => {});

      expect(dispatcher.listenerCount(Event)).toBe(2);
    });

    it('should not count wildcard listeners', () => {
      dispatcher.listen('event', () => {});
      dispatcher.onAny(() => {});

      expect(dispatcher.listenerCount('event')).toBe(1);
    });
  });

  describe('async listeners', () => {
    it('should support async listener functions', async () => {
      let resolved = false;

      dispatcher.listen('async-event', async () => {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolved = true;
            resolve(undefined);
          }, 10);
        });
      });

      await dispatcher.emit('async-event');

      expect(resolved).toBe(true);
    });

    it('should wait for all listeners to complete', async () => {
      const order: string[] = [];

      dispatcher.listen('event', async () => {
        await new Promise((r) => setTimeout(r, 20));
        order.push('first');
      });

      dispatcher.listen('event', async () => {
        await new Promise((r) => setTimeout(r, 10));
        order.push('second');
      });

      await dispatcher.emit('event');

      expect(order).toEqual(['first', 'second']);
    });
  });

  describe('integration', () => {
    it('should handle complex event flows', async () => {
      class UserRegistered {
        constructor(public email: string) {}
      }

      class EmailSent {
        constructor(public to: string, public template: string) {}
      }

      const events: any[] = [];

      dispatcher.listen(UserRegistered, (e) => {
        events.push(e.email);
      });

      dispatcher.listen(EmailSent, (e) => {
        events.push(`Email to ${e.to}`);
      });

      dispatcher.onAny((name) => {
        events.push(`Wildcard: ${name}`);
      });

      await dispatcher.dispatch(new UserRegistered('user@example.com'));
      await dispatcher.dispatch(new EmailSent('user@example.com', 'welcome'));

      expect(events).toContain('user@example.com');
      expect(events).toContain('Email to user@example.com');
      expect(events).toContain('Wildcard: UserRegistered');
      expect(events).toContain('Wildcard: EmailSent');
    });
  });
});
