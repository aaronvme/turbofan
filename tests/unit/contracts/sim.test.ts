import { describe, expect, it } from 'vitest';
import {
  MAX_WALL_STEP_S,
  SIM_COMMAND_TYPES,
  SIM_SCHEMA_VERSION,
  TIME_SCALE_MAX,
  TIME_SCALE_MIN,
  advanceClock,
  deepFreeze,
  findNonPlainData,
  nextSnapshot,
  validateSimCommand,
  validateSimCommandMessage,
  type SimClock,
} from '../../../src/contracts/sim';
import { SAMPLE_COMMANDS, sampleSnapshot, sampleSnapshotParts } from './fixtures/snapshotFixture';

describe('the sim/UI boundary is structured-clone-safe plain data (D0-2)', () => {
  it('round-trips a full snapshot through structuredClone unchanged', () => {
    const snap = sampleSnapshot();
    expect(findNonPlainData(snap)).toBeNull();
    expect(structuredClone(snap)).toEqual(snap);
  });

  it('round-trips every command type through structuredClone unchanged', () => {
    expect(new Set(SAMPLE_COMMANDS.map((c) => c.type))).toEqual(new Set(SIM_COMMAND_TYPES));
    for (const command of SAMPLE_COMMANDS) {
      expect(findNonPlainData(command)).toBeNull();
      expect(structuredClone(command)).toEqual(command);
      expect(validateSimCommand(command)).toEqual([]);
    }
  });

  it('round-trips a frozen snapshot (the clone is a plain, unfrozen copy)', () => {
    const frozen = nextSnapshot(null, sampleSnapshotParts());
    const clone = structuredClone(frozen);
    expect(clone).toEqual(frozen);
    expect(Object.isFrozen(clone)).toBe(false);
  });

  it('rejects class instances, which structuredClone would silently strip to plain objects', () => {
    class Vec {
      constructor(
        readonly x: number,
        readonly y: number,
      ) {}
      length(): number {
        return Math.hypot(this.x, this.y);
      }
    }
    const v = new Vec(3, 4);
    // why the check exists: the clone loses the prototype (and its methods) without an error
    expect(Object.getPrototypeOf(structuredClone(v))).toBe(Object.prototype);
    expect(findNonPlainData({ cycle: { position: v } })).toMatch(/^cycle\.position: class instance/);
    expect(findNonPlainData([1, new Date(0)])).toMatch(/^\[1\]: class instance \(Date\)/);
    expect(findNonPlainData(new Map())).toMatch(/class instance \(Map\)/);
  });

  it('rejects functions, which structuredClone refuses', () => {
    const withFn = { onUpdate: () => 1 };
    expect(() => structuredClone(withFn)).toThrow();
    expect(findNonPlainData(withFn)).toMatch(/^onUpdate: function/);
    expect(findNonPlainData({ a: [{ b: Math.max }] })).toMatch(/^a\[0\]\.b: function/);
  });

  const sparse = new Array<number>(3);
  sparse[0] = 1;
  sparse[2] = 3;

  it.each<[string, unknown, RegExp]>([
    ['a symbol', { s: Symbol('x') }, /^s: symbol/],
    ['a bigint', { n: 1n }, /^n: bigint/],
    ['NaN', { t: Number.NaN }, /^t: non-finite number/],
    ['Infinity', { t: [Infinity] }, /^t\[0\]: non-finite number/],
    ['a sparse array', { a: sparse }, /^a\[1\]: hole in array/],
  ])('rejects %s', (_name, value, pattern) => {
    expect(findNonPlainData(value)).toMatch(pattern);
  });

  it('rejects reference cycles', () => {
    const a: Record<string, unknown> = { x: 1 };
    a['self'] = a;
    expect(findNonPlainData(a)).toMatch(/^self: cycle/);
  });

  it('accepts null, primitives, prototype-less objects and undefined optional fields', () => {
    const bare = Object.create(null) as Record<string, unknown>;
    bare['k'] = 'v';
    expect(findNonPlainData(null)).toBeNull();
    expect(findNonPlainData('text')).toBeNull();
    expect(findNonPlainData({ a: undefined, b: [true, false, 0, -1.5], c: bare })).toBeNull();
  });

  it('allows shared (non-cyclic) references', () => {
    const shared = { v: 1 };
    expect(findNonPlainData({ a: shared, b: shared })).toBeNull();
  });
});

describe('snapshots are immutable and versioned', () => {
  it('starts at version 1 and increments from the previous snapshot', () => {
    const first = nextSnapshot(null, sampleSnapshotParts());
    expect(first.version).toBe(1);
    expect(first.schemaVersion).toBe(SIM_SCHEMA_VERSION);
    const second = nextSnapshot(first, sampleSnapshotParts());
    expect(second.version).toBe(2);
  });

  it('deep-freezes the snapshot so the UI cannot mutate sim state', () => {
    const snap = nextSnapshot(null, sampleSnapshotParts());
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.cycle.stations['4'])).toBe(true);
    expect(Object.isFrozen(snap.scenario.outcomes)).toBe(true);
    expect(() => {
      (snap.cycle as { n1Rpm: number }).n1Rpm = 0;
    }).toThrow(TypeError);
  });

  it('refuses to publish parts that are not plain data', () => {
    const parts = sampleSnapshotParts();
    const bad = { ...parts, clock: { ...parts.clock, simTimeS: Number.NaN } };
    expect(() => nextSnapshot(null, bad)).toThrow(/clock\.simTimeS: non-finite number/);
  });

  it('deepFreeze returns the same object and handles shared references', () => {
    const shared = { v: [1, 2] };
    const obj = { a: shared, b: shared };
    expect(deepFreeze(obj)).toBe(obj);
    expect(Object.isFrozen(obj.a.v)).toBe(true);
  });
});

describe('SimCommand validation (messages crossing a thread boundary are untrusted)', () => {
  it.each<[string, unknown, RegExp]>([
    ['a non-object', 42, /command must be an object/],
    ['an unknown type', { type: 'warp' }, /unknown command type "warp"/],
    ['a missing type', {}, /unknown command type/],
    ['a lever above 1', { type: 'setThrottle', lever: 1.2 }, /lever/],
    ['a NaN lever', { type: 'setThrottle', lever: Number.NaN }, /lever/],
    ['a non-boolean starter', { type: 'start', engage: 'yes' }, /engage/],
    ['a non-boolean cutoff', { type: 'cutoff' }, /cutoff/],
    ['an unknown ignition mode', { type: 'ignition', mode: 'max' }, /mode/],
    ['bleed above the TCDS limit', { type: 'setBleed', customerBleedFraction: 0.5 }, /customerBleedFraction/],
    ['a bad ambient', { type: 'setAmbient', ambient: { pressurePa: 1 } }, /ambient/],
    ['an unknown fault', { type: 'injectFault', fault: 'fire' }, /fault/],
    ['an unknown reset state', { type: 'reset', initial: 'cruise' }, /initial/],
    ['an unknown view mode', { type: 'setViewMode', mode: 'xray' }, /mode/],
    ['a bad render state', { type: 'setRenderState', render: { quality: 'insane' } }, /render\.quality/],
    ['an unknown overlay', { type: 'setRenderState', render: { overlays: { lasers: true } } }, /lasers/],
    ['a zero time scale', { type: 'setTimeScale', scale: 0 }, /scale/],
    ['a time scale above max', { type: 'setTimeScale', scale: TIME_SCALE_MAX * 2 }, /scale/],
    ['a non-boolean pause', { type: 'pause', paused: 1 }, /paused/],
    ['a zero step', { type: 'stepFrame', dtS: 0 }, /dtS/],
    ['a step longer than the wall-step clamp', { type: 'stepFrame', dtS: 5 }, /dtS/],
    ['an unknown solver mode', { type: 'setSolverMode', mode: 'fast' }, /mode/],
    ['an empty scenario id', { type: 'runScenario', scenarioId: '' }, /scenarioId/],
  ])('rejects %s', (_name, command, pattern) => {
    const problems = validateSimCommand(command);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join('\n')).toMatch(pattern);
  });

  it('validates the message envelope and its sequence number', () => {
    expect(validateSimCommandMessage({ seq: 0, command: { type: 'stopScenario' } })).toEqual([]);
    expect(validateSimCommandMessage({ seq: -1, command: { type: 'stopScenario' } })[0]).toMatch(/seq/);
    expect(validateSimCommandMessage({ seq: 1.5, command: { type: 'stopScenario' } })[0]).toMatch(/seq/);
    expect(validateSimCommandMessage({ seq: 3, command: { type: 'nope' } }).join()).toMatch(/nope/);
    expect(validateSimCommandMessage(null)[0]).toMatch(/message must be an object/);
  });
});

describe('SimClock', () => {
  const running: SimClock = { simTimeS: 10, timeScale: 1, paused: false };

  it('advances sim time by wall time times the time scale', () => {
    const { clock, simDtS } = advanceClock({ ...running, timeScale: 0.5 }, 0.02);
    expect(simDtS).toBeCloseTo(0.01, 12);
    expect(clock.simTimeS).toBeCloseTo(10.01, 12);
  });

  it('does not advance while paused', () => {
    const { clock, simDtS } = advanceClock({ ...running, paused: true }, 0.02);
    expect(simDtS).toBe(0);
    expect(clock.simTimeS).toBe(10);
  });

  it('clamps long wall steps (tab switches) and ignores negative ones', () => {
    expect(advanceClock(running, 3).simDtS).toBe(MAX_WALL_STEP_S);
    expect(advanceClock(running, -1).simDtS).toBe(0);
    expect(advanceClock(running, Number.NaN).simDtS).toBe(0);
  });

  it('spans physical-time slow motion (about 2000x) up to a modest fast-forward', () => {
    expect(TIME_SCALE_MIN).toBeLessThanOrEqual(1 / 2000);
    expect(TIME_SCALE_MAX).toBeGreaterThanOrEqual(2);
  });

  it('does not mutate the input clock', () => {
    const before = { ...running };
    advanceClock(running, 0.016);
    expect(running).toEqual(before);
  });
});
