/**
 * Svelar Pipeline
 *
 * Laravel-inspired Pipeline (Chain of Responsibility pattern).
 * Passes data through a sequence of pipes, where each pipe can
 * transform, validate, or halt the data before passing it on.
 *
 * @example
 * ```ts
 * const result = await Pipeline.send(order)
 *   .through([
 *     ValidateStock,
 *     ApplyDiscount,
 *     CalculateTax,
 *     ChargePayment,
 *   ])
 *   .thenReturn();
 * ```
 */

// ── Types ──────────────────────────────────────────────────

/**
 * A pipe can be:
 * - A class with a handle(data, next) method
 * - An inline function (data, next) => result
 */
export type PipeFunction<T> = (passable: T, next: (passable: T) => Promise<T>) => Promise<T> | T;

export interface Pipe<T> {
  handle(passable: T, next: (passable: T) => Promise<T>): Promise<T> | T;
}

export type PipeEntry<T> = (new () => Pipe<T>) | PipeFunction<T>;

// ── Pipeline ───────────────────────────────────────────────

export class Pipeline<T> {
  private passable!: T;
  private pipes: PipeEntry<T>[] = [];
  private onCatchFn?: (error: Error, passable: T) => Promise<T> | T;

  /**
   * Set the data being sent through the pipeline.
   */
  static send<T>(passable: T): Pipeline<T> {
    const pipeline = new Pipeline<T>();
    pipeline.passable = passable;
    return pipeline;
  }

  /**
   * Set the pipes to process.
   */
  through(pipes: PipeEntry<T>[]): this {
    this.pipes = pipes;
    return this;
  }

  /**
   * Add a single pipe to the pipeline.
   */
  pipe(pipe: PipeEntry<T>): this {
    this.pipes.push(pipe);
    return this;
  }

  /**
   * Set an error handler for the pipeline.
   * If a pipe throws, this handler receives the error and current passable,
   * and can return a recovery value or re-throw.
   */
  onCatch(handler: (error: Error, passable: T) => Promise<T> | T): this {
    this.onCatchFn = handler;
    return this;
  }

  /**
   * Run the pipeline and return the final result.
   */
  async thenReturn(): Promise<T> {
    return this.run((passable) => passable);
  }

  /**
   * Run the pipeline with a final destination callback.
   */
  async then<R>(destination: (passable: T) => Promise<R> | R): Promise<R> {
    return this.run(destination);
  }

  /**
   * Execute the pipeline.
   */
  private async run<R>(destination: (passable: T) => Promise<R> | R): Promise<R> {
    // Build the chain from right to left (last pipe wraps the destination)
    let chain: (passable: T) => Promise<any> = async (passable: T) => {
      return destination(passable);
    };

    // Iterate pipes in reverse so the first pipe in the array runs first
    for (let i = this.pipes.length - 1; i >= 0; i--) {
      const pipe = this.pipes[i];
      const next = chain;

      chain = async (passable: T) => {
        if (this.isPipeClass(pipe)) {
          const instance = new pipe();
          return instance.handle(passable, next);
        } else {
          return (pipe as PipeFunction<T>)(passable, next);
        }
      };
    }

    try {
      return await chain(this.passable);
    } catch (error) {
      if (this.onCatchFn) {
        const recovered = await this.onCatchFn(error as Error, this.passable);
        return recovered as any;
      }
      throw error;
    }
  }

  private isPipeClass(pipe: PipeEntry<T>): pipe is new () => Pipe<T> {
    return (
      typeof pipe === 'function' &&
      pipe.prototype &&
      typeof pipe.prototype.handle === 'function'
    );
  }
}
