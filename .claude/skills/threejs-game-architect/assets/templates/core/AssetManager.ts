/**
 * AssetManager.ts
 * Asset loading, caching, and lifecycle management.
 * Supports GLTF (with Draco), textures (with KTX2), HDR, audio, and JSON.
 */

import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

export type AssetType = 'gltf' | 'texture' | 'ktx2' | 'hdr' | 'audio' | 'json';

export interface AssetDescriptor {
  key: string;
  url: string;
  type: AssetType;
}

export class AssetManager {
  private readonly gltfCache = new Map<string, GLTF>();
  private readonly textureCache = new Map<string, THREE.Texture>();
  private readonly audioCache = new Map<string, AudioBuffer>();
  private readonly jsonCache = new Map<string, unknown>();

  // In-flight deduplication
  private readonly inFlight = new Map<string, Promise<unknown>>();

  private readonly gltfLoader: GLTFLoader;
  private readonly textureLoader = new THREE.TextureLoader();
  private readonly ktx2Loader: KTX2Loader;
  private readonly rgbeLoader = new RGBELoader();
  private readonly audioLoader = new THREE.AudioLoader();

  constructor(
    renderer: THREE.WebGLRenderer,
    options: {
      dracoPath?: string;
      ktx2Path?: string;
    } = {},
  ) {
    const { dracoPath = '/draco/', ktx2Path = '/basis/' } = options;

    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(dracoPath);
    dracoLoader.preload();

    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.setDRACOLoader(dracoLoader);

    this.ktx2Loader = new KTX2Loader()
      .setTranscoderPath(ktx2Path)
      .detectSupport(renderer);

    this.gltfLoader.setKTX2Loader(this.ktx2Loader);
  }

  // ---------- Preloading ----------

  async preload(
    manifest: AssetDescriptor[],
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<void> {
    let loaded = 0;
    await Promise.all(
      manifest.map(async (descriptor) => {
        await this.loadAsset(descriptor);
        onProgress?.(++loaded, manifest.length);
      }),
    );
  }

  async loadAsset(descriptor: AssetDescriptor): Promise<unknown> {
    const { key } = descriptor;

    // Deduplication: if already loading, return same promise
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    let promise: Promise<unknown>;
    switch (descriptor.type) {
      case 'gltf':    promise = this.fetchGLTF(key, descriptor.url); break;
      case 'texture': promise = this.fetchTexture(key, descriptor.url); break;
      case 'ktx2':    promise = this.fetchKTX2(key, descriptor.url); break;
      case 'hdr':     promise = this.fetchHDR(key, descriptor.url); break;
      case 'audio':   promise = this.fetchAudio(key, descriptor.url); break;
      case 'json':    promise = this.fetchJSON(key, descriptor.url); break;
      default: throw new Error(`Unknown asset type: ${(descriptor as any).type}`);
    }

    this.inFlight.set(key, promise);
    const result = await promise.finally(() => this.inFlight.delete(key));
    return result;
  }

  // ---------- Loaders ----------

  private fetchGLTF(key: string, url: string): Promise<GLTF> {
    const cached = this.gltfCache.get(key);
    if (cached) return Promise.resolve(cached);

    return new Promise<GLTF>((resolve, reject) => {
      this.gltfLoader.load(
        url,
        (gltf) => {
          // Apply shadows to all meshes
          gltf.scene.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });
          this.gltfCache.set(key, gltf);
          resolve(gltf);
        },
        undefined,
        reject,
      );
    });
  }

  private fetchTexture(key: string, url: string): Promise<THREE.Texture> {
    const cached = this.textureCache.get(key);
    if (cached) return Promise.resolve(cached);

    return new Promise<THREE.Texture>((resolve, reject) => {
      this.textureLoader.load(
        url,
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.generateMipmaps = true;
          texture.minFilter = THREE.LinearMipmapLinearFilter;
          texture.magFilter = THREE.LinearFilter;
          this.textureCache.set(key, texture);
          resolve(texture);
        },
        undefined,
        reject,
      );
    });
  }

  private fetchKTX2(key: string, url: string): Promise<THREE.CompressedTexture> {
    const cached = this.textureCache.get(key);
    if (cached) return Promise.resolve(cached as THREE.CompressedTexture);

    return new Promise<THREE.CompressedTexture>((resolve, reject) => {
      this.ktx2Loader.load(
        url,
        (texture) => {
          this.textureCache.set(key, texture);
          resolve(texture as THREE.CompressedTexture);
        },
        undefined,
        reject,
      );
    });
  }

  private fetchHDR(key: string, url: string): Promise<THREE.DataTexture> {
    const cached = this.textureCache.get(key);
    if (cached) return Promise.resolve(cached as THREE.DataTexture);

    return new Promise<THREE.DataTexture>((resolve, reject) => {
      this.rgbeLoader.load(
        url,
        (texture) => {
          texture.mapping = THREE.EquirectangularReflectionMapping;
          this.textureCache.set(key, texture);
          resolve(texture);
        },
        undefined,
        reject,
      );
    });
  }

  private fetchAudio(key: string, url: string): Promise<AudioBuffer> {
    const cached = this.audioCache.get(key);
    if (cached) return Promise.resolve(cached);

    return new Promise<AudioBuffer>((resolve, reject) => {
      this.audioLoader.load(url, resolve, undefined, reject);
    });
  }

  private async fetchJSON(key: string, url: string): Promise<unknown> {
    const cached = this.jsonCache.get(key);
    if (cached) return cached;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} loading JSON: ${url}`);
    const data = await response.json() as unknown;
    this.jsonCache.set(key, data);
    return data;
  }

  // ---------- Typed Getters ----------

  getGLTF(key: string): GLTF {
    const asset = this.gltfCache.get(key);
    if (!asset) throw new Error(`GLTF asset "${key}" not loaded. Call preload() first.`);
    return asset;
  }

  /** Returns a cloned, independent scene graph from a cached GLTF. Safe for multiple instances. */
  cloneGLTFScene(key: string): THREE.Group {
    return this.getGLTF(key).scene.clone(true);
  }

  getTexture(key: string): THREE.Texture {
    const asset = this.textureCache.get(key);
    if (!asset) throw new Error(`Texture "${key}" not loaded.`);
    return asset;
  }

  getAudio(key: string): AudioBuffer {
    const asset = this.audioCache.get(key);
    if (!asset) throw new Error(`Audio "${key}" not loaded.`);
    return asset;
  }

  getJSON<T = unknown>(key: string): T {
    const asset = this.jsonCache.get(key);
    if (!asset) throw new Error(`JSON "${key}" not loaded.`);
    return asset as T;
  }

  hasAsset(key: string): boolean {
    return (
      this.gltfCache.has(key) ||
      this.textureCache.has(key) ||
      this.audioCache.has(key) ||
      this.jsonCache.has(key)
    );
  }

  // ---------- Memory Management ----------

  unload(key: string): void {
    const texture = this.textureCache.get(key);
    if (texture) {
      texture.dispose();
      this.textureCache.delete(key);
    }

    const gltf = this.gltfCache.get(key);
    if (gltf) {
      gltf.scene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          for (const mat of materials) {
            for (const val of Object.values(mat)) {
              if (val instanceof THREE.Texture) val.dispose();
            }
            mat.dispose();
          }
        }
      });
      this.gltfCache.delete(key);
    }

    this.audioCache.delete(key);
    this.jsonCache.delete(key);
  }

  dispose(): void {
    this.ktx2Loader.dispose();
    for (const texture of this.textureCache.values()) texture.dispose();
    this.textureCache.clear();
    this.gltfCache.clear();
    this.audioCache.clear();
    this.jsonCache.clear();
  }

  // ---------- Debug ----------

  get stats() {
    return {
      gltfCount: this.gltfCache.size,
      textureCount: this.textureCache.size,
      audioCount: this.audioCache.size,
      jsonCount: this.jsonCache.size,
      inFlight: this.inFlight.size,
    };
  }
}
