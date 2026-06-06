/**
 * GameEngine.ts
 * Base game engine with fixed-timestep game loop, scene management, and system orchestration.
 */

import * as THREE from 'three';

export interface GameEngineOptions {
  canvas: HTMLCanvasElement;
  antialias?: boolean;
  shadows?: boolean;
  pixelRatioCap?: number;
  fixedUpdateHz?: number;
}

export interface GameSystems {
  fixedUpdate?(delta: number, step: number): void;
  update?(delta: number, elapsed: number): void;
  lateUpdate?(delta: number, elapsed: number): void;
  render?(): void;
  dispose?(): void;
}

export class GameEngine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly clock: THREE.Clock;

  private animationId = 0;
  private running = false;

  // Fixed-timestep accumulator
  private readonly FIXED_STEP: number;
  private readonly MAX_DELTA = 0.1; // Cap at 100ms to prevent spiral-of-death
  private accumulator = 0;
  private fixedStepCount = 0;

  private systems: GameSystems[] = [];

  constructor(options: GameEngineOptions) {
    const {
      canvas,
      antialias = true,
      shadows = true,
      pixelRatioCap = 2,
      fixedUpdateHz = 60,
    } = options;

    this.FIXED_STEP = 1 / fixedUpdateHz;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatioCap));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    if (shadows) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }

    // Scene
    this.scene = new THREE.Scene();

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      75,
      canvas.clientWidth / canvas.clientHeight,
      0.1,
      1000,
    );

    // Clock
    this.clock = new THREE.Clock(false);

    // Handle resize
    window.addEventListener('resize', () => this.onResize());
  }

  addSystem(system: GameSystems): this {
    this.systems.push(system);
    return this;
  }

  removeSystem(system: GameSystems): this {
    const idx = this.systems.indexOf(system);
    if (idx >= 0) this.systems.splice(idx, 1);
    return this;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    this.animationId = requestAnimationFrame(() => this.tick());
  }

  private tick(): void {
    if (!this.running) return;

    const rawDelta = this.clock.getDelta();
    const delta = Math.min(rawDelta, this.MAX_DELTA);
    const elapsed = this.clock.getElapsedTime();

    // Fixed-timestep loop
    this.accumulator += delta;
    while (this.accumulator >= this.FIXED_STEP) {
      for (const sys of this.systems) sys.fixedUpdate?.(this.FIXED_STEP, this.fixedStepCount);
      this.fixedStepCount++;
      this.accumulator -= this.FIXED_STEP;
    }

    // Variable-rate update
    for (const sys of this.systems) sys.update?.(delta, elapsed);

    // Late update (camera, post-processing)
    for (const sys of this.systems) sys.lateUpdate?.(delta, elapsed);

    // Render
    for (const sys of this.systems) sys.render?.();
    this.renderer.render(this.scene, this.camera);

    this.animationId = requestAnimationFrame(() => this.tick());
  }

  pause(): void {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.animationId);
    this.clock.stop();
  }

  resume(): void {
    if (this.running) return;
    this.running = true;
    // Consume accumulated time to prevent large delta on resume
    this.clock.getDelta();
    this.accumulator = 0;
    this.clock.start();
    this.animationId = requestAnimationFrame(() => this.tick());
  }

  stop(): void {
    this.pause();
  }

  private onResize(): void {
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.stop();
    for (const sys of this.systems) sys.dispose?.();
    this.systems = [];

    // Dispose scene
    this.scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m) => {
          for (const val of Object.values(m)) {
            if (val instanceof THREE.Texture) val.dispose();
          }
          m.dispose();
        });
      }
    });

    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  get isRunning(): boolean { return this.running; }
  get renderInfo(): THREE.WebGLInfo { return this.renderer.info; }
}
