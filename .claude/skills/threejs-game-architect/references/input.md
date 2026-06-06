# Input Handling

## Input Manager — State-Based (Not Event-Based)

```typescript
// Poll input state each frame instead of reacting to events
// Prevents missed inputs and double-firing

class InputManager {
  // Keyboard state
  private keys = new Set<string>();
  private keysDown = new Set<string>(); // Just pressed this frame
  private keysUp = new Set<string>();   // Just released this frame

  // Mouse state
  readonly mouse = {
    position: new THREE.Vector2(),
    delta: new THREE.Vector2(),
    buttons: new Set<number>(),
    buttonsDown: new Set<number>(),
    buttonsUp: new Set<number>(),
    wheel: 0,
    locked: false,
  };

  // Touch state
  private touches = new Map<number, TouchInfo>();

  // Gamepad state
  private gamepads = new Map<number, GamepadState>();

  // Raw event queues — processed once per frame
  private pendingKeys: { key: string; down: boolean }[] = [];
  private pendingMouseButtons: { button: number; down: boolean }[] = [];
  private pendingMouseMoves: { x: number; y: number; movX: number; movY: number }[] = [];
  private pendingWheel: number[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    this.bindEvents();
  }

  private bindEvents(): void {
    // Keyboard
    window.addEventListener('keydown', (e) => {
      if (!e.repeat) this.pendingKeys.push({ key: e.code, down: true });
    });
    window.addEventListener('keyup', (e) => {
      this.pendingKeys.push({ key: e.code, down: false });
    });

    // Mouse
    this.canvas.addEventListener('mousedown', (e) => {
      this.pendingMouseButtons.push({ button: e.button, down: true });
    });
    window.addEventListener('mouseup', (e) => {
      this.pendingMouseButtons.push({ button: e.button, down: false });
    });
    window.addEventListener('mousemove', (e) => {
      this.pendingMouseMoves.push({
        x: e.clientX,
        y: e.clientY,
        movX: e.movementX,
        movY: e.movementY,
      });
    });
    this.canvas.addEventListener('wheel', (e) => {
      this.pendingWheel.push(e.deltaY);
      e.preventDefault();
    }, { passive: false });

    // Pointer lock
    document.addEventListener('pointerlockchange', () => {
      this.mouse.locked = document.pointerLockElement === this.canvas;
    });

    // Touch
    this.canvas.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: false });
    this.canvas.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false });
    this.canvas.addEventListener('touchend', (e) => this.onTouchEnd(e));

    // Gamepad
    window.addEventListener('gamepadconnected', (e) => this.onGamepadConnected(e as GamepadEvent));
    window.addEventListener('gamepaddisconnected', (e) => this.onGamepadDisconnected(e as GamepadEvent));
  }

  // Call once per frame — processes queued events
  update(): void {
    // Clear frame-specific state
    this.keysDown.clear();
    this.keysUp.clear();
    this.mouse.buttonsDown.clear();
    this.mouse.buttonsUp.clear();
    this.mouse.delta.set(0, 0);
    this.mouse.wheel = 0;

    // Process keyboard events
    for (const { key, down } of this.pendingKeys) {
      if (down) {
        this.keys.add(key);
        this.keysDown.add(key);
      } else {
        this.keys.delete(key);
        this.keysUp.add(key);
      }
    }
    this.pendingKeys.length = 0;

    // Process mouse button events
    for (const { button, down } of this.pendingMouseButtons) {
      if (down) {
        this.mouse.buttons.add(button);
        this.mouse.buttonsDown.add(button);
      } else {
        this.mouse.buttons.delete(button);
        this.mouse.buttonsUp.add(button);
      }
    }
    this.pendingMouseButtons.length = 0;

    // Accumulate mouse movement
    for (const move of this.pendingMouseMoves) {
      this.mouse.position.set(move.x, move.y);
      this.mouse.delta.x += move.movX;
      this.mouse.delta.y += move.movY;
    }
    this.pendingMouseMoves.length = 0;

    // Accumulate wheel
    for (const delta of this.pendingWheel) {
      this.mouse.wheel += delta;
    }
    this.pendingWheel.length = 0;

    // Update gamepads (polled, not event-based)
    this.pollGamepads();
  }

  // Keyboard queries
  isKeyHeld(code: string): boolean { return this.keys.has(code); }
  isKeyDown(code: string): boolean { return this.keysDown.has(code); }
  isKeyUp(code: string): boolean { return this.keysUp.has(code); }

  // Mouse queries
  isMouseButtonHeld(button: number): boolean { return this.mouse.buttons.has(button); }
  isMouseButtonDown(button: number): boolean { return this.mouse.buttonsDown.has(button); }
  isMouseButtonUp(button: number): boolean { return this.mouse.buttonsUp.has(button); }

  // Get normalized mouse position (-1 to 1)
  getNormalizedMousePosition(): THREE.Vector2 {
    return new THREE.Vector2(
      (this.mouse.position.x / window.innerWidth) * 2 - 1,
      -(this.mouse.position.y / window.innerHeight) * 2 + 1,
    );
  }

  // Touch handling
  private onTouchStart(event: TouchEvent): void {
    event.preventDefault();
    for (const touch of event.changedTouches) {
      this.touches.set(touch.identifier, {
        id: touch.identifier,
        position: new THREE.Vector2(touch.clientX, touch.clientY),
        startPosition: new THREE.Vector2(touch.clientX, touch.clientY),
        delta: new THREE.Vector2(),
      });
    }
  }

  private onTouchMove(event: TouchEvent): void {
    event.preventDefault();
    for (const touch of event.changedTouches) {
      const existing = this.touches.get(touch.identifier);
      if (existing) {
        existing.delta.set(
          touch.clientX - existing.position.x,
          touch.clientY - existing.position.y,
        );
        existing.position.set(touch.clientX, touch.clientY);
      }
    }
  }

  private onTouchEnd(event: TouchEvent): void {
    for (const touch of event.changedTouches) {
      this.touches.delete(touch.identifier);
    }
  }

  getTouch(index = 0): TouchInfo | undefined {
    return [...this.touches.values()][index];
  }

  getTouchCount(): number { return this.touches.size; }

  // Gamepad handling
  private pollGamepads(): void {
    const gamepads = navigator.getGamepads();
    for (const gamepad of gamepads) {
      if (!gamepad || !this.gamepads.has(gamepad.index)) continue;
      const state = this.gamepads.get(gamepad.index)!;
      state.axes = [...gamepad.axes];
      state.buttonsHeld = new Set(
        gamepad.buttons.map((b, i) => ({ pressed: b.pressed, index: i }))
          .filter((b) => b.pressed)
          .map((b) => b.index),
      );
      state.timestamp = gamepad.timestamp;
    }
  }

  private onGamepadConnected(event: GamepadEvent): void {
    console.log(`Gamepad connected: ${event.gamepad.id}`);
    this.gamepads.set(event.gamepad.index, {
      index: event.gamepad.index,
      id: event.gamepad.id,
      axes: [...event.gamepad.axes],
      buttonsHeld: new Set(),
      timestamp: event.gamepad.timestamp,
    });
  }

  private onGamepadDisconnected(event: GamepadEvent): void {
    this.gamepads.delete(event.gamepad.index);
  }

  getGamepad(index = 0): GamepadState | undefined {
    return this.gamepads.get(index);
  }

  getGamepadAxis(index = 0, axis: number): number {
    const state = this.gamepads.get(index);
    if (!state) return 0;
    const value = state.axes[axis] ?? 0;
    // Dead zone
    return Math.abs(value) < 0.15 ? 0 : value;
  }

  isGamepadButtonHeld(index = 0, button: number): boolean {
    return this.gamepads.get(index)?.buttonsHeld.has(button) ?? false;
  }

  requestPointerLock(): void {
    this.canvas.requestPointerLock();
  }

  releasePointerLock(): void {
    document.exitPointerLock();
  }

  dispose(): void {
    // Remove event listeners (simplified — in production, store and remove each)
    // window.removeEventListener(...)
  }
}

interface TouchInfo {
  id: number;
  position: THREE.Vector2;
  startPosition: THREE.Vector2;
  delta: THREE.Vector2;
}

interface GamepadState {
  index: number;
  id: string;
  axes: number[];
  buttonsHeld: Set<number>;
  timestamp: number;
}
```

## Action Mapping

```typescript
// Rebindable input action system
type ActionId = string;

interface ActionBinding {
  keyboard?: string[];      // e.g., ['KeyW', 'ArrowUp']
  mouseButton?: number[];
  gamepadButton?: number[];
  gamepadAxis?: { axis: number; direction: 1 | -1; threshold?: number }[];
}

class ActionMap {
  private bindings = new Map<ActionId, ActionBinding>();
  private input: InputManager;

  constructor(input: InputManager) {
    this.input = input;
    this.loadDefaults();
  }

  private loadDefaults(): void {
    this.bind('moveForward',  { keyboard: ['KeyW', 'ArrowUp'],    gamepadAxis: [{ axis: 1, direction: -1 }] });
    this.bind('moveBackward', { keyboard: ['KeyS', 'ArrowDown'],  gamepadAxis: [{ axis: 1, direction:  1 }] });
    this.bind('moveLeft',     { keyboard: ['KeyA', 'ArrowLeft'],  gamepadAxis: [{ axis: 0, direction: -1 }] });
    this.bind('moveRight',    { keyboard: ['KeyD', 'ArrowRight'], gamepadAxis: [{ axis: 0, direction:  1 }] });
    this.bind('jump',         { keyboard: ['Space'],              gamepadButton: [0] }); // A button
    this.bind('sprint',       { keyboard: ['ShiftLeft'],          gamepadButton: [10] }); // L3
    this.bind('fire',         { mouseButton: [0],                 gamepadButton: [7] }); // RT
    this.bind('aim',          { mouseButton: [2],                 gamepadButton: [6] }); // LT
    this.bind('interact',     { keyboard: ['KeyE'],               gamepadButton: [2] }); // X
    this.bind('pause',        { keyboard: ['Escape', 'KeyP'],     gamepadButton: [9] }); // Start
  }

  bind(action: ActionId, binding: ActionBinding): void {
    this.bindings.set(action, binding);
  }

  isHeld(action: ActionId): boolean {
    const binding = this.bindings.get(action);
    if (!binding) return false;

    if (binding.keyboard?.some((k) => this.input.isKeyHeld(k))) return true;
    if (binding.mouseButton?.some((b) => this.input.isMouseButtonHeld(b))) return true;
    if (binding.gamepadButton?.some((b) => this.input.isGamepadButtonHeld(0, b))) return true;
    if (binding.gamepadAxis?.some(({ axis, direction, threshold = 0.5 }) =>
      this.input.getGamepadAxis(0, axis) * direction > threshold
    )) return true;

    return false;
  }

  isDown(action: ActionId): boolean {
    const binding = this.bindings.get(action);
    if (!binding) return false;

    if (binding.keyboard?.some((k) => this.input.isKeyDown(k))) return true;
    if (binding.mouseButton?.some((b) => this.input.isMouseButtonDown(b))) return true;
    return false;
  }

  getAxis(positiveAction: ActionId, negativeAction: ActionId): number {
    const pos = this.isHeld(positiveAction) ? 1 : 0;
    const neg = this.isHeld(negativeAction) ? -1 : 0;
    return pos + neg;
  }

  // Analog value for gamepad sticks
  getAnalog(action: ActionId): number {
    const binding = this.bindings.get(action);
    if (!binding?.gamepadAxis) return this.isHeld(action) ? 1 : 0;

    let max = 0;
    for (const { axis, direction, threshold = 0 } of binding.gamepadAxis) {
      const value = this.input.getGamepadAxis(0, axis) * direction;
      if (value > threshold) max = Math.max(max, value);
    }
    return max || (this.isHeld(action) ? 1 : 0);
  }
}
```

## Raycasting for 3D Interaction

```typescript
class InteractionSystem {
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private interactables: THREE.Object3D[] = [];
  private hoveredObject: THREE.Object3D | null = null;

  private onHoverEnter?: (object: THREE.Object3D) => void;
  private onHoverExit?: (object: THREE.Object3D) => void;
  private onClick?: (object: THREE.Object3D, point: THREE.Vector3) => void;

  register(object: THREE.Object3D): void {
    this.interactables.push(object);
  }

  unregister(object: THREE.Object3D): void {
    const idx = this.interactables.indexOf(object);
    if (idx >= 0) this.interactables.splice(idx, 1);
  }

  update(
    camera: THREE.Camera,
    input: InputManager,
    canvas: HTMLCanvasElement,
  ): void {
    // Update normalized mouse coordinates
    const { x, y } = input.mouse.position;
    this.mouse.set(
      (x / canvas.clientWidth) * 2 - 1,
      -(y / canvas.clientHeight) * 2 + 1,
    );

    this.raycaster.setFromCamera(this.mouse, camera);
    const hits = this.raycaster.intersectObjects(this.interactables, true);

    const newHovered = hits.length > 0 ? hits[0].object : null;

    // Hover events
    if (newHovered !== this.hoveredObject) {
      if (this.hoveredObject) this.onHoverExit?.(this.hoveredObject);
      if (newHovered) this.onHoverEnter?.(newHovered);
      this.hoveredObject = newHovered;
    }

    // Click
    if (input.isMouseButtonDown(0) && newHovered && hits.length > 0) {
      this.onClick?.(newHovered, hits[0].point);
    }
  }
}
```

## Virtual Joystick (Touch Controls)

```typescript
class VirtualJoystick {
  private active = false;
  private touchId: number | null = null;
  private center = new THREE.Vector2();
  private current = new THREE.Vector2();
  readonly output = new THREE.Vector2(); // Normalized -1 to 1

  readonly radius: number;

  constructor(
    private container: HTMLElement,
    radius = 60,
  ) {
    this.radius = radius;
    this.createUI();
    this.bindEvents();
  }

  private createUI(): void {
    // Visual joystick — implementation depends on your UI framework
    // Simple CSS circle as placeholder
    this.container.style.cssText = `
      position: fixed; bottom: 80px; left: 80px;
      width: ${this.radius * 2}px; height: ${this.radius * 2}px;
      border-radius: 50%; background: rgba(255,255,255,0.2);
      border: 2px solid rgba(255,255,255,0.5);
      touch-action: none;
    `;
  }

  private bindEvents(): void {
    this.container.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (this.active) return;
      const touch = e.changedTouches[0];
      this.touchId = touch.identifier;
      this.active = true;
      const rect = this.container.getBoundingClientRect();
      this.center.set(rect.left + this.radius, rect.top + this.radius);
    }, { passive: false });

    window.addEventListener('touchmove', (e) => {
      if (!this.active) return;
      for (const touch of e.changedTouches) {
        if (touch.identifier !== this.touchId) continue;
        this.current.set(touch.clientX, touch.clientY);
        const delta = new THREE.Vector2().subVectors(this.current, this.center);
        const dist = Math.min(delta.length(), this.radius);
        this.output.copy(delta).normalize().multiplyScalar(dist / this.radius);
        break;
      }
    });

    window.addEventListener('touchend', (e) => {
      for (const touch of e.changedTouches) {
        if (touch.identifier === this.touchId) {
          this.active = false;
          this.touchId = null;
          this.output.set(0, 0);
          break;
        }
      }
    });
  }

  get x(): number { return this.output.x; }
  get y(): number { return this.output.y; }
  get isActive(): boolean { return this.active; }
}
```

## Keyboard Constants

```typescript
// Common key codes for reference
const Keys = {
  // Movement
  W: 'KeyW', A: 'KeyA', S: 'KeyS', D: 'KeyD',
  UP: 'ArrowUp', DOWN: 'ArrowDown', LEFT: 'ArrowLeft', RIGHT: 'ArrowRight',
  // Actions
  SPACE: 'Space',
  SHIFT_L: 'ShiftLeft', SHIFT_R: 'ShiftRight',
  CTRL_L: 'ControlLeft', CTRL_R: 'ControlRight',
  ALT_L: 'AltLeft',
  // UI
  ESCAPE: 'Escape',
  ENTER: 'Enter',
  TAB: 'Tab',
  // Numbers
  ONE: 'Digit1', TWO: 'Digit2', THREE: 'Digit3',
  FOUR: 'Digit4', FIVE: 'Digit5',
  // Letters
  E: 'KeyE', F: 'KeyF', G: 'KeyG', R: 'KeyR', Q: 'KeyQ',
} as const;

// Gamepad button mapping (standard mapping)
const GamepadButtons = {
  A: 0, B: 1, X: 2, Y: 3,
  LB: 4, RB: 5,
  LT: 6, RT: 7,
  SELECT: 8, START: 9,
  L3: 10, R3: 11,
  DPAD_UP: 12, DPAD_DOWN: 13, DPAD_LEFT: 14, DPAD_RIGHT: 15,
} as const;

const GamepadAxes = {
  LEFT_X: 0,  LEFT_Y: 1,
  RIGHT_X: 2, RIGHT_Y: 3,
} as const;
```
