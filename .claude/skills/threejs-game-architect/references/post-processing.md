# Post-Processing Effects

## EffectComposer Setup

```typescript
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

class PostProcessingPipeline {
  readonly composer: EffectComposer;
  private bloomPass: UnrealBloomPass;
  private ssaoPass: SSAOPass;
  private smaaPass: SMAAPass;
  private bokehPass: BokehPass;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
  ) {
    const width = renderer.domElement.clientWidth;
    const height = renderer.domElement.clientHeight;

    // Use HDR render target for bloom and tone mapping
    const renderTarget = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,  // HDR
    });

    this.composer = new EffectComposer(renderer, renderTarget);
    this.composer.setSize(width, height);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Pass 1: Render scene
    const renderPass = new RenderPass(scene, camera);
    this.composer.addPass(renderPass);

    // Pass 2: SSAO (Ambient Occlusion)
    this.ssaoPass = new SSAOPass(scene, camera, width, height);
    this.ssaoPass.kernelRadius = 16;
    this.ssaoPass.minDistance = 0.005;
    this.ssaoPass.maxDistance = 0.1;
    this.composer.addPass(this.ssaoPass);

    // Pass 3: Bloom
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      0.5,    // Strength
      0.4,    // Radius
      0.85,   // Threshold — only pixels brighter than this bloom
    );
    this.composer.addPass(this.bloomPass);

    // Pass 4: Depth of Field
    this.bokehPass = new BokehPass(scene, camera, {
      focus: 500.0,
      aperture: 0.0001,
      maxblur: 0.01,
    });
    this.bokehPass.enabled = false; // Enable for cinematic shots
    this.composer.addPass(this.bokehPass);

    // Pass 5: SMAA Anti-aliasing (better than FXAA for quality)
    this.smaaPass = new SMAAPass(width * renderer.getPixelRatio(), height * renderer.getPixelRatio());
    this.composer.addPass(this.smaaPass);

    // Pass 6: Output (handles tone mapping and color space conversion)
    const outputPass = new OutputPass();
    this.composer.addPass(outputPass);
  }

  render(): void {
    this.composer.render();
  }

  resize(width: number, height: number): void {
    this.composer.setSize(width, height);
    this.ssaoPass.setSize(width, height);
    this.smaaPass.setSize(width * window.devicePixelRatio, height * window.devicePixelRatio);
    this.bloomPass.setSize(width, height);
  }

  setBloomStrength(value: number): void {
    this.bloomPass.strength = value;
  }

  setBloomThreshold(value: number): void {
    this.bloomPass.threshold = value;
  }

  enableDOF(focus: number, aperture: number): void {
    this.bokehPass.enabled = true;
    (this.bokehPass.uniforms as any).focus.value = focus;
    (this.bokehPass.uniforms as any).aperture.value = aperture;
  }

  disableDOF(): void {
    this.bokehPass.enabled = false;
  }

  setSSAOEnabled(enabled: boolean): void {
    this.ssaoPass.enabled = enabled;
  }

  dispose(): void {
    this.composer.dispose();
  }
}
```

## Selective Bloom (Emissive-Only)

```typescript
// Selective bloom: only bloom emissive objects, not the whole scene
// Technique: render dark non-emissive materials in bloom pass, restore after

class SelectiveBloom {
  private bloomComposer: EffectComposer;
  private finalComposer: EffectComposer;
  private darkMaterial: THREE.MeshBasicMaterial;
  private materials = new Map<string, THREE.Material | THREE.Material[]>();

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    width: number,
    height: number,
  ) {
    this.darkMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });

    // Bloom composer — renders only emissive objects
    const renderTarget = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
    });
    this.bloomComposer = new EffectComposer(renderer, renderTarget);
    this.bloomComposer.renderToScreen = false;

    this.bloomComposer.addPass(new RenderPass(scene, camera));
    this.bloomComposer.addPass(
      new UnrealBloomPass(new THREE.Vector2(width, height), 1.5, 0.4, 0.0),
    );

    // Final composer — combines bloom with main render
    this.finalComposer = new EffectComposer(renderer);
    this.finalComposer.addPass(new RenderPass(scene, camera));

    // Mix pass
    const mixShader = {
      uniforms: {
        baseTexture: { value: null as THREE.Texture | null },
        bloomTexture: { value: this.bloomComposer.renderTarget2.texture },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D baseTexture;
        uniform sampler2D bloomTexture;
        varying vec2 vUv;
        void main() {
          gl_FragColor = texture2D(baseTexture, vUv) + vec4(1.0) * texture2D(bloomTexture, vUv);
        }
      `,
    };
    const mixPass = new ShaderPass(new THREE.ShaderMaterial(mixShader), 'baseTexture');
    mixPass.needsSwap = true;
    this.finalComposer.addPass(mixPass);
    this.finalComposer.addPass(new OutputPass());
  }

  render(scene: THREE.Scene): void {
    // Step 1: Darken non-bloom objects
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        // Keep objects with bloom layer visible; darken others
        if (!obj.layers.test(new THREE.Layers().set(1))) {
          this.materials.set(obj.uuid, obj.material);
          obj.material = this.darkMaterial;
        }
      }
    });

    // Step 2: Render bloom
    this.bloomComposer.render();

    // Step 3: Restore materials
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh && this.materials.has(obj.uuid)) {
        obj.material = this.materials.get(obj.uuid)!;
        this.materials.delete(obj.uuid);
      }
    });

    // Step 4: Render final composite
    this.finalComposer.render();
  }
}

// Mark an object as a bloom emitter
const BLOOM_LAYER = 1;
function makeEmissive(mesh: THREE.Mesh, color: THREE.Color, intensity: number): void {
  (mesh.material as THREE.MeshStandardMaterial).emissive = color;
  (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = intensity;
  mesh.layers.enable(BLOOM_LAYER); // Bloom layer
}
```

## Custom Post-Processing Pass

```typescript
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

class ChromaticAberrationPass extends Pass {
  private uniforms: Record<string, THREE.IUniform>;
  private material: THREE.ShaderMaterial;
  private fsQuad: FullScreenQuad;

  constructor(strength = 0.003) {
    super();

    this.uniforms = {
      tDiffuse: { value: null },
      uStrength: { value: strength },
      uTime: { value: 0 },
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uStrength;
        uniform float uTime;
        varying vec2 vUv;

        void main() {
          vec2 center = vec2(0.5);
          vec2 dir = vUv - center;
          float dist = length(dir);

          // Radial chromatic aberration
          float strength = uStrength * dist * dist;

          float r = texture2D(tDiffuse, vUv + dir * strength).r;
          float g = texture2D(tDiffuse, vUv).g;
          float b = texture2D(tDiffuse, vUv - dir * strength).b;

          gl_FragColor = vec4(r, g, b, 1.0);
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
    this.uniforms.tDiffuse.value = readBuffer.texture;
    this.uniforms.uTime.value += 0.01;

    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) renderer.clear();
    }

    this.fsQuad.render(renderer);
  }

  setStrength(value: number): void {
    this.uniforms.uStrength.value = value;
  }

  dispose(): void {
    this.material.dispose();
    this.fsQuad.dispose();
  }
}

// Usage
const chromaticPass = new ChromaticAberrationPass(0.002);
composer.addPass(chromaticPass);
```

## Color Grading (LUT)

```typescript
import { LUTPass } from 'three/examples/jsm/postprocessing/LUTPass.js';
import { LUTLoader } from 'three/examples/jsm/loaders/LUTLoader.js';

async function applyColorGrading(
  composer: EffectComposer,
  lutUrl: string,
): Promise<LUTPass> {
  const loader = new LUTLoader();
  const lut = await loader.loadAsync(lutUrl);

  const lutPass = new LUTPass();
  lutPass.lut = lut.texture3D;
  lutPass.intensity = 1.0;
  composer.addPass(lutPass);

  return lutPass;
}
```

## Motion Blur

```typescript
import { MotionBlurPass } from 'three/examples/jsm/postprocessing/MotionBlurPass.js';

// Screen-space motion blur based on velocity buffer
// Requires velocity buffer setup — complex but high quality

// Simpler approach: radial motion blur shader
const radialBlurShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uStrength: { value: 0.0 },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uSamples: { value: 8 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uStrength;
    uniform vec2 uCenter;
    uniform int uSamples;
    varying vec2 vUv;

    void main() {
      vec2 dir = vUv - uCenter;
      float dist = length(dir);
      vec4 color = vec4(0.0);
      float total = 0.0;

      for (int i = 0; i < 16; i++) {
        if (i >= uSamples) break;
        float t = float(i) / float(uSamples);
        float weight = 1.0 - t * 0.5;
        color += texture2D(tDiffuse, vUv - dir * uStrength * t) * weight;
        total += weight;
      }

      gl_FragColor = color / total;
    }
  `,
};

class RadialBlurPass extends ShaderPass {
  constructor() {
    super(new THREE.ShaderMaterial(radialBlurShader));
  }

  setStrength(strength: number): void {
    this.uniforms.uStrength.value = strength;
  }
}
```

## Performance Considerations

```typescript
// Lower resolution for expensive passes
class HalfResolutionComposer {
  private halfResComposer: EffectComposer;
  private fullResComposer: EffectComposer;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    width: number,
    height: number,
  ) {
    // Run SSAO at half resolution
    const halfTarget = new THREE.WebGLRenderTarget(width / 2, height / 2, {
      type: THREE.HalfFloatType,
    });
    this.halfResComposer = new EffectComposer(renderer, halfTarget);
    this.halfResComposer.addPass(new RenderPass(scene, camera));
    this.halfResComposer.addPass(new SSAOPass(scene, camera as THREE.PerspectiveCamera, width / 2, height / 2));
    this.halfResComposer.renderToScreen = false;

    // Full resolution final pass
    this.fullResComposer = new EffectComposer(renderer);
    this.fullResComposer.addPass(new RenderPass(scene, camera));
    // Upsample SSAO result and mix
  }
}

// Disable expensive passes based on GPU tier
function configurePPForHardware(pipeline: PostProcessingPipeline): void {
  const gl = document.createElement('canvas').getContext('webgl2');
  const debugInfo = gl?.getExtension('WEBGL_debug_renderer_info');
  const renderer = debugInfo
    ? gl?.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) as string
    : '';

  const isMobile = /mobile|android|ios/i.test(navigator.userAgent);
  const isLowEnd = isMobile || renderer.includes('Intel');

  if (isLowEnd) {
    pipeline.setSSAOEnabled(false);
    pipeline.setBloomStrength(0.3); // Lower bloom
  }
}
```
