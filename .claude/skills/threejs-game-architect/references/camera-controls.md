# Camera Systems and Controls

## First-Person Camera Controller

```typescript
class FirstPersonCamera {
  private yaw = 0;    // Horizontal rotation (Y axis)
  private pitch = 0;  // Vertical rotation (X axis)
  private readonly MAX_PITCH = Math.PI / 2 - 0.01;

  // Pre-allocated
  private _euler = new THREE.Euler(0, 0, 0, 'YXZ'); // YXZ order for FPS
  private _forward = new THREE.Vector3();
  private _right = new THREE.Vector3();

  constructor(
    private camera: THREE.PerspectiveCamera,
    private sensitivity = 0.002,
  ) {}

  rotate(deltaX: number, deltaY: number): void {
    this.yaw -= deltaX * this.sensitivity;
    this.pitch -= deltaY * this.sensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -this.MAX_PITCH, this.MAX_PITCH);

    this._euler.set(this.pitch, this.yaw, 0);
    this.camera.quaternion.setFromEuler(this._euler);
  }

  // Get movement directions based on camera orientation
  getForwardVector(): THREE.Vector3 {
    this.camera.getWorldDirection(this._forward);
    this._forward.y = 0; // Flatten for ground movement
    return this._forward.normalize();
  }

  getRightVector(): THREE.Vector3 {
    this.camera.getWorldDirection(this._forward);
    this._right.crossVectors(this._forward, new THREE.Vector3(0, 1, 0)).normalize();
    this._right.y = 0;
    return this._right.normalize();
  }

  setYaw(yaw: number): void {
    this.yaw = yaw;
  }

  setPitch(pitch: number): void {
    this.pitch = THREE.MathUtils.clamp(pitch, -this.MAX_PITCH, this.MAX_PITCH);
  }
}

// Pointer lock for FPS games
class PointerLockController {
  private locked = false;
  private onMove: (dx: number, dy: number) => void;

  constructor(
    private canvas: HTMLCanvasElement,
    onMove: (dx: number, dy: number) => void,
  ) {
    this.onMove = onMove;
    canvas.addEventListener('click', () => this.requestLock());
    document.addEventListener('pointerlockchange', () => this.onLockChange());
    document.addEventListener('mousemove', (e) => this.onMouseMove(e));
  }

  private requestLock(): void {
    this.canvas.requestPointerLock();
  }

  private onLockChange(): void {
    this.locked = document.pointerLockElement === this.canvas;
  }

  private onMouseMove(event: MouseEvent): void {
    if (!this.locked) return;
    this.onMove(event.movementX, event.movementY);
  }

  get isLocked(): boolean {
    return this.locked;
  }

  release(): void {
    document.exitPointerLock();
  }
}
```

## Third-Person Camera

```typescript
class ThirdPersonCamera {
  private offset = new THREE.Vector3(0, 3, -8);   // Camera offset from target
  private currentPos = new THREE.Vector3();
  private currentLookAt = new THREE.Vector3();

  // Camera angles
  private theta = 0;   // Horizontal angle around target
  private phi = 0.3;   // Vertical angle
  private distance = 8;

  // Pre-allocated
  private _idealPos = new THREE.Vector3();
  private _idealLookAt = new THREE.Vector3();
  private _temp = new THREE.Vector3();

  constructor(
    private camera: THREE.PerspectiveCamera,
    private target: THREE.Object3D,
    private sensitivity = 0.003,
    private followSpeed = 5.0,
  ) {
    this.currentPos.copy(camera.position);
    this.currentLookAt.copy(target.position);
  }

  rotate(deltaX: number, deltaY: number): void {
    this.theta -= deltaX * this.sensitivity;
    this.phi = THREE.MathUtils.clamp(
      this.phi - deltaY * this.sensitivity,
      0.1,          // Min angle (look down)
      Math.PI / 2,  // Max angle (horizontal)
    );
  }

  zoom(delta: number): void {
    this.distance = THREE.MathUtils.clamp(this.distance + delta, 3, 20);
  }

  update(delta: number): void {
    const targetPos = this.target.position;

    // Calculate ideal camera position (spherical coordinates)
    const sinPhi = Math.sin(this.phi);
    const cosPhi = Math.cos(this.phi);
    const sinTheta = Math.sin(this.theta);
    const cosTheta = Math.cos(this.theta);

    this._idealPos.set(
      targetPos.x + this.distance * sinPhi * sinTheta,
      targetPos.y + this.distance * cosPhi,
      targetPos.z + this.distance * sinPhi * cosTheta,
    );

    // Ideal look-at point (slightly above target)
    this._idealLookAt.set(targetPos.x, targetPos.y + 1.5, targetPos.z);

    // Smooth follow with lerp
    const t = 1 - Math.exp(-this.followSpeed * delta);
    this.currentPos.lerp(this._idealPos, t);
    this.currentLookAt.lerp(this._idealLookAt, t);

    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLookAt);
  }

  // Collision-aware camera (prevent camera going through walls)
  private _rayOrigin = new THREE.Vector3();
  private _rayDir = new THREE.Vector3();
  private raycaster = new THREE.Raycaster();

  updateWithCollision(
    delta: number,
    collidables: THREE.Object3D[],
  ): void {
    this.update(delta);

    // Cast ray from target to ideal camera position
    this._rayOrigin.copy(this.target.position);
    this._rayOrigin.y += 1.5;
    this._rayDir.subVectors(this.currentPos, this._rayOrigin).normalize();
    const dist = this._rayOrigin.distanceTo(this.currentPos);

    this.raycaster.set(this._rayOrigin, this._rayDir);
    this.raycaster.far = dist + 0.5;
    const hits = this.raycaster.intersectObjects(collidables, true);

    if (hits.length > 0 && hits[0].distance < dist) {
      // Move camera to just before the collision point
      this.camera.position
        .copy(this._rayOrigin)
        .addScaledVector(this._rayDir, hits[0].distance - 0.5);
    }
  }
}
```

## Cinematic Camera System

```typescript
interface CameraKeyframe {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
  time: number; // Time in seconds
}

class CinematicCamera {
  private keyframes: CameraKeyframe[] = [];
  private elapsed = 0;
  private playing = false;
  private onComplete?: () => void;

  // Pre-allocated
  private _pos = new THREE.Vector3();
  private _target = new THREE.Vector3();
  private _pos1 = new THREE.Vector3();
  private _pos2 = new THREE.Vector3();
  private _t1 = new THREE.Vector3();
  private _t2 = new THREE.Vector3();

  constructor(private camera: THREE.PerspectiveCamera) {}

  addKeyframe(keyframe: CameraKeyframe): this {
    this.keyframes.push(keyframe);
    this.keyframes.sort((a, b) => a.time - b.time);
    return this;
  }

  play(onComplete?: () => void): void {
    this.elapsed = 0;
    this.playing = true;
    this.onComplete = onComplete;
  }

  stop(): void {
    this.playing = false;
  }

  update(delta: number): void {
    if (!this.playing || this.keyframes.length < 2) return;

    this.elapsed += delta;
    const totalDuration = this.keyframes[this.keyframes.length - 1].time;

    if (this.elapsed >= totalDuration) {
      this.playing = false;
      this.onComplete?.();
      return;
    }

    // Find surrounding keyframes
    let fromIdx = 0;
    for (let i = 0; i < this.keyframes.length - 1; i++) {
      if (this.elapsed >= this.keyframes[i].time) fromIdx = i;
    }
    const toIdx = fromIdx + 1;

    const from = this.keyframes[fromIdx];
    const to = this.keyframes[toIdx];
    const t = (this.elapsed - from.time) / (to.time - from.time);

    // Cubic ease in-out
    const eased = t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;

    this._pos.lerpVectors(from.position, to.position, eased);
    this._target.lerpVectors(from.target, to.target, eased);

    this.camera.position.copy(this._pos);
    this.camera.lookAt(this._target);
    this.camera.fov = THREE.MathUtils.lerp(from.fov, to.fov, eased);
    this.camera.updateProjectionMatrix();
  }
}

// Usage — define a cutscene
const cutscene = new CinematicCamera(camera);
cutscene
  .addKeyframe({
    position: new THREE.Vector3(0, 20, 50),
    target: new THREE.Vector3(0, 0, 0),
    fov: 60,
    time: 0,
  })
  .addKeyframe({
    position: new THREE.Vector3(10, 5, 15),
    target: new THREE.Vector3(0, 2, 0),
    fov: 75,
    time: 3,
  })
  .addKeyframe({
    position: new THREE.Vector3(5, 2, 5),
    target: new THREE.Vector3(0, 1, 0),
    fov: 90,
    time: 5,
  });

cutscene.play(() => {
  console.log('Cutscene complete — handing back control to player');
  gameState.resume();
});
```

## Camera Shake

```typescript
class CameraShake {
  private intensity = 0;
  private decay = 5;
  private maxOffset = 0.5;

  // Pre-allocated noise vectors
  private _offset = new THREE.Vector3();
  private _noiseTime = 0;

  trigger(intensity: number, duration?: number): void {
    this.intensity = Math.min(this.intensity + intensity, 1.0);
    if (duration !== undefined) {
      setTimeout(() => { this.intensity = 0; }, duration * 1000);
    }
  }

  update(camera: THREE.Camera, delta: number): void {
    if (this.intensity <= 0.001) {
      this.intensity = 0;
      return;
    }

    this._noiseTime += delta * 20;

    // Perlin-like noise using sin (cheap approximation)
    const noiseX = Math.sin(this._noiseTime * 1.3) * Math.sin(this._noiseTime * 0.7);
    const noiseY = Math.sin(this._noiseTime * 0.9) * Math.sin(this._noiseTime * 1.1);

    this._offset.set(
      noiseX * this.maxOffset * this.intensity,
      noiseY * this.maxOffset * this.intensity,
      0,
    );

    camera.position.add(this._offset);

    // Decay over time
    this.intensity = Math.max(0, this.intensity - this.decay * delta);
  }
}

// Usage
const shake = new CameraShake();

// On explosion
shake.trigger(0.8, 0.5); // 80% intensity for 0.5 seconds

// In game loop
shake.update(camera, delta);
```

## OrbitControls (Editor / Debug)

```typescript
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

function createEditorControls(
  camera: THREE.PerspectiveCamera,
  canvas: HTMLCanvasElement,
): OrbitControls {
  const controls = new OrbitControls(camera, canvas);

  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  controls.screenSpacePanning = true;
  controls.minDistance = 1;
  controls.maxDistance = 500;
  controls.maxPolarAngle = Math.PI / 2; // Prevent going underground

  // Zoom to fit scene
  controls.target.set(0, 0, 0);
  camera.position.set(10, 10, 10);
  controls.update();

  return controls;
}

// Must call controls.update() each frame when damping is enabled
function update(delta: number): void {
  editorControls.update();
  renderer.render(scene, camera);
}
```

## Spring Camera (Smooth Follow)

```typescript
// Spring-based camera for responsive following with physical feel
class SpringCamera {
  private velocity = new THREE.Vector3();
  private springStrength = 50.0;
  private damping = 10.0;

  private _toTarget = new THREE.Vector3();
  private _springForce = new THREE.Vector3();

  constructor(private camera: THREE.PerspectiveCamera) {}

  update(targetPosition: THREE.Vector3, delta: number): void {
    // Spring force toward target
    this._toTarget.subVectors(targetPosition, this.camera.position);
    this._springForce.copy(this._toTarget).multiplyScalar(this.springStrength);

    // Apply damping
    this._springForce.addScaledVector(this.velocity, -this.damping);

    // Integrate velocity and position
    this.velocity.addScaledVector(this._springForce, delta);
    this.camera.position.addScaledVector(this.velocity, delta);
  }
}
```
