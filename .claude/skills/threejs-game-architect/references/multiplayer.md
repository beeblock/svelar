# Multiplayer Architecture

## WebSocket Client

```typescript
interface NetworkMessage {
  type: string;
  payload: unknown;
  timestamp: number;
  sequence: number;
}

type MessageHandler<T = unknown> = (payload: T) => void;

class NetworkClient {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<MessageHandler>>();
  private sendQueue: NetworkMessage[] = [];
  private sequence = 0;
  private connected = false;

  // Connection state
  readonly latency = { current: 0, average: 0, history: [] as number[] };
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private lastPingTime = 0;

  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.connected = true;
        this.flushQueue();
        this.startPing();
        resolve();
      };

      this.ws.onclose = (event) => {
        this.connected = false;
        this.stopPing();
        this.emit('connection:close', { code: event.code, reason: event.reason });
        if (!event.wasClean) this.attemptReconnect(url);
      };

      this.ws.onerror = (error) => {
        reject(error);
        this.emit('connection:error', { error });
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as NetworkMessage;
          if (message.type === 'pong') {
            this.onPong(message.timestamp);
          } else {
            this.dispatch(message);
          }
        } catch (err) {
          console.error('Failed to parse network message:', err);
        }
      };

      setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });
  }

  send<T>(type: string, payload: T): void {
    const message: NetworkMessage = {
      type,
      payload,
      timestamp: performance.now(),
      sequence: this.sequence++,
    };

    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      this.sendQueue.push(message);
    }
  }

  on<T>(type: string, handler: MessageHandler<T>): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler as MessageHandler);
    return () => this.handlers.get(type)?.delete(handler as MessageHandler);
  }

  private dispatch(message: NetworkMessage): void {
    const handlers = this.handlers.get(message.type);
    if (handlers) {
      for (const handler of handlers) handler(message.payload);
    }
  }

  private emit(type: string, payload: unknown): void {
    this.dispatch({ type, payload, timestamp: Date.now(), sequence: -1 });
  }

  private flushQueue(): void {
    while (this.sendQueue.length > 0) {
      const msg = this.sendQueue.shift()!;
      this.ws?.send(JSON.stringify(msg));
    }
  }

  private startPing(): void {
    this.pingInterval = setInterval(() => {
      this.lastPingTime = performance.now();
      this.send('ping', { timestamp: this.lastPingTime });
    }, 1000);
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private onPong(serverTimestamp: number): void {
    const rtt = performance.now() - this.lastPingTime;
    this.latency.current = rtt / 2;
    this.latency.history.push(rtt);
    if (this.latency.history.length > 20) this.latency.history.shift();
    this.latency.average = this.latency.history.reduce((a, b) => a + b) / this.latency.history.length / 2;
  }

  private reconnectAttempts = 0;
  private async attemptReconnect(url: string): Promise<void> {
    if (this.reconnectAttempts >= 5) {
      console.error('Max reconnect attempts reached');
      return;
    }
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      await this.connect(url);
      this.reconnectAttempts = 0;
    } catch {
      this.attemptReconnect(url);
    }
  }

  disconnect(): void {
    this.stopPing();
    this.ws?.close(1000, 'Client disconnect');
    this.ws = null;
    this.connected = false;
  }
}
```

## Client-Side Prediction and Reconciliation

```typescript
// Lock-step multiplayer with client-side prediction
// Player inputs are applied immediately locally, then sent to server
// Server sends authoritative state; client reconciles

interface PlayerInput {
  sequence: number;
  timestamp: number;
  moveX: number;
  moveZ: number;
  jump: boolean;
  yaw: number;
}

interface ServerState {
  sequence: number;   // Last processed input sequence
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
}

class PredictedPlayer {
  position = new THREE.Vector3();
  velocity = new THREE.Vector3();

  private pendingInputs: PlayerInput[] = [];
  private inputSequence = 0;
  private serverState: ServerState | null = null;
  private reconciling = false;

  // Local physics simulation (matches server)
  private applyInput(input: PlayerInput, dt: number): void {
    const speed = 5;
    const gravity = -9.81;

    // Horizontal movement
    this.velocity.x = input.moveX * speed;
    this.velocity.z = input.moveZ * speed;

    // Gravity
    if (this.position.y > 0) {
      this.velocity.y += gravity * dt;
    } else {
      this.velocity.y = 0;
      this.position.y = 0;
      if (input.jump) this.velocity.y = 5;
    }

    // Integrate
    this.position.addScaledVector(this.velocity, dt);
    this.position.y = Math.max(0, this.position.y);
  }

  processInput(input: PlayerInput, dt: number): void {
    input.sequence = this.inputSequence++;
    input.timestamp = performance.now();

    // Apply immediately (client prediction)
    this.applyInput(input, dt);

    // Store for reconciliation
    this.pendingInputs.push({ ...input });

    // Send to server
    network.send('playerInput', input);
  }

  onServerUpdate(state: ServerState): void {
    this.serverState = state;

    // Remove acknowledged inputs
    this.pendingInputs = this.pendingInputs.filter(
      (input) => input.sequence > state.sequence,
    );

    // Check prediction error
    const serverPos = new THREE.Vector3(state.position.x, state.position.y, state.position.z);
    const error = serverPos.distanceTo(this.position);

    if (error > 0.5) {
      // Large error: snap to server position and replay inputs
      this.position.copy(serverPos);
      this.velocity.set(state.velocity.x, state.velocity.y, state.velocity.z);
      this.replayInputs();
    } else if (error > 0.01) {
      // Small error: smooth correction
      this.position.lerp(serverPos, 0.3);
    }
  }

  private replayInputs(): void {
    const dt = 1 / 60;
    for (const input of this.pendingInputs) {
      this.applyInput(input, dt);
    }
  }
}
```

## Entity Interpolation (Remote Players)

```typescript
// Interpolate remote player positions for smooth rendering
// Server sends snapshots; client renders between two most recent

interface Snapshot {
  timestamp: number;
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
}

class InterpolatedEntity {
  private snapshots: Snapshot[] = [];
  private readonly maxSnapshots = 20;
  private readonly interpolationDelay = 100; // ms — stay behind by 100ms

  readonly object3D: THREE.Object3D;
  private _pos = new THREE.Vector3();
  private _rot = new THREE.Quaternion();

  constructor(object3D: THREE.Object3D) {
    this.object3D = object3D;
  }

  addSnapshot(position: THREE.Vector3, rotation: THREE.Quaternion): void {
    this.snapshots.push({
      timestamp: performance.now(),
      position: position.clone(),
      rotation: rotation.clone(),
    });

    // Trim old snapshots
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }
  }

  update(): void {
    if (this.snapshots.length < 2) return;

    // Render at interpolation delay behind "now"
    const renderTime = performance.now() - this.interpolationDelay;

    // Find the two snapshots surrounding renderTime
    let from: Snapshot | null = null;
    let to: Snapshot | null = null;

    for (let i = 0; i < this.snapshots.length - 1; i++) {
      if (this.snapshots[i].timestamp <= renderTime &&
          this.snapshots[i + 1].timestamp >= renderTime) {
        from = this.snapshots[i];
        to = this.snapshots[i + 1];
        break;
      }
    }

    if (!from || !to) {
      // Use latest snapshot if no range found
      const latest = this.snapshots[this.snapshots.length - 1];
      this.object3D.position.copy(latest.position);
      this.object3D.quaternion.copy(latest.rotation);
      return;
    }

    // Interpolation factor
    const t = (renderTime - from.timestamp) / (to.timestamp - from.timestamp);
    const clamped = Math.max(0, Math.min(1, t));

    this._pos.lerpVectors(from.position, to.position, clamped);
    this._rot.slerpQuaternions(from.rotation, to.rotation, clamped);

    this.object3D.position.copy(this._pos);
    this.object3D.quaternion.copy(this._rot);
  }
}
```

## State Synchronization

```typescript
// Sync game state across clients using delta compression
interface EntityNetState {
  id: number;
  position: [number, number, number];
  rotation: [number, number, number, number]; // Quaternion
  velocity: [number, number, number];
  health: number;
  animState: string;
}

interface WorldSnapshot {
  tick: number;
  timestamp: number;
  entities: EntityNetState[];
}

class StateSynchronizer {
  private lastSnapshot: WorldSnapshot | null = null;
  private readonly SNAPSHOT_RATE = 20; // Hz
  private readonly UPDATE_INTERVAL = 1000 / this.SNAPSHOT_RATE;
  private lastUpdateTime = 0;

  // Server-side: collect and broadcast world state
  buildSnapshot(world: World, tick: number): WorldSnapshot {
    const entities: EntityNetState[] = [];

    for (const id of world.query(world.transforms)) {
      const t = world.transforms.get(id)!;
      const v = world.velocities.get(id);
      const h = world.health.get(id);

      entities.push({
        id,
        position: [t.position.x, t.position.y, t.position.z],
        rotation: [t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w],
        velocity: v ? [v.linear.x, v.linear.y, v.linear.z] : [0, 0, 0],
        health: h ? h.current : 100,
        animState: 'idle', // Get from animation component
      });
    }

    return { tick, timestamp: Date.now(), entities };
  }

  // Client-side: apply server state
  applySnapshot(snapshot: WorldSnapshot, world: World): void {
    for (const netState of snapshot.entities) {
      if (!world.transforms.has(netState.id)) {
        // New entity — create it
        // world.create(...) + add components
        continue;
      }

      const transform = world.transforms.get(netState.id)!;
      transform.position.set(...netState.position);
      transform.rotation.set(...netState.rotation);
      transform.dirty = true;
    }

    // Remove entities not in snapshot
    // (compare IDs in snapshot vs world entities)
  }

  shouldSendUpdate(elapsed: number): boolean {
    if (elapsed - this.lastUpdateTime < this.UPDATE_INTERVAL) return false;
    this.lastUpdateTime = elapsed;
    return true;
  }
}
```

## Colyseus Integration

```bash
npm install colyseus.js
```

```typescript
import { Client, Room } from 'colyseus.js';

class ColyseusMultiplayer {
  private client: Client;
  private room: Room | null = null;

  constructor(serverUrl: string) {
    this.client = new Client(serverUrl);
  }

  async joinOrCreate<T>(roomName: string, options: Record<string, unknown> = {}): Promise<Room<T>> {
    this.room = await this.client.joinOrCreate<T>(roomName, options);
    return this.room as Room<T>;
  }

  async join<T>(roomId: string, options: Record<string, unknown> = {}): Promise<Room<T>> {
    this.room = await this.client.join<T>(roomId, options);
    return this.room as Room<T>;
  }

  send(type: string, data?: unknown): void {
    this.room?.send(type, data);
  }

  get sessionId(): string | undefined {
    return this.room?.sessionId;
  }

  leave(): void {
    this.room?.leave();
    this.room = null;
  }
}

// Usage
const multiplayer = new ColyseusMultiplayer('ws://localhost:2567');

const room = await multiplayer.joinOrCreate<GameState>('battle_room', {
  playerName: 'Player1',
});

// React to server state changes
room.state.players.onAdd = (player, sessionId) => {
  console.log(`Player joined: ${sessionId}`);
  spawnRemotePlayer(sessionId, player);
};

room.state.players.onRemove = (player, sessionId) => {
  console.log(`Player left: ${sessionId}`);
  removeRemotePlayer(sessionId);
};

// Listen to server messages
room.onMessage('hit', ({ targetId, damage }) => {
  applyDamage(targetId, damage);
});

// Send player input
function sendInput(input: PlayerInput): void {
  multiplayer.send('input', input);
}
```

## Lag Compensation (Server-Side Concept)

```typescript
// On the server: store historical world states for lag compensation
class LagCompensator {
  private history: Map<number, WorldSnapshot> = new Map();
  private readonly HISTORY_DURATION = 1000; // ms — keep 1 second of history

  recordSnapshot(tick: number, snapshot: WorldSnapshot): void {
    this.history.set(tick, snapshot);

    // Prune old history
    const cutoff = Date.now() - this.HISTORY_DURATION;
    for (const [t, snap] of this.history) {
      if (snap.timestamp < cutoff) this.history.delete(t);
    }
  }

  // Find world state at the time the client fired (accounting for their latency)
  getStateAtTime(timestamp: number): WorldSnapshot | null {
    let closest: WorldSnapshot | null = null;
    let closestDiff = Infinity;

    for (const snap of this.history.values()) {
      const diff = Math.abs(snap.timestamp - timestamp);
      if (diff < closestDiff) {
        closestDiff = diff;
        closest = snap;
      }
    }

    return closest;
  }

  // Process hitscan at historical state
  processHitscan(
    shooterPos: THREE.Vector3,
    direction: THREE.Vector3,
    clientTimestamp: number,
  ): { hit: boolean; entityId?: number } {
    const historicalState = this.getStateAtTime(clientTimestamp);
    if (!historicalState) return { hit: false };

    // Temporarily move entities to historical positions
    // Run raycast
    // Restore entities
    // Return hit result

    return { hit: false }; // Placeholder
  }
}
```
