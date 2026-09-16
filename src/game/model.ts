/** The simulation is independent of Three.js, the DOM, and wall-clock time. */
export type Phase = 'menu' | 'playing' | 'paused' | 'gameover';
export type Difficulty = 'normal' | 'hard';
export type Entity = {
  id: number;
  kind: 'barrier' | 'crystal';
  lane: number;
  z: number;
  hit: boolean;
};
export type GameEvent = {
  type: 'collect' | 'hit' | 'gameover' | 'milestone';
  value?: number;
};
export type GameState = {
  phase: Phase;
  score: number;
  best: number;
  distance: number;
  speed: number;
  health: number;
  energy: number;
  combo: number;
  lane: number;
  playerX: number;
  boosting: boolean;
  elapsed: number;
  entities: Entity[];
  crystals: number;
};

const LANE_WIDTH = 3.2;
const PLAYER_Z = 5;
const MAX_FRAME = 0.25;
const STEP = 1 / 60;

export class GameModel {
  public state: GameState;
  private readonly random: () => number;
  private difficulty: Difficulty = 'normal';
  private nextId = 1;
  private rowDistance = 0;
  private pickupScore = 0;
  private invulnerable = 0;
  private boostRequested = false;
  private boostExhausted = false;
  private milestone = 1000;

  constructor(best = 0, random: () => number = Math.random) {
    this.random = random;
    this.state = this.freshState(Number.isFinite(best) ? Math.max(0, Math.floor(best)) : 0);
  }

  private freshState(best: number): GameState {
    return {
      phase: 'menu', score: 0, best, distance: 0, speed: 32,
      health: 3, energy: 100, combo: 0, lane: 0, playerX: 0,
      boosting: false, elapsed: 0, entities: [], crystals: 0,
    };
  }

  start(difficulty: Difficulty = 'normal'): void {
    this.difficulty = difficulty;
    this.state = this.freshState(this.state.best);
    this.state.phase = 'playing';
    this.state.speed = difficulty === 'hard' ? 40 : 32;
    this.nextId = 1;
    this.rowDistance = 0;
    this.pickupScore = 0;
    this.invulnerable = 0;
    this.boostRequested = false;
    this.boostExhausted = false;
    this.milestone = 1000;
    this.spawnRow(-140);
  }

  steer(direction: -1 | 1): void {
    if (this.state.phase !== 'playing') return;
    this.state.lane = Math.max(-1, Math.min(1, this.state.lane + direction));
  }

  setBoost(active: boolean): void {
    this.boostRequested = active && this.state.phase === 'playing';
    if (!active) this.boostExhausted = false;
    this.state.boosting = this.boostRequested && !this.boostExhausted && this.state.energy > 0;
  }

  pause(): void {
    if (this.state.phase !== 'playing') return;
    this.state.phase = 'paused';
    this.setBoost(false);
  }

  resume(): void {
    if (this.state.phase === 'paused') this.state.phase = 'playing';
  }

  goToMenu(): void {
    this.state.phase = 'menu';
    this.setBoost(false);
  }

  /** Ignore invalid deltas and cap background-tab gaps to prevent surprise deaths. */
  update(dt: number): GameEvent[] {
    if (this.state.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return [];
    const events: GameEvent[] = [];
    let remaining = Math.min(dt, MAX_FRAME);
    while (remaining > 1e-8 && this.state.phase === 'playing') {
      const step = Math.min(STEP, remaining);
      this.tick(step, events);
      remaining -= step;
    }
    return events;
  }

  private tick(dt: number, events: GameEvent[]): void {
    const s = this.state;
    s.elapsed += dt;
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    const oldX = s.playerX;
    s.playerX += (s.lane * LANE_WIDTH - s.playerX) * (1 - Math.exp(-13 * dt));

    s.boosting = this.boostRequested && !this.boostExhausted && s.energy > 0;
    if (s.boosting) {
      s.energy = Math.max(0, s.energy - 32 * dt);
      if (s.energy === 0) {
        this.boostExhausted = true;
        s.boosting = false;
      }
    } else {
      s.energy = Math.min(100, s.energy + 17 * dt);
    }
    const baseSpeed = Math.min(70, (this.difficulty === 'hard' ? 40 : 32) + s.distance * 0.013);
    s.speed = baseSpeed * (s.boosting ? 1.55 : 1);
    const travel = s.speed * dt;
    s.distance += travel;
    this.rowDistance += travel;
    const spacing = this.difficulty === 'hard' ? 32 : 39;
    if (this.rowDistance >= spacing) {
      this.rowDistance -= spacing;
      this.spawnRow(-140 + this.rowDistance);
    }

    for (const entity of s.entities) {
      const oldZ = entity.z;
      entity.z += travel;
      if (entity.hit) continue;
      const depth = entity.kind === 'barrier' ? 1.65 : 1.2;
      const width = entity.kind === 'barrier' ? 1.32 : 0.88;
      // Interpolate player position over the portion of this step overlapping the
      // entity's depth. This catches swept collisions and allows late dodges.
      const enter = Math.max(0, (PLAYER_Z - depth - oldZ) / travel);
      const leave = Math.min(1, (PLAYER_Z + depth - oldZ) / travel);
      if (enter > leave || enter > 1 || leave < 0) continue;
      const xAtEnter = oldX + (s.playerX - oldX) * enter;
      const xAtLeave = oldX + (s.playerX - oldX) * leave;
      const entityX = entity.lane * LANE_WIDTH;
      if (Math.max(xAtEnter, xAtLeave) < entityX - width ||
          Math.min(xAtEnter, xAtLeave) > entityX + width) continue;
      entity.hit = true;
      if (entity.kind === 'crystal') {
        s.crystals += 1;
        s.combo += 1;
        const reward = 80 + Math.min(s.combo, 5) * 20;
        this.pickupScore += reward;
        s.energy = Math.min(100, s.energy + 8);
        events.push({ type: 'collect', value: reward });
      } else if (this.invulnerable === 0) {
        s.health -= 1;
        s.combo = 0;
        s.energy = Math.max(0, s.energy - 8);
        this.invulnerable = 1.3;
        events.push({ type: 'hit', value: s.health });
        if (s.health <= 0) {
          s.phase = 'gameover';
          this.setBoost(false);
          break;
        }
      }
    }

    s.entities = s.entities.filter((entity) => entity.z <= 15);
    s.score = Math.floor(s.distance * 2 + this.pickupScore);
    s.best = Math.max(s.best, s.score);
    while (s.score >= this.milestone) {
      events.push({ type: 'milestone', value: this.milestone });
      this.milestone += 1000;
    }
    if (s.phase === 'gameover') events.push({ type: 'gameover', value: s.score });
  }

  private roll(): number {
    const value = this.random();
    return Number.isFinite(value) ? Math.max(0, Math.min(0.999999, value)) : 0.5;
  }

  private spawnRow(z: number): void {
    const available = [-1, 0, 1];
    const obstacleCount = this.state.distance > 300 && this.roll() < (this.difficulty === 'hard' ? 0.6 : 0.35) ? 2 : 1;
    for (let i = 0; i < obstacleCount; i += 1) {
      const [lane] = available.splice(Math.floor(this.roll() * available.length), 1);
      this.state.entities.push({ id: this.nextId++, kind: 'barrier', lane, z, hit: false });
    }
    if (this.roll() < 0.85) {
      const lane = available[Math.floor(this.roll() * available.length)];
      this.state.entities.push({ id: this.nextId++, kind: 'crystal', lane, z, hit: false });
    }
  }
}
