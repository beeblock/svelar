/**
 * FPSController.ts
 * First-person player controller with pointer lock, smooth camera rotation,
 * character controller physics, and basic weapon bobbing.
 *
 * Integrates with: GameEngine, InputManager, PhysicsWorld (Rapier)
 */

import * as THREE from 'three';

export interface FPSControllerOptions {
  /** Move speed in meters per second */
  moveSpeed?: number;
  /** Sprint speed multiplier */
  sprintMultiplier?: number;
  /** Mouse sensitivity */
  sensitivity?: number;
  /** Jump velocity */
  jumpVelocity?: number;
  /** Player height (capsule height) */
  playerHeight?: number;
  /** Capsule radius */
  capsuleRadius?: number;
  /** Head height above capsule bottom */
  eyeHeight?: number;
}

export class FPSController {
  readonly camera: THREE.PerspectiveCamera;

  // Camera rotation
  private yaw = 0;    // Horizontal (Y-axis)
  private pitch = 0;  // Vertical (X-axis)
  private readonly MAX_PITCH = Math.PI / 2 - 0.02;

  // Physics state
  private gravityVelocity = 0;
  private isGrounded = false;
  private isSprinting = false;

  // Weapon bob
  private bobTime = 0;
  private readonly bobCamera = new THREE.Object3D(); // Camera bob node
  private readonly _weaponBobOffset = new THREE.Vector3();

  // Pre-allocated — no GC in update
  private readonly _euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly _moveDir = new THREE.Vector3();
  private readonly _forward = new THREE.Vector3();
  private readonly _right = new THREE.Vector3();
  private readonly _up = new THREE.Vector3(0, 1, 0);

  // Settings
  private readonly moveSpeed: number;
  private readonly sprintMultiplier: number;
  private readonly sensitivity: number;
  private readonly jumpVelocity: number;
  private readonly eyeHeight: number;

  // Pointer lock state
  private pointerLocked = false;

  // Callbacks
  onFire?: (position: THREE.Vector3, direction: THREE.Vector3) => void;
  onJump?: () => void;
  onLand?: () => void;

  constructor(
    camera: THREE.PerspectiveCamera,
    private canvas: HTMLCanvasElement,
    options: FPSControllerOptions = {},
  ) {
    this.camera = camera;
    this.moveSpeed = options.moveSpeed ?? 5;
    this.sprintMultiplier = options.sprintMultiplier ?? 2.0;
    this.sensitivity = options.sensitivity ?? 0.002;
    this.jumpVelocity = options.jumpVelocity ?? 6;
    this.eyeHeight = options.eyeHeight ?? (options.playerHeight ?? 1.8) * 0.9;

    // Setup pointer lock
    this.setupPointerLock();
  }

  private setupPointerLock(): void {
    this.canvas.addEventListener('click', () => {
      if (!this.pointerLocked) {
        this.canvas.requestPointerLock();
      }
    });

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.rotateCamera(e.movementX, e.movementY);
    });
  }

  private rotateCamera(movementX: number, movementY: number): void {
    this.yaw -= movementX * this.sensitivity;
    this.pitch -= movementY * this.sensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -this.MAX_PITCH, this.MAX_PITCH);
  }

  /**
   * Update the controller.
   * @param delta - Frame delta time in seconds
   * @param keys - Current held key codes (from InputManager)
   * @param mouseButtons - Current held mouse buttons
   * @param physicsMove - Optional callback to move character via physics (entityId, velocity, delta)
   * @param physicsJump - Optional callback to apply jump via physics
   * @param groundedCheck - Optional function to query grounded state
   */
  update(
    delta: number,
    keys: ReadonlySet<string>,
    mouseButtons: ReadonlySet<number>,
    physicsMove?: (velocity: THREE.Vector3, delta: number) => boolean,
    physicsJump?: (jumpVelocity: number) => void,
    getPosition?: () => THREE.Vector3,
  ): void {
    // ---------- Input ----------
    this.isSprinting = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const speed = this.moveSpeed * (this.isSprinting ? this.sprintMultiplier : 1.0);

    const moveX = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    const moveZ = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);

    // ---------- Movement Direction ----------
    // Get horizontal camera direction only
    this._euler.set(0, this.yaw, 0);
    this._forward.set(0, 0, -1).applyEuler(this._euler).normalize();
    this._right.crossVectors(this._forward, this._up).normalize();

    this._moveDir.set(0, 0, 0);
    if (moveX !== 0 || moveZ !== 0) {
      this._moveDir
        .addScaledVector(this._right, moveX)
        .addScaledVector(this._forward, moveZ)
        .normalize()
        .multiplyScalar(speed);
    }

    // ---------- Physics / Gravity ----------
    if (physicsMove) {
      this.isGrounded = physicsMove(this._moveDir, delta);
      if (this.isGrounded && this.gravityVelocity < 0) {
        const wasAirborne = this.gravityVelocity < -3;
        this.gravityVelocity = 0;
        if (wasAirborne) this.onLand?.();
      }
      if (!this.isGrounded) {
        this.gravityVelocity = Math.max(this.gravityVelocity - 9.81 * delta, -20);
      }

      // Jump
      if (keys.has('Space') && this.isGrounded && physicsJump) {
        physicsJump(this.jumpVelocity);
        this.gravityVelocity = this.jumpVelocity;
        this.onJump?.();
      }
    } else {
      // Fallback: no physics — move camera directly
      this.camera.position.addScaledVector(this._moveDir, delta);
    }

    // ---------- Apply Camera Rotation ----------
    this._euler.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(this._euler);

    // ---------- Sync Camera to Character Position ----------
    if (getPosition) {
      const pos = getPosition();
      this.camera.position.set(pos.x, pos.y + this.eyeHeight, pos.z);
    }

    // ---------- Weapon Bob ----------
    this.updateWeaponBob(delta, moveX !== 0 || moveZ !== 0);

    // ---------- Fire ----------
    if (mouseButtons.has(0) && this.pointerLocked) {
      this.fire();
    }
  }

  private updateWeaponBob(delta: number, isMoving: boolean): void {
    if (isMoving && this.isGrounded) {
      const bobSpeed = this.isSprinting ? 12 : 8;
      this.bobTime += delta * bobSpeed;
    } else {
      // Settle back to center
      this.bobTime *= 1 - 8 * delta;
    }

    const bobAmplitude = isMoving && this.isGrounded ? (this.isSprinting ? 0.04 : 0.02) : 0;
    this._weaponBobOffset.set(
      Math.sin(this.bobTime) * bobAmplitude,
      Math.abs(Math.sin(this.bobTime * 0.5)) * bobAmplitude * -1,
      0,
    );

    // Apply bob as camera offset (could drive a weapon model instead)
    // this.weaponObject?.position.copy(this._weaponBobOffset);
  }

  private _fireDir = new THREE.Vector3();

  private fire(): void {
    // Get world-space aim direction
    this.camera.getWorldDirection(this._fireDir);

    // Fire from camera position
    this.onFire?.(this.camera.position.clone(), this._fireDir.clone());
  }

  /** World-space direction the player is looking */
  getAimDirection(): THREE.Vector3 {
    this.camera.getWorldDirection(this._fireDir);
    return this._fireDir.clone();
  }

  /** Adjust FOV for zoom effect (e.g., iron sights) */
  setZoom(isZoomed: boolean, normalFOV = 75, zoomedFOV = 45): void {
    const targetFOV = isZoomed ? zoomedFOV : normalFOV;
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFOV, 0.15);
    this.camera.updateProjectionMatrix();
  }

  /** Set camera yaw directly (e.g., for spawn facing direction) */
  setYaw(yaw: number): void {
    this.yaw = yaw;
  }

  /** Trigger a camera shake effect */
  applyRecoil(amount = 0.02): void {
    this.pitch = Math.min(this.pitch + amount, this.MAX_PITCH);
  }

  get isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  requestPointerLock(): void {
    this.canvas.requestPointerLock();
  }

  releasePointerLock(): void {
    document.exitPointerLock();
  }

  dispose(): void {
    // Note: removeEventListener requires stored handler references in production
  }
}

// ---------- Crosshair Helper ----------

export function createCrosshair(): HTMLElement {
  const crosshair = document.createElement('div');
  crosshair.style.cssText = `
    position: fixed;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    pointer-events: none;
    width: 20px; height: 20px;
    display: flex; align-items: center; justify-content: center;
  `;

  // Simple dot crosshair
  const dot = document.createElement('div');
  dot.style.cssText = `
    width: 4px; height: 4px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.8);
    box-shadow: 0 0 2px rgba(0, 0, 0, 0.8);
  `;
  crosshair.appendChild(dot);
  document.body.appendChild(crosshair);
  return crosshair;
}

// ---------- Minimal FPS Game Setup ----------

export function createMinimalFPSSetup(canvas: HTMLCanvasElement): {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controller: FPSController;
  clock: THREE.Clock;
} {
  // Renderer
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;

  // Scene
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);
  scene.fog = new THREE.FogExp2(0x1a1a2e, 0.02);

  // Lights
  const hemi = new THREE.HemisphereLight(0x4466aa, 0x222222, 0.5);
  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.position.set(10, 20, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  scene.add(hemi, sun);

  // Camera
  const camera = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.1, 500);
  camera.position.set(0, 1.6, 0);

  // Controller
  const controller = new FPSController(camera, canvas, {
    moveSpeed: 5,
    sensitivity: 0.002,
    jumpVelocity: 5,
  });

  // Ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: 0x334433, roughness: 0.9 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const clock = new THREE.Clock();

  // Resize handler
  window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });

  // HUD
  createCrosshair();

  return { renderer, scene, camera, controller, clock };
}
