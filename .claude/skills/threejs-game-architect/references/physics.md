# Physics Integration

## Rapier.js (Recommended)

Rapier is a WASM-based physics engine written in Rust. It is the recommended choice for new projects due to its performance, determinism, and active maintenance.

### Setup

```bash
npm install @dimforge/rapier3d-compat
```

```typescript
import RAPIER from '@dimforge/rapier3d-compat';

async function initPhysics(): Promise<RAPIER.World> {
  await RAPIER.init();
  const gravity = new RAPIER.Vector3(0.0, -9.81, 0.0);
  return new RAPIER.World(gravity);
}
```

### Physics World Integration

```typescript
class PhysicsWorld {
  private world: RAPIER.World;
  private rigidBodies = new Map<number, RAPIER.RigidBody>(); // entityId -> body
  private debugLines: THREE.LineSegments | null = null;

  constructor(world: RAPIER.World) {
    this.world = world;
  }

  // Fixed update — call at 60 Hz
  step(delta: number): void {
    this.world.timestep = delta;
    this.world.step();
  }

  // Create dynamic rigid body
  createDynamicBody(
    entityId: number,
    position: THREE.Vector3,
    collider: ColliderConfig,
  ): RAPIER.RigidBody {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setLinearDamping(0.5)
      .setAngularDamping(0.8);

    const body = this.world.createRigidBody(bodyDesc);

    // Attach collider
    const colliderDesc = this.createColliderDesc(collider);
    this.world.createCollider(colliderDesc, body);

    this.rigidBodies.set(entityId, body);
    return body;
  }

  // Create static (immovable) body for terrain/walls
  createStaticBody(
    position: THREE.Vector3,
    collider: ColliderConfig,
  ): RAPIER.RigidBody {
    const bodyDesc = RAPIER.RigidBodyDesc.fixed()
      .setTranslation(position.x, position.y, position.z);
    const body = this.world.createRigidBody(bodyDesc);
    const colliderDesc = this.createColliderDesc(collider);
    this.world.createCollider(colliderDesc, body);
    return body;
  }

  // Create kinematic body (moved programmatically, not by physics)
  createKinematicBody(position: THREE.Vector3): RAPIER.RigidBody {
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(position.x, position.y, position.z);
    return this.world.createRigidBody(bodyDesc);
  }

  private createColliderDesc(config: ColliderConfig): RAPIER.ColliderDesc {
    switch (config.type) {
      case 'sphere':
        return RAPIER.ColliderDesc.ball(config.radius!)
          .setRestitution(config.restitution ?? 0.2)
          .setFriction(config.friction ?? 0.8)
          .setCollisionGroups(config.groups ?? 0xffffffff)
          .setSolverGroups(config.groups ?? 0xffffffff);

      case 'box':
        return RAPIER.ColliderDesc.cuboid(
          config.halfExtents!.x,
          config.halfExtents!.y,
          config.halfExtents!.z,
        )
          .setRestitution(config.restitution ?? 0.2)
          .setFriction(config.friction ?? 0.8);

      case 'capsule':
        return RAPIER.ColliderDesc.capsule(config.halfHeight!, config.radius!)
          .setRestitution(config.restitution ?? 0.0)
          .setFriction(config.friction ?? 1.0);

      case 'cylinder':
        return RAPIER.ColliderDesc.cylinder(config.halfHeight!, config.radius!);

      case 'trimesh': {
        const { vertices, indices } = config;
        return RAPIER.ColliderDesc.trimesh(
          new Float32Array(vertices!),
          new Uint32Array(indices!),
        );
      }

      default:
        throw new Error(`Unknown collider type: ${(config as any).type}`);
    }
  }

  // Sync physics body positions to Three.js transforms
  syncTransforms(world: World): void {
    for (const [entityId, body] of this.rigidBodies) {
      if (!body.isEnabled() || body.isSleeping()) continue;

      const transform = world.transforms.get(entityId);
      if (!transform) continue;

      const pos = body.translation();
      const rot = body.rotation();

      transform.position.set(pos.x, pos.y, pos.z);
      transform.rotation.set(rot.x, rot.y, rot.z, rot.w);
      transform.dirty = true;
    }
  }

  // Apply forces
  applyImpulse(entityId: number, impulse: THREE.Vector3): void {
    const body = this.rigidBodies.get(entityId);
    if (!body) return;
    body.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);
  }

  applyForce(entityId: number, force: THREE.Vector3): void {
    const body = this.rigidBodies.get(entityId);
    if (!body) return;
    body.addForce({ x: force.x, y: force.y, z: force.z }, true);
  }

  // Set velocity directly (for character controllers)
  setLinearVelocity(entityId: number, velocity: THREE.Vector3): void {
    const body = this.rigidBodies.get(entityId);
    if (!body) return;
    body.setLinvel({ x: velocity.x, y: velocity.y, z: velocity.z }, true);
  }

  getLinearVelocity(entityId: number): THREE.Vector3 | null {
    const body = this.rigidBodies.get(entityId);
    if (!body) return null;
    const v = body.linvel();
    return new THREE.Vector3(v.x, v.y, v.z);
  }

  removeBody(entityId: number): void {
    const body = this.rigidBodies.get(entityId);
    if (body) {
      this.world.removeRigidBody(body);
      this.rigidBodies.delete(entityId);
    }
  }

  dispose(): void {
    this.world.free();
  }
}

interface ColliderConfig {
  type: 'sphere' | 'box' | 'capsule' | 'cylinder' | 'trimesh';
  radius?: number;
  halfExtents?: THREE.Vector3;
  halfHeight?: number;
  restitution?: number;
  friction?: number;
  groups?: number;
  vertices?: number[];
  indices?: number[];
}
```

### Character Controller

```typescript
class CharacterController {
  private controller: RAPIER.KinematicCharacterController;
  private body: RAPIER.RigidBody;
  private collider: RAPIER.Collider;

  // Pre-allocated vectors
  private _movement = new RAPIER.Vector3(0, 0, 0);
  private _velocity = new THREE.Vector3();
  private _gravityVelocity = 0;

  readonly onGround: boolean = false;

  constructor(world: RAPIER.World, position: THREE.Vector3) {
    // Controller with step height and slope limit
    this.controller = world.createCharacterController(0.01); // Offset for snapping
    this.controller.setMaxSlopeClimbAngle((45 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((30 * Math.PI) / 180);
    this.controller.enableAutostep(0.5, 0.2, true); // Max step height, min width, dynamic bodies
    this.controller.enableSnapToGround(0.5);
    this.controller.setCharacterMass(70);

    // Kinematic body
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(position.x, position.y, position.z);
    this.body = world.createRigidBody(bodyDesc);

    // Capsule collider — player shape
    const colliderDesc = RAPIER.ColliderDesc.capsule(0.9, 0.4); // halfHeight, radius
    this.collider = world.createCollider(colliderDesc, this.body);
  }

  move(desiredMovement: THREE.Vector3, delta: number, world: RAPIER.World): void {
    // Apply gravity
    if (this.controller.computedGrounded()) {
      this._gravityVelocity = 0;
      (this as any).onGround = true;
    } else {
      this._gravityVelocity += -9.81 * delta;
      (this as any).onGround = false;
    }

    // Combine horizontal movement with gravity
    this._movement.x = desiredMovement.x;
    this._movement.y = (desiredMovement.y + this._gravityVelocity) * delta;
    this._movement.z = desiredMovement.z;

    // Compute collision-aware movement
    this.controller.computeColliderMovement(this.collider, this._movement);

    // Apply movement to kinematic body
    const corrected = this.controller.computedMovement();
    const pos = this.body.translation();
    this.body.setNextKinematicTranslation({
      x: pos.x + corrected.x,
      y: pos.y + corrected.y,
      z: pos.z + corrected.z,
    });
  }

  jump(velocity: number): void {
    if (this.controller.computedGrounded()) {
      this._gravityVelocity = velocity;
    }
  }

  getPosition(): THREE.Vector3 {
    const pos = this.body.translation();
    return new THREE.Vector3(pos.x, pos.y, pos.z);
  }

  dispose(world: RAPIER.World): void {
    world.removeCollider(this.collider, false);
    world.removeRigidBody(this.body);
    world.removeCharacterController(this.controller);
  }
}
```

### Raycasting (Physics)

```typescript
// Physics raycast — for ground detection, hit scanning
function physicsRaycast(
  world: RAPIER.World,
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  maxDistance: number,
  excludeCollider?: RAPIER.Collider,
): { point: THREE.Vector3; normal: THREE.Vector3; entityId?: number } | null {
  const ray = new RAPIER.Ray(
    { x: origin.x, y: origin.y, z: origin.z },
    { x: direction.x, y: direction.y, z: direction.z },
  );

  const hit = world.castRay(
    ray,
    maxDistance,
    true,  // Solid — stop at first hit
    undefined, // Query filter flags
    undefined, // Collision groups
    undefined, // Target filter
    excludeCollider, // Exclude specific collider
  );

  if (hit === null) return null;

  const hitPoint = ray.pointAt(hit.toi);
  const hitCollider = hit.collider;

  return {
    point: new THREE.Vector3(hitPoint.x, hitPoint.y, hitPoint.z),
    normal: new THREE.Vector3(), // Get from collider if needed
    entityId: hitCollider.userData as number | undefined,
  };
}
```

## Cannon-es (Pure JS Alternative)

```bash
npm install cannon-es
```

```typescript
import * as CANNON from 'cannon-es';

class CannonPhysics {
  private world: CANNON.World;
  private bodies = new Map<number, CANNON.Body>();

  // Pre-allocated
  private _vec = new CANNON.Vec3();

  constructor() {
    this.world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -9.82, 0),
    });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = true;

    // Default contact material
    this.world.defaultContactMaterial.friction = 0.5;
    this.world.defaultContactMaterial.restitution = 0.2;
  }

  createSphereBody(
    id: number,
    position: THREE.Vector3,
    radius: number,
    mass: number,
  ): CANNON.Body {
    const shape = new CANNON.Sphere(radius);
    const body = new CANNON.Body({
      mass,
      shape,
      position: new CANNON.Vec3(position.x, position.y, position.z),
      linearDamping: 0.3,
      angularDamping: 0.5,
    });
    this.world.addBody(body);
    this.bodies.set(id, body);
    return body;
  }

  createBoxBody(
    id: number,
    position: THREE.Vector3,
    halfExtents: THREE.Vector3,
    mass: number,
  ): CANNON.Body {
    const shape = new CANNON.Box(
      new CANNON.Vec3(halfExtents.x, halfExtents.y, halfExtents.z),
    );
    const body = new CANNON.Body({
      mass,
      shape,
      position: new CANNON.Vec3(position.x, position.y, position.z),
    });
    this.world.addBody(body);
    this.bodies.set(id, body);
    return body;
  }

  step(delta: number): void {
    this.world.fixedStep(1 / 60, delta);
  }

  syncToThreeJS(object: THREE.Object3D, id: number): void {
    const body = this.bodies.get(id);
    if (!body) return;
    object.position.copy(body.position as unknown as THREE.Vector3);
    object.quaternion.copy(body.quaternion as unknown as THREE.Quaternion);
  }

  dispose(): void {
    this.world.bodies.forEach((b) => this.world.removeBody(b));
  }
}
```

## Collision Layers and Masks

```typescript
// Collision groups for Rapier (bitmask)
// Group = which group this object belongs to
// Mask = which groups this object collides with

const COLLISION_GROUPS = {
  WORLD: 0x0001,
  PLAYER: 0x0002,
  ENEMY: 0x0004,
  PROJECTILE: 0x0008,
  TRIGGER: 0x0010,
  PICKUP: 0x0020,
} as const;

function encodeGroups(membership: number, filter: number): number {
  return (membership << 16) | filter;
}

// Player collides with world, enemies, triggers, pickups — not projectiles shot by player
const playerGroups = encodeGroups(
  COLLISION_GROUPS.PLAYER,
  COLLISION_GROUPS.WORLD | COLLISION_GROUPS.ENEMY | COLLISION_GROUPS.TRIGGER | COLLISION_GROUPS.PICKUP,
);

// Projectile collides with world and enemies — not player or other projectiles
const projectileGroups = encodeGroups(
  COLLISION_GROUPS.PROJECTILE,
  COLLISION_GROUPS.WORLD | COLLISION_GROUPS.ENEMY,
);

// Usage in collider creation
const colliderDesc = RAPIER.ColliderDesc.ball(0.1)
  .setCollisionGroups(projectileGroups)
  .setSolverGroups(projectileGroups)
  .setSensor(false); // true = trigger (no collision response)
```

## Physics Debug Renderer

```typescript
class PhysicsDebugRenderer {
  private mesh: THREE.LineSegments;
  private enabled = false;

  constructor(scene: THREE.Scene) {
    const geometry = new THREE.BufferGeometry();
    const material = new THREE.LineBasicMaterial({
      color: 0x00ff00,
      vertexColors: true,
    });
    this.mesh = new THREE.LineSegments(geometry, material);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  update(world: RAPIER.World): void {
    if (!this.enabled) return;

    const { vertices, colors } = world.debugRender();

    this.mesh.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(vertices, 3),
    );
    this.mesh.geometry.setAttribute(
      'color',
      new THREE.BufferAttribute(colors, 4),
    );
  }

  toggle(): void {
    this.enabled = !this.enabled;
    this.mesh.visible = this.enabled;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.parent?.remove(this.mesh);
  }
}
```
