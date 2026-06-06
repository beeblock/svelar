// =============================================================================
// CustomShader.glsl
// Template GLSL shader pair — vertex + fragment with common patterns.
// Use with THREE.ShaderMaterial or THREE.RawShaderMaterial.
// =============================================================================

// ======================== VERTEX SHADER ========================
// [VERTEX]

precision highp float;

// --- Three.js built-in uniforms (automatically injected by ShaderMaterial) ---
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat3 normalMatrix;
uniform vec3 cameraPosition;

// --- Three.js built-in attributes ---
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
// attribute vec2 uv2;    // Second UV channel
// attribute vec4 tangent; // For TBN matrix / normal mapping

// --- Custom uniforms ---
uniform float uTime;
uniform float uWaveAmplitude;
uniform float uWaveFrequency;

// --- Varyings to fragment shader ---
varying vec2 vUv;
varying vec3 vNormal;        // View-space normal
varying vec3 vWorldNormal;   // World-space normal
varying vec3 vWorldPosition;
varying float vElevation;

void main() {
  vUv = uv;

  // World-space position (without projection)
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPos.xyz;

  // View-space normal (for lighting in view space)
  vNormal = normalize(normalMatrix * normal);

  // World-space normal
  vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);

  // --- Optional displacement ---
  float wave = sin(position.x * uWaveFrequency + uTime) *
               cos(position.z * uWaveFrequency + uTime) *
               uWaveAmplitude;
  vElevation = wave;
  vec3 displaced = position + vec3(0.0, wave, 0.0);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}

// [/VERTEX]

// ======================== FRAGMENT SHADER ========================
// [FRAGMENT]

precision highp float;

const float PI = 3.14159265359;

// --- Custom uniforms ---
uniform float uTime;
uniform vec3 uColor;
uniform sampler2D uMap;
uniform sampler2D uNormalMap;
uniform float uNormalScale;
uniform float uRoughness;
uniform float uMetalness;

// Environment
uniform vec3 uLightDirection;    // Normalized, world space
uniform vec3 uLightColor;
uniform float uAmbientStrength;
uniform samplerCube uEnvMap;     // Optional: IBL

// --- Varyings from vertex shader ---
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldNormal;
varying vec3 vWorldPosition;
varying float vElevation;

// =============================================================================
// Utility functions
// =============================================================================

float remap(float v, float inMin, float inMax, float outMin, float outMax) {
  return outMin + (v - inMin) * (outMax - outMin) / (inMax - inMin);
}

vec3 linearToSRGB(vec3 c) {
  return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
}

// Schlick fresnel approximation
float fresnel(float cosTheta, float F0) {
  return F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
}

// Simple hash function
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// Value noise
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i),              hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

// Fractal Brownian Motion
float fbm(vec2 p, int octaves) {
  float value = 0.0;
  float amplitude = 0.5;
  float frequency = 1.0;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    value += amplitude * noise(p * frequency);
    amplitude *= 0.5;
    frequency *= 2.0;
  }
  return value;
}

// =============================================================================
// PBR lighting (simplified)
// =============================================================================

vec3 cookTorranceBRDF(
  vec3 normal,
  vec3 viewDir,
  vec3 lightDir,
  vec3 lightColor,
  vec3 baseColor,
  float roughness,
  float metalness
) {
  vec3 halfDir = normalize(lightDir + viewDir);
  float NdotL = max(dot(normal, lightDir), 0.0);
  float NdotV = max(dot(normal, viewDir), 0.001);
  float NdotH = max(dot(normal, halfDir), 0.0);
  float HdotV = max(dot(halfDir, viewDir), 0.0);

  // F0 (reflectance at normal incidence)
  vec3 F0 = mix(vec3(0.04), baseColor, metalness);

  // GGX Distribution
  float alpha = roughness * roughness;
  float alpha2 = alpha * alpha;
  float denom = NdotH * NdotH * (alpha2 - 1.0) + 1.0;
  float D = alpha2 / (PI * denom * denom);

  // Fresnel (Schlick)
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - HdotV, 5.0);

  // Geometry (Smith GGX)
  float k = (roughness + 1.0) * (roughness + 1.0) / 8.0;
  float Gl = NdotL / (NdotL * (1.0 - k) + k);
  float Gv = NdotV / (NdotV * (1.0 - k) + k);
  float G = Gl * Gv;

  // Specular
  vec3 specular = (D * G * F) / (4.0 * NdotL * NdotV + 0.001);

  // Diffuse (metals have no diffuse)
  vec3 kD = (1.0 - F) * (1.0 - metalness);
  vec3 diffuse = kD * baseColor / PI;

  return (diffuse + specular) * lightColor * NdotL;
}

// =============================================================================
// Main
// =============================================================================

void main() {
  // Sample base color
  vec4 texColor = texture2D(uMap, vUv);
  vec3 baseColor = texColor.rgb * uColor;

  // View direction
  vec3 viewDir = normalize(cameraPosition - vWorldPosition);

  // Normal (with optional normal map)
  vec3 normal = normalize(vNormal);
  // To enable normal map: sample uNormalMap and transform with TBN matrix

  // Lighting
  vec3 lightDir = normalize(-uLightDirection);
  vec3 ambient = uAmbientStrength * baseColor;

  vec3 lighting = cookTorranceBRDF(
    normal, viewDir, lightDir,
    uLightColor, baseColor,
    uRoughness, uMetalness
  );

  vec3 finalColor = ambient + lighting;

  // Optional: elevation-based tint
  // float elevFactor = remap(vElevation, -0.5, 0.5, 0.0, 1.0);
  // finalColor = mix(finalColor, finalColor * vec3(0.5, 0.8, 1.0), elevFactor);

  // Output — Three.js OutputPass handles tone mapping and sRGB conversion
  // when using EffectComposer. If rendering directly, apply linearToSRGB().
  gl_FragColor = vec4(finalColor, texColor.a);
}

// [/FRAGMENT]
