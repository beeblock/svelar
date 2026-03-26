/**
 * Svelar Actions
 *
 * Single-responsibility action classes for complex business operations.
 * Each action does ONE thing, following the Command pattern.
 *
 * @example
 * ```ts
 * import { Action } from 'svelar/actions';
 *
 * class RegisterUserAction extends Action<RegisterDTO, User> {
 *   constructor(
 *     private userRepo: UserRepository,
 *     private mailer: Mailer,
 *   ) {
 *     super();
 *   }
 *
 *   async execute(data: RegisterDTO): Promise<User> {
 *     const user = await this.userRepo.create({
 *       name: data.name,
 *       email: data.email,
 *       password: await Hash.make(data.password),
 *     });
 *
 *     await this.mailer.send({
 *       to: user.email,
 *       template: 'welcome',
 *     });
 *
 *     return user;
 *   }
 * }
 *
 * // Usage
 * const action = new RegisterUserAction(userRepo, mailer);
 * const user = await action.run(dto);
 * ```
 */

// ── Types ──────────────────────────────────────────────────

export interface ActionResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

export type ActionMiddleware<TInput = any> = (
  input: TInput,
  next: (input: TInput) => Promise<any>,
) => Promise<any>;

// ── Base Action Class ──────────────────────────────────────

export abstract class Action<TInput = any, TOutput = any> {
  private beforeHooks: Array<(input: TInput) => Promise<void> | void> = [];
  private afterHooks: Array<(input: TInput, output: TOutput) => Promise<void> | void> = [];
  private middlewarePipeline: ActionMiddleware<TInput>[] = [];

  /**
   * Execute the action logic. Override this in subclasses.
   */
  abstract execute(input: TInput): Promise<TOutput>;

  /**
   * Run the action with before/after hooks and middleware pipeline
   */
  async run(input: TInput): Promise<TOutput> {
    // Run before hooks
    for (const hook of this.beforeHooks) {
      await hook(input);
    }

    // Build middleware pipeline
    let result: TOutput;
    if (this.middlewarePipeline.length > 0) {
      result = await this.runWithMiddleware(input);
    } else {
      result = await this.execute(input);
    }

    // Run after hooks
    for (const hook of this.afterHooks) {
      await hook(input, result);
    }

    return result;
  }

  /**
   * Run the action and catch errors, returning an ActionResult
   */
  async runSafe(input: TInput): Promise<ActionResult<TOutput>> {
    try {
      const data = await this.run(input);
      return { success: true, data };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Register a before hook
   */
  before(hook: (input: TInput) => Promise<void> | void): this {
    this.beforeHooks.push(hook);
    return this;
  }

  /**
   * Register an after hook
   */
  after(hook: (input: TInput, output: TOutput) => Promise<void> | void): this {
    this.afterHooks.push(hook);
    return this;
  }

  /**
   * Add middleware to the action pipeline
   */
  through(middleware: ActionMiddleware<TInput>): this {
    this.middlewarePipeline.push(middleware);
    return this;
  }

  /**
   * Run the action through the middleware pipeline
   */
  private async runWithMiddleware(input: TInput): Promise<TOutput> {
    let index = 0;
    const middlewares = this.middlewarePipeline;

    const next = async (currentInput: TInput): Promise<TOutput> => {
      if (index >= middlewares.length) {
        return this.execute(currentInput);
      }
      const mw = middlewares[index++];
      return mw(currentInput, next);
    };

    return next(input);
  }
}

// ── Chainable Action ───────────────────────────────────────

/**
 * An action that can be chained into a pipeline of actions.
 * The output of one becomes the input of the next.
 */
export abstract class ChainableAction<TInput = any, TOutput = any> extends Action<TInput, TOutput> {
  /**
   * Chain another action after this one
   */
  then<TNext>(nextAction: ChainableAction<TOutput, TNext>): ChainableAction<TInput, TNext> {
    return new PipelineAction(this, nextAction);
  }
}

class PipelineAction<TInput, TMid, TOutput> extends ChainableAction<TInput, TOutput> {
  constructor(
    private first: ChainableAction<TInput, TMid>,
    private second: ChainableAction<TMid, TOutput>,
  ) {
    super();
  }

  async execute(input: TInput): Promise<TOutput> {
    const mid = await this.first.run(input);
    return this.second.run(mid);
  }
}

// ── Inline Action ──────────────────────────────────────────

/**
 * Create an action from a simple function, without creating a class.
 *
 * @example
 * ```ts
 * const sendEmail = inlineAction(async (data: { to: string; body: string }) => {
 *   await mailer.send(data);
 * });
 *
 * await sendEmail.run({ to: 'user@example.com', body: 'Hello!' });
 * ```
 */
export function inlineAction<TInput = any, TOutput = any>(
  fn: (input: TInput) => Promise<TOutput>,
): Action<TInput, TOutput> {
  class InlineAction extends Action<TInput, TOutput> {
    async execute(input: TInput): Promise<TOutput> {
      return fn(input);
    }
  }
  return new InlineAction();
}
