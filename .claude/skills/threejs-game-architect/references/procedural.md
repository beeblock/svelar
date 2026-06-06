# Procedural Generation

## Terrain Generation with Noise

```typescript
import * as THREE from 'three';

class TerrainGenerator {
  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;

  constructor(
    private readonly resolution: number = 256,
    private readonly width: number = 100,
    private readonly depth: number = 100,
    private readonly maxHeight: number = 20,
  ) {
    this.canvas = new OffscreenCanvas(resolution, resolution);
    this.ctx = this.canvas.getContext('2d')!;
  }

  generate(seed = 0): THREE.Mesh {
    const heightmap = this.generateHeightmap(seed);
    const geometry = this.buildGeometry(heightmap);
    const material = this.buildMaterial(heightmap);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    return mesh;
  }

  private generateHeightmap(seed: number): Float32Array {
    const size = this.resolution;
    const heights = new Float32Array(size * size);

    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        const nx = x / size;
        const nz = z / size;

        // Multi-octave noise
        let height = 0;
        height += this.fbm(nx + seed, nz + seed, 4, 1.0, 0.5, 2.0, 0.5);

        // Ridge noise for mountains
        height += this.ridgeNoise(nx * 2 + seed, nz * 2 + seed) * 0.3;

        // Domain warp for organic shapes
        const wx = nx + 0.3 * this.noise2D(nx + 5.2 + seed, nz + 1.3 + seed);
        const wz = nz + 0.3 * this.noise2D(nx + 9.2 + seed, nz + 0.8 + seed);
        height += this.fbm(wx, wz, 3, 0.3, 0.5, 2.0, 0.5);

        heights[z * size + x] = Math.pow(Math.max(0, height), 1.5);
      }
    }
    return heights;
  }

  private buildGeometry(heights: Float32Array): THREE.BufferGeometry {
    const size = this.resolution;
    const geometry = new THREE.PlaneGeometry(
      this.width,
      this.depth,
      size - 1,
      size - 1,
    );
    geometry.rotateX(-Math.PI / 2);

    // Apply heights to Y positions
    const positions = geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < positions.count; i++) {
      const heightIndex = i; // PlaneGeometry vertex order matches heightmap
      const h = heights[heightIndex] * this.maxHeight;
      positions.setY(i, h);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    return geometry;
  }

  private buildMaterial(heights: Float32Array): THREE.Material {
    // Biome-based vertex colors
    const colors = new Float32Array(heights.length * 3);
    for (let i = 0; i < heights.length; i++) {
      const h = heights[i];
      let r, g, b;
      if (h < 0.1) { r = 0.2; g = 0.4; b = 0.8; } // Water (blue)
      else if (h < 0.2) { r = 0.8; g = 0.7; b = 0.5; } // Sand (beige)
      else if (h < 0.5) { r = 0.3; g = 0.6; b = 0.2; } // Grass (green)
      else if (h < 0.7) { r = 0.4; g = 0.3; b = 0.2; } // Rock (brown)
      else { r = 0.9; g = 0.9; b = 0.95; }              // Snow (white)
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    return new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0.0,
    });
  }

  // Get height at world-space XZ position
  getHeightAt(heightmap: Float32Array, worldX: number, worldZ: number): number {
    const size = this.resolution;
    const nx = (worldX / this.width + 0.5) * (size - 1);
    const nz = (worldZ / this.depth + 0.5) * (size - 1);

    const x0 = Math.floor(nx);
    const z0 = Math.floor(nz);
    const x1 = Math.min(x0 + 1, size - 1);
    const z1 = Math.min(z0 + 1, size - 1);

    const fx = nx - x0;
    const fz = nz - z0;

    // Bilinear interpolation
    const h00 = heightmap[z0 * size + x0];
    const h10 = heightmap[z0 * size + x1];
    const h01 = heightmap[z1 * size + x0];
    const h11 = heightmap[z1 * size + x1];

    const h0 = h00 + (h10 - h00) * fx;
    const h1 = h01 + (h11 - h01) * fx;
    return (h0 + (h1 - h0) * fz) * this.maxHeight;
  }

  // --- Noise functions ---
  private noise2D(x: number, y: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    const u = this.fade(x);
    const v = this.fade(y);
    const a = (X + Y) & 255;
    const b = (X + Y + 1) & 255;
    return this.lerp(v,
      this.lerp(u, this.grad(a, x, y), this.grad(b, x - 1, y)),
      this.lerp(u, this.grad(a + 1, x, y - 1), this.grad(b + 1, x - 1, y - 1)),
    );
  }

  private fade(t: number): number { return t * t * t * (t * (t * 6 - 15) + 10); }
  private lerp(t: number, a: number, b: number): number { return a + t * (b - a); }
  private grad(hash: number, x: number, y: number): number {
    const h = hash & 3;
    const u = h < 2 ? x : y;
    const v = h < 2 ? y : x;
    return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
  }

  private fbm(x: number, y: number, octaves: number, amplitude: number, persistence: number, frequency: number, lacunarity: number): number {
    let value = 0;
    let amp = amplitude;
    let freq = frequency;
    for (let i = 0; i < octaves; i++) {
      value += this.noise2D(x * freq, y * freq) * amp;
      amp *= persistence;
      freq *= lacunarity;
    }
    return value;
  }

  private ridgeNoise(x: number, y: number): number {
    return 1.0 - Math.abs(this.noise2D(x, y));
  }
}
```

## Procedural Tree Generation

```typescript
interface BranchConfig {
  length: number;
  radius: number;
  angle: number;
  depth: number;
  maxDepth: number;
}

class ProceduralTree {
  private vertices: number[] = [];
  private indices: number[] = [];
  private normals: number[] = [];
  private uvs: number[] = [];
  private vertexCount = 0;

  generate(
    seed: number,
    maxDepth = 5,
    trunkLength = 5,
    trunkRadius = 0.4,
  ): THREE.Mesh {
    this.vertices = [];
    this.indices = [];
    this.normals = [];
    this.uvs = [];
    this.vertexCount = 0;

    const rng = this.seededRandom(seed);

    this.buildBranch(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 1, 0),
      trunkLength,
      trunkRadius,
      0,
      maxDepth,
      rng,
    );

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.vertices, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geometry.setIndex(this.indices);
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      color: 0x5c3d1e,
      roughness: 1.0,
    });

    return new THREE.Mesh(geometry, material);
  }

  private buildBranch(
    start: THREE.Vector3,
    direction: THREE.Vector3,
    length: number,
    radius: number,
    depth: number,
    maxDepth: number,
    rng: () => number,
  ): void {
    if (depth >= maxDepth || length < 0.1) return;

    const end = start.clone().addScaledVector(direction, length);
    const segments = 6;

    // Create cylinder for this branch
    this.addCylinder(start, end, radius, radius * 0.6, segments);

    // Recurse
    const numBranches = depth === 0 ? 3 : 2;
    for (let i = 0; i < numBranches; i++) {
      const angle = (i / numBranches) * Math.PI * 2 + rng() * 0.5;
      const splitAngle = 0.4 + rng() * 0.4;

      const newDir = direction.clone()
        .applyAxisAngle(new THREE.Vector3(1, 0, 0), splitAngle)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);

      this.buildBranch(
        end,
        newDir,
        length * (0.6 + rng() * 0.2),
        radius * 0.65,
        depth + 1,
        maxDepth,
        rng,
      );
    }
  }

  private addCylinder(
    start: THREE.Vector3,
    end: THREE.Vector3,
    radiusBottom: number,
    radiusTop: number,
    segments: number,
  ): void {
    const axis = end.clone().sub(start).normalize();
    const up = Math.abs(axis.y) > 0.99
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 1, 0);
    const right = axis.clone().cross(up).normalize();
    const forward = axis.clone().cross(right).normalize();

    for (let ring = 0; ring <= 1; ring++) {
      const center = ring === 0 ? start : end;
      const radius = ring === 0 ? radiusBottom : radiusTop;
      for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        const pos = center.clone()
          .addScaledVector(right, x)
          .addScaledVector(forward, z);
        this.vertices.push(pos.x, pos.y, pos.z);
        this.normals.push(right.x * Math.cos(angle) + forward.x * Math.sin(angle), 0, forward.z);
        this.uvs.push(i / segments, ring);
      }
    }

    const base = this.vertexCount;
    for (let i = 0; i < segments; i++) {
      const a = base + i;
      const b = base + i + 1;
      const c = base + i + segments + 1;
      const d = base + i + segments + 2;
      this.indices.push(a, b, c, b, d, c);
    }
    this.vertexCount += (segments + 1) * 2;
  }

  private seededRandom(seed: number): () => number {
    let s = seed;
    return () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
  }
}
```

## Instanced Foliage Placement

```typescript
// Scatter foliage across terrain using noise-based density
function scatterFoliage(
  scene: THREE.Scene,
  heightmap: Float32Array,
  terrain: TerrainGenerator,
  treeGeo: THREE.BufferGeometry,
  treeMat: THREE.Material,
  count: number,
  seed: number,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(treeGeo, treeMat, count);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  const rng = seededRandom(seed);
  let placed = 0;
  let attempts = 0;

  const terrainWidth = 100;
  const terrainDepth = 100;

  while (placed < count && attempts < count * 10) {
    attempts++;

    const x = (rng() - 0.5) * terrainWidth;
    const z = (rng() - 0.5) * terrainDepth;
    const h = terrain.getHeightAt(heightmap, x, z);

    // Only place on valid terrain (not water, not steep)
    if (h < 2 || h > terrain['maxHeight'] * 0.8) continue;

    // Density based on noise (cluster trees)
    const density = (Math.sin(x * 0.1) * Math.cos(z * 0.1) + 1) * 0.5;
    if (rng() > density) continue;

    position.set(x, h, z);

    // Slight random rotation
    quaternion.setFromAxisAngle(up, rng() * Math.PI * 2);

    // Scale variation
    const s = 0.8 + rng() * 0.4;
    scale.setScalar(s);

    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(placed, matrix);
    placed++;
  }

  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
  return mesh;
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return ((s >>> 0) / 0xFFFFFFFF);
  };
}
```

## Dungeon Generation (BSP)

```typescript
interface Room {
  x: number; z: number;
  width: number; depth: number;
  center: THREE.Vector2;
}

class BSPDungeonGenerator {
  private rooms: Room[] = [];
  private corridors: [Room, Room][] = [];

  generate(
    width: number,
    depth: number,
    minRoomSize: number,
    seed: number,
  ): { rooms: Room[]; corridors: [Room, Room][] } {
    this.rooms = [];
    this.corridors = [];
    const rng = seededRandom(seed);
    this.split({ x: 0, z: 0, width, depth }, minRoomSize, rng);
    this.connectRooms();
    return { rooms: this.rooms, corridors: this.corridors };
  }

  private split(
    node: { x: number; z: number; width: number; depth: number },
    minSize: number,
    rng: () => number,
  ): void {
    if (node.width < minSize * 2 || node.depth < minSize * 2) {
      // Create a room in this leaf
      const margin = 2;
      const roomW = Math.floor(minSize * (0.5 + rng() * 0.5));
      const roomD = Math.floor(minSize * (0.5 + rng() * 0.5));
      const room: Room = {
        x: node.x + margin + Math.floor(rng() * (node.width - roomW - margin * 2)),
        z: node.z + margin + Math.floor(rng() * (node.depth - roomD - margin * 2)),
        width: roomW,
        depth: roomD,
        center: new THREE.Vector2(),
      };
      room.center.set(room.x + room.width / 2, room.z + room.depth / 2);
      this.rooms.push(room);
      return;
    }

    const splitHorizontal = rng() > 0.5;
    if (splitHorizontal && node.depth >= minSize * 2) {
      const mid = Math.floor(minSize + rng() * (node.depth - minSize * 2));
      this.split({ ...node, depth: mid }, minSize, rng);
      this.split({ ...node, z: node.z + mid, depth: node.depth - mid }, minSize, rng);
    } else if (node.width >= minSize * 2) {
      const mid = Math.floor(minSize + rng() * (node.width - minSize * 2));
      this.split({ ...node, width: mid }, minSize, rng);
      this.split({ ...node, x: node.x + mid, width: node.width - mid }, minSize, rng);
    }
  }

  private connectRooms(): void {
    for (let i = 1; i < this.rooms.length; i++) {
      this.corridors.push([this.rooms[i - 1], this.rooms[i]]);
    }
  }

  buildMesh(scene: THREE.Scene): void {
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x888888 });
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x555555 });

    for (const room of this.rooms) {
      // Floor
      const floor = new THREE.Mesh(
        new THREE.BoxGeometry(room.width, 0.2, room.depth),
        floorMat,
      );
      floor.position.set(room.x + room.width / 2, -0.1, room.z + room.depth / 2);
      floor.receiveShadow = true;
      scene.add(floor);

      // Walls (simplified)
      const wallH = 3;
      for (const [wx, wz, ww, wd] of [
        [room.x, room.z, room.width, 0.3],
        [room.x, room.z + room.depth - 0.3, room.width, 0.3],
        [room.x, room.z, 0.3, room.depth],
        [room.x + room.width - 0.3, room.z, 0.3, room.depth],
      ] as [number, number, number, number][]) {
        const wall = new THREE.Mesh(
          new THREE.BoxGeometry(ww, wallH, wd),
          wallMat,
        );
        wall.position.set(wx + ww / 2, wallH / 2, wz + wd / 2);
        wall.castShadow = true;
        wall.receiveShadow = true;
        scene.add(wall);
      }
    }
  }
}
```
