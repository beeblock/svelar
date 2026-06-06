/**
 * AudioManager.ts
 * Spatial audio system using Three.js PositionalAudio + Web Audio API.
 * Supports 2D/3D sounds, BGM with crossfade, and a sound pool for polyphony.
 */

import * as THREE from 'three';

export interface SoundOptions {
  volume?: number;
  loop?: boolean;
  detune?: number;          // Semitones in cents: -1200 to 1200
  playbackRate?: number;
}

export interface PositionalSoundOptions extends SoundOptions {
  refDistance?: number;     // Distance where volume starts attenuating
  maxDistance?: number;     // Distance of maximum attenuation
  rolloffFactor?: number;
  distanceModel?: DistanceModelType;
}

export class AudioManager {
  private readonly listener: THREE.AudioListener;
  private readonly soundLoader = new THREE.AudioLoader();

  private bgm: THREE.Audio | null = null;
  private bgmVolume = 0.5;
  private sfxVolume = 1.0;

  // Track all active sounds for pause/resume/dispose
  private activeSounds = new Set<THREE.Audio | THREE.PositionalAudio>();

  constructor(camera: THREE.Camera) {
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);
  }

  // ---------- Asset Loading ----------

  async loadBuffer(url: string): Promise<AudioBuffer> {
    return new Promise((resolve, reject) => {
      this.soundLoader.load(url, resolve, undefined, reject);
    });
  }

  // ---------- 2D Sound Effects ----------

  playSFX(buffer: AudioBuffer, options: SoundOptions = {}): THREE.Audio {
    const sound = new THREE.Audio(this.listener);
    sound.setBuffer(buffer);
    sound.setVolume((options.volume ?? 1.0) * this.sfxVolume);
    sound.setLoop(options.loop ?? false);
    if (options.detune !== undefined) sound.setDetune(options.detune);
    if (options.playbackRate !== undefined) sound.setPlaybackRate(options.playbackRate);

    // Resume AudioContext if suspended (browser autoplay policy)
    if (this.listener.context.state === 'suspended') {
      this.listener.context.resume().then(() => sound.play());
    } else {
      sound.play();
    }

    this.activeSounds.add(sound);

    if (!options.loop) {
      sound.onEnded = () => {
        this.activeSounds.delete(sound);
        sound.disconnect();
      };
    }

    return sound;
  }

  // ---------- 3D Positional Sound ----------

  playPositionalSFX(
    buffer: AudioBuffer,
    worldObject: THREE.Object3D,
    options: PositionalSoundOptions = {},
  ): THREE.PositionalAudio {
    const sound = new THREE.PositionalAudio(this.listener);
    sound.setBuffer(buffer);
    sound.setVolume((options.volume ?? 1.0) * this.sfxVolume);
    sound.setRefDistance(options.refDistance ?? 5);
    sound.setMaxDistance(options.maxDistance ?? 50);
    sound.setRolloffFactor(options.rolloffFactor ?? 1);
    sound.setDistanceModel(options.distanceModel ?? 'exponential');
    sound.setLoop(options.loop ?? false);
    if (options.detune !== undefined) sound.setDetune(options.detune);

    // Attach to world object for automatic position tracking
    worldObject.add(sound);

    if (this.listener.context.state === 'suspended') {
      this.listener.context.resume().then(() => sound.play());
    } else {
      sound.play();
    }

    this.activeSounds.add(sound);

    if (!options.loop) {
      sound.onEnded = () => {
        this.activeSounds.delete(sound);
        worldObject.remove(sound);
        sound.disconnect();
      };
    }

    return sound;
  }

  // ---------- Background Music ----------

  async playBGM(
    buffer: AudioBuffer,
    options: { fadeDuration?: number; volume?: number } = {},
  ): Promise<void> {
    const { fadeDuration = 2.0, volume } = options;
    this.bgmVolume = volume ?? this.bgmVolume;

    // Fade out current BGM
    if (this.bgm?.isPlaying) {
      await this.fadeOut(this.bgm, fadeDuration);
      this.bgm.stop();
      this.bgm.disconnect();
    }

    // Create and start new BGM
    this.bgm = new THREE.Audio(this.listener);
    this.bgm.setBuffer(buffer);
    this.bgm.setLoop(true);
    this.bgm.setVolume(0);

    await this.ensureAudioContextRunning();
    this.bgm.play();
    await this.fadeIn(this.bgm, this.bgmVolume, fadeDuration);
  }

  async stopBGM(fadeDuration = 1.5): Promise<void> {
    if (!this.bgm?.isPlaying) return;
    await this.fadeOut(this.bgm, fadeDuration);
    this.bgm.stop();
    this.bgm = null;
  }

  // ---------- Volume Control ----------

  setMasterVolume(volume: number): void {
    this.listener.setMasterVolume(Math.max(0, Math.min(1, volume)));
  }

  setSFXVolume(volume: number): void {
    this.sfxVolume = Math.max(0, Math.min(1, volume));
  }

  setBGMVolume(volume: number): void {
    this.bgmVolume = Math.max(0, Math.min(1, volume));
    if (this.bgm) this.bgm.setVolume(this.bgmVolume);
  }

  // ---------- Pause / Resume (for pause menu) ----------

  pauseAll(): void {
    for (const sound of this.activeSounds) {
      if (sound.isPlaying) sound.pause();
    }
    this.bgm?.pause();
  }

  resumeAll(): void {
    for (const sound of this.activeSounds) {
      if (!sound.isPlaying) sound.play();
    }
    this.bgm?.play();
  }

  // ---------- Fade Helpers ----------

  private fadeIn(audio: THREE.Audio, targetVolume: number, duration: number): Promise<void> {
    return new Promise((resolve) => {
      const ctx = this.listener.context;
      audio.gain.gain.setValueAtTime(0, ctx.currentTime);
      audio.gain.gain.linearRampToValueAtTime(targetVolume, ctx.currentTime + duration);
      setTimeout(resolve, duration * 1000);
    });
  }

  private fadeOut(audio: THREE.Audio, duration: number): Promise<void> {
    return new Promise((resolve) => {
      const ctx = this.listener.context;
      const currentGain = audio.gain.gain.value;
      audio.gain.gain.setValueAtTime(currentGain, ctx.currentTime);
      audio.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + duration);
      setTimeout(resolve, duration * 1000);
    });
  }

  private async ensureAudioContextRunning(): Promise<void> {
    if (this.listener.context.state === 'suspended') {
      await this.listener.context.resume();
    }
  }

  // ---------- Cleanup ----------

  dispose(): void {
    for (const sound of this.activeSounds) {
      if (sound.isPlaying) sound.stop();
      sound.disconnect();
    }
    this.activeSounds.clear();

    if (this.bgm) {
      if (this.bgm.isPlaying) this.bgm.stop();
      this.bgm.disconnect();
      this.bgm = null;
    }
  }
}

// ---------- Sound Pool (polyphony) ----------

export class SoundPool {
  private sounds: THREE.Audio[];
  private index = 0;

  constructor(
    listener: THREE.AudioListener,
    buffer: AudioBuffer,
    poolSize = 8,
  ) {
    this.sounds = Array.from({ length: poolSize }, () => {
      const sound = new THREE.Audio(listener);
      sound.setBuffer(buffer);
      return sound;
    });
  }

  play(options: SoundOptions = {}): void {
    const sound = this.sounds[this.index % this.sounds.length];
    this.index++;

    if (sound.isPlaying) sound.stop();

    sound.setVolume(options.volume ?? 1.0);
    if (options.detune !== undefined) sound.setDetune(options.detune);
    if (options.playbackRate !== undefined) sound.setPlaybackRate(options.playbackRate);

    if (sound.context.state === 'running') {
      sound.play();
    }
  }

  playWithPitchVariation(volume = 1.0, pitchRange = 200): void {
    const detune = (Math.random() - 0.5) * pitchRange;
    this.play({ volume, detune });
  }

  dispose(): void {
    this.sounds.forEach((s) => {
      if (s.isPlaying) s.stop();
      s.disconnect();
    });
    this.sounds = [];
  }
}
