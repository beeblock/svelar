# Three.js Core Reference

## WebGLRenderer — Complete Configuration

```typescript
import * as THREE from 'three';

interface RendererOptions {
  canvas: HTMLCanvasElement;
  antialias?: boolean;
  shadows?: boolean;
  pixelRatioCap?: number;
}

function createRenderer(options: RendererOptions): THREE.WebGLRenderer {
  const { canvas, antialias = true, shadows = true, pixelRatioCap = 2 } = options;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias,
    alpha: false,               // Transparent background costs fillrate
    powerPreference: 'high-performance',
    stencil: false,             // Enable only if using stencil operations
    depth: true,
    logarithmicDepthBuffer: false, // Enable for very large scenes (cosmos scale)
    precision: 'highp',         // 'mediump' for mobile performance
  });

  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatioCap));

  // Color management (Three.js r152+)
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // Tone mapping
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  // Shadow maps
  if (shadows) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // THREE.BasicShadowMap     — fastest, hard edges
    // THREE.PCFShadowMap       — soft edges, moderate cost
    // THREE.PCFSoftShadowMap   — softer, slightly more expensive
    // THREE.VSMShadowMap       — variance shadow maps, good for large areas
  }

  // Disable auto-clear if using multiple render passes
  // renderer.autoClear = false;

  return renderer;
}

// Handle resize
function onResize(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

window.addEventListener('resize', () => onResize(renderer, camera));
```

## Renderer Info and Profiling

```typescript
// Monitor performance in development
function logRenderInfo(renderer: THREE.WebGLRenderer): void {
  const info = renderer.info;
  console.table({
    'Draw calls': info.render.calls,
    'Triangles': info.render.triangles,
    'Points': info.render.points,
    'Lines': info.render.lines,
    'Textures': info.memory.textures,
    'Geometries': info.memory.geometries,
    'Programs (shaders)': info.programs?.length,
  });
}

// Reset info counters each frame (needed for accurate per-frame counts)
renderer.info.autoReset = true; // Default: true
```

## Scene Setup

```typescript
function createScene(): THREE.Scene {
  const scene = new THREE.Scene();

  // Background options
  scene.background = new THREE.Color(0x1a1a2e);                // Solid color
  // scene.background = cubeTexture;                           // Skybox
  // scene.background = new THREE.Color(0x000000);            // Black (space)

  // Fog
  scene.fog = new THREE.Fog(0x1a1a2e, 50, 200);                // Linear fog
  // scene.fog = new THREE.FogExp2(0x87ceeb, 0.008);          // Exponential fog

  // Environment map for PBR reflections
  // scene.environment = hdrTexture; // Loaded via RGBELoader

  return scene;
}
```

## Camera Systems

### Perspective Camera (3D Games)

```typescript
function createPerspectiveCamera(width: number, height: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(
    75,              // Field of view (degrees) — 60 for third-person, 90+ for FPS
    width / height,  // Aspect ratio
    0.1,             // Near plane — larger = better depth precision, avoids z-fighting
    1000,            // Far plane — smaller = better depth precision
  );
  camera.position.set(0, 5, 10);
  camera.lookAt(0, 0, 0);
  return camera;
}

// Dynamic FOV for zoom effects
function zoomCamera(camera: THREE.PerspectiveCamera, targetFOV: number, t: number): void {
  camera.fov = THREE.MathUtils.lerp(camera.fov, targetFOV, t);
  camera.updateProjectionMatrix(); // Must call after changing FOV
}
```

### Orthographic Camera (2.5D or UI)

```typescript
function createOrthographicCamera(width: number, height: number): THREE.OrthographicCamera {
  const aspect = width / height;
  const frustumSize = 10;
  return new THREE.OrthographicCamera(
    (-frustumSize * aspect) / 2,
    (frustumSize * aspect) / 2,
    frustumSize / 2,
    -frustumSize / 2,
    0.1,
    1000,
  );
}
```

## Geometry

### BufferGeometry Fundamentals

```typescript
// Custom geometry from scratch
function createCustomGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();

  // Positions (3 floats per vertex: x, y, z)
  const positions = new Float32Array([
    -1, 0, 0,  // vertex 0
     1, 0, 0,  // vertex 1
     0, 2, 0,  // vertex 2
  ]);

  // Normals for lighting (3 floats per vertex)
  const normals = new Float32Array([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ]);

  // UV coordinates for texturing (2 floats per vertex)
  const uvs = new Float32Array([
    0, 0,
    1, 0,
    0.5, 1,
  ]);

  // Indices for indexed geometry (reuse vertices)
  const indices = new Uint16Array([0, 1, 2]);

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));

  // Compute missing normals if not provided
  geometry.computeVertexNormals();

  // Compute bounding volumes for frustum culling
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  return geometry;
}

// Dispose geometry when done (prevents memory leaks)
geometry.dispose();
```

### Dynamic Geometry (Update Each Frame)

```typescript
class DynamicMesh {
  private geometry: THREE.BufferGeometry;
  private positionAttr: THREE.BufferAttribute;
  readonly mesh: THREE.Mesh;

  constructor(maxVertices: number) {
    this.geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(maxVertices * 3);
    this.positionAttr = new THREE.BufferAttribute(positions, 3);
    this.positionAttr.setUsage(THREE.DynamicDrawUsage); // Hint for GPU
    this.geometry.setAttribute('position', this.positionAttr);

    this.mesh = new THREE.Mesh(
      this.geometry,
      new THREE.PointsMaterial({ size: 0.1 }),
    );
  }

  updateVertex(index: number, x: number, y: number, z: number): void {
    this.positionAttr.setXYZ(index, x, y, z);
    this.positionAttr.needsUpdate = true; // Required to upload to GPU
  }
}
```

## Materials

### PBR Material (MeshStandardMaterial)

```typescript
function createPBRMaterial(options: {
  color?: THREE.ColorRepresentation;
  metalness?: number;
  roughness?: number;
  map?: THREE.Texture;
  normalMap?: THREE.Texture;
  roughnessMap?: THREE.Texture;
  metalnessMap?: THREE.Texture;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: options.color ?? 0xffffff,
    metalness: options.metalness ?? 0.0,     // 0 = non-metal, 1 = metal
    roughness: options.roughness ?? 0.5,     // 0 = mirror, 1 = fully diffuse
    map: options.map,
    normalMap: options.normalMap,
    normalScale: new THREE.Vector2(1, 1),
    roughnessMap: options.roughnessMap,
    metalnessMap: options.metalnessMap,
    emissive: options.emissive ? new THREE.Color(options.emissive) : undefined,
    emissiveIntensity: options.emissiveIntensity ?? 1.0,
    envMapIntensity: 1.0,                    // PBR environment reflection strength
    shadowSide: THREE.FrontSide,
  });
}
```

### Transparent Materials

```typescript
// Additive blending (fire, particles, glow)
const additiveMaterial = new THREE.MeshBasicMaterial({
  color: 0xff8800,
  blending: THREE.AdditiveBlending,
  transparent: true,
  depthWrite: false,   // Critical for additive: don't write to depth buffer
  side: THREE.DoubleSide,
});

// Standard transparency
const glassMaterial = new THREE.MeshPhysicalMaterial({
  color: 0x88ccff,
  metalness: 0.0,
  roughness: 0.0,
  transmission: 1.0,   // Physical glass transmission
  thickness: 0.5,
  transparent: true,
  opacity: 0.3,
  depthWrite: false,
});
```

### Material Disposal

```typescript
function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  const materials = Array.isArray(material) ? material : [material];
  for (const mat of materials) {
    // Dispose all texture maps
    for (const key of Object.keys(mat)) {
      const value = (mat as Record<string, unknown>)[key];
      if (value instanceof THREE.Texture) {
        value.dispose();
      }
    }
    mat.dispose();
  }
}
```

## Textures

### Loading and Configuration

```typescript
import { TextureLoader } from 'three';

const loader = new TextureLoader();

// Load with proper color space
async function loadTexture(url: string, colorSpace = THREE.SRGBColorSpace): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (texture) => {
        texture.colorSpace = colorSpace;    // SRGB for color maps, NoColorSpace for normals/roughness
        texture.generateMipmaps = true;     // For downscaled rendering
        texture.minFilter = THREE.LinearMipmapLinearFilter; // Best quality mipmapping
        texture.magFilter = THREE.LinearFilter;
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy(); // Up to 16x
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        resolve(texture);
      },
      undefined,
      reject,
    );
  });
}

// Repeat tiling textures
texture.repeat.set(4, 4);
texture.wrapS = THREE.RepeatWrapping;
texture.wrapT = THREE.RepeatWrapping;
texture.needsUpdate = true;
```

### Compressed Textures (KTX2)

```typescript
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

const ktx2Loader = new KTX2Loader()
  .setTranscoderPath('/node_modules/three/examples/jsm/libs/basis/')
  .detectSupport(renderer);

async function loadKTX2Texture(url: string): Promise<THREE.CompressedTexture> {
  return ktx2Loader.loadAsync(url) as Promise<THREE.CompressedTexture>;
}
```

## Lighting

### Complete Lighting Rig

```typescript
function createLightingRig(scene: THREE.Scene): void {
  // Ambient base fill (keep low — let hemisphere provide fill instead)
  // const ambient = new THREE.AmbientLight(0xffffff, 0.1);
  // scene.add(ambient);

  // Hemisphere light — sky/ground two-tone ambient
  const hemi = new THREE.HemisphereLight(
    0x87ceeb,  // Sky color (blue sky)
    0x444433,  // Ground color (brown earth)
    0.5,
  );
  hemi.name = 'hemisphereLight';
  scene.add(hemi);

  // Directional (sun/moon)
  const sun = new THREE.DirectionalLight(0xfffde7, 1.2);
  sun.name = 'sunLight';
  sun.position.set(50, 100, 50);
  sun.castShadow = true;
  configureShadow(sun, 100, 2048);
  scene.add(sun);

  // Point light example (lamp post, fire)
  const pointLight = new THREE.PointLight(0xff8800, 1.0, 20, 2); // color, intensity, distance, decay
  pointLight.castShadow = true;
  pointLight.shadow.mapSize.set(512, 512); // Smaller for point lights
  scene.add(pointLight);

  // Spot light example (flashlight, stage spotlight)
  const spotLight = new THREE.SpotLight(0xffffff, 2.0, 30, Math.PI / 6, 0.25, 2);
  spotLight.castShadow = true;
  scene.add(spotLight);
}

function configureShadow(
  light: THREE.DirectionalLight,
  range: number,
  mapSize: number,
): void {
  light.shadow.mapSize.set(mapSize, mapSize);
  light.shadow.camera.near = 0.5;
  light.shadow.camera.far = range * 3;
  light.shadow.camera.left = -range;
  light.shadow.camera.right = range;
  light.shadow.camera.top = range;
  light.shadow.camera.bottom = -range;
  light.shadow.bias = -0.0001;     // Prevents shadow acne
  light.shadow.normalBias = 0.02;  // Prevents shadow detachment on curved surfaces
}
```

### Shadow Optimization

```typescript
// Only cast/receive shadows where needed
staticEnvironmentMesh.receiveShadow = true;
staticEnvironmentMesh.castShadow = false;  // Static won't cast on itself

playerMesh.castShadow = true;
playerMesh.receiveShadow = false;          // Player usually doesn't need ground shadow on itself

// Small objects: no shadow at all
debrisMesh.castShadow = false;
debrisMesh.receiveShadow = false;

// Update shadow camera frustum when sun moves
sun.position.set(newX, newY, newZ);
sun.shadow.camera.updateProjectionMatrix();

// Debug shadow camera (development only)
const shadowHelper = new THREE.CameraHelper(sun.shadow.camera);
scene.add(shadowHelper);
```

## Raycasting (Object Picking)

```typescript
class Raycaster {
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();

  // Screen-space ray from mouse position
  fromMouse(
    event: MouseEvent,
    camera: THREE.Camera,
    canvas: HTMLCanvasElement,
  ): THREE.Intersection[] {
    const rect = canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, camera);
    return this.raycaster.intersectObjects(scene.children, true);
  }

  // Ray from arbitrary point/direction
  fromRay(origin: THREE.Vector3, direction: THREE.Vector3): THREE.Intersection[] {
    this.raycaster.set(origin, direction.normalize());
    return this.raycaster.intersectObjects(scene.children, true);
  }

  // Optimize: set layers to only cast against relevant objects
  setLayer(layer: number): void {
    this.raycaster.layers.set(layer);
  }
}

// Usage
canvas.addEventListener('click', (event) => {
  const hits = raycaster.fromMouse(event, camera, canvas);
  if (hits.length > 0) {
    const { object, point, distance } = hits[0];
    console.log(`Hit: ${object.name} at distance ${distance.toFixed(2)}`);
  }
});
```

## Object Management

### Scene Graph Best Practices

```typescript
// Group related objects for batch transforms
const vehicle = new THREE.Group();
vehicle.name = 'vehicle_001';

const body = new THREE.Mesh(bodyGeo, bodyMat);
const wheelFL = new THREE.Mesh(wheelGeo, wheelMat);
const wheelFR = wheelFL.clone();

wheelFL.position.set(-1, -0.5, 1.5);
wheelFR.position.set( 1, -0.5, 1.5);

vehicle.add(body, wheelFL, wheelFR);
scene.add(vehicle);

// Clone objects (shares geometry and material — efficient)
const tree2 = tree1.clone(); // Geometry and material are shared
tree2.position.set(5, 0, 10);

// Deep clone (all unique references)
const uniqueTree = tree1.clone(true);
```

### Object Layers

```typescript
// Layers for selective rendering and raycasting
const LAYER_DEFAULT = 0;
const LAYER_UI = 1;
const LAYER_SHADOW_CASTERS = 2;
const LAYER_INTERACTABLE = 3;

// Assign object to layer
object.layers.set(LAYER_INTERACTABLE);

// Camera renders layers 0 and 1
camera.layers.enable(LAYER_DEFAULT);
camera.layers.enable(LAYER_UI);

// Raycaster only checks interactable layer
raycaster.layers.set(LAYER_INTERACTABLE);
```

## Memory Management

```typescript
// Full disposal of scene objects
function disposeSceneObject(object: THREE.Object3D): void {
  // Remove from scene first
  object.parent?.remove(object);

  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      // Dispose geometry
      if (child.geometry) {
        child.geometry.dispose();
      }

      // Dispose materials and their textures
      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];

      for (const material of materials) {
        // Dispose all texture properties
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) {
            value.dispose();
          }
        }
        material.dispose();
      }
    }

    // Dispose lights (release shadow maps)
    if (child instanceof THREE.Light && child.shadow) {
      child.shadow.map?.dispose();
    }
  });
}

// Renderer cleanup on app unmount
function disposeRenderer(renderer: THREE.WebGLRenderer): void {
  renderer.dispose();
  renderer.forceContextLoss();
  renderer.domElement.remove();
}
```
