/**
 * StateMachine.ts
 * Finite State Machine with typed transitions, guards, and lifecycle hooks.
 * Generic over the context object and state ID type.
 */

export type StateId = string;

export interface StateTransition<Context> {
  /** Target state ID */
  to: StateId;
  /** Guard condition — transition fires only when this returns true */
  when: (ctx: Context) => boolean;
  /** Optional side effect on transition */
  onTransition?: (ctx: Context, from: StateId, to: StateId) => void;
  /** Optional label for debugging */
  label?: string;
}

export interface StateDefinition<Context> {
  name: StateId;
  /** Called once when entering this state */
  onEnter?: (ctx: Context, from: StateId | null) => void | Promise<void>;
  /** Called every frame while in this state */
  onUpdate?: (ctx: Context, delta: number) => void;
  /** Called once when leaving this state */
  onExit?: (ctx: Context, to: StateId) => void | Promise<void>;
  /** List of possible outgoing transitions */
  transitions?: StateTransition<Context>[];
}

export interface FSMOptions {
  /** Log state transitions to console */
  debug?: boolean;
}

export class FiniteStateMachine<Context> {
  private states = new Map<StateId, StateDefinition<Context>>();
  private _current: StateDefinition<Context> | null = null;
  private history: StateId[] = [];
  private transitioning = false;
  private debug: boolean;

  constructor(options: FSMOptions = {}) {
    this.debug = options.debug ?? false;
  }

  addState(state: StateDefinition<Context>): this {
    this.states.set(state.name, state);
    return this;
  }

  addStates(states: StateDefinition<Context>[]): this {
    states.forEach((s) => this.addState(s));
    return this;
  }

  get current(): StateId | null {
    return this._current?.name ?? null;
  }

  get isIn(): (stateId: StateId) => boolean {
    return (id) => this._current?.name === id;
  }

  async start(initialState: StateId, ctx: Context): Promise<void> {
    const state = this.requireState(initialState);
    this._current = state;
    if (this.debug) console.log(`[FSM] Started in state: ${initialState}`);
    await state.onEnter?.(ctx, null);
  }

  /** Call once per frame — checks transitions and runs current state update */
  update(ctx: Context, delta: number): void {
    if (!this._current || this.transitioning) return;

    // Check outgoing transitions
    const transitions = this._current.transitions ?? [];
    for (const transition of transitions) {
      if (transition.when(ctx)) {
        // Fire transition asynchronously to avoid blocking update
        void this.transition(transition.to, ctx, transition.onTransition);
        return; // Only one transition per frame
      }
    }

    // Update current state
    this._current.onUpdate?.(ctx, delta);
  }

  async transition(
    to: StateId,
    ctx: Context,
    onTransitionCallback?: (ctx: Context, from: StateId, to: StateId) => void,
  ): Promise<void> {
    if (this.transitioning) {
      if (this.debug) console.warn(`[FSM] Transition to "${to}" blocked — already transitioning`);
      return;
    }

    const nextState = this.requireState(to);
    const fromId = this._current?.name ?? 'none';

    this.transitioning = true;
    try {
      if (this.debug) console.log(`[FSM] ${fromId} -> ${to}`);

      await this._current?.onExit?.(ctx, to);
      onTransitionCallback?.(ctx, fromId, to);

      if (this._current) this.history.push(this._current.name);
      this._current = nextState;

      await nextState.onEnter?.(ctx, fromId);
    } finally {
      this.transitioning = false;
    }
  }

  /** Go back to the previous state */
  async back(ctx: Context): Promise<void> {
    const prev = this.history.pop();
    if (prev) await this.transition(prev, ctx);
  }

  get previousState(): StateId | null {
    return this.history[this.history.length - 1] ?? null;
  }

  private requireState(id: StateId): StateDefinition<Context> {
    const state = this.states.get(id);
    if (!state) throw new Error(`[FSM] State "${id}" not registered`);
    return state;
  }
}

// ---------- Example: Game Flow FSM ----------

interface GameContext {
  score: number;
  lives: number;
  level: number;
  playerDead: boolean;
  levelComplete: boolean;
  pauseRequested: boolean;
  startRequested: boolean;
}

export function createGameFSM(
  onLoading: (ctx: GameContext) => Promise<void>,
  onLevelComplete: (ctx: GameContext) => void,
  onGameOver: (ctx: GameContext) => void,
): FiniteStateMachine<GameContext> {
  return new FiniteStateMachine<GameContext>({ debug: true })
    .addStates([
      {
        name: 'menu',
        onEnter: (_ctx) => { /* Show UI menu */ },
        onExit: (_ctx) => { /* Hide UI menu */ },
        transitions: [
          {
            to: 'loading',
            when: (ctx) => ctx.startRequested,
            onTransition: (ctx) => {
              ctx.startRequested = false;
              ctx.score = 0;
              ctx.lives = 3;
              ctx.level = 1;
            },
            label: 'Player pressed Start',
          },
        ],
      },
      {
        name: 'loading',
        onEnter: async (ctx) => {
          await onLoading(ctx);
        },
        transitions: [
          { to: 'countdown', when: () => true }, // Auto-transition when load completes
        ],
      },
      {
        name: 'countdown',
        onEnter: () => { /* Show 3-2-1 countdown */ },
        transitions: [
          { to: 'playing', when: (_ctx) => false }, // Drive externally via transition()
        ],
      },
      {
        name: 'playing',
        onUpdate: (_ctx, _delta) => { /* Game systems update here */ },
        transitions: [
          { to: 'paused', when: (ctx) => ctx.pauseRequested },
          { to: 'gameover', when: (ctx) => ctx.lives <= 0 },
          { to: 'levelcomplete', when: (ctx) => ctx.levelComplete },
        ],
      },
      {
        name: 'paused',
        onEnter: () => { /* Show pause menu */ },
        onExit: (ctx) => { ctx.pauseRequested = false; },
        transitions: [
          { to: 'playing', when: (ctx) => ctx.pauseRequested },
          { to: 'menu', when: () => false }, // Drive externally
        ],
      },
      {
        name: 'gameover',
        onEnter: (ctx) => onGameOver(ctx),
        transitions: [
          { to: 'menu', when: () => false }, // Drive externally
        ],
      },
      {
        name: 'levelcomplete',
        onEnter: (ctx) => {
          onLevelComplete(ctx);
          ctx.level++;
          ctx.levelComplete = false;
        },
        transitions: [
          { to: 'loading', when: () => false }, // Drive externally
        ],
      },
    ]);
}
