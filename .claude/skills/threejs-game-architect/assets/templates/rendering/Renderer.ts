/**
 * Renderer.ts
 * Three.js WebGLRenderer factory with optimal settings for game rendering.
 */

import * as THREE from 'three';

export interface RendererConfig {
  canvas: HTMLCanvasElement;
  antialias?: boolean;
  shadows?: boolean;
  shadowType?: THREE.ShadowMapType;
  pixelRatioCap?: number;
  toneMapping?: THREE.ToneMapping;
  exposure?: number;
  alpha?: boolean;
  logarithmicDepth?: boolean;
}

export function createGameRenderer(config: RendererConfig): THREE.WebGLRenderer {
  const {
    canvas,
    antialias = true,
    shadows = true,
    shadowType = THREE.PCFSoftShadowMap,
    pixelRatioCap = 2,
    toneMapping = THREE.ACESFilmicToneMapping,
    exposure = 1.0,
    alpha = false,
    logarithmicDepth = false,
  } = config;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias,
    alpha,
    powerPreference: 'high-performance',
    stencil: false,
    depth: true,
    logarithmicDepthBuffer: logarithmicDepth,
    // 'highp' is default; use 'mediump' only if targeting very low-end mobile
    precision: 'highp',
  });

  // Size
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatioCap));

  // Color management (Three.js r152+)
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // Tone mapping
  renderer.toneMapping = toneMapping;
  renderer.toneMappingExposure = exposure;

  // Shadow maps
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = shadowType;

  // Sorting — correct for transparent objects
  renderer.sortObjects = true;

  // Automatically reset render info counters each frame
  renderer.info.autoReset = true;

  return renderer;
}

/** Create a sun (directional light) with pre-configured shadow map */
export function createSun(
  scene: THREE.Scene,
  options: {
    position?: THREE.Vector3;
    color?: THREE.ColorRepresentation;
    intensity?: number;
    shadowMapSize?: number;
    shadowRange?: number;
    shadowBias?: number;
  } = {},
): THREE.DirectionalLight {
  const {
    position = new THREE.Vector3(50, 100, 50),
    color = 0xfffde7,
    intensity = 1.2,
    shadowMapSize = 2048,
    shadowRange = 100,
    shadowBias = -0.0001,
  } = options;

  const sun = new THREE.DirectionalLight(color, intensity);
  sun.name = 'sun';
  sun.position.copy(position);
  sun.castShadow = true;

  // Shadow camera — frustum should tightly fit the visible scene
  sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = shadowRange * 3;
  sun.shadow.camera.left = -shadowRange;
  sun.shadow.camera.right = shadowRange;
  sun.shadow.camera.top = shadowRange;
  sun.shadow.camera.bottom = -shadowRange;
  sun.shadow.bias = shadowBias;
  sun.shadow.normalBias = 0.02;

  scene.add(sun);
  return sun;
}

/** Create a hemisphere + directional light rig for outdoor scenes */
export function createOutdoorLighting(scene: THREE.Scene): {
  hemisphere: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
} {
  const hemisphere = new THREE.HemisphereLight(
    0x87ceeb,  // Sky color
    0x444433,  // Ground color
    0.6,
  );
  hemisphere.name = 'hemisphereLight';
  scene.add(hemisphere);

  const sun = createSun(scene);
  return { hemisphere, sun };
}

/** Handle window resize to keep renderer and camera in sync */
export function installResizeHandler(
  renderer: THREE.WebGLRenderer,
  camera: THREE.PerspectiveCamera,
): () => void {
  const handler = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', handler);

  // Return cleanup function
  return () => window.removeEventListener('resize', handler);
}

/** Safely dispose the entire renderer and scene */
export function disposeRenderer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
): void {
  // Dispose all scene objects
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of materials) {
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) value.dispose();
        }
        material.dispose();
      }
    }
    if (object instanceof THREE.Light && object.shadow) {
      object.shadow.map?.dispose();
    }
  });

  renderer.dispose();
  renderer.forceContextLoss();
}

/** Log render statistics to console (useful in development) */
export function logRenderStats(renderer: THREE.WebGLRenderer): void {
  const { render, memory, programs } = renderer.info;
  console.table({
    'Draw calls': render.calls,
    Triangles: render.triangles,
    Lines: render.lines,
    Points: render.points,
    Geometries: memory.geometries,
    Textures: memory.textures,
    'Shader programs': programs?.length ?? 0,
  });
}
