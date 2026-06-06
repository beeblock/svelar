# Asset Management

## Asset Manager — Core System

```typescript
import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { AudioLoader } from 'three';

type AssetType = 'gltf' | 'texture' | 'ktx2' | 'hdr' | 'audio' | 'json';

interface AssetDescriptor {
  url: string;
  type: AssetType;
  key: string;
}

interface AssetCache {
  gltf: Map<string, GLTF>;
  textures: Map<string, THREE.Texture>;
  audio: Map<string, AudioBuffer>;
  json: Map<string, unknown>;
}

class AssetManager {
  private cache: AssetCache = {
    gltf: new Map(),
    textures: new Map(),
    audio: new Map(),
    json: new Map(),
  };

  private gltfLoader: GLTFLoader;
  private textureLoader: THREE.TextureLoader;
  private ktx2Loader: KTX2Loader;
  private rgbeLoader: RGBELoader;
  private audioLoader: THREE.AudioLoader;

  private loadingManager: THREE.LoadingManager;
  private inFlight = new Map<string, Promise<unknown>>();

  constructor(renderer: THREE.WebGLRenderer) {
    this.loadingManager = new THREE.LoadingManager();

    // Draco decoder for compressed GLTF geometry
    const dracoLoader = new DRACOLoader(this.loadingManager);
    dracoLoader.setDecoderPath('/draco/'); // Point to decoder files

    this.gltfLoader = new GLTFLoader(this.loadingManager);
    this.gltfLoader.setDRACOLoader(dracoLoader);

    // KTX2 for compressed textures
    this.ktx2Loader = new KTX2Loader(this.loadingManager)
      .setTranscoderPath('/basis/')
      .detectSupport(renderer);
    this.gltfLoader.setKTX2Loader(this.ktx2Loader);

    this.textureLoader = new THREE.TextureLoader(this.loadingManager);
    this.rgbeLoader = new RGBELoader(this.loadingManager);
    this.audioLoader = new THREE.AudioLoader(this.loadingManager);
  }

  // Preload a manifest of assets with progress callback
  async preload(
    manifest: AssetDescriptor[],
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<void> {
    let loaded = 0;
    const total = manifest.length;

    await Promise.all(
      manifest.map(async (descriptor) => {
        await this.load(descriptor);
        loaded++;
        onProgress?.(loaded, total);
      }),
    );
  }

  private async load(descriptor: AssetDescriptor): Promise<unknown> {
    const { key, url, type } = descriptor;

    // Deduplication: if already loading, return same promise
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    let promise: Promise<unknown>;
    switch (type) {
      case 'gltf':
        promise = this.loadGLTF(key, url);
        break;
      case 'texture':
        promise = this.loadTexture(key, url);
        break;
      case 'ktx2':
        promise = this.loadKTX2(key, url);
        break;
      case 'hdr':
        promise = this.loadHDR(key, url);
        break;
      case 'audio':
        promise = this.loadAudio(key, url);
        break;
      case 'json':
        promise = this.loadJSON(key, url);
        break;
      default:
        throw new Error(`Unknown asset type: ${type}`);
    }

    this.inFlight.set(key, promise);
    const result = await promise;
    this.inFlight.delete(key);
    return result;
  }

  private loadGLTF(key: string, url: string): Promise<GLTF> {
    if (this.cache.gltf.has(key)) return Promise.resolve(this.cache.gltf.get(key)!);
    return new Promise((resolve, reject) => {
      this.gltfLoader.load(url, (gltf) => {
        this.cache.gltf.set(key, gltf);
        resolve(gltf);
      }, undefined, reject);
    });
  }

  private loadTexture(key: string, url: string): Promise<THREE.Texture> {
    if (this.cache.textures.has(key)) return Promise.resolve(this.cache.textures.get(key)!);
    return new Promise((resolve, reject) => {
      this.textureLoader.load(url, (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.generateMipmaps = true;
        texture.anisotropy = 4;
        this.cache.textures.set(key, texture);
        resolve(texture);
      }, undefined, reject);
    });
  }

  private loadKTX2(key: string, url: string): Promise<THREE.CompressedTexture> {
    if (this.cache.textures.has(key)) {
      return Promise.resolve(this.cache.textures.get(key) as THREE.CompressedTexture);
    }
    return new Promise((resolve, reject) => {
      this.ktx2Loader.load(url, (texture) => {
        this.cache.textures.set(key, texture);
        resolve(texture as THREE.CompressedTexture);
      }, undefined, reject);
    });
  }

  private loadHDR(key: string, url: string): Promise<THREE.DataTexture> {
    if (this.cache.textures.has(key)) {
      return Promise.resolve(this.cache.textures.get(key) as THREE.DataTexture);
    }
    return new Promise((resolve, reject) => {
      this.rgbeLoader.load(url, (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        this.cache.textures.set(key, texture);
        resolve(texture);
      }, undefined, reject);
    });
  }

  private loadAudio(key: string, url: string): Promise<AudioBuffer> {
    if (this.cache.audio.has(key)) return Promise.resolve(this.cache.audio.get(key)!);
    return new Promise((resolve, reject) => {
      this.audioLoader.load(url, (buffer) => {
        this.cache.audio.set(key, buffer);
        resolve(buffer);
      }, undefined, reject);
    });
  }

  private async loadJSON(key: string, url: string): Promise<unknown> {
    if (this.cache.json.has(key)) return this.cache.json.get(key);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to load JSON: ${url}`);
    const data = await response.json();
    this.cache.json.set(key, data);
    return data;
  }

  // Typed getters
  getGLTF(key: string): GLTF {
    const asset = this.cache.gltf.get(key);
    if (!asset) throw new Error(`GLTF "${key}" not loaded`);
    return asset;
  }

  getTexture(key: string): THREE.Texture {
    const asset = this.cache.textures.get(key);
    if (!asset) throw new Error(`Texture "${key}" not loaded`);
    return asset;
  }

  getAudio(key: string): AudioBuffer {
    const asset = this.cache.audio.get(key);
    if (!asset) throw new Error(`Audio "${key}" not loaded`);
    return asset;
  }

  getJSON<T = unknown>(key: string): T {
    const asset = this.cache.json.get(key);
    if (!asset) throw new Error(`JSON "${key}" not loaded`);
    return asset as T;
  }

  // Create a cloned, independent GLTF instance (safe for multiple instances of same model)
  cloneGLTF(key: string): THREE.Group {
    const gltf = this.getGLTF(key);
    return gltf.scene.clone(true);
  }

  // Unload assets to free memory
  unload(key: string): void {
    if (this.cache.textures.has(key)) {
      this.cache.textures.get(key)!.dispose();
      this.cache.textures.delete(key);
    }
    // GLTF disposal requires traversal
    if (this.cache.gltf.has(key)) {
      const gltf = this.cache.gltf.get(key)!;
      gltf.scene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach((m) => {
            for (const v of Object.values(m)) {
              if (v instanceof THREE.Texture) v.dispose();
            }
            m.dispose();
          });
        }
      });
      this.cache.gltf.delete(key);
    }
    this.cache.audio.delete(key);
    this.cache.json.delete(key);
  }

  dispose(): void {
    this.ktx2Loader.dispose();
    for (const texture of this.cache.textures.values()) texture.dispose();
    this.cache.textures.clear();
    this.cache.gltf.clear();
    this.cache.audio.clear();
    this.cache.json.clear();
  }
}
```

## GLTF Loading — Best Practices

```typescript
// Load GLTF with animation clips
async function loadCharacter(
  assetManager: AssetManager,
): Promise<{ model: THREE.Group; clips: THREE.AnimationClip[] }> {
  const gltf = assetManager.getGLTF('character');

  // Set up shadows on all meshes
  gltf.scene.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      // Ensure correct color space on textures (sometimes needed)
      if (child.material instanceof THREE.MeshStandardMaterial) {
        if (child.material.map) {
          child.material.map.colorSpace = THREE.SRGBColorSpace;
          child.material.map.needsUpdate = true;
        }
      }
    }
  });

  return {
    model: gltf.scene,
    clips: gltf.animations,
  };
}

// GLTF with multiple materials — share materials across instances
function prepareSharedGLTF(gltf: GLTF): Map<string, THREE.Material> {
  const materials = new Map<string, THREE.Material>();
  gltf.scene.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const mat = child.material as THREE.MeshStandardMaterial;
      if (mat.name && !materials.has(mat.name)) {
        materials.set(mat.name, mat);
      }
    }
  });
  return materials;
}
```

## Asset Manifest Pattern

```typescript
// Define all game assets in a typed manifest
interface AssetManifest {
  models: Record<string, { url: string; draco: boolean }>;
  textures: Record<string, { url: string; compressed: boolean }>;
  audio: Record<string, { url: string }>;
  levels: Record<string, { url: string }>;
}

const GAME_MANIFEST: AssetManifest = {
  models: {
    player: { url: '/assets/models/player.glb', draco: true },
    enemy_grunt: { url: '/assets/models/enemy_grunt.glb', draco: true },
    weapon_pistol: { url: '/assets/models/pistol.glb', draco: false },
  },
  textures: {
    terrain_diffuse: { url: '/assets/textures/terrain.ktx2', compressed: true },
    ui_spritesheet: { url: '/assets/textures/ui.png', compressed: false },
  },
  audio: {
    bgm_main: { url: '/assets/audio/theme.ogg' },
    sfx_gunshot: { url: '/assets/audio/gunshot.ogg' },
    sfx_footstep: { url: '/assets/audio/footstep.ogg' },
  },
  levels: {
    level_01: { url: '/assets/levels/level01.json' },
  },
};

// Preload specific level's required assets
async function preloadLevel(
  assetManager: AssetManager,
  levelName: keyof typeof GAME_MANIFEST.levels,
  onProgress: (pct: number) => void,
): Promise<void> {
  const levelData = assetManager.getJSON<LevelData>(levelName);
  const requiredAssets: AssetDescriptor[] = [];

  // Collect assets referenced by the level
  for (const modelKey of levelData.requiredModels) {
    const modelDef = GAME_MANIFEST.models[modelKey];
    if (modelDef) {
      requiredAssets.push({ key: modelKey, url: modelDef.url, type: 'gltf' });
    }
  }

  await assetManager.preload(requiredAssets, (loaded, total) => {
    onProgress(loaded / total);
  });
}

interface LevelData {
  requiredModels: string[];
  requiredTextures: string[];
  requiredAudio: string[];
  entities: EntitySpawnData[];
}

interface EntitySpawnData {
  type: string;
  position: [number, number, number];
  rotation: [number, number, number];
}
```

## Draco Compression Setup

```bash
# Install draco decoder files (needed at runtime)
# In your project's public/ or static/ folder:
# copy node_modules/three/examples/jsm/libs/draco/ -> public/draco/

# For build tools, use vite-plugin-copy or similar
```

```typescript
// vite.config.ts - Copy Draco decoder files to public
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/three/examples/jsm/libs/draco',
          dest: '.', // Output to public/draco/
        },
        {
          src: 'node_modules/three/examples/jsm/libs/basis',
          dest: '.', // Output to public/basis/
        },
      ],
    }),
  ],
});
```

## Progressive Loading with UI

```typescript
class LoadingScreen {
  private element: HTMLElement;
  private progressBar: HTMLElement;
  private statusText: HTMLElement;

  constructor() {
    this.element = document.getElementById('loading-screen')!;
    this.progressBar = document.getElementById('progress-bar')!;
    this.statusText = document.getElementById('loading-status')!;
  }

  show(): void {
    this.element.style.display = 'flex';
  }

  hide(): void {
    this.element.style.opacity = '0';
    setTimeout(() => {
      this.element.style.display = 'none';
    }, 500); // Fade out
  }

  setProgress(loaded: number, total: number): void {
    const pct = (loaded / total) * 100;
    this.progressBar.style.width = `${pct}%`;
    this.statusText.textContent = `Loading... ${Math.floor(pct)}%`;
  }

  setStatus(text: string): void {
    this.statusText.textContent = text;
  }
}

// Usage
const loadingScreen = new LoadingScreen();
loadingScreen.show();
loadingScreen.setStatus('Initializing engine...');

await assetManager.preload(coreManifest, (loaded, total) => {
  loadingScreen.setProgress(loaded, total);
});

loadingScreen.setStatus('Starting game...');
await game.start();
loadingScreen.hide();
```
