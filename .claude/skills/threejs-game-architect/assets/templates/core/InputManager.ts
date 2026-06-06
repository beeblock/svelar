/**
 * InputManager.ts
 * Unified state-based input handling for keyboard, mouse, touch, and gamepad.
 * Poll state each frame — never react directly to events in game logic.
 */

import * as THREE from 'three';

export interface InputState {
  // Keyboard
  keys: ReadonlySet<string>;
  keysDown: ReadonlySet<string>;
  keysUp: ReadonlySet<string>;

  // Mouse
  mousePosition: Readonly<THREE.Vector2>;
  mouseNormalized: Readonly<THREE.Vector2>;
  mouseDelta: Readonly<THREE.Vector2>;
  mouseButtons: ReadonlySet<number>;
  mouseButtonsDown: ReadonlySet<number>;
  mouseButtonsUp: ReadonlySet<number>;
  mouseWheel: number;
  mouseIsLocked: boolean;
}

export class InputManager {
  // Keyboard state
  private readonly _keys = new Set<string>();
  private readonly _keysDown = new Set<string>();
  private readonly _keysUp = new Set<string>();

  // Mouse state
  private readonly _mousePos = new THREE.Vector2();
  private readonly _mouseNorm = new THREE.Vector2();
  private readonly _mouseDelta = new THREE.Vector2();
  private readonly _mouseButtons = new Set<number>();
  private readonly _mouseButtonsDown = new Set<number>();
  private readonly _mouseButtonsUp = new Set<number>();
  private _mouseWheel = 0;
  private _mouseIsLocked = false;

  // Gamepad
  private gamepads = new Map<number, Gamepad>();

  // Pending event queues (filled by event handlers, consumed by update())
  private pendingKeys: { code: string; down: boolean }[] = [];
  private pendingMouseButtons: { button: number; down: boolean }[] = [];
  private pendingMouseMoves: { x: number; y: number; dx: number; dy: number }[] = [];
  private pendingWheelDeltas: number[] = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.bindEvents();
  }

  private bindEvents(): void {
    // --- Keyboard ---
    window.addEventListener('keydown', (e) => {
      if (!e.repeat) this.pendingKeys.push({ code: e.code, down: true });
    });
    window.addEventListener('keyup', (e) => {
      this.pendingKeys.push({ code: e.code, down: false });
    });

    // --- Mouse ---
    window.addEventListener('mousedown', (e) => {
      this.pendingMouseButtons.push({ button: e.button, down: true });
    });
    window.addEventListener('mouseup', (e) => {
      this.pendingMouseButtons.push({ button: e.button, down: false });
    });
    window.addEventListener('mousemove', (e) => {
      this.pendingMouseMoves.push({
        x: e.clientX,
        y: e.clientY,
        dx: e.movementX,
        dy: e.movementY,
      });
    });
    this.canvas.addEventListener('wheel', (e) => {
      this.pendingWheelDeltas.push(e.deltaY);
      e.preventDefault();
    }, { passive: false });

    // Pointer lock
    document.addEventListener('pointerlockchange', () => {
      this._mouseIsLocked = document.pointerLockElement === this.canvas;
    });

    // --- Gamepad ---
    window.addEventListener('gamepadconnected', (e) => {
      this.gamepads.set((e as GamepadEvent).gamepad.index, (e as GamepadEvent).gamepad);
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      this.gamepads.delete((e as GamepadEvent).gamepad.index);
    });

    // Prevent context menu on right-click
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Call once at the start of each frame */
  update(): void {
    // Clear frame-specific state
    this._keysDown.clear();
    this._keysUp.clear();
    this._mouseButtonsDown.clear();
    this._mouseButtonsUp.clear();
    this._mouseDelta.set(0, 0);
    this._mouseWheel = 0;

    // --- Process keyboard events ---
    for (const { code, down } of this.pendingKeys) {
      if (down) {
        this._keys.add(code);
        this._keysDown.add(code);
      } else {
        this._keys.delete(code);
        this._keysUp.add(code);
      }
    }
    this.pendingKeys.length = 0;

    // --- Process mouse button events ---
    for (const { button, down } of this.pendingMouseButtons) {
      if (down) {
        this._mouseButtons.add(button);
        this._mouseButtonsDown.add(button);
      } else {
        this._mouseButtons.delete(button);
        this._mouseButtonsUp.add(button);
      }
    }
    this.pendingMouseButtons.length = 0;

    // --- Accumulate mouse movement ---
    for (const move of this.pendingMouseMoves) {
      this._mousePos.set(move.x, move.y);
      this._mouseDelta.x += move.dx;
      this._mouseDelta.y += move.dy;
    }
    this.pendingMouseMoves.length = 0;

    // --- Normalized mouse position (-1 to 1) ---
    this._mouseNorm.set(
      (this._mousePos.x / this.canvas.clientWidth) * 2 - 1,
      -(this._mousePos.y / this.canvas.clientHeight) * 2 + 1,
    );

    // --- Accumulate wheel ---
    for (const delta of this.pendingWheelDeltas) {
      this._mouseWheel += delta;
    }
    this.pendingWheelDeltas.length = 0;

    // --- Poll gamepads (no events for button state changes) ---
    const rawGamepads = navigator.getGamepads();
    for (const gp of rawGamepads) {
      if (gp) this.gamepads.set(gp.index, gp);
    }
  }

  // ---------- Keyboard ----------

  isKeyHeld(code: string): boolean { return this._keys.has(code); }
  isKeyDown(code: string): boolean { return this._keysDown.has(code); }
  isKeyUp(code: string): boolean { return this._keysUp.has(code); }

  // ---------- Mouse ----------

  get mousePosition(): THREE.Vector2 { return this._mousePos; }
  get mouseNormalized(): THREE.Vector2 { return this._mouseNorm; }
  get mouseDelta(): THREE.Vector2 { return this._mouseDelta; }
  get mouseWheel(): number { return this._mouseWheel; }
  get mouseIsLocked(): boolean { return this._mouseIsLocked; }

  isMouseButtonHeld(button: number): boolean { return this._mouseButtons.has(button); }
  isMouseButtonDown(button: number): boolean { return this._mouseButtonsDown.has(button); }
  isMouseButtonUp(button: number): boolean { return this._mouseButtonsUp.has(button); }

  requestPointerLock(): void { this.canvas.requestPointerLock(); }
  releasePointerLock(): void { document.exitPointerLock(); }

  // ---------- Gamepad ----------

  getGamepad(index = 0): Gamepad | undefined { return this.gamepads.get(index); }

  getGamepadAxis(index = 0, axis: number, deadZone = 0.15): number {
    const gp = this.gamepads.get(index);
    if (!gp) return 0;
    const value = gp.axes[axis] ?? 0;
    return Math.abs(value) < deadZone ? 0 : value;
  }

  isGamepadButtonHeld(index = 0, button: number): boolean {
    return this.gamepads.get(index)?.buttons[button]?.pressed ?? false;
  }

  isGamepadButtonDown(index = 0, button: number): boolean {
    // Note: true gamepad "just pressed" detection requires frame-to-frame comparison
    // For simplicity this returns held state — extend if needed
    return this.isGamepadButtonHeld(index, button);
  }

  get hasGamepad(): boolean { return this.gamepads.size > 0; }

  // ---------- Convenience ----------

  /** Returns movement vector from WASD/Arrow keys or left stick */
  getMovementVector(): THREE.Vector2 {
    const x = (this.isKeyHeld('KeyD') || this.isKeyHeld('ArrowRight') ? 1 : 0)
            - (this.isKeyHeld('KeyA') || this.isKeyHeld('ArrowLeft')  ? 1 : 0)
            + this.getGamepadAxis(0, 0);

    const y = (this.isKeyHeld('KeyW') || this.isKeyHeld('ArrowUp')   ? 1 : 0)
            - (this.isKeyHeld('KeyS') || this.isKeyHeld('ArrowDown')  ? 1 : 0)
            - this.getGamepadAxis(0, 1);

    return new THREE.Vector2(
      Math.max(-1, Math.min(1, x)),
      Math.max(-1, Math.min(1, y)),
    );
  }

  dispose(): void {
    // Note: event listeners are attached to window/canvas — call this on cleanup
    // In production, store bound handlers and call removeEventListener
  }
}

// Keyboard key code constants for readability
export const Keys = {
  W: 'KeyW', A: 'KeyA', S: 'KeyS', D: 'KeyD',
  UP: 'ArrowUp', DOWN: 'ArrowDown', LEFT: 'ArrowLeft', RIGHT: 'ArrowRight',
  SPACE: 'Space',
  SHIFT_L: 'ShiftLeft', SHIFT_R: 'ShiftRight',
  CTRL_L: 'ControlLeft', CTRL_R: 'ControlRight',
  ALT_L: 'AltLeft',
  ESCAPE: 'Escape', ENTER: 'Enter', TAB: 'Tab',
  E: 'KeyE', F: 'KeyF', G: 'KeyG', R: 'KeyR', Q: 'KeyQ',
  ONE: 'Digit1', TWO: 'Digit2', THREE: 'Digit3', FOUR: 'Digit4', FIVE: 'Digit5',
} as const;

export const MouseButton = {
  LEFT: 0,
  MIDDLE: 1,
  RIGHT: 2,
} as const;

export const GamepadButton = {
  A: 0, B: 1, X: 2, Y: 3,
  LB: 4, RB: 5, LT: 6, RT: 7,
  SELECT: 8, START: 9,
  L3: 10, R3: 11,
  DPAD_UP: 12, DPAD_DOWN: 13, DPAD_LEFT: 14, DPAD_RIGHT: 15,
} as const;

export const GamepadAxis = {
  LEFT_X: 0, LEFT_Y: 1,
  RIGHT_X: 2, RIGHT_Y: 3,
} as const;
