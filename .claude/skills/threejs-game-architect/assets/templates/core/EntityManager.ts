/**
 * EntityManager.ts
 * Entity Component System (ECS) — entities as IDs, components as data, systems as logic.
 * Designed to minimize GC pressure in the game loop.
 */

import * as THREE from 'three';

export type EntityId = number;

// ---------- Component Definitions ----------

export interface TransformComponent {
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
  scale: THREE.Vector3;
  dirty: boolean;
}

export interface VelocityComponent {
  linear: THREE.Vector3;
  angular: THREE.Vector3;
  maxSpeed: number;
  damping: number;
}

export interface RenderComponent {
  object3D: THREE.Object3D;
  visible: boolean;
}

export interface HealthComponent {
  current: number;
  max: number;
  invincibleTimer: number;
  dead: boolean;
}

export interface LifetimeComponent {
  remaining: number;
  total: number;
}

export interface ColliderComponent {
  type: 'sphere' | 'box' | 'capsule';
  radius?: number;
  halfExtents?: THREE.Vector3;
  halfHeight?: number;
  isTrigger: boolean;
  layer: number;
  mask: number;
}

// ---------- Entity Manager ----------

export class EntityManager {
  private nextId = 1;
  private destroyed = new Set<EntityId>();

  // Component storage (Struct of Arrays layout)
  readonly transforms = new Map<EntityId, TransformComponent>();
  readonly velocities = new Map<EntityId, VelocityComponent>();
  readonly renders = new Map<EntityId, RenderComponent>();
  readonly health = new Map<EntityId, HealthComponent>();
  readonly lifetimes = new Map<EntityId, LifetimeComponent>();
  readonly colliders = new Map<EntityId, ColliderComponent>();

  // Tag sets (no data, just membership)
  readonly players = new Set<EntityId>();
  readonly enemies = new Set<EntityId>();
  readonly projectiles = new Set<EntityId>();
  readonly pickups = new Set<EntityId>();

  create(): EntityId {
    return this.nextId++;
  }

  // Schedule entity for end-of-frame destruction
  destroy(id: EntityId): void {
    this.destroyed.add(id);
  }

  isAlive(id: EntityId): boolean {
    return !this.destroyed.has(id) &&
      (this.transforms.has(id) || this.renders.has(id));
  }

  // Process deferred destruction — call at end of each frame
  flushDestroyQueue(scene: THREE.Scene): void {
    for (const id of this.destroyed) {
      // Remove Three.js object from scene
      const render = this.renders.get(id);
      if (render?.object3D.parent) {
        scene.remove(render.object3D);
      }

      // Clear all components
      this.transforms.delete(id);
      this.velocities.delete(id);
      this.renders.delete(id);
      this.health.delete(id);
      this.lifetimes.delete(id);
      this.colliders.delete(id);

      // Clear tags
      this.players.delete(id);
      this.enemies.delete(id);
      this.projectiles.delete(id);
      this.pickups.delete(id);
    }
    this.destroyed.clear();
  }

  // Query: return entities that have ALL of the given component maps
  // Starts from smallest map for efficiency
  query(...components: Map<EntityId, unknown>[]): EntityId[] {
    if (components.length === 0) return [];

    const sorted = [...components].sort((a, b) => a.size - b.size);
    const [smallest, ...rest] = sorted;
    const result: EntityId[] = [];

    for (const id of smallest.keys()) {
      if (this.destroyed.has(id)) continue;
      if (rest.every((map) => map.has(id))) {
        result.push(id);
      }
    }

    return result;
  }

  // Query with tag (tag is a Set<EntityId>, not a Map)
  queryWithTag(tag: Set<EntityId>, ...components: Map<EntityId, unknown>[]): EntityId[] {
    const result: EntityId[] = [];
    for (const id of tag) {
      if (this.destroyed.has(id)) continue;
      if (components.every((map) => map.has(id))) {
        result.push(id);
      }
    }
    return result;
  }

  // Convenience: add transform component
  addTransform(id: EntityId, position?: THREE.Vector3): TransformComponent {
    const component: TransformComponent = {
      position: position ? position.clone() : new THREE.Vector3(),
      rotation: new THREE.Quaternion(),
      scale: new THREE.Vector3(1, 1, 1),
      dirty: true,
    };
    this.transforms.set(id, component);
    return component;
  }

  // Convenience: add render component and attach to scene
  addRender(
    id: EntityId,
    object3D: THREE.Object3D,
    scene: THREE.Scene,
  ): RenderComponent {
    const component: RenderComponent = { object3D, visible: true };
    this.renders.set(id, component);
    scene.add(object3D);
    return component;
  }

  // Convenience: add health component
  addHealth(id: EntityId, max: number): HealthComponent {
    const component: HealthComponent = {
      current: max,
      max,
      invincibleTimer: 0,
      dead: false,
    };
    this.health.set(id, component);
    return component;
  }

  // Convenience: add lifetime component
  addLifetime(id: EntityId, seconds: number): LifetimeComponent {
    const component: LifetimeComponent = { remaining: seconds, total: seconds };
    this.lifetimes.set(id, component);
    return component;
  }

  // Convenience: add velocity component
  addVelocity(
    id: EntityId,
    maxSpeed = 10,
    damping = 0.1,
  ): VelocityComponent {
    const component: VelocityComponent = {
      linear: new THREE.Vector3(),
      angular: new THREE.Vector3(),
      maxSpeed,
      damping,
    };
    this.velocities.set(id, component);
    return component;
  }

  clear(scene: THREE.Scene): void {
    // Destroy all entities
    const allIds = new Set([
      ...this.transforms.keys(),
      ...this.renders.keys(),
    ]);
    for (const id of allIds) {
      this.destroy(id);
    }
    this.flushDestroyQueue(scene);
  }
}

// ---------- Base Systems ----------

export interface System {
  readonly name: string;
  update(em: EntityManager, delta: number): void;
}

/** Applies velocity to transform */
export class MovementSystem implements System {
  readonly name = 'MovementSystem';

  update(em: EntityManager, delta: number): void {
    for (const id of em.query(em.transforms, em.velocities)) {
      const t = em.transforms.get(id)!;
      const v = em.velocities.get(id)!;

      // Apply damping
      v.linear.multiplyScalar(1 - v.damping * delta);

      // Clamp to max speed
      if (v.linear.lengthSq() > v.maxSpeed * v.maxSpeed) {
        v.linear.setLength(v.maxSpeed);
      }

      t.position.addScaledVector(v.linear, delta);
      t.dirty = true;
    }
  }
}

/** Syncs ECS transforms to Three.js Object3D */
export class RenderSyncSystem implements System {
  readonly name = 'RenderSyncSystem';

  update(em: EntityManager, _delta: number): void {
    for (const id of em.query(em.transforms, em.renders)) {
      const t = em.transforms.get(id)!;
      if (!t.dirty) continue;

      const r = em.renders.get(id)!;
      r.object3D.position.copy(t.position);
      r.object3D.quaternion.copy(t.rotation);
      r.object3D.scale.copy(t.scale);
      r.object3D.visible = r.visible;
      t.dirty = false;
    }
  }
}

/** Destroys entities when their lifetime expires */
export class LifetimeSystem implements System {
  readonly name = 'LifetimeSystem';

  update(em: EntityManager, delta: number): void {
    for (const id of em.query(em.lifetimes)) {
      const lt = em.lifetimes.get(id)!;
      lt.remaining -= delta;
      if (lt.remaining <= 0) {
        em.destroy(id);
      }
    }
  }
}

/** Handles invincibility timer and death */
export class HealthSystem implements System {
  readonly name = 'HealthSystem';

  update(em: EntityManager, delta: number): void {
    for (const id of em.query(em.health)) {
      const h = em.health.get(id)!;
      if (h.invincibleTimer > 0) {
        h.invincibleTimer = Math.max(0, h.invincibleTimer - delta);
      }
      if (!h.dead && h.current <= 0) {
        h.dead = true;
        em.destroy(id);
      }
    }
  }
}
