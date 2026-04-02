/**
 * actingAs — Simulate an authenticated user in tests.
 *
 * Sets `event.locals.user` to the provided user object,
 * mimicking how AuthenticateMiddleware populates it.
 */

import { createRequestEvent, type RequestEventOptions } from './request.js';

/**
 * Attach a user to the event's locals, simulating authentication.
 *
 * If `event` is not provided, a fresh RequestEvent is created.
 * Returns the event with `locals.user` set.
 */
export function actingAs(user: any, event?: any): any;
export function actingAs(user: any, options?: RequestEventOptions): any;
export function actingAs(user: any, eventOrOptions?: any): any {
  let event: any;

  if (eventOrOptions && typeof eventOrOptions === 'object' && 'request' in eventOrOptions) {
    // Already a RequestEvent
    event = eventOrOptions;
  } else {
    // Create a new RequestEvent from options
    event = createRequestEvent(eventOrOptions ?? {});
  }

  event.locals.user = user;
  return event;
}
