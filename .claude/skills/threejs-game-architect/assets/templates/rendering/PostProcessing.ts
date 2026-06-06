/**
 * PostProcessing.ts
 * EffectComposer with SSAO, Bloom, SMAA, and optional DOF.
 * Designed for easy enable/disable of passes based on hardware capability.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

export interface PostProcessingConfig {
  bloom?: {
    enabled?: boolean;
    strength?: number;
    radius?: number;
    threshold?: number;
  };
  ssao?: {
    enabled?: boolean;
    kernelRadius?: number;
    minDistance?: number;
    maxDistance?: number;
  };
  smaa?: {
    enabled?: boolean;
  };
  vignette?: {
    enabled?: boolean;
    intensity?: number;
    smoothness?: number;
  };
}

export class PostProcessingPipeline {
  readonly composer: EffectComposer;

  private bloomPass: UnrealBloomPass;
  private ssaoPass: SSAOPass;
  private smaaPass: SMAAPass;
  private vignettePass: VignettePass;
  private outputPass: OutputPass;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    config: PostProcessingConfig = {},
  ) {
    const width = renderer.domElement.clientWidth;
    const height = renderer.domElement.clientHeight;
    const dpr = renderer.getPixelRatio();

    // HDR render target for linear-space rendering + tone mapping
    const renderTarget = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType, // HDR
      depthBuffer: true,
    });

    this.composer = new EffectComposer(renderer, renderTarget);
    this.composer.setSize(width, height);
    this.composer.setPixelRatio(Math.min(dpr, 2));

    // Pass 1: Render scene
    this.composer.addPass(new RenderPass(scene, camera));

    // Pass 2: SSAO
    const ssaoCfg = config.ssao ?? {};
    this.ssaoPass = new SSAOPass(scene, camera, width, height);
    this.ssaoPass.kernelRadius = ssaoCfg.kernelRadius ?? 16;
    this.ssaoPass.minDistance = ssaoCfg.minDistance ?? 0.005;
    this.ssaoPass.maxDistance = ssaoCfg.maxDistance ?? 0.1;
    this.ssaoPass.enabled = ssaoCfg.enabled ?? true;
    this.composer.addPass(this.ssaoPass);

    // Pass 3: Bloom
    const bloomCfg = config.bloom ?? {};
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      bloomCfg.strength ?? 0.5,
      bloomCfg.radius ?? 0.4,
      bloomCfg.threshold ?? 0.85,
    );
    this.bloomPass.enabled = bloomCfg.enabled ?? true;
    this.composer.addPass(this.bloomPass);

    // Pass 4: Vignette
    const vignetteCfg = config.vignette ?? {};
    this.vignettePass = new VignettePass(
      vignetteCfg.intensity ?? 0.5,
      vignetteCfg.smoothness ?? 0.5,
    );
    this.vignettePass.enabled = vignetteCfg.enabled ?? true;
    this.composer.addPass(this.vignettePass);

    // Pass 5: SMAA anti-aliasing
    const smaaCfg = config.smaa ?? {};
    this.smaaPass = new SMAAPass(width * dpr, height * dpr);
    this.smaaPass.enabled = smaaCfg.enabled ?? true;
    this.composer.addPass(this.smaaPass);

    // Pass 6: Output (tone mapping + color space conversion)
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);
  }

  render(): void {
    this.composer.render();
  }

  resize(width: number, height: number, dpr: number): void {
    this.composer.setSize(width, height);
    this.ssaoPass.setSize(width, height);
    this.smaaPass.setSize(width * dpr, height * dpr);
    this.bloomPass.setSize(width, height);
  }

  // ---------- Bloom ----------

  setBloomEnabled(enabled: boolean): this {
    this.bloomPass.enabled = enabled;
    return this;
  }

  setBloomStrength(strength: number): this {
    this.bloomPass.strength = strength;
    return this;
  }

  setBloomThreshold(threshold: number): this {
    this.bloomPass.threshold = threshold;
    return this;
  }

  setBloomRadius(radius: number): this {
    this.bloomPass.radius = radius;
    return this;
  }

  // ---------- SSAO ----------

  setSSAOEnabled(enabled: boolean): this {
    this.ssaoPass.enabled = enabled;
    return this;
  }

  // ---------- Vignette ----------

  setVignetteEnabled(enabled: boolean): this {
    this.vignettePass.enabled = enabled;
    return this;
  }

  setVignetteIntensity(intensity: number): this {
    this.vignettePass.setIntensity(intensity);
    return this;
  }

  // ---------- Quality Presets ----------

  applyQualityPreset(preset: 'low' | 'medium' | 'high'): this {
    switch (preset) {
      case 'low':
        this.setSSAOEnabled(false);
        this.setBloomEnabled(false);
        this.smaaPass.enabled = false;
        break;
      case 'medium':
        this.setSSAOEnabled(false);
        this.setBloomEnabled(true);
        this.setBloomStrength(0.3);
        this.smaaPass.enabled = true;
        break;
      case 'high':
        this.setSSAOEnabled(true);
        this.setBloomEnabled(true);
        this.setBloomStrength(0.5);
        this.smaaPass.enabled = true;
        break;
    }
    return this;
  }

  dispose(): void {
    this.composer.dispose();
    this.vignettePass.dispose();
  }
}

// ---------- Custom: Vignette Pass ----------

class VignettePass extends Pass {
  private material: THREE.ShaderMaterial;
  private fsQuad: FullScreenQuad;

  constructor(intensity: number, smoothness: number) {
    super();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null as THREE.Texture | null },
        uIntensity: { value: intensity },
        uSmoothness: { value: smoothness },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uIntensity;
        uniform float uSmoothness;
        varying vec2 vUv;

        void main() {
          vec4 color = texture2D(tDiffuse, vUv);
          vec2 uv = vUv * (1.0 - vUv.yx);
          float vignette = uv.x * uv.y * 15.0;
          vignette = pow(vignette, uIntensity);
          vignette = smoothstep(0.0, 1.0, vignette);
          gl_FragColor = vec4(color.rgb * vignette, color.a);
        }
      `,
    });
    this.fsQuad = new FullScreenQuad(this.material);
  }

  render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
  ): void {
    this.material.uniforms.tDiffuse.value = readBuffer.texture;

    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) renderer.clear();
    }
    this.fsQuad.render(renderer);
  }

  setIntensity(intensity: number): void {
    this.material.uniforms.uIntensity.value = intensity;
  }

  dispose(): void {
    this.material.dispose();
    this.fsQuad.dispose();
  }
}
