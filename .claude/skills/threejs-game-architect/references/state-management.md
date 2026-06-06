# State Management

## Finite State Machine

```typescript
// Strongly typed FSM for game states
type StateId = string;

interface StateTransition<Context> {
  to: StateId;
  condition: (ctx: Context) => boolean;
  onTransition?: (ctx: Context) => void;
}

interface State<Context> {
  name: StateId;
  onEnter?: (ctx: Context, from: StateId | null) => void;
  onUpdate?: (ctx: Context, delta: number) => void;
  onExit?: (ctx: Context, to: StateId) => void;
  transitions: StateTransition<Context>[];
}

class FSM<Context> {
  private states = new Map<StateId, State<Context>>();
  private _current: State<Context> | null = null;
  private history: StateId[] = [];

  get current(): StateId | null { return this._current?.name ?? null; }

  addState(state: State<Context>): this {
    this.states.set(state.name, state);
    return this;
  }

  start(initialState: StateId, ctx: Context): void {
    const state = this.states.get(initialState);
    if (!state) throw new Error(`State "${initialState}" not registered`);
    this._current = state;
    state.onEnter?.(ctx, null);
  }

  update(ctx: Context, delta: number): void {
    if (!this._current) return;

    // Check transitions
    for (const transition of this._current.transitions) {
      if (transition.condition(ctx)) {
        this.transition(transition.to, ctx);
        transition.onTransition?.(ctx);
        break; // Only one transition per update
      }
    }

    // Update current state
    this._current?.onUpdate?.(ctx, delta);
  }

  transition(to: StateId, ctx: Context): void {
    if (!this._current) return;
    const fromId = this._current.name;
    const nextState = this.states.get(to);
    if (!nextState) throw new Error(`State "${to}" not registered`);

    this._current.onExit?.(ctx, to);
    this.history.push(fromId);
    this._current = nextState;
    nextState.onEnter?.(ctx, fromId);
  }

  isIn(stateId: StateId): boolean { return this._current?.name === stateId; }

  back(ctx: Context): void {
    const prev = this.history.pop();
    if (prev) this.transition(prev, ctx);
  }
}

// Game state machine example
interface GameContext {
  score: number;
  lives: number;
  level: number;
  playerDead: boolean;
  levelComplete: boolean;
  pauseRequested: boolean;
}

const gameFSM = new FSM<GameContext>()
  .addState({
    name: 'menu',
    onEnter: (ctx, from) => {
      console.log('Showing main menu');
      uiManager.showMenu();
      audioManager.playBGM('menu_theme');
    },
    onExit: () => uiManager.hideMenu(),
    transitions: [
      {
        to: 'loading',
        condition: (ctx) => inputActions.isDown('startGame'),
        onTransition: (ctx) => { ctx.score = 0; ctx.lives = 3; ctx.level = 1; },
      },
    ],
  })
  .addState({
    name: 'loading',
    onEnter: async (ctx) => {
      uiManager.showLoading();
      await sceneManager.loadLevel(ctx.level);
    },
    onExit: () => uiManager.hideLoading(),
    transitions: [
      { to: 'playing', condition: () => sceneManager.isLoaded },
    ],
  })
  .addState({
    name: 'playing',
    onEnter: (ctx, from) => {
      if (from !== 'paused') {
        sceneManager.spawnPlayer();
        audioManager.playBGM('gameplay_theme');
      }
    },
    onUpdate: (ctx, delta) => {
      gameLoop.update(delta);
    },
    transitions: [
      { to: 'paused', condition: (ctx) => ctx.pauseRequested },
      { to: 'gameover', condition: (ctx) => ctx.lives <= 0 },
      { to: 'levelcomplete', condition: (ctx) => ctx.levelComplete },
    ],
  })
  .addState({
    name: 'paused',
    onEnter: () => {
      uiManager.showPauseMenu();
      audioManager.pauseAll();
    },
    onExit: (ctx) => {
      ctx.pauseRequested = false;
      uiManager.hidePauseMenu();
      audioManager.resumeAll();
    },
    transitions: [
      { to: 'playing', condition: (ctx) => inputActions.isDown('pause') },
      { to: 'menu', condition: () => uiManager.quitPressed },
    ],
  })
  .addState({
    name: 'gameover',
    onEnter: () => {
      uiManager.showGameOver();
      audioManager.playOneShot('gameover_sound');
    },
    transitions: [
      { to: 'menu', condition: () => inputActions.isDown('startGame') },
    ],
  })
  .addState({
    name: 'levelcomplete',
    onEnter: (ctx) => {
      ctx.level++;
      ctx.levelComplete = false;
      uiManager.showLevelComplete(ctx.score);
    },
    transitions: [
      {
        to: 'loading',
        condition: () => inputActions.isDown('startGame'),
      },
    ],
  });
```

## Scene Manager

```typescript
abstract class GameScene {
  abstract readonly name: string;
  protected engine!: GameEngine;

  // Override these
  async load(): Promise<void> {}
  async enter(from?: string): Promise<void> {}
  update(delta: number): void {}
  lateUpdate(delta: number): void {}
  async exit(to?: string): Promise<void> {}
  async unload(): Promise<void> {}
}

class SceneManager {
  private scenes = new Map<string, GameScene>();
  private current: GameScene | null = null;
  private loading = false;

  register(scene: GameScene): void {
    this.scenes.set(scene.name, scene);
  }

  get currentScene(): GameScene | null { return this.current; }

  async transition(
    name: string,
    options: {
      preload?: boolean;
      unloadPrevious?: boolean;
      fadeOut?: number;
      fadeIn?: number;
    } = {},
  ): Promise<void> {
    if (this.loading) {
      console.warn('Scene transition already in progress');
      return;
    }
    this.loading = true;

    const { preload = true, unloadPrevious = true, fadeOut = 0.5, fadeIn = 0.5 } = options;
    const next = this.scenes.get(name);
    if (!next) throw new Error(`Scene "${name}" not registered`);

    try {
      // Fade out
      if (fadeOut > 0) await uiManager.fadeOut(fadeOut);

      // Exit current scene
      if (this.current) {
        await this.current.exit(name);
        if (unloadPrevious) await this.current.unload();
      }

      // Preload next scene
      if (preload) await next.load();

      // Enter next scene
      const prevName = this.current?.name;
      this.current = next;
      await next.enter(prevName);

      // Fade in
      if (fadeIn > 0) await uiManager.fadeIn(fadeIn);
    } finally {
      this.loading = false;
    }
  }

  update(delta: number): void {
    this.current?.update(delta);
  }

  lateUpdate(delta: number): void {
    this.current?.lateUpdate(delta);
  }
}
```

## Event Bus

```typescript
// Type-safe event bus for decoupled communication between systems
type Handler<T> = (data: T) => void;

class TypedEventBus<Events extends Record<string, unknown>> {
  private handlers = new Map<keyof Events, Set<Handler<unknown>>>();

  on<K extends keyof Events>(
    event: K,
    handler: Handler<Events[K]>,
  ): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    const set = this.handlers.get(event)!;
    set.add(handler as Handler<unknown>);

    // Return unsubscribe function
    return () => set.delete(handler as Handler<unknown>);
  }

  once<K extends keyof Events>(
    event: K,
    handler: Handler<Events[K]>,
  ): void {
    const unsub = this.on(event, (data) => {
      handler(data);
      unsub();
    });
  }

  emit<K extends keyof Events>(event: K, data: Events[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(data);
      } catch (err) {
        console.error(`Error in event handler for "${String(event)}":`, err);
      }
    }
  }

  off<K extends keyof Events>(event: K, handler?: Handler<Events[K]>): void {
    if (!handler) {
      this.handlers.delete(event);
    } else {
      this.handlers.get(event)?.delete(handler as Handler<unknown>);
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}

// Define game events
type GameEventMap = {
  'player:damage': { entityId: number; amount: number; attacker?: number };
  'player:death': { entityId: number; position: THREE.Vector3 };
  'player:respawn': { entityId: number; position: THREE.Vector3 };
  'enemy:death': { entityId: number; position: THREE.Vector3; score: number };
  'score:change': { score: number; delta: number };
  'level:complete': { level: number; score: number; time: number };
  'game:pause': Record<string, never>;
  'game:resume': Record<string, never>;
  'collectible:picked': { entityId: number; type: string; value: number };
  'weapon:fire': { entityId: number; position: THREE.Vector3; direction: THREE.Vector3 };
};

const events = new TypedEventBus<GameEventMap>();

// Typed usage
const unsub = events.on('player:damage', ({ entityId, amount }) => {
  console.log(`Entity ${entityId} took ${amount} damage`);
});
events.emit('score:change', { score: 1500, delta: 100 });
// Clean up
unsub();
```

## Save and Load System

```typescript
interface SaveData {
  version: number;
  timestamp: number;
  player: {
    level: number;
    score: number;
    lives: number;
    position: [number, number, number];
  };
  world: {
    completedLevels: number[];
    collectedItems: string[];
  };
  settings: {
    masterVolume: number;
    sfxVolume: number;
    bgmVolume: number;
    sensitivity: number;
    graphics: 'low' | 'medium' | 'high';
  };
}

class SaveSystem {
  private readonly SAVE_KEY = 'game_save';
  private readonly SETTINGS_KEY = 'game_settings';
  private readonly VERSION = 1;

  save(data: Omit<SaveData, 'version' | 'timestamp'>): boolean {
    try {
      const saveData: SaveData = {
        ...data,
        version: this.VERSION,
        timestamp: Date.now(),
      };
      localStorage.setItem(this.SAVE_KEY, JSON.stringify(saveData));
      return true;
    } catch (err) {
      console.error('Save failed:', err);
      return false;
    }
  }

  load(): SaveData | null {
    try {
      const raw = localStorage.getItem(this.SAVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw) as SaveData;

      // Version migration
      if (data.version < this.VERSION) {
        return this.migrate(data);
      }

      return data;
    } catch (err) {
      console.error('Load failed:', err);
      return null;
    }
  }

  private migrate(data: SaveData): SaveData {
    // Handle save format migrations here
    console.log(`Migrating save from v${data.version} to v${this.VERSION}`);
    return { ...data, version: this.VERSION };
  }

  hasSave(): boolean {
    return localStorage.getItem(this.SAVE_KEY) !== null;
  }

  deleteSave(): void {
    localStorage.removeItem(this.SAVE_KEY);
  }

  saveSettings(settings: SaveData['settings']): void {
    localStorage.setItem(this.SETTINGS_KEY, JSON.stringify(settings));
  }

  loadSettings(): SaveData['settings'] | null {
    try {
      const raw = localStorage.getItem(this.SETTINGS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  // For larger save data, use IndexedDB
  async saveToIndexedDB(data: SaveData): Promise<void> {
    const db = await this.openDB();
    const tx = db.transaction('saves', 'readwrite');
    const store = tx.objectStore('saves');
    await new Promise<void>((resolve, reject) => {
      const req = store.put({ id: 'main', ...data });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  private openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('GameSaveDB', 1);
      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        db.createObjectStore('saves', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
}
```

## Game Phase System

```typescript
// Manages game phases within a level (pre-game, gameplay, result)
type GamePhase = 'countdown' | 'playing' | 'dead' | 'levelComplete' | 'scoreboard';

class GamePhaseManager {
  private _phase: GamePhase = 'countdown';
  private timer = 0;

  get phase(): GamePhase { return this._phase; }
  get timeInPhase(): number { return this.timer; }

  setPhase(phase: GamePhase): void {
    console.log(`Phase transition: ${this._phase} -> ${phase}`);
    this._phase = phase;
    this.timer = 0;
    events.emit(`game:${phase}` as any, {} as any);
  }

  update(delta: number): void {
    this.timer += delta;

    switch (this._phase) {
      case 'countdown':
        if (this.timer >= 3) this.setPhase('playing');
        break;
      case 'dead':
        if (this.timer >= 3) {
          // Respawn or game over logic
        }
        break;
    }
  }
}
```
