/**
 * Svelar Listener
 *
 * Base class for event listeners. Listeners encapsulate the logic
 * that runs in response to a dispatched event.
 *
 * @example
 * ```ts
 * import { Listener } from '@beeblock/svelar/events';
 *
 * export class SendWelcomeEmail extends Listener {
 *   async handle(event: UserRegistered) {
 *     await Mail.to(event.user.email).send(new WelcomeEmail(event.user));
 *   }
 * }
 * ```
 */

export abstract class Listener<T = any> {
  /**
   * Handle the event.
   */
  abstract handle(event: T): void | Promise<void>;

  /**
   * Determine whether the listener should handle the event.
   * Override to add conditional logic.
   */
  shouldHandle(_event: T): boolean {
    return true;
  }
}
