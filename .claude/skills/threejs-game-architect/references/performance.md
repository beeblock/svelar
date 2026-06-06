# Performance Optimization

## Performance Budget — Target Metrics

| Metric | Desktop Target | Mobile Target |
|---|---|---|
| Frame time | < 16.67ms (60 FPS) | < 33ms (30 FPS) |
| Draw calls | < 200 | < 100 |
| Triangles | < 500K | < 100K |
| Texture memory | < 256MB | < 64MB |
| JS frame budget | < 5ms | < 10ms |

## Profiling First

```typescript
// Frame timing measurement
class FrameProfiler {
  private marks = new Map<string, number>();
  private measures: Record<string, number[]> = {};

  begin(name: string): void {
    this.marks.set(name, performance.now());
  }

  end(name: string): void {
    const start = this.marks.get(name);
    if (start === undefined) return;
    const elapsed = performance.now() - start;
    if (!this.measures[name]) this.measures[name] = [];
    this.measures[name].push(elapsed);
    // Keep only last 60 samples
    if (this.measures[name].length > 60) this.measures[name].shift();
  }

  getAverage(name: string): number {
    const samples = this.measures[name] ?? [];
    if (samples.length === 0) return 0;
    return samples.reduce((a, b) => a + b) / samples.length;
  }

  report(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [name, samples] of Object.entries(this.measures)) {
      const avg = samples.reduce((a, b) => a + b) / samples.length;
      const max = Math.max(...samples);
      out[name] = `avg: ${avg.toFixed(2)}ms, max: ${max.toFixed(2)}ms`;
    }
    return out;
  }
}

// Usage in game loop
const profiler = new FrameProfiler();

function update(delta: number): void {
  profiler.begin('physics');
  physicsSystem.update(delta);
  profiler.end('physics');

  profiler.begin('ai');
  aiSystem.update(delta);
  profiler.end('ai');

  profiler.begin('render');
  renderer.render(scene, camera);
  profiler.end('render');
}

// Log every 5 seconds
setInterval(() => console.table(profiler.report()), 5000);
```

## InstancedMesh — The Primary Draw Call Reducer

```typescript
// Replace separate meshes with a single InstancedMesh
class InstancedObjectManager {
  private mesh: THREE.InstancedMesh;
  private nextInstance = 0;
  private instanceIds = new Map<number, number>(); // entityId -> instanceIndex
  private freeList: number[] = [];

  // Reusable matrix — no allocation in update
  private _matrix = new THREE.Matrix4();
  private _position = new THREE.Vector3();
  private _quaternion = new THREE.Quaternion();
  private _scale = new THREE.Vector3(1, 1, 1);

  constructor(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    maxCount: number,
    scene: THREE.Scene,
  ) {
    this.mesh = new THREE.InstancedMesh(geometry, material, maxCount);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0; // Start with 0 visible instances
    scene.add(this.mesh);
  }

  addInstance(entityId: number, position: THREE.Vector3, scale?: number): number {
    let index: number;
    if (this.freeList.length > 0) {
      index = this.freeList.pop()!;
    } else {
      index = this.nextInstance++;
    }

    this._position.copy(position);
    this._scale.setScalar(scale ?? 1);
    this._matrix.compose(this._position, this._quaternion, this._scale);
    this.mesh.setMatrixAt(index, this._matrix);

    this.instanceIds.set(entityId, index);
    this.mesh.count = Math.max(this.mesh.count, index + 1);
    this.mesh.instanceMatrix.needsUpdate = true;
    return index;
  }

  updateInstance(entityId: number, position: THREE.Vector3, rotation?: THREE.Quaternion): void {
    const index = this.instanceIds.get(entityId);
    if (index === undefined) return;

    this._position.copy(position);
    this._matrix.compose(
      this._position,
      rotation ?? this._quaternion,
      this._scale,
    );
    this.mesh.setMatrixAt(index, this._matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  removeInstance(entityId: number): void {
    const index = this.instanceIds.get(entityId);
    if (index === undefined) return;

    // Hide by scaling to zero (don't change count)
    this._matrix.makeScale(0, 0, 0);
    this.mesh.setMatrixAt(index, this._matrix);
    this.mesh.instanceMatrix.needsUpdate = true;

    this.instanceIds.delete(entityId);
    this.freeList.push(index);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.parent?.remove(this.mesh);
  }
}
```

## Geometry Merging

```typescript
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Merge static world geometry — massive draw call reduction
function bakeStaticWorld(meshes: THREE.Mesh[]): THREE.Mesh[] {
  // Group meshes by material to minimize merges
  const materialGroups = new Map<THREE.Material, THREE.BufferGeometry[]>();

  for (const mesh of meshes) {
    mesh.updateMatrixWorld(true);
    const geo = mesh.geometry.clone();
    geo.applyMatrix4(mesh.matrixWorld); // Bake transform into geometry

    const mat = mesh.material as THREE.Material;
    if (!materialGroups.has(mat)) materialGroups.set(mat, []);
    materialGroups.get(mat)!.push(geo);

    // Remove from scene — will be replaced by merged version
    mesh.parent?.remove(mesh);
  }

  const mergedMeshes: THREE.Mesh[] = [];
  for (const [material, geos] of materialGroups) {
    const merged = mergeGeometries(geos);
    if (merged) {
      mergeVertices(merged, 0.001); // Weld vertices within 1mm
      merged.computeVertexNormals();
      mergedMeshes.push(new THREE.Mesh(merged, material));
    }
    // Dispose source geometries
    geos.forEach((g) => g.dispose());
  }

  return mergedMeshes;
}
```

## LOD (Level of Detail)

```typescript
import { LOD } from 'three';
import { SimplifyModifier } from 'three/examples/jsm/modifiers/SimplifyModifier.js';

function createLODTree(
  highDetailGeo: THREE.BufferGeometry,
  material: THREE.Material,
): THREE.LOD {
  const lod = new THREE.LOD();

  // High detail: 0-30 units
  lod.addLevel(new THREE.Mesh(highDetailGeo, material), 0);

  // Medium: simplify to 50%
  const modifier = new SimplifyModifier();
  const medGeo = modifier.modify(highDetailGeo.clone(), Math.floor(highDetailGeo.attributes.position.count * 0.5));
  lod.addLevel(new THREE.Mesh(medGeo, material), 30);

  // Low: 20% of original
  const lowGeo = modifier.modify(highDetailGeo.clone(), Math.floor(highDetailGeo.attributes.position.count * 0.2));
  lod.addLevel(new THREE.Mesh(lowGeo, material), 60);

  // Billboard: just a sprite at extreme distance
  // lod.addLevel(createBillboard(material), 150);

  return lod;
}

// Update LOD each frame based on camera position
function updateLODs(scene: THREE.Scene, camera: THREE.Camera): void {
  scene.traverse((obj) => {
    if (obj instanceof THREE.LOD) {
      obj.update(camera);
    }
  });
}
```

## Frustum Culling

```typescript
// Three.js performs automatic frustum culling by default
// Manual culling for dynamic objects not using Three.js

class FrustumCuller {
  private frustum = new THREE.Frustum();
  private projScreenMatrix = new THREE.Matrix4();

  update(camera: THREE.Camera): void {
    camera.updateMatrixWorld();
    this.projScreenMatrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix);
  }

  isVisible(object: THREE.Object3D): boolean {
    // Use bounding sphere for quick check
    const sphere = (object as THREE.Mesh).geometry?.boundingSphere;
    if (!sphere) return true;
    return this.frustum.intersectsSphere(sphere.clone().applyMatrix4(object.matrixWorld));
  }

  isBoxVisible(box: THREE.Box3): boolean {
    return this.frustum.intersectsBox(box);
  }
}

// Disable automatic culling only if you're doing it yourself
mesh.frustumCulled = true; // Default — leave enabled unless custom culling
```

## Texture Optimization

```typescript
// Texture atlas — combine multiple small textures into one
// Reduces texture swaps and state changes

class TextureAtlas {
  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;
  private regions = new Map<string, THREE.Vector4>(); // name -> (u0, v0, u1, v1)

  private size: number;
  private cursor = { x: 0, y: 0, rowHeight: 0 };

  constructor(size = 2048) {
    this.size = size;
    this.canvas = new OffscreenCanvas(size, size);
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas as unknown as HTMLCanvasElement);
    this.texture.colorSpace = THREE.SRGBColorSpace;
  }

  addImage(name: string, image: ImageBitmap): THREE.Vector4 {
    const { width, height } = image;

    // Simple row-based packing
    if (this.cursor.x + width > this.size) {
      this.cursor.x = 0;
      this.cursor.y += this.cursor.rowHeight;
      this.cursor.rowHeight = 0;
    }

    this.ctx.drawImage(image, this.cursor.x, this.cursor.y);

    const region = new THREE.Vector4(
      this.cursor.x / this.size,
      this.cursor.y / this.size,
      (this.cursor.x + width) / this.size,
      (this.cursor.y + height) / this.size,
    );
    this.regions.set(name, region);

    this.cursor.x += width;
    this.cursor.rowHeight = Math.max(this.cursor.rowHeight, height);
    this.texture.needsUpdate = true;

    return region;
  }

  getRegion(name: string): THREE.Vector4 | undefined {
    return this.regions.get(name);
  }
}
```

## Object Pooling — Scene-Level

```typescript
// Pool for entire mesh instances (reuse, don't create/destroy)
class MeshPool {
  private pool: THREE.Mesh[] = [];
  private active = new Set<THREE.Mesh>();
  private scene: THREE.Scene;

  constructor(
    private readonly geometry: THREE.BufferGeometry,
    private readonly material: THREE.Material,
    private readonly scene_: THREE.Scene,
    preWarm = 20,
  ) {
    this.scene = scene_;
    for (let i = 0; i < preWarm; i++) {
      const mesh = this.createMesh();
      mesh.visible = false;
      this.pool.push(mesh);
      this.scene.add(mesh);
    }
  }

  acquire(position: THREE.Vector3): THREE.Mesh {
    let mesh: THREE.Mesh;
    if (this.pool.length > 0) {
      mesh = this.pool.pop()!;
    } else {
      mesh = this.createMesh();
      this.scene.add(mesh);
    }
    mesh.position.copy(position);
    mesh.visible = true;
    this.active.add(mesh);
    return mesh;
  }

  release(mesh: THREE.Mesh): void {
    if (!this.active.has(mesh)) return;
    mesh.visible = false;
    mesh.position.set(0, -1000, 0); // Off screen
    this.active.delete(mesh);
    this.pool.push(mesh);
  }

  private createMesh(): THREE.Mesh {
    return new THREE.Mesh(this.geometry, this.material);
  }

  dispose(): void {
    const allMeshes = [...this.pool, ...this.active];
    for (const mesh of allMeshes) {
      this.scene.remove(mesh);
    }
    this.geometry.dispose();
    this.material.dispose();
  }
}
```

## Avoid GC Allocations in Game Loop

```typescript
// BAD — creates new objects every frame
class BadMovementSystem {
  update(entity: Entity, delta: number): void {
    const velocity = new THREE.Vector3(1, 0, 0); // ALLOCATION!
    const newPos = entity.position.clone().add(velocity.multiplyScalar(delta)); // ALLOCATION!
    entity.position.copy(newPos);
  }
}

// GOOD — reuses pre-allocated objects
class GoodMovementSystem {
  // Pre-allocated working vectors
  private _velocity = new THREE.Vector3();

  update(entity: Entity, delta: number): void {
    this._velocity.set(1, 0, 0);
    entity.position.addScaledVector(this._velocity, delta); // No allocation
  }
}

// Anti-patterns to avoid:
// entity.position = new THREE.Vector3(x, y, z);     // BAD: creates new object
// const dir = target.sub(origin);                   // BAD: modifies target in place
// entity.position.add(entity.velocity.clone());     // BAD: .clone() allocates

// Correct patterns:
// entity.position.set(x, y, z);                     // GOOD: reuse existing
// this._dir.subVectors(target, origin);             // GOOD: pre-allocated _dir
// entity.position.addScaledVector(velocity, delta); // GOOD: no allocation
```

## Web Workers for Heavy Computation

```typescript
// Move pathfinding, procedural generation, or physics preprocessing to workers

// pathfinding.worker.ts
self.onmessage = (event: MessageEvent) => {
  const { start, end, navmesh } = event.data;
  const path = computeAStar(start, end, navmesh); // Expensive operation
  self.postMessage({ path });
};

// Main thread
class PathfindingWorkerPool {
  private workers: Worker[];
  private queue: Array<{
    task: PathTask;
    resolve: (path: THREE.Vector3[]) => void;
    reject: (err: Error) => void;
  }> = [];
  private available: Worker[] = [];

  constructor(workerCount = navigator.hardwareConcurrency ?? 4) {
    this.workers = Array.from({ length: workerCount }, () => {
      const worker = new Worker(new URL('./pathfinding.worker.ts', import.meta.url));
      worker.onmessage = (e) => this.onWorkerMessage(worker, e);
      this.available.push(worker);
      return worker;
    });
  }

  findPath(start: THREE.Vector3, end: THREE.Vector3): Promise<THREE.Vector3[]> {
    return new Promise((resolve, reject) => {
      this.queue.push({ task: { start, end }, resolve, reject });
      this.dispatch();
    });
  }

  private dispatch(): void {
    while (this.available.length > 0 && this.queue.length > 0) {
      const worker = this.available.pop()!;
      const item = this.queue.shift()!;
      (worker as any).__resolve = item.resolve;
      worker.postMessage(item.task);
    }
  }

  private onWorkerMessage(worker: Worker, event: MessageEvent): void {
    const resolve = (worker as any).__resolve as (path: THREE.Vector3[]) => void;
    resolve(event.data.path);
    this.available.push(worker);
    this.dispatch();
  }

  terminate(): void {
    this.workers.forEach((w) => w.terminate());
  }
}

interface PathTask {
  start: THREE.Vector3;
  end: THREE.Vector3;
}
```

## Render Target Optimization

```typescript
// Reuse render targets — don't create new ones each frame
class RenderTargetManager {
  private targets = new Map<string, THREE.WebGLRenderTarget>();

  get(
    name: string,
    width: number,
    height: number,
    options?: THREE.RenderTargetOptions,
  ): THREE.WebGLRenderTarget {
    const existing = this.targets.get(name);
    if (existing) {
      // Resize if needed
      if (existing.width !== width || existing.height !== height) {
        existing.setSize(width, height);
      }
      return existing;
    }

    const target = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType, // HDR render targets
      ...options,
    });
    this.targets.set(name, target);
    return target;
  }

  dispose(): void {
    this.targets.forEach((t) => t.dispose());
    this.targets.clear();
  }
}
```

## Performance Checklist

```typescript
// Run this audit in development mode
function performanceAudit(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
  const info = renderer.info;
  const warnings: string[] = [];

  if (info.render.calls > 200) {
    warnings.push(`HIGH DRAW CALLS: ${info.render.calls} (target: <200)`);
  }

  if (info.render.triangles > 500_000) {
    warnings.push(`HIGH TRIANGLE COUNT: ${info.render.triangles.toLocaleString()}`);
  }

  if (info.memory.textures > 50) {
    warnings.push(`MANY TEXTURES: ${info.memory.textures} (consider atlases)`);
  }

  let meshCount = 0;
  let shadowCasters = 0;
  scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      meshCount++;
      if (obj.castShadow) shadowCasters++;
    }
  });

  if (shadowCasters > 30) {
    warnings.push(`MANY SHADOW CASTERS: ${shadowCasters} (consider baked shadows)`);
  }

  if (warnings.length === 0) {
    console.log('%c Performance OK', 'color: green');
  } else {
    warnings.forEach((w) => console.warn(`[PERF] ${w}`));
  }
}
```
