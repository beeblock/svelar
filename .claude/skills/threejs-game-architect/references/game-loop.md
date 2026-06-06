# Game Loop Patterns

## The Game Loop Problem

Browser games use `requestAnimationFrame` which fires at the display refresh rate (60, 90, 120 Hz or variable). Physics, AI, and game logic must be deterministic regardless of frame rate. The solution is a fixed-timestep accumulator pattern.

## Fixed-Timestep Accumulator

```typescript
class GameLoop {
  private clock = new THREE.Clock();
  private animationId = 0;
  private running = false;

  // Fixed physics step (60 Hz = 16.67ms)
  private readonly FIXED_STEP = 1 / 60;
  private readonly MAX_DELTA = 0.1;  // Cap at 100ms to prevent spiral-of-death
  private accumulator = 0;
  private fixedStepCount = 0;

  // Callbacks
  private onFixedUpdate?: (delta: number, step: number) => void;
  private onUpdate?: (delta: number, elapsed: number) => void;
  private onRender?: (interpolation: number) => void;

  start(): void {
    this.running = true;
    this.clock.start();
    this.animationId = requestAnimationFrame(() => this.tick());
  }

  private tick(): void {
    if (!this.running) return;

    const rawDelta = this.clock.getDelta();
    const delta = Math.min(rawDelta, this.MAX_DELTA);
    const elapsed = this.clock.getElapsedTime();

    // Fixed update loop — runs zero, one, or multiple times per frame
    this.accumulator += delta;
    while (this.accumulator >= this.FIXED_STEP) {
      this.onFixedUpdate?.(this.FIXED_STEP, this.fixedStepCount++);
      this.accumulator -= this.FIXED_STEP;
    }

    // Interpolation factor for smooth rendering between physics steps
    const interpolation = this.accumulator / this.FIXED_STEP;

    // Variable update — runs exactly once per frame
    this.onUpdate?.(delta, elapsed);

    // Render with interpolation
    this.onRender?.(interpolation);

    this.animationId = requestAnimationFrame(() => this.tick());
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.animationId);
    this.clock.stop();
  }

  pause(): void {
    this.running = false;
    cancelAnimationFrame(this.animationId);
  }

  resume(): void {
    if (!this.running) {
      this.running = true;
      this.clock.getDelta(); // Consume accumulated time while paused
      this.accumulator = 0;
      this.animationId = requestAnimationFrame(() => this.tick());
    }
  }
}

// Usage
const loop = new GameLoop();
loop['onFixedUpdate'] = (delta, step) => {
  physicsWorld.step(delta);
  movementSystem.update(delta);
};
loop['onUpdate'] = (delta, elapsed) => {
  inputManager.update();
  animationSystem.update(delta);
  cameraSystem.update(delta);
};
loop['onRender'] = (alpha) => {
  renderSystem.interpolate(alpha);
  renderer.render(scene, camera);
};
loop.start();
```

## Delta Time Usage

```typescript
// WRONG: Frame-rate dependent movement
object.position.x += 5; // Moves 5 units per FRAME — faster on 120Hz, slower on 30Hz

// CORRECT: Frame-rate independent movement
const SPEED = 5; // 5 units per SECOND
object.position.x += SPEED * deltaTime;

// Physics quantities with delta time
class RigidBody {
  position = new THREE.Vector3();
  velocity = new THREE.Vector3();
  acceleration = new THREE.Vector3();

  // Pre-allocated to avoid GC
  private _delta = new THREE.Vector3();

  integrate(dt: number): void {
    // Semi-implicit Euler integration (more stable than Euler)
    this.velocity.addScaledVector(this.acceleration, dt);

    // Apply damping (velocity *= (1 - damping * dt))
    this.velocity.multiplyScalar(1 - 0.01 * dt);

    this.position.addScaledVector(this.velocity, dt);
  }
}
```

## Performance Monitoring

```typescript
import Stats from 'three/examples/jsm/libs/stats.module.js';

class PerformanceMonitor {
  private stats: Stats;
  private frameTimeHistory: number[] = [];
  private readonly HISTORY_SIZE = 60;

  constructor(container: HTMLElement) {
    this.stats = new Stats();
    this.stats.showPanel(0); // 0: FPS, 1: MS, 2: MB
    container.appendChild(this.stats.dom);
  }

  begin(): void {
    this.stats.begin();
  }

  end(): void {
    this.stats.end();
  }

  recordFrameTime(ms: number): void {
    this.frameTimeHistory.push(ms);
    if (this.frameTimeHistory.length > this.HISTORY_SIZE) {
      this.frameTimeHistory.shift();
    }
  }

  getAverageFrameTime(): number {
    if (this.frameTimeHistory.length === 0) return 0;
    return this.frameTimeHistory.reduce((a, b) => a + b) / this.frameTimeHistory.length;
  }

  get isUnder60fps(): boolean {
    return this.getAverageFrameTime() > 16.67;
  }
}
```

## Entity Component System (ECS) — Deep Dive

### Architecture Overview

```
Entities  = just IDs (numbers)
Components = pure data structs
Systems   = logic that processes matching entities
World     = container that connects them
```

### Type-Safe Component Registry

```typescript
// Component type IDs as string literals
const COMPONENTS = {
  TRANSFORM: 'transform',
  VELOCITY: 'velocity',
  RENDER: 'render',
  HEALTH: 'health',
  COLLIDER: 'collider',
  PLAYER_TAG: 'playerTag',
  ENEMY_AI: 'enemyAI',
  LIFETIME: 'lifetime',
} as const;

type ComponentId = (typeof COMPONENTS)[keyof typeof COMPONENTS];
type EntityId = number;

// Component data definitions
interface TransformData {
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
  scale: THREE.Vector3;
  dirty: boolean; // Needs sync to Three.js Object3D
}

interface VelocityData {
  linear: THREE.Vector3;
  angular: THREE.Vector3;
  maxSpeed: number;
}

interface RenderData {
  object3D: THREE.Object3D;
  visible: boolean;
  castShadow: boolean;
}

interface HealthData {
  current: number;
  max: number;
  invincibleTimer: number;
}

interface ColliderData {
  type: 'sphere' | 'box' | 'capsule';
  radius?: number;
  halfExtents?: THREE.Vector3;
  layer: number;
  mask: number;
}

interface EnemyAIData {
  state: 'idle' | 'patrol' | 'chase' | 'attack' | 'dead';
  target: EntityId | null;
  aggroRange: number;
  attackRange: number;
  attackTimer: number;
}

interface LifetimeData {
  remaining: number;
  totalLifetime: number;
}
```

### World Implementation

```typescript
class World {
  private nextId = 1;
  private destroyed = new Set<EntityId>();

  // Typed component storage — SoA (Structure of Arrays) layout
  readonly transforms = new Map<EntityId, TransformData>();
  readonly velocities = new Map<EntityId, VelocityData>();
  readonly renders = new Map<EntityId, RenderData>();
  readonly health = new Map<EntityId, HealthData>();
  readonly colliders = new Map<EntityId, ColliderData>();
  readonly players = new Set<EntityId>(); // Tag component
  readonly enemies = new Map<EntityId, EnemyAIData>();
  readonly lifetimes = new Map<EntityId, LifetimeData>();

  create(): EntityId {
    const id = this.nextId++;
    return id;
  }

  destroy(id: EntityId): void {
    // Queue for end-of-frame cleanup
    this.destroyed.add(id);
  }

  // Process deferred destruction
  flushDestroyQueue(): void {
    for (const id of this.destroyed) {
      // Remove render object from scene
      const render = this.renders.get(id);
      if (render) {
        render.object3D.parent?.remove(render.object3D);
      }

      this.transforms.delete(id);
      this.velocities.delete(id);
      this.renders.delete(id);
      this.health.delete(id);
      this.colliders.delete(id);
      this.players.delete(id);
      this.enemies.delete(id);
      this.lifetimes.delete(id);
    }
    this.destroyed.clear();
  }

  // Query: entities that have all specified components
  query<K extends Map<EntityId, unknown>>(
    ...components: K[]
  ): EntityId[] {
    const [smallest] = [...components].sort((a, b) => a.size - b.size);
    const result: EntityId[] = [];
    for (const id of smallest.keys()) {
      if (!this.destroyed.has(id) && components.every((c) => c.has(id))) {
        result.push(id);
      }
    }
    return result;
  }

  // Query with tag set
  queryWithTag(tag: Set<EntityId>, ...components: Map<EntityId, unknown>[]): EntityId[] {
    const result: EntityId[] = [];
    for (const id of tag) {
      if (!this.destroyed.has(id) && components.every((c) => c.has(id))) {
        result.push(id);
      }
    }
    return result;
  }
}
```

### System Implementations

```typescript
// System base interface
interface System {
  readonly name: string;
  update(world: World, delta: number): void;
}

// Movement system: applies velocity to transform
class MovementSystem implements System {
  readonly name = 'MovementSystem';

  update(world: World, delta: number): void {
    for (const id of world.query(world.transforms, world.velocities)) {
      const transform = world.transforms.get(id)!;
      const velocity = world.velocities.get(id)!;

      // Apply velocity — no allocation, uses addScaledVector
      transform.position.addScaledVector(velocity.linear, delta);
      transform.dirty = true;
    }
  }
}

// Sync system: propagates ECS transforms to Three.js objects
class RenderSyncSystem implements System {
  readonly name = 'RenderSyncSystem';

  update(world: World, _delta: number): void {
    for (const id of world.query(world.transforms, world.renders)) {
      const transform = world.transforms.get(id)!;
      if (!transform.dirty) continue;

      const render = world.renders.get(id)!;
      render.object3D.position.copy(transform.position);
      render.object3D.quaternion.copy(transform.rotation);
      render.object3D.scale.copy(transform.scale);
      transform.dirty = false;
    }
  }
}

// Lifetime system: destroys entities after their time expires
class LifetimeSystem implements System {
  readonly name = 'LifetimeSystem';

  update(world: World, delta: number): void {
    for (const id of world.query(world.lifetimes)) {
      const lt = world.lifetimes.get(id)!;
      lt.remaining -= delta;
      if (lt.remaining <= 0) {
        world.destroy(id);
      }
    }
  }
}

// Enemy AI system
class EnemyAISystem implements System {
  readonly name = 'EnemyAISystem';
  private _toPlayer = new THREE.Vector3(); // Pre-allocated

  update(world: World, delta: number): void {
    const enemies = world.query(world.transforms, world.enemies);
    const playerIds = [...world.players].filter((id) => world.transforms.has(id));

    for (const id of enemies) {
      const transform = world.transforms.get(id)!;
      const ai = world.enemies.get(id)!;

      // Find nearest player
      let nearestDist = Infinity;
      let nearestPlayer: EntityId | null = null;

      for (const pid of playerIds) {
        const pt = world.transforms.get(pid)!;
        const dist = transform.position.distanceTo(pt.position);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestPlayer = pid;
        }
      }

      // State machine
      switch (ai.state) {
        case 'idle':
          if (nearestPlayer !== null && nearestDist < ai.aggroRange) {
            ai.state = 'chase';
            ai.target = nearestPlayer;
          }
          break;

        case 'chase':
          if (nearestPlayer === null || nearestDist > ai.aggroRange * 1.5) {
            ai.state = 'idle';
            ai.target = null;
          } else if (nearestDist < ai.attackRange) {
            ai.state = 'attack';
          } else {
            // Move toward player
            const pt = world.transforms.get(nearestPlayer!)!;
            this._toPlayer.subVectors(pt.position, transform.position).normalize();
            transform.position.addScaledVector(this._toPlayer, 3 * delta);
            transform.dirty = true;
          }
          break;

        case 'attack':
          ai.attackTimer -= delta;
          if (ai.attackTimer <= 0) {
            ai.attackTimer = 1.5; // 1.5 seconds between attacks
            // Emit attack event — don't apply damage directly
          }
          if (nearestDist > ai.attackRange) ai.state = 'chase';
          break;
      }
    }
  }
}
```

### System Execution Order

```typescript
class SystemManager {
  private fixedSystems: System[] = [];
  private updateSystems: System[] = [];
  private lateUpdateSystems: System[] = [];

  addFixedSystem(system: System): this {
    this.fixedSystems.push(system);
    return this;
  }

  addUpdateSystem(system: System): this {
    this.updateSystems.push(system);
    return this;
  }

  addLateUpdateSystem(system: System): this {
    this.lateUpdateSystems.push(system);
    return this;
  }

  fixedUpdate(world: World, delta: number): void {
    for (const system of this.fixedSystems) {
      system.update(world, delta);
    }
    world.flushDestroyQueue();
  }

  update(world: World, delta: number): void {
    for (const system of this.updateSystems) {
      system.update(world, delta);
    }
  }

  lateUpdate(world: World, delta: number): void {
    for (const system of this.lateUpdateSystems) {
      system.update(world, delta);
    }
  }
}

// Typical system registration
const systems = new SystemManager()
  // Fixed (physics-rate)
  .addFixedSystem(new PhysicsSystem(physicsWorld))
  .addFixedSystem(new CollisionSystem())
  .addFixedSystem(new MovementSystem())
  // Variable (render-rate)
  .addUpdateSystem(new InputSystem(inputManager))
  .addUpdateSystem(new EnemyAISystem())
  .addUpdateSystem(new AnimationSystem())
  .addUpdateSystem(new LifetimeSystem())
  .addUpdateSystem(new ParticleSystem())
  // Late (after all updates)
  .addLateUpdateSystem(new CameraSystem(camera))
  .addLateUpdateSystem(new RenderSyncSystem());
```

## Object Pooling

```typescript
class ObjectPool<T> {
  private available: T[] = [];
  private inUse = new Set<T>();
  private totalCreated = 0;

  constructor(
    private readonly create: () => T,
    private readonly reset: (obj: T) => void,
    initialSize = 0,
  ) {
    for (let i = 0; i < initialSize; i++) {
      this.available.push(create());
      this.totalCreated++;
    }
  }

  acquire(): T {
    let obj: T;
    if (this.available.length > 0) {
      obj = this.available.pop()!;
    } else {
      obj = this.create();
      this.totalCreated++;
    }
    this.inUse.add(obj);
    return obj;
  }

  release(obj: T): void {
    if (!this.inUse.has(obj)) return;
    this.inUse.delete(obj);
    this.reset(obj);
    this.available.push(obj);
  }

  releaseAll(): void {
    for (const obj of this.inUse) {
      this.reset(obj);
      this.available.push(obj);
    }
    this.inUse.clear();
  }

  get stats() {
    return {
      available: this.available.length,
      inUse: this.inUse.size,
      total: this.totalCreated,
    };
  }
}

// Bullet pool example
interface Bullet {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  lifetime: number;
}

const bulletPool = new ObjectPool<Bullet>(
  () => ({
    mesh: new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 4, 4),
      new THREE.MeshBasicMaterial({ color: 0xffff00 }),
    ),
    velocity: new THREE.Vector3(),
    lifetime: 0,
  }),
  (bullet) => {
    bullet.mesh.visible = false;
    bullet.velocity.set(0, 0, 0);
    bullet.lifetime = 0;
  },
  50, // Pre-warm with 50 bullets
);

// Spawn bullet
function spawnBullet(position: THREE.Vector3, direction: THREE.Vector3): void {
  const bullet = bulletPool.acquire();
  bullet.mesh.position.copy(position);
  bullet.velocity.copy(direction).multiplyScalar(50);
  bullet.lifetime = 3.0;
  bullet.mesh.visible = true;
  scene.add(bullet.mesh);
}
```

## Animation System

```typescript
import { AnimationMixer, AnimationAction } from 'three';

class AnimationController {
  private mixer: AnimationMixer;
  private actions = new Map<string, AnimationAction>();
  private currentAction: AnimationAction | null = null;

  constructor(object: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.mixer = new AnimationMixer(object);
    for (const clip of clips) {
      const action = this.mixer.clipAction(clip);
      this.actions.set(clip.name, action);
    }
  }

  play(name: string, options: { loop?: boolean; crossFadeDuration?: number } = {}): void {
    const { loop = true, crossFadeDuration = 0.3 } = options;
    const action = this.actions.get(name);
    if (!action) {
      console.warn(`Animation "${name}" not found`);
      return;
    }

    action.loop = loop ? THREE.LoopRepeat : THREE.LoopOnce;
    action.clampWhenFinished = !loop;

    if (this.currentAction && this.currentAction !== action) {
      this.currentAction.crossFadeTo(action, crossFadeDuration, true);
    }
    action.play();
    this.currentAction = action;
  }

  update(delta: number): void {
    this.mixer.update(delta);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
  }
}
```
