# GLSL Shader Programming

## ShaderMaterial Fundamentals

```typescript
import * as THREE from 'three';

// Basic shader material setup
const material = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uColor: { value: new THREE.Color(0x00aaff) },
    uTexture: { value: null as THREE.Texture | null },
    uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
  },
  vertexShader: vertexGLSL,
  fragmentShader: fragmentGLSL,
  transparent: false,
  depthWrite: true,
  depthTest: true,
  blending: THREE.NormalBlending,
  side: THREE.FrontSide,
});

// Update time uniform each frame — NO allocation
function updateShaderTime(material: THREE.ShaderMaterial, elapsed: number): void {
  material.uniforms.uTime.value = elapsed;
}
```

## Vertex Shader — Complete Template

```glsl
// vertex.glsl
precision highp float;

// Built-in Three.js uniforms (automatically provided)
uniform mat4 modelMatrix;           // Object-to-world transform
uniform mat4 modelViewMatrix;       // Object-to-camera transform
uniform mat4 projectionMatrix;      // Camera projection
uniform mat4 viewMatrix;            // World-to-camera
uniform mat3 normalMatrix;          // Inverse transpose of modelViewMatrix (for normals)
uniform vec3 cameraPosition;        // Camera world position

// Built-in Three.js attributes (from BufferGeometry)
attribute vec3 position;            // Vertex position in object space
attribute vec3 normal;              // Vertex normal in object space
attribute vec2 uv;                  // Primary UV coordinates
attribute vec2 uv2;                 // Secondary UV coordinates
attribute vec4 color;               // Per-vertex color (if attribute set)
attribute vec4 tangent;             // Tangent for normal mapping

// Custom uniforms
uniform float uTime;
uniform float uWaveAmplitude;
uniform float uWaveFrequency;

// Varying — passed to fragment shader
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying float vElevation;

void main() {
  vUv = uv;

  // World-space normal (for lighting calculations)
  vNormal = normalize(normalMatrix * normal);

  // World-space position
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPos.xyz;

  // Wave displacement along Y axis
  float wave = sin(position.x * uWaveFrequency + uTime) *
               cos(position.z * uWaveFrequency + uTime) *
               uWaveAmplitude;
  vElevation = wave;

  vec3 displacedPosition = position + vec3(0.0, wave, 0.0);

  // Final clip-space position
  gl_Position = projectionMatrix * modelViewMatrix * vec4(displacedPosition, 1.0);
}
```

## Fragment Shader — Complete Template

```glsl
// fragment.glsl
precision highp float;

// Uniforms
uniform float uTime;
uniform vec3 uColor;
uniform sampler2D uTexture;
uniform sampler2D uNormalMap;
uniform vec3 uLightDirection;
uniform vec3 uLightColor;
uniform float uAmbientStrength;

// Varyings from vertex shader
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying float vElevation;

// Constants
const float PI = 3.14159265359;

// Utility functions
float remap(float value, float inMin, float inMax, float outMin, float outMax) {
  return outMin + (value - inMin) * (outMax - outMin) / (inMax - inMin);
}

vec3 linearToSRGB(vec3 color) {
  return pow(color, vec3(1.0 / 2.2));
}

void main() {
  // Sample base texture
  vec4 texColor = texture2D(uTexture, vUv);

  // Simple Lambertian diffuse
  vec3 normal = normalize(vNormal);
  float diffuse = max(dot(normal, normalize(uLightDirection)), 0.0);

  // Ambient + diffuse lighting
  vec3 ambient = uAmbientStrength * uLightColor;
  vec3 lighting = ambient + diffuse * uLightColor;

  // Elevation-based color tint
  float elevationFactor = remap(vElevation, -1.0, 1.0, 0.0, 1.0);
  vec3 elevationColor = mix(vec3(0.0, 0.2, 0.8), vec3(0.8, 0.5, 0.0), elevationFactor);

  // Combine
  vec3 finalColor = texColor.rgb * uColor * lighting * elevationColor;

  gl_FragColor = vec4(finalColor, texColor.a);
}
```

## Common GLSL Noise Functions

```glsl
// Value noise (fast, low quality)
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f); // Smoothstep

  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));

  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Simplex noise 2D (better for textures)
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865, 0.366025404, -0.577350269, 0.024390244);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291 - 0.85373472 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

// Fractal Brownian Motion (layered noise)
float fbm(vec2 p, int octaves) {
  float value = 0.0;
  float amplitude = 0.5;
  float frequency = 1.0;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    value += amplitude * snoise(p * frequency);
    frequency *= 2.0;
    amplitude *= 0.5;
  }
  return value;
}
```

## Custom Post-Processing Shader

```glsl
// Scanline / CRT effect — post-processing fragment shader
uniform sampler2D tDiffuse;    // Input render target (from Three.js pass)
uniform float uTime;
uniform float uIntensity;
uniform vec2 uResolution;

varying vec2 vUv;

void main() {
  vec2 uv = vUv;

  // Barrel distortion (CRT curvature)
  vec2 centered = uv * 2.0 - 1.0;
  float r2 = dot(centered, centered);
  vec2 distorted = centered * (1.0 + 0.1 * r2 + 0.03 * r2 * r2);
  uv = distorted * 0.5 + 0.5;

  // Sample original scene
  vec3 color = texture2D(tDiffuse, uv).rgb;

  // Scanlines
  float scanline = sin(uv.y * uResolution.y * PI) * 0.5 + 0.5;
  color *= mix(1.0, scanline, uIntensity * 0.3);

  // Vignette
  float vignette = 1.0 - smoothstep(0.5, 1.5, length(centered));
  color *= vignette;

  gl_FragColor = vec4(color, 1.0);
}
```

## Extending Built-in Materials with onBeforeCompile

```typescript
// Modify MeshStandardMaterial shaders without full custom shader
function createDissolveEffect(baseColor: THREE.Color): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness: 0.7,
    metalness: 0.0,
  });

  material.onBeforeCompile = (shader) => {
    // Add custom uniforms
    shader.uniforms.uDissolveAmount = { value: 0.0 };
    shader.uniforms.uEdgeColor = { value: new THREE.Color(0xff5500) };
    shader.uniforms.uEdgeWidth = { value: 0.05 };

    // Store reference to update uniforms later
    (material as any).userData.shader = shader;

    // Inject into fragment shader
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
      uniform float uDissolveAmount;
      uniform vec3 uEdgeColor;
      uniform float uEdgeWidth;

      // Simplex noise
      float snoise(vec2 v) {
        // ... (insert noise function here)
        return 0.0;
      }
      `,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
      float noise = snoise(vUv * 5.0) * 0.5 + 0.5;
      float dissolve = step(noise, uDissolveAmount);
      float edge = smoothstep(uDissolveAmount - uEdgeWidth, uDissolveAmount, noise);

      if (dissolve > 0.5) discard;
      gl_FragColor.rgb = mix(gl_FragColor.rgb, uEdgeColor, edge);
      `,
    );
  };

  return material;
}

// Animate the dissolve effect
let dissolveAmount = 0;
function updateDissolve(material: THREE.MeshStandardMaterial, delta: number): void {
  dissolveAmount = Math.min(dissolveAmount + delta * 0.5, 1.0);
  const shader = (material as any).userData.shader;
  if (shader) {
    shader.uniforms.uDissolveAmount.value = dissolveAmount;
  }
}
```

## Animated Water Shader

```typescript
const waterVertexShader = `
  uniform float uTime;
  uniform float uWaveHeight;
  varying vec2 vUv;
  varying float vElevation;

  #include <common>

  float wave(vec2 pos, float freq, float speed, float amplitude) {
    return sin(pos.x * freq + uTime * speed) *
           cos(pos.z * freq + uTime * speed) * amplitude;
  }

  void main() {
    vUv = uv;

    vec3 pos = position;
    float elevation = 0.0;
    elevation += wave(pos.xz, 2.0, 1.0, uWaveHeight);
    elevation += wave(pos.xz, 4.0, 0.7, uWaveHeight * 0.5);
    elevation += wave(pos.xz, 8.0, 1.3, uWaveHeight * 0.25);

    pos.y += elevation;
    vElevation = elevation;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const waterFragmentShader = `
  uniform float uTime;
  uniform vec3 uColorDeep;
  uniform vec3 uColorShallow;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vElevation;

  void main() {
    float elevationFactor = (vElevation + 0.2) / 0.4;
    vec3 color = mix(uColorDeep, uColorShallow, clamp(elevationFactor, 0.0, 1.0));

    gl_FragColor = vec4(color, uOpacity);
  }
`;

function createWaterMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uWaveHeight: { value: 0.2 },
      uColorDeep: { value: new THREE.Color(0x005588) },
      uColorShallow: { value: new THREE.Color(0x00aacc) },
      uOpacity: { value: 0.85 },
    },
    vertexShader: waterVertexShader,
    fragmentShader: waterFragmentShader,
    transparent: true,
    side: THREE.DoubleSide,
  });
}
```

## Instanced Shader with Per-Instance Data

```typescript
// Pass per-instance data via InstancedBufferAttribute
const instancedMaterial = new THREE.ShaderMaterial({
  vertexShader: `
    attribute vec3 instanceColor;  // Per-instance color
    attribute float instanceScale; // Per-instance scale
    varying vec3 vColor;

    void main() {
      vColor = instanceColor;

      vec3 scaledPos = position * instanceScale;
      gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(scaledPos, 1.0);
    }
  `,
  fragmentShader: `
    varying vec3 vColor;
    void main() {
      gl_FragColor = vec4(vColor, 1.0);
    }
  `,
});

// Set per-instance data
const instanceCount = 1000;
const mesh = new THREE.InstancedMesh(geometry, instancedMaterial, instanceCount);

const colors = new Float32Array(instanceCount * 3);
const scales = new Float32Array(instanceCount);

for (let i = 0; i < instanceCount; i++) {
  colors[i * 3] = Math.random();
  colors[i * 3 + 1] = Math.random();
  colors[i * 3 + 2] = Math.random();
  scales[i] = 0.5 + Math.random() * 1.5;
}

const colorAttr = new THREE.InstancedBufferAttribute(colors, 3);
const scaleAttr = new THREE.InstancedBufferAttribute(scales, 1);

geometry.setAttribute('instanceColor', colorAttr);
geometry.setAttribute('instanceScale', scaleAttr);
```

## RawShaderMaterial (No Three.js Includes)

```typescript
// When you need full control — Three.js won't inject any code
const rawMaterial = new THREE.RawShaderMaterial({
  uniforms: {
    uProjectionMatrix: { value: camera.projectionMatrix },
    uModelViewMatrix: { value: new THREE.Matrix4() },
  },
  vertexShader: `
    precision highp float;

    uniform mat4 uProjectionMatrix;
    uniform mat4 uModelViewMatrix;

    attribute vec3 position;

    void main() {
      gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    precision highp float;

    void main() {
      gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
    }
  `,
});
```
