import { describe, expect, it } from 'vitest';
import { GameModel, type Entity } from '../src/game/model';

const entity = (kind: Entity['kind'], lane = 0, z = 3): Entity => ({ id: 999, kind, lane, z, hit: false });
const advance = (model: GameModel, seconds: number) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) model.update(1 / 60);
};

describe('GameModel', () => {
  it('starts with a safe approach and resets a run while retaining the record', () => {
    const model = new GameModel(400, () => 0.4);
    expect(model.state.phase).toBe('menu');
    model.start();
    expect(model.state.entities.every((item) => item.z === -140)).toBe(true);
    advance(model, 2);
    expect(model.state.health).toBe(3);
    model.state.best = 900;
    model.state.health = 1;
    model.start('hard');
    expect(model.state).toMatchObject({ phase: 'playing', best: 900, health: 3, score: 0, energy: 100, lane: 0, speed: 40 });
  });

  it('ignores invalid time and caps long gaps', () => {
    const model = new GameModel();
    model.start();
    for (const dt of [0, -1, NaN, Infinity]) expect(model.update(dt)).toEqual([]);
    expect(model.state.distance).toBe(0);
    model.update(30);
    expect(model.state.elapsed).toBeCloseTo(0.25);
    expect(model.state.distance).toBeLessThan(9);
  });

  it('pauses simulation and boost, then resumes without resetting', () => {
    const model = new GameModel();
    model.start();
    model.setBoost(true);
    model.pause();
    const before = structuredClone(model.state);
    model.update(0.25);
    model.steer(1);
    expect(model.state).toEqual(before);
    expect(model.state.boosting).toBe(false);
    model.resume();
    model.update(0.1);
    expect(model.state.distance).toBeGreaterThan(0);
  });

  it('smooths lane changes and clamps at the track edges', () => {
    const model = new GameModel();
    model.start();
    model.steer(1);
    model.steer(1);
    model.update(1 / 60);
    expect(model.state.lane).toBe(1);
    expect(model.state.playerX).toBeGreaterThan(0);
    expect(model.state.playerX).toBeLessThan(3.2);
    advance(model, 1);
    expect(model.state.playerX).toBeCloseTo(3.2, 3);
  });

  it('collects only the matching lane and awards combo and energy once', () => {
    const model = new GameModel();
    model.start();
    model.state.energy = 50;
    model.state.entities = [entity('crystal'), entity('crystal', 1)];
    const events = model.update(0.1);
    expect(events.filter((event) => event.type === 'collect')).toEqual([{ type: 'collect', value: 100 }]);
    expect(model.state).toMatchObject({ combo: 1, crystals: 1 });
    expect(model.state.energy).toBeGreaterThan(58);
    expect(model.update(0.1).some((event) => event.type === 'collect')).toBe(false);
  });

  it('catches an obstacle swept across the player in a long frame', () => {
    const model = new GameModel();
    model.start('hard');
    model.setBoost(true);
    model.state.entities = [entity('barrier', 0, -3)];
    expect(model.update(0.25).some((event) => event.type === 'hit')).toBe(true);
    expect(model.state.health).toBe(2);
  });

  it('does not damage the player in a different lane', () => {
    const model = new GameModel();
    model.start();
    model.state.entities = [entity('barrier', -1), entity('barrier', 1)];
    expect(model.update(0.25)).toEqual([]);
    expect(model.state.health).toBe(3);
  });

  it('grants hit immunity, then ends the run on the third separated hit', () => {
    const model = new GameModel();
    model.start();
    model.state.entities = [entity('barrier'), { ...entity('barrier'), id: 1000 }];
    expect(model.update(0.1).filter((event) => event.type === 'hit')).toHaveLength(1);
    expect(model.state.health).toBe(2);
    for (let hit = 0; hit < 2; hit++) {
      model.state.entities = [];
      advance(model, 1.5);
      model.state.entities = [entity('barrier')];
      const events = model.update(0.1);
      if (hit === 1) expect(events.some((event) => event.type === 'gameover')).toBe(true);
    }
    expect(model.state).toMatchObject({ health: 0, phase: 'gameover', combo: 0, boosting: false });
    const score = model.state.score;
    expect(model.update(0.25)).toEqual([]);
    expect(model.state.score).toBe(score);
  });

  it('drains boost, requires release after exhaustion, and regenerates energy', () => {
    const model = new GameModel();
    model.start();
    model.state.entities = [];
    model.setBoost(true);
    model.update(0.25);
    expect(model.state.speed).toBeGreaterThan(49);
    expect(model.state.energy).toBeCloseTo(92);
    model.state.energy = 0.2;
    model.update(1 / 60);
    expect(model.state.boosting).toBe(false);
    advance(model, 1);
    expect(model.state.energy).toBeGreaterThan(16);
    expect(model.state.boosting).toBe(false);
    model.setBoost(false);
    model.setBoost(true);
    model.update(1 / 60);
    expect(model.state.boosting).toBe(true);
  });

  it('generates fair rows with distinct barriers and collectible escape lanes', () => {
    let seed = 13;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const model = new GameModel(0, random);
    model.start('hard');
    const observed = new Set<number>();
    for (let frame = 0; frame < 3600; frame++) {
      model.state.health = 3;
      model.update(1 / 60);
      const rows = new Map<string, Entity[]>();
      for (const item of model.state.entities) {
        observed.add(item.id);
        const key = item.z.toFixed(4);
        rows.set(key, [...(rows.get(key) ?? []), item]);
      }
      for (const row of rows.values()) {
        const barriers = row.filter((item) => item.kind === 'barrier');
        expect(barriers.length).toBeLessThan(3);
        expect(new Set(barriers.map((item) => item.lane)).size).toBe(barriers.length);
        for (const crystal of row.filter((item) => item.kind === 'crystal')) {
          expect(barriers.some((barrier) => barrier.lane === crystal.lane)).toBe(false);
        }
      }
    }
    expect(observed.size).toBeGreaterThan(100);
    expect(model.state.entities.length).toBeLessThan(25);
  });
});
