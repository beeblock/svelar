/**
 * SceneManager.ts
 * Manages game scene transitions with loading, enter/exit lifecycle, and fade transitions.
 */

import type { GameEngine } from './GameEngine.js';

export abstract class GameScene {
  abstract readonly name: string;

  /**
   * Called once when the scene is first registered or explicitly preloaded.
   * Load heavy assets here. May be called before enter().
   */
  async load(_engine: GameEngine): Promise<void> {}

  /**
   * Called each time this scene becomes the active scene.
   * @param from - Name of the previous scene, if any
   */
  async enter(_engine: GameEngine, _from: string | null): Promise<void> {}

  /**
   * Called every frame while this scene is active.
   */
  update(_delta: number): void {}

  /**
   * Called after update() — useful for camera, post-processing.
   */
  lateUpdate(_delta: number): void {}

  /**
   * Called when transitioning away from this scene.
   * @param to - Name of the target scene
   */
  async exit(_engine: GameEngine, _to: string): Promise<void> {}

  /**
   * Called when this scene is explicitly unloaded to free memory.
   */
  async unload(_engine: GameEngine): Promise<void> {}
}

export interface TransitionOptions {
  /** Whether to preload the next scene before exiting the current one */
  preload?: boolean;
  /** Whether to unload the current scene after transition */
  unloadCurrent?: boolean;
  /** Fade out duration in seconds */
  fadeOutDuration?: number;
  /** Fade in duration in seconds */
  fadeInDuration?: number;
}

export class SceneManager {
  private readonly scenes = new Map<string, GameScene>();
  private current: GameScene | null = null;
  private transitioning = false;

  // Optional overlay element for fade transitions
  private fadeOverlay: HTMLElement | null = null;

  constructor(private readonly engine: GameEngine) {
    this.fadeOverlay = this.createFadeOverlay();
  }

  private createFadeOverlay(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; inset: 0;
      background: black;
      opacity: 0;
      pointer-events: none;
      transition: opacity var(--fade-duration, 0.5s) ease;
      z-index: 9999;
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  register(scene: GameScene): this {
    this.scenes.set(scene.name, scene);
    return this;
  }

  get currentScene(): GameScene | null { return this.current; }
  get currentSceneName(): string | null { return this.current?.name ?? null; }
  get isTransitioning(): boolean { return this.transitioning; }

  async start(
    initialSceneName: string,
    options: Pick<TransitionOptions, 'fadeInDuration'> = {},
  ): Promise<void> {
    const { fadeInDuration = 0.5 } = options;
    const scene = this.getScene(initialSceneName);

    await scene.load(this.engine);
    this.current = scene;
    await scene.enter(this.engine, null);

    if (fadeInDuration > 0) await this.fadeIn(fadeInDuration);
  }

  async transition(
    targetSceneName: string,
    options: TransitionOptions = {},
  ): Promise<void> {
    if (this.transitioning) {
      console.warn(`[SceneManager] Transition already in progress. Ignoring transition to "${targetSceneName}".`);
      return;
    }

    const {
      preload = true,
      unloadCurrent = false,
      fadeOutDuration = 0.5,
      fadeInDuration = 0.5,
    } = options;

    const target = this.getScene(targetSceneName);
    this.transitioning = true;

    try {
      // 1. Fade out
      if (fadeOutDuration > 0) await this.fadeOut(fadeOutDuration);

      // 2. Preload target scene (while screen is black)
      if (preload) await target.load(this.engine);

      // 3. Exit current scene
      const previous = this.current;
      if (previous) {
        await previous.exit(this.engine, targetSceneName);
        if (unloadCurrent) await previous.unload(this.engine);
      }

      // 4. Enter new scene
      const previousName = previous?.name ?? null;
      this.current = target;
      await target.enter(this.engine, previousName);

      // 5. Fade in
      if (fadeInDuration > 0) await this.fadeIn(fadeInDuration);
    } finally {
      this.transitioning = false;
    }
  }

  update(delta: number): void {
    if (!this.transitioning) {
      this.current?.update(delta);
    }
  }

  lateUpdate(delta: number): void {
    if (!this.transitioning) {
      this.current?.lateUpdate(delta);
    }
  }

  private getScene(name: string): GameScene {
    const scene = this.scenes.get(name);
    if (!scene) throw new Error(`[SceneManager] Scene "${name}" is not registered.`);
    return scene;
  }

  private fadeOut(duration: number): Promise<void> {
    return this.setFade(1, duration);
  }

  private fadeIn(duration: number): Promise<void> {
    return this.setFade(0, duration);
  }

  private setFade(opacity: number, duration: number): Promise<void> {
    return new Promise((resolve) => {
      if (!this.fadeOverlay) {
        resolve();
        return;
      }
      this.fadeOverlay.style.setProperty('--fade-duration', `${duration}s`);
      this.fadeOverlay.style.opacity = String(opacity);
      setTimeout(resolve, duration * 1000 + 50); // Small buffer after transition
    });
  }

  dispose(): void {
    this.fadeOverlay?.remove();
    this.scenes.clear();
    this.current = null;
  }
}
