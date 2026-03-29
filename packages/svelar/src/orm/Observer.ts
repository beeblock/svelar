/**
 * Svelar Model Observer
 *
 * Observers encapsulate model lifecycle logic in a dedicated class.
 * Each method corresponds to a model event and receives the model instance.
 *
 * @example
 * ```ts
 * class UserObserver extends ModelObserver {
 *   async created(user: User) {
 *     await sendWelcomeEmail(user);
 *   }
 *
 *   async deleting(user: User) {
 *     await user.posts().query().delete();
 *   }
 * }
 *
 * User.observe(new UserObserver());
 * ```
 */

import type { Model } from './Model.js';

export type ModelEventName =
  | 'creating' | 'created'
  | 'updating' | 'updated'
  | 'saving' | 'saved'
  | 'deleting' | 'deleted';

export const MODEL_EVENTS: ModelEventName[] = [
  'creating', 'created',
  'updating', 'updated',
  'saving', 'saved',
  'deleting', 'deleted',
];

export abstract class ModelObserver {
  creating?(model: Model): Promise<void> | void;
  created?(model: Model): Promise<void> | void;
  updating?(model: Model): Promise<void> | void;
  updated?(model: Model): Promise<void> | void;
  saving?(model: Model): Promise<void> | void;
  saved?(model: Model): Promise<void> | void;
  deleting?(model: Model): Promise<void> | void;
  deleted?(model: Model): Promise<void> | void;
}
