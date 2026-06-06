# Audio Systems

## Three.js Positional Audio

```typescript
import * as THREE from 'three';

class AudioManager {
  private listener: THREE.AudioListener;
  private sounds = new Map<string, THREE.Audio | THREE.PositionalAudio>();
  private bgm: THREE.Audio | null = null;
  private masterVolume = 1.0;
  private sfxVolume = 1.0;
  private bgmVolume = 0.5;

  constructor(camera: THREE.Camera) {
    this.listener = new THREE.AudioListener();
    camera.add(this.listener); // Attach listener to camera
  }

  // Load audio buffer
  async loadAudio(url: string): Promise<AudioBuffer> {
    const loader = new THREE.AudioLoader();
    return new Promise((resolve, reject) => {
      loader.load(url, resolve, undefined, reject);
    });
  }

  // Play 2D sound effect (non-spatial)
  playSFX(
    buffer: AudioBuffer,
    options: {
      volume?: number;
      loop?: boolean;
      detune?: number;  // Cents: -1200 to 1200
      playbackRate?: number;
    } = {},
  ): THREE.Audio {
    const sound = new THREE.Audio(this.listener);
    sound.setBuffer(buffer);
    sound.setVolume((options.volume ?? 1.0) * this.sfxVolume * this.masterVolume);
    sound.setLoop(options.loop ?? false);
    if (options.detune) sound.setDetune(options.detune);
    if (options.playbackRate) sound.setPlaybackRate(options.playbackRate);
    sound.play();

    // Auto-cleanup when done
    if (!options.loop) {
      sound.onEnded = () => {
        sound.disconnect();
      };
    }

    return sound;
  }

  // Play 3D spatial sound at a position
  playPositionalSFX(
    buffer: AudioBuffer,
    position: THREE.Vector3,
    options: {
      volume?: number;
      refDistance?: number;  // Distance where volume starts decreasing
      maxDistance?: number;  // Distance where volume reaches minimum
      rolloffFactor?: number;
      loop?: boolean;
    } = {},
  ): THREE.PositionalAudio {
    const sound = new THREE.PositionalAudio(this.listener);
    sound.setBuffer(buffer);
    sound.setVolume((options.volume ?? 1.0) * this.sfxVolume * this.masterVolume);
    sound.setRefDistance(options.refDistance ?? 5);
    sound.setMaxDistance(options.maxDistance ?? 50);
    sound.setRolloffFactor(options.rolloffFactor ?? 1);
    sound.setDistanceModel('exponential'); // 'linear' | 'inverse' | 'exponential'
    sound.setLoop(options.loop ?? false);

    // Positional audio needs to be attached to an Object3D
    const holder = new THREE.Object3D();
    holder.position.copy(position);
    holder.add(sound);
    // NOTE: Add holder to scene so it has world position

    sound.play();
    return sound;
  }

  // Background music with crossfade
  async playBGM(buffer: AudioBuffer, fadeDuration = 2.0): Promise<void> {
    if (this.bgm && this.bgm.isPlaying) {
      await this.fadeOut(this.bgm, fadeDuration);
      this.bgm.stop();
    }

    this.bgm = new THREE.Audio(this.listener);
    this.bgm.setBuffer(buffer);
    this.bgm.setLoop(true);
    this.bgm.setVolume(0);
    this.bgm.play();
    await this.fadeIn(this.bgm, this.bgmVolume * this.masterVolume, fadeDuration);
  }

  private fadeIn(audio: THREE.Audio, targetVolume: number, duration: number): Promise<void> {
    return new Promise((resolve) => {
      const gain = audio.gain;
      gain.gain.setValueAtTime(0, this.listener.context.currentTime);
      gain.gain.linearRampToValueAtTime(targetVolume, this.listener.context.currentTime + duration);
      setTimeout(resolve, duration * 1000);
    });
  }

  private fadeOut(audio: THREE.Audio, duration: number): Promise<void> {
    return new Promise((resolve) => {
      const gain = audio.gain;
      gain.gain.setValueAtTime(gain.gain.value, this.listener.context.currentTime);
      gain.gain.linearRampToValueAtTime(0, this.listener.context.currentTime + duration);
      setTimeout(resolve, duration * 1000);
    });
  }

  setMasterVolume(volume: number): void {
    this.masterVolume = THREE.MathUtils.clamp(volume, 0, 1);
    this.listener.setMasterVolume(this.masterVolume);
  }

  setSFXVolume(volume: number): void {
    this.sfxVolume = THREE.MathUtils.clamp(volume, 0, 1);
  }

  setBGMVolume(volume: number): void {
    this.bgmVolume = THREE.MathUtils.clamp(volume, 0, 1);
    if (this.bgm) {
      this.bgm.setVolume(this.bgmVolume * this.masterVolume);
    }
  }

  // Resume AudioContext after user interaction (browser policy)
  async resume(): Promise<void> {
    if (this.listener.context.state === 'suspended') {
      await this.listener.context.resume();
    }
  }

  dispose(): void {
    this.sounds.forEach((s) => {
      if (s.isPlaying) s.stop();
    });
    this.sounds.clear();
    if (this.bgm?.isPlaying) this.bgm.stop();
  }
}
```

## Sound Pool (Polyphony)

```typescript
// Multiple simultaneous instances of the same sound (gunshots, footsteps)
class SoundPool {
  private sounds: THREE.Audio[] = [];
  private index = 0;

  constructor(
    listener: THREE.AudioListener,
    buffer: AudioBuffer,
    poolSize: number,
  ) {
    for (let i = 0; i < poolSize; i++) {
      const sound = new THREE.Audio(listener);
      sound.setBuffer(buffer);
      this.sounds.push(sound);
    }
  }

  play(volume = 1.0, detune = 0): void {
    const sound = this.sounds[this.index % this.sounds.length];
    this.index++;

    if (sound.isPlaying) sound.stop();

    sound.setVolume(volume);
    sound.setDetune(detune);
    sound.play();
  }

  // Random pitch variation for natural sound
  playRandom(volume = 1.0, pitchRange = 200): void {
    const detune = (Math.random() - 0.5) * pitchRange;
    this.play(volume, detune);
  }
}
```

## Web Audio API — Direct Usage

```typescript
class WebAudioSynthesizer {
  private ctx: AudioContext;
  private masterGain: GainNode;
  private compressor: DynamicsCompressorNode;

  constructor() {
    this.ctx = new AudioContext();

    // Master bus compression (prevents clipping)
    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -24;
    this.compressor.knee.value = 30;
    this.compressor.ratio.value = 12;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.25;

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.8;

    this.compressor.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);
  }

  // Procedural sound: explosion
  playExplosion(intensity = 1.0): void {
    const now = this.ctx.currentTime;
    const duration = 1.5 * intensity;

    // White noise source
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;

    // Low-pass filter for rumble
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(400, now);
    filter.frequency.exponentialRampToValueAtTime(50, now + duration);

    // Envelope
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(intensity, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.compressor);
    source.start(now);
    source.stop(now + duration);
  }

  // Procedural sound: coin/pickup
  playPickup(frequency = 880): void {
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency, now);
    osc.frequency.setValueAtTime(frequency * 1.5, now + 0.1);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.linearRampToValueAtTime(0, now + 0.3);

    osc.connect(gain);
    gain.connect(this.compressor);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  // Procedural UI click sound
  playClick(): void {
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1000, now);
    osc.frequency.exponentialRampToValueAtTime(200, now + 0.05);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.linearRampToValueAtTime(0, now + 0.05);

    osc.connect(gain);
    gain.connect(this.compressor);
    osc.start(now);
    osc.stop(now + 0.06);
  }

  async resume(): Promise<void> {
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  dispose(): void {
    this.ctx.close();
  }
}
```

## Howler.js Integration

```bash
npm install howler @types/howler
```

```typescript
import { Howl, Howler } from 'howler';

// Howler is great for sprite-based audio (multiple sounds in one file)
class HowlerSoundManager {
  private sounds = new Map<string, Howl>();

  register(
    key: string,
    config: {
      src: string[];
      sprite?: Record<string, [number, number]>; // [startMs, durationMs]
      volume?: number;
      loop?: boolean;
    },
  ): void {
    this.sounds.set(key, new Howl({
      src: config.src,
      sprite: config.sprite,
      volume: config.volume ?? 1.0,
      loop: config.loop ?? false,
    }));
  }

  play(key: string, sprite?: string): number {
    const sound = this.sounds.get(key);
    if (!sound) return -1;
    return sprite ? sound.play(sprite) : sound.play();
  }

  stop(key: string, id?: number): void {
    const sound = this.sounds.get(key);
    if (!sound) return;
    id !== undefined ? sound.stop(id) : sound.stop();
  }

  setVolume(key: string, volume: number, id?: number): void {
    const sound = this.sounds.get(key);
    if (!sound) return;
    sound.volume(volume, id);
  }

  setMasterVolume(volume: number): void {
    Howler.volume(volume);
  }

  dispose(): void {
    this.sounds.forEach((sound) => sound.unload());
    this.sounds.clear();
  }
}

// Audio sprite example — multiple sounds from one file
const manager = new HowlerSoundManager();
manager.register('sfx', {
  src: ['/audio/sfx_sprite.webm', '/audio/sfx_sprite.mp3'],
  sprite: {
    gunshot: [0, 500],
    reload: [1000, 1500],
    footstep_grass: [3000, 300],
    footstep_concrete: [3500, 300],
    jump: [4000, 400],
    land: [4500, 200],
  },
});

// Play
manager.play('sfx', 'gunshot');
```

## Dynamic Music System

```typescript
// Adaptive music that changes with game state
class AdaptiveMusicSystem {
  private layers = new Map<string, Howl>();
  private activeLayerIds = new Map<string, number>();
  private intensity = 0; // 0 = calm, 1 = intense combat

  constructor() {
    // Each layer plays simultaneously — mix by adjusting volumes
    this.layers.set('base', new Howl({
      src: ['/audio/music_base.webm'],
      loop: true,
      volume: 0.5,
    }));
    this.layers.set('tension', new Howl({
      src: ['/audio/music_tension.webm'],
      loop: true,
      volume: 0,
    }));
    this.layers.set('combat', new Howl({
      src: ['/audio/music_combat.webm'],
      loop: true,
      volume: 0,
    }));
  }

  start(): void {
    for (const [key, howl] of this.layers) {
      const id = howl.play();
      this.activeLayerIds.set(key, id);
    }
  }

  setIntensity(value: number): void {
    this.intensity = THREE.MathUtils.clamp(value, 0, 1);
    this.updateMix();
  }

  private updateMix(): void {
    const baseId = this.activeLayerIds.get('base')!;
    const tensionId = this.activeLayerIds.get('tension')!;
    const combatId = this.activeLayerIds.get('combat')!;

    const baseVol = 0.5;
    const tensionVol = this.intensity * 0.4;
    const combatVol = Math.max(0, (this.intensity - 0.5) * 2 * 0.6);

    this.layers.get('base')!.volume(baseVol, baseId);
    this.layers.get('tension')!.volume(tensionVol, tensionId);
    this.layers.get('combat')!.volume(combatVol, combatId);
  }

  stop(fadeOut = 2000): void {
    for (const [key, howl] of this.layers) {
      const id = this.activeLayerIds.get(key)!;
      howl.fade(howl.volume(id) as number, 0, fadeOut, id);
    }
    setTimeout(() => this.layers.forEach((h) => h.stop()), fadeOut + 100);
  }
}
```

## Audio Format Recommendations

| Format | Browser Support | Use Case |
|---|---|---|
| WebM/Opus | Chrome, Firefox, Edge | Best compression, modern browsers |
| MP3 | Universal | Fallback for all browsers |
| OGG/Vorbis | Chrome, Firefox | Good quality, open format |
| WAV | Universal | Uncompressed, short SFX only |
| AAC/M4A | Safari, Chrome | Apple ecosystem |

Always provide at least WebM + MP3 fallback:

```typescript
const sound = new Howl({
  src: ['/audio/music.webm', '/audio/music.mp3'], // Try WebM first, fallback to MP3
});
```
