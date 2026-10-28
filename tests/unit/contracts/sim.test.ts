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
  SNAPSHOT_ROOTS,
  FLOW_DEFAULT_ERRORS,
  FLOW_RUN_STATUSES,
  sanitizeFlowStatus,
  snapshotHasMockData,
  type FlowStatus,
  type SimClock,
  type SnapshotParts,
} from '../../../src/contracts/sim';
import type { FlowStepStats, StationReduction } from '../../../src/contracts/flow';
import { SOLVER_REDUCTION_STATIONS } from '../../../src/contracts/stations';
import { validateScenario } from '../../../src/contracts/scenario';
import { ISA_SLS } from '../../../src/contracts/ambient';
import { ENGINE_DEFINITION } from '../../../src/engine/definition';
import { mockSteadyState } from '../../../src/mocks/mockCycle';
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
    expect(findNonPlainData({ cycle: { position: v } })).toMatch(
      /^cycle\.position: class instance/,
    );
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

  it('W0C-N9: rejects non-enumerable properties and non-index keys on arrays', () => {
    // structuredClone silently drops a non-enumerable property ...
    const hidden = {};
    Object.defineProperty(hidden, 'secret', { value: 1, enumerable: false });
    expect(structuredClone(hidden)).toEqual({});
    expect(findNonPlainData({ a: hidden })).toMatch(/^a\.secret: non-enumerable property/);
    // ... and keeps extra keys on an array, where the check used to look away
    const tagged = Object.assign([1, 2], { fn: () => 1 });
    expect(() => structuredClone(tagged)).toThrow();
    expect(findNonPlainData({ list: tagged })).toMatch(/^list\.fn: non-index key on an array/);
    expect(findNonPlainData({ list: Object.assign([1], { n: Number.NaN }) })).toMatch(
      /^list\.n: non-index key on an array/,
    );
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

  it('W0C-I1: stamps version and schema even when the parts carry stale ones', () => {
    // updating one part by spreading the previous snapshot compiles (excess-property checks
    // do not apply to spread members) and used to freeze version at its old value
    const first = nextSnapshot(null, sampleSnapshotParts());
    const second = nextSnapshot(first, { ...first, lastCommandSeq: 8 });
    const third = nextSnapshot(second, { ...second, lastCommandSeq: 9 });
    expect([first.version, second.version, third.version]).toEqual([1, 2, 3]);
    expect(third.lastCommandSeq).toBe(9);
    const forged = { ...sampleSnapshotParts(), schemaVersion: 0, version: 99 } as SnapshotParts;
    const fourth = nextSnapshot(third, forged);
    expect(fourth.version).toBe(4);
    expect(fourth.schemaVersion).toBe(SIM_SCHEMA_VERSION);
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

describe('W0C-I3: snapshots carry the provenance of their data (MOCK badge under D0-2)', () => {
  const mockParts = (): SnapshotParts => ({
    ...sampleSnapshotParts(),
    cycle: mockSteadyState(ENGINE_DEFINITION, 0.5),
    sources: { cycle: 'mock', flow: 'mock' },
  });

  it('a snapshot built from the MOCK cycle says so, so the UI can label it', () => {
    const s = nextSnapshot(null, mockParts());
    expect(s.sources).toEqual({ cycle: 'mock', flow: 'mock' });
    expect(snapshotHasMockData(s)).toBe(true);
    const real = nextSnapshot(s, { ...mockParts(), sources: { cycle: 'model', flow: 'solver' } });
    expect(snapshotHasMockData(real)).toBe(false);
    const half = nextSnapshot(s, { ...mockParts(), sources: { cycle: 'model', flow: 'mock' } });
    expect(snapshotHasMockData(half)).toBe(true);
    const noFlow = nextSnapshot(s, { ...mockParts(), sources: { cycle: 'mock', flow: 'none' } });
    expect(snapshotHasMockData(noFlow)).toBe(true);
    expect(snapshotHasMockData({ ...real, sources: { cycle: 'model', flow: 'none' } })).toBe(false);
  });

  it('bumps the schema version for the new fields', () => {
    expect(SIM_SCHEMA_VERSION).toBe(2);
    expect(sampleSnapshot().schemaVersion).toBe(SIM_SCHEMA_VERSION);
  });

  it('makes sources a snapshot root that scenario paths can address', () => {
    expect(SNAPSHOT_ROOTS).toContain('sources');
    const scenario = {
      id: 'src',
      title: 'sources',
      description: '',
      initial: 'groundIdle' as const,
      ambient: ISA_SLS,
      durationS: 1,
      timeline: [],
      outcomes: [
        {
          id: 'model',
          description: 'the real cycle model is running',
          window: { kind: 'at' as const, atS: 0 },
          predicate: {
            kind: 'compare' as const,
            path: ['sources', 'cycle'],
            op: '==' as const,
            value: 'model',
          },
          thresholdId: null,
        },
      ],
    };
    expect(validateScenario(scenario, sampleSnapshot())).toEqual([]);
  });

  it('refuses a snapshot whose sources are missing or unknown', () => {
    const bad = (sources: unknown) =>
      nextSnapshot(null, { ...sampleSnapshotParts(), sources } as unknown as SnapshotParts);
    expect(() => bad(undefined)).toThrow(/sources/);
    expect(() => bad({ cycle: 'MOCK', flow: 'none' })).toThrow(/sources\.cycle "MOCK"/);
    expect(() => bad({ cycle: 'model', flow: 'gpu' })).toThrow(/sources\.flow "gpu"/);
  });
});

describe('W0C-I5: the solver has a failure channel in the snapshot', () => {
  const healthyStats: FlowStepStats = {
    iterationsThisStep: 5,
    totalIterations: 12_000,
    gpuTimeMs: 5.8,
    residualDensityL2: 3.2e-6,
    physicalTimeS: 0,
  };
  const reduction = (grossThrustN: number): StationReduction => ({
    iteration: 12_000,
    stations: Object.fromEntries(
      SOLVER_REDUCTION_STATIONS.map((id) => [
        id,
        {
          massFlowKgPerS: 50,
          ptMassAvgPa: 150_000,
          ttMassAvgK: 320,
          psAreaAvgPa: 140_000,
          swirlAngleMassAvgRad: 0,
          areaM2: 0.3,
        },
      ]),
    ) as StationReduction['stations'],
    grossThrustN,
    lpTorqueNm: -1000,
    hpTorqueNm: -2000,
  });
  const withFlow = (patch: Partial<FlowStatus>): SnapshotParts => {
    const p = sampleSnapshotParts();
    return { ...p, flow: { ...p.flow, ...patch } };
  };

  it('names the solver states', () => {
    expect([...FLOW_RUN_STATUSES]).toEqual([
      'unavailable',
      'initialising',
      'running',
      'diverged',
      'lost',
    ]);
    expect(sampleSnapshotParts().flow).toMatchObject({ status: 'running', error: null });
  });

  it('a NaN residual publishes a diverged snapshot instead of stopping publication', () => {
    const first = nextSnapshot(null, sampleSnapshotParts());
    const s = nextSnapshot(
      first,
      withFlow({ stats: { ...healthyStats, residualDensityL2: Number.NaN } }),
    );
    // the cycle (the truth) and the UI keep getting snapshots
    expect(s.version).toBe(2);
    expect(s.cycle).toEqual(first.cycle);
    expect(s.flow.status).toBe('diverged');
    expect(s.flow.error).toMatch(/stats\.residualDensityL2 is NaN/);
    expect(s.flow.stats).toEqual({ ...healthyStats, residualDensityL2: null });
  });

  it('drops a station reduction with a non-finite value and reports it', () => {
    const s = nextSnapshot(null, withFlow({ reduction: reduction(Number.POSITIVE_INFINITY) }));
    expect(s.flow).toMatchObject({ status: 'diverged', reduction: null });
    expect(s.flow.error).toMatch(/reduction\.grossThrustN is Infinity/);
    expect(s.flow.stats).toEqual(healthyStats);
    const ok = nextSnapshot(null, withFlow({ reduction: reduction(120_000) }));
    expect(ok.flow).toMatchObject({ status: 'running', error: null });
    expect(ok.flow.reduction?.grossThrustN).toBe(120_000);
  });

  it('W1F-I1: a non-finite GPU time alone is a timing glitch, not divergence', () => {
    // a stale or backwards timestamp pair (every fresh D3D12 device) gives NaN by design
    for (const gpuTimeMs of [Number.NaN, Infinity]) {
      const s = nextSnapshot(null, withFlow({ stats: { ...healthyStats, gpuTimeMs } }));
      expect(s.flow).toMatchObject({ status: 'running', error: null });
      expect(s.flow.stats).toEqual({ ...healthyStats, gpuTimeMs: null });
    }
    // with a non-finite residual as well, the residual is what diverges
    const both = nextSnapshot(
      null,
      withFlow({
        stats: { ...healthyStats, gpuTimeMs: Number.NaN, residualDensityL2: Number.NaN },
      }),
    );
    expect(both.flow.status).toBe('diverged');
    expect(both.flow.error).toMatch(/stats\.residualDensityL2 is NaN/);
    expect(both.flow.error).not.toMatch(/gpuTimeMs/);
    expect(both.flow.stats).toEqual({ ...healthyStats, gpuTimeMs: null, residualDensityL2: null });
  });

  it('drops stats whose counters are not finite', () => {
    const counters = nextSnapshot(
      null,
      withFlow({ stats: { ...healthyStats, totalIterations: Number.NaN } }),
    );
    expect(counters.flow).toMatchObject({ status: 'diverged', stats: null });
    expect(counters.flow.error).toMatch(/stats\.totalIterations is NaN/);
  });

  it('keeps a lost device (the root cause) and its message, and still drops the bad numbers', () => {
    const s = nextSnapshot(
      null,
      withFlow({
        status: 'lost',
        error: 'device lost: unknown',
        stats: { ...healthyStats, residualDensityL2: Number.NaN },
      }),
    );
    expect(s.flow).toMatchObject({ status: 'lost', error: 'device lost: unknown' });
    expect(s.flow.stats?.residualDensityL2).toBeNull();
    const diverged = sanitizeFlowStatus({
      ...sampleSnapshotParts().flow,
      status: 'diverged',
      error: 'density residual grew 1e6 x',
      stats: { ...healthyStats, residualDensityL2: Number.NaN },
    });
    expect(diverged).toMatchObject({ status: 'diverged', error: 'density residual grew 1e6 x' });
  });

  it('publishes device loss and WGSL errors as data', () => {
    const lost = nextSnapshot(
      null,
      withFlow({ status: 'lost', error: 'device lost: destroyed', stats: null, reduction: null }),
    );
    expect(lost.flow).toMatchObject({ status: 'lost', error: 'device lost: destroyed' });
    const none = nextSnapshot(
      null,
      withFlow({ status: 'unavailable', error: 'navigator.gpu is undefined', stats: null }),
    );
    expect(none.flow.status).toBe('unavailable');
  });

  it('refuses unknown states and a non-string error', () => {
    expect(() => nextSnapshot(null, withFlow({ status: 'exploded' as never }))).toThrow(
      /flow\.status "exploded"/,
    );
    expect(() => nextSnapshot(null, withFlow({ error: 42 as never }))).toThrow(/flow\.error/);
  });

  it('W1F-I1: a failure without a message gets a default one instead of stopping publication', () => {
    // GPUDeviceLostInfo.message may be empty (the spec allows it)
    const lost = nextSnapshot(null, withFlow({ status: 'lost', error: '' }));
    expect(lost.flow.status).toBe('lost');
    expect(lost.flow.error).toBe(FLOW_DEFAULT_ERRORS.lost);
    const diverged = nextSnapshot(null, withFlow({ status: 'diverged', error: null }));
    expect(diverged.flow.status).toBe('diverged');
    expect(diverged.flow.error).toBe(FLOW_DEFAULT_ERRORS.diverged);
    for (const msg of Object.values(FLOW_DEFAULT_ERRORS)) expect(msg.length).toBeGreaterThan(0);
    // a lost device with an empty message and a bad number keeps the loss as the root cause
    const both = nextSnapshot(
      null,
      withFlow({ status: 'lost', error: '', stats: { ...healthyStats, residualDensityL2: NaN } }),
    );
    expect(both.flow).toMatchObject({ status: 'lost', error: FLOW_DEFAULT_ERRORS.lost });
    expect(both.flow.stats?.residualDensityL2).toBeNull();
  });

  it('leaves a healthy status untouched and still refuses NaN in the cycle state', () => {
    const flow = sampleSnapshotParts().flow;
    expect(sanitizeFlowStatus(flow)).toBe(flow);
    const p = sampleSnapshotParts();
    expect(() => nextSnapshot(null, { ...p, cycle: { ...p.cycle, n1Rpm: Number.NaN } })).toThrow(
      /cycle\.n1Rpm: non-finite/,
    );
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
    [
      'bleed above the TCDS limit',
      { type: 'setBleed', customerBleedFraction: 0.5 },
      /customerBleedFraction/,
    ],
    ['a bad ambient', { type: 'setAmbient', ambient: { pressurePa: 1 } }, /ambient/],
    ['an unknown fault', { type: 'injectFault', fault: 'fire' }, /fault/],
    ['an unknown reset state', { type: 'reset', initial: 'cruise' }, /initial/],
    ['an unknown view mode', { type: 'setViewMode', mode: 'xray' }, /mode/],
    [
      'a bad render state',
      { type: 'setRenderState', render: { quality: 'insane' } },
      /render\.quality/,
    ],
    [
      'an unknown overlay',
      { type: 'setRenderState', render: { overlays: { lasers: true } } },
      /lasers/,
    ],
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
    expect(validateSimCommandMessage({ seq: -1, command: { type: 'stopScenario' } })[0]).toMatch(
      /seq/,
    );
    expect(validateSimCommandMessage({ seq: 1.5, command: { type: 'stopScenario' } })[0]).toMatch(
      /seq/,
    );
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
