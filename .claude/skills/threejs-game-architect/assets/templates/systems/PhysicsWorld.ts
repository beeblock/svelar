/**
 * PhysicsWorld.ts
 * Rapier.js physics world integration with Three.js.
 * Install: npm install @dimforge/rapier3d-compat
 */

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

export type ColliderShape =
  | { type: 'sphere'; radius: number }
  | { type: 'box'; halfExtents: THREE.Vector3 }
  | { type: 'capsule'; halfHeight: number; radius: number }
  | { type: 'cylinder'; halfHeight: number; radius: number }
  | { type: 'trimesh'; vertices: Float32Array; indices: Uint32Array };

export interface ColliderConfig {
  shape: ColliderShape;
  restitution?: number;   // Bounciness: 0 = no bounce, 1 = perfect bounce
  friction?: number;      // 0 = ice, 1 = rubber
  density?: number;       // Affects mass when not set explicitly
  isSensor?: boolean;     // Trigger volume — detects overlaps, no physical response
  collisionGroups?: number; // Bitmask: upper 16 = membership, lower 16 = filter
}

export class PhysicsWorld {
  private world: RAPIER.World;
  private bodies = new Map<number, RAPIER.RigidBody>();      // entityId -> body
  private colliders = new Map<number, RAPIER.Collider>();    // entityId -> collider
  private characterControllers = new Map<number, {
    controller: RAPIER.KinematicCharacterController;
    body: RAPIER.RigidBody;
    collider: RAPIER.Collider;
    gravityVelocity: number;
  }>();

  private debugMesh: THREE.LineSegments | null = null;
  private debugEnabled = false;

  static async create(gravity = new THREE.Vector3(0, -9.81, 0)): Promise<PhysicsWorld> {
    await RAPIER.init();
    const rapierGravity = new RAPIER.Vector3(gravity.x, gravity.y, gravity.z);
    return new PhysicsWorld(new RAPIER.World(rapierGravity));
  }

  constructor(world: RAPIER.World) {
    this.world = world;
  }

  // ---------- Body Creation ----------

  createDynamicBody(
    entityId: number,
    position: THREE.Vector3,
    colliderConfig: ColliderConfig,
    options: {
      linearDamping?: number;
      angularDamping?: number;
      mass?: number;
      gravityScale?: number;
      canSleep?: boolean;
    } = {},
  ): RAPIER.RigidBody {
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setLinearDamping(options.linearDamping ?? 0.5)
      .setAngularDamping(options.angularDamping ?? 0.8)
      .setGravityScale(options.gravityScale ?? 1.0)
      .setCanSleep(options.canSleep ?? true);

    const body = this.world.createRigidBody(desc);

    const colliderDesc = this.buildColliderDesc(colliderConfig);
    if (options.mass !== undefined) {
      colliderDesc.setMass(options.mass);
    }
    const collider = this.world.createCollider(colliderDesc, body);

    this.bodies.set(entityId, body);
    this.colliders.set(entityId, collider);
    return body;
  }

  createStaticBody(
    position: THREE.Vector3,
    colliderConfig: ColliderConfig,
    rotation?: THREE.Quaternion,
  ): RAPIER.RigidBody {
    const desc = RAPIER.RigidBodyDesc.fixed()
      .setTranslation(position.x, position.y, position.z);
    if (rotation) desc.setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w });

    const body = this.world.createRigidBody(desc);
    this.world.createCollider(this.buildColliderDesc(colliderConfig), body);
    return body;
  }

  createKinematicBody(
    entityId: number,
    position: THREE.Vector3,
  ): RAPIER.RigidBody {
    const desc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(position.x, position.y, position.z);
    const body = this.world.createRigidBody(desc);
    this.bodies.set(entityId, body);
    return body;
  }

  createCharacterController(
    entityId: number,
    position: THREE.Vector3,
    options: {
      height?: number;
      radius?: number;
      stepHeight?: number;
      maxSlopeAngle?: number;
    } = {},
  ): void {
    const {
      height = 1.8,
      radius = 0.4,
      stepHeight = 0.5,
      maxSlopeAngle = (45 * Math.PI) / 180,
    } = options;

    const controller = this.world.createCharacterController(0.01); // Small offset
    controller.setMaxSlopeClimbAngle(maxSlopeAngle);
    controller.setMinSlopeSlideAngle((30 * Math.PI) / 180);
    controller.enableAutostep(stepHeight, 0.2, true);
    controller.enableSnapToGround(0.5);
    controller.setCharacterMass(70);

    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(position.x, position.y, position.z);
    const body = this.world.createRigidBody(bodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.capsule(height / 2 - radius, radius);
    const collider = this.world.createCollider(colliderDesc, body);

    this.characterControllers.set(entityId, {
      controller,
      body,
      collider,
      gravityVelocity: 0,
    });
  }

  moveCharacter(
    entityId: number,
    desiredMove: THREE.Vector3,
    delta: number,
  ): { grounded: boolean } {
    const cc = this.characterControllers.get(entityId);
    if (!cc) return { grounded: false };

    const { controller, body, collider } = cc;

    // Apply gravity
    const grounded = controller.computedGrounded();
    if (grounded) {
      cc.gravityVelocity = 0;
    } else {
      cc.gravityVelocity += this.world.gravity.y * delta;
    }

    const movement = new RAPIER.Vector3(
      desiredMove.x * delta,
      (desiredMove.y + cc.gravityVelocity) * delta,
      desiredMove.z * delta,
    );

    controller.computeColliderMovement(collider, movement);
    const corrected = controller.computedMovement();

    const pos = body.translation();
    body.setNextKinematicTranslation({
      x: pos.x + corrected.x,
      y: pos.y + corrected.y,
      z: pos.z + corrected.z,
    });

    return { grounded };
  }

  jumpCharacter(entityId: number, jumpVelocity: number): void {
    const cc = this.characterControllers.get(entityId);
    if (!cc) return;
    if (cc.controller.computedGrounded()) {
      cc.gravityVelocity = jumpVelocity;
    }
  }

  getCharacterPosition(entityId: number): THREE.Vector3 | null {
    const cc = this.characterControllers.get(entityId);
    if (!cc) return null;
    const pos = cc.body.translation();
    return new THREE.Vector3(pos.x, pos.y, pos.z);
  }

  // ---------- Forces & Velocity ----------

  applyImpulse(entityId: number, impulse: THREE.Vector3): void {
    const body = this.bodies.get(entityId);
    body?.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);
  }

  setLinearVelocity(entityId: number, velocity: THREE.Vector3): void {
    const body = this.bodies.get(entityId);
    body?.setLinvel({ x: velocity.x, y: velocity.y, z: velocity.z }, true);
  }

  getLinearVelocity(entityId: number): THREE.Vector3 | null {
    const body = this.bodies.get(entityId);
    if (!body) return null;
    const v = body.linvel();
    return new THREE.Vector3(v.x, v.y, v.z);
  }

  // ---------- Step ----------

  step(delta: number): void {
    this.world.timestep = delta;
    this.world.step();

    if (this.debugEnabled && this.debugMesh) {
      this.updateDebugMesh();
    }
  }

  // ---------- Sync ----------

  syncBodiesToTransforms(transformMap: Map<number, { position: THREE.Vector3; rotation: THREE.Quaternion; dirty: boolean }>): void {
    for (const [entityId, body] of this.bodies) {
      if (body.isSleeping() || !body.isDynamic()) continue;

      const transform = transformMap.get(entityId);
      if (!transform) continue;

      const pos = body.translation();
      const rot = body.rotation();

      transform.position.set(pos.x, pos.y, pos.z);
      transform.rotation.set(rot.x, rot.y, rot.z, rot.w);
      transform.dirty = true;
    }

    // Also sync character controllers
    for (const [entityId, cc] of this.characterControllers) {
      const transform = transformMap.get(entityId);
      if (!transform) continue;
      const pos = cc.body.translation();
      transform.position.set(pos.x, pos.y, pos.z);
      transform.dirty = true;
    }
  }

  // ---------- Raycasting ----------

  raycast(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDistance: number,
    excludeEntityId?: number,
  ): { point: THREE.Vector3; distance: number; entityId?: number } | null {
    const ray = new RAPIER.Ray(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: direction.x, y: direction.y, z: direction.z },
    );

    const excludeCollider = excludeEntityId !== undefined
      ? this.colliders.get(excludeEntityId)
      : undefined;

    const hit = this.world.castRay(ray, maxDistance, true, undefined, undefined, undefined, excludeCollider);
    if (!hit) return null;

    const point = ray.pointAt(hit.toi);
    return {
      point: new THREE.Vector3(point.x, point.y, point.z),
      distance: hit.toi,
      entityId: hit.collider.userData as number | undefined,
    };
  }

  // ---------- Cleanup ----------

  removeBody(entityId: number): void {
    const body = this.bodies.get(entityId);
    if (body) {
      this.world.removeRigidBody(body);
      this.bodies.delete(entityId);
      this.colliders.delete(entityId);
    }

    const cc = this.characterControllers.get(entityId);
    if (cc) {
      this.world.removeCharacterController(cc.controller);
      this.world.removeCollider(cc.collider, false);
      this.world.removeRigidBody(cc.body);
      this.characterControllers.delete(entityId);
    }
  }

  // ---------- Debug Rendering ----------

  enableDebug(scene: THREE.Scene): void {
    this.debugEnabled = true;
    if (!this.debugMesh) {
      const geo = new THREE.BufferGeometry();
      const mat = new THREE.LineBasicMaterial({ color: 0x00ff00, vertexColors: true });
      this.debugMesh = new THREE.LineSegments(geo, mat);
      this.debugMesh.frustumCulled = false;
      scene.add(this.debugMesh);
    }
  }

  disableDebug(): void {
    this.debugEnabled = false;
    if (this.debugMesh) {
      this.debugMesh.visible = false;
    }
  }

  private updateDebugMesh(): void {
    if (!this.debugMesh) return;
    const { vertices, colors } = this.world.debugRender();
    this.debugMesh.geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    this.debugMesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    this.debugMesh.visible = true;
  }

  dispose(): void {
    if (this.debugMesh) {
      this.debugMesh.geometry.dispose();
      (this.debugMesh.material as THREE.Material).dispose();
      this.debugMesh.parent?.remove(this.debugMesh);
    }
    this.world.free();
  }

  // ---------- Private Helpers ----------

  private buildColliderDesc(config: ColliderConfig): RAPIER.ColliderDesc {
    let desc: RAPIER.ColliderDesc;
    const { shape } = config;

    switch (shape.type) {
      case 'sphere':
        desc = RAPIER.ColliderDesc.ball(shape.radius);
        break;
      case 'box':
        desc = RAPIER.ColliderDesc.cuboid(shape.halfExtents.x, shape.halfExtents.y, shape.halfExtents.z);
        break;
      case 'capsule':
        desc = RAPIER.ColliderDesc.capsule(shape.halfHeight, shape.radius);
        break;
      case 'cylinder':
        desc = RAPIER.ColliderDesc.cylinder(shape.halfHeight, shape.radius);
        break;
      case 'trimesh':
        desc = RAPIER.ColliderDesc.trimesh(shape.vertices, shape.indices);
        break;
    }

    desc
      .setRestitution(config.restitution ?? 0.2)
      .setFriction(config.friction ?? 0.8)
      .setSensor(config.isSensor ?? false);

    if (config.collisionGroups !== undefined) {
      desc.setCollisionGroups(config.collisionGroups);
      desc.setSolverGroups(config.collisionGroups);
    }

    return desc;
  }
}

// Collision group encoding helper
export const CollisionGroups = {
  WORLD: 0x0001,
  PLAYER: 0x0002,
  ENEMY: 0x0004,
  PROJECTILE: 0x0008,
  TRIGGER: 0x0010,
  PICKUP: 0x0020,
} as const;

export function encodeCollisionGroups(membership: number, filter: number): number {
  return (membership << 16) | filter;
}
