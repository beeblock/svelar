/**
 * BasicGame.ts
 * Minimal but complete Three.js game example.
 * Features: game loop, ECS, input, physics (Rapier), audio, and a simple scene.
 *
 * This is a self-contained starting point — extend and split into modules as the game grows.
 *
 * Usage:
 *   const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!;
 *   const game = new BasicGame(canvas);
 *   await game.init();
 *   game.start();
 */

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { GameEngine } from '../core/GameEngine.js';
import {
  EntityManager,
  MovementSystem,
  RenderSyncSystem,
  LifetimeSystem,
  HealthSystem,
} from '../core/EntityManager.js';
import { InputManager, Keys, MouseButton } from '../core/InputManager.js';
import { AssetManager } from '../core/AssetManager.js';
import { AudioManager, SoundPool } from '../systems/AudioManager.js';
import { PhysicsWorld, CollisionGroups, encodeCollisionGroups } from '../systems/PhysicsWorld.js';
import { FiniteStateMachine } from '../systems/StateMachine.js';
import { createOutdoorLighting } from '../rendering/Renderer.js';

// ---------- Game Context ----------

interface GameCtx {
  score: number;
  lives: number;
  playerEntityId: number;
  paused: boolean;
}

// ---------- Main Game Class ----------

export class BasicGame {
  private engine: GameEngine;
  private em: EntityManager;
  private input: InputManager;
  private assets: AssetManager;
  private audio: AudioManager;
  private physics!: PhysicsWorld;
  private fsm: FiniteStateMachine<GameCtx>;
  private ctx: GameCtx;

  // Systems
  private movementSystem = new MovementSystem();
  private renderSyncSystem = new RenderSyncSystem();
  private lifetimeSystem = new LifetimeSystem();
  private healthSystem = new HealthSystem();

  // Pre-allocated vectors (no allocation in game loop)
  private _moveDir = new THREE.Vector3();
  private _camForward = new THREE.Vector3();
  private _camRight = new THREE.Vector3();

  constructor(private canvas: HTMLCanvasElement) {
    this.engine = new GameEngine({ canvas, antialias: true, shadows: true });
    this.em = new EntityManager();
    this.input = new InputManager(canvas);
    this.assets = new AssetManager(this.engine.renderer);
    this.audio = new AudioManager(this.engine.camera);

    this.ctx = { score: 0, lives: 3, playerEntityId: -1, paused: false };
    this.fsm = this.buildFSM();
  }

  async init(): Promise<void> {
    // Initialize physics
    this.physics = await PhysicsWorld.create();

    // Set up scene
    this.setupScene();

    // Load core assets
    await this.loadAssets();

    // Build game world
    this.buildWorld();

    // Spawn player
    this.ctx.playerEntityId = this.spawnPlayer();

    // Start state machine
    await this.fsm.start('playing', this.ctx);

    // Register systems with engine
    this.engine.addSystem({
      fixedUpdate: (delta) => this.onFixedUpdate(delta),
      update: (delta, elapsed) => this.onUpdate(delta, elapsed),
      dispose: () => this.onDispose(),
    });
  }

  start(): void {
    this.engine.start();
  }

  stop(): void {
    this.engine.stop();
  }

  // ---------- Scene Setup ----------

  private setupScene(): void {
    const scene = this.engine.scene;
    scene.background = new THREE.Color(0x87ceeb);
    scene.fog = new THREE.FogExp2(0x87ceeb, 0.008);

    createOutdoorLighting(scene);

    // Camera initial position
    this.engine.camera.position.set(0, 10, 20);
    this.engine.camera.lookAt(0, 0, 0);
  }

  private async loadAssets(): Promise<void> {
    // Example: load audio
    // const sfxBuffer = await this.audio.loadBuffer('/audio/jump.ogg');
    // this.jumpSfx = new SoundPool(this.audio['listener'], sfxBuffer, 4);
  }

  // ---------- World Building ----------

  private buildWorld(): void {
    const scene = this.engine.scene;

    // Ground plane
    const groundGeo = new THREE.PlaneGeometry(100, 100);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x558855, roughness: 0.9 });
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);

    // Static physics ground
    this.physics.createStaticBody(
      new THREE.Vector3(0, -0.1, 0),
      { shape: { type: 'box', halfExtents: new THREE.Vector3(50, 0.1, 50) } },
    );

    // Spawn some obstacles
    for (let i = 0; i < 10; i++) {
      const x = (Math.random() - 0.5) * 40;
      const z = (Math.random() - 0.5) * 40;
      this.spawnBox(new THREE.Vector3(x, 1, z));
    }
  }

  // ---------- Entity Spawning ----------

  private spawnPlayer(): number {
    const id = this.em.create();
    const startPos = new THREE.Vector3(0, 2, 0);

    // Transform
    this.em.addTransform(id, startPos);

    // Render
    const playerMesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.4, 1.0, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0x3399ff }),
    );
    playerMesh.castShadow = true;
    this.em.addRender(id, playerMesh, this.engine.scene);

    // Health
    this.em.addHealth(id, 100);

    // Velocity
    this.em.addVelocity(id, 10, 0.2);

    // Physics character controller
    this.physics.createCharacterController(id, startPos, {
      height: 1.8,
      radius: 0.4,
    });

    // Tag as player
    this.em.players.add(id);

    return id;
  }

  private spawnBox(position: THREE.Vector3): number {
    const id = this.em.create();

    this.em.addTransform(id, position);

    const boxMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 2, 1),
      new THREE.MeshStandardMaterial({ color: 0x884422 }),
    );
    boxMesh.castShadow = true;
    boxMesh.receiveShadow = true;
    this.em.addRender(id, boxMesh, this.engine.scene);

    // Dynamic physics box
    this.physics.createDynamicBody(
      id,
      position,
      { shape: { type: 'box', halfExtents: new THREE.Vector3(0.5, 1, 0.5) } },
      { linearDamping: 0.5, angularDamping: 0.8 },
    );

    return id;
  }

  private spawnProjectile(from: THREE.Vector3, direction: THREE.Vector3): void {
    const id = this.em.create();

    this.em.addTransform(id, from.clone());
    this.em.addLifetime(id, 3.0);

    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 6, 6),
      new THREE.MeshStandardMaterial({ color: 0xffff00, emissive: 0xffcc00, emissiveIntensity: 1 }),
    );
    this.em.addRender(id, mesh, this.engine.scene);

    const velocity = this.em.addVelocity(id, 30, 0.0);
    velocity.linear.copy(direction).multiplyScalar(30);

    this.em.projectiles.add(id);
  }

  // ---------- Update ----------

  private onFixedUpdate(delta: number): void {
    // Physics step runs at fixed 60 Hz
    this.physics.step(delta);

    // Sync physics positions to ECS transforms
    this.physics.syncBodiesToTransforms(this.em.transforms);
  }

  private onUpdate(delta: number, _elapsed: number): void {
    if (this.ctx.paused) return;

    // Process frame input
    this.input.update();

    // FSM update
    this.fsm.update(this.ctx, delta);

    // Player input
    this.updatePlayer(delta);

    // ECS systems
    this.movementSystem.update(this.em, delta);
    this.lifetimeSystem.update(this.em, delta);
    this.healthSystem.update(this.em, delta);

    // Sync transforms to Three.js objects
    this.renderSyncSystem.update(this.em, delta);

    // Camera follow
    this.updateCamera(delta);

    // Flush entity destruction
    this.em.flushDestroyQueue(this.engine.scene);

    // Handle pause toggle
    if (this.input.isKeyDown(Keys.ESCAPE)) {
      this.ctx.paused = !this.ctx.paused;
    }
  }

  private updatePlayer(delta: number): void {
    const playerId = this.ctx.playerEntityId;
    if (!this.em.isAlive(playerId)) return;

    // Get movement input
    const moveInput = this.input.getMovementVector();

    // Compute movement relative to camera orientation
    const camera = this.engine.camera;
    camera.getWorldDirection(this._camForward);
    this._camForward.y = 0;
    this._camForward.normalize();

    this._camRight.crossVectors(this._camForward, new THREE.Vector3(0, 1, 0)).normalize();

    this._moveDir
      .set(0, 0, 0)
      .addScaledVector(this._camRight, moveInput.x)
      .addScaledVector(this._camForward, moveInput.y)
      .multiplyScalar(5); // Move speed m/s

    // Move character via physics controller
    this.physics.moveCharacter(playerId, this._moveDir, delta);

    // Jump
    if (this.input.isKeyDown(Keys.SPACE)) {
      this.physics.jumpCharacter(playerId, 6);
    }

    // Fire projectile on left click
    if (this.input.isMouseButtonDown(MouseButton.LEFT)) {
      const playerPos = this.physics.getCharacterPosition(playerId);
      if (playerPos) {
        camera.getWorldDirection(this._camForward);
        this.spawnProjectile(
          playerPos.clone().add(new THREE.Vector3(0, 1.5, 0)),
          this._camForward.clone(),
        );
      }
    }
  }

  private _targetCamPos = new THREE.Vector3();

  private updateCamera(delta: number): void {
    const playerId = this.ctx.playerEntityId;
    const t = this.em.transforms.get(playerId);
    if (!t) return;

    // Third-person follow camera
    this._targetCamPos.set(
      t.position.x,
      t.position.y + 8,
      t.position.z + 15,
    );

    // Smooth lerp
    this.engine.camera.position.lerp(this._targetCamPos, 1 - Math.exp(-5 * delta));
    this.engine.camera.lookAt(t.position.x, t.position.y + 1, t.position.z);
  }

  // ---------- State Machine ----------

  private buildFSM(): FiniteStateMachine<GameCtx> {
    return new FiniteStateMachine<GameCtx>({ debug: true })
      .addStates([
        {
          name: 'playing',
          transitions: [
            { to: 'gameover', when: (ctx) => ctx.lives <= 0 },
          ],
        },
        {
          name: 'gameover',
          onEnter: (_ctx) => {
            console.log('Game Over!');
          },
          transitions: [],
        },
      ]);
  }

  // ---------- Cleanup ----------

  private onDispose(): void {
    this.em.clear(this.engine.scene);
    this.physics.dispose();
    this.audio.dispose();
    this.assets.dispose();
  }

  dispose(): void {
    this.engine.dispose();
  }
}

// ---------- Entry Point ----------

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#canvas');
  if (!canvas) throw new Error('Canvas element #canvas not found');

  const game = new BasicGame(canvas);
  await game.init();
  game.start();

  // Resume AudioContext on first user interaction
  canvas.addEventListener('click', async () => {
    // Audio context requires user gesture in most browsers
  }, { once: true });
}

main().catch(console.error);
