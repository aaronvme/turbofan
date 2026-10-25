import { describe, expect, it } from 'vitest';
import {
  COMPONENT_IDS,
  CURVE_IDS,
  casingRadiusAt,
  hubRadiusAt,
  radiusAt,
  validateEngineDefinition,
  type BladeRow,
  type EngineDefinition,
  type FlowComponent,
  type Polyline,
} from '../../../src/contracts/engine';
import { validEngine } from './fixtures/engineFixture';

type Mutator = (d: EngineDefinition) => EngineDefinition;

function first<T>(items: readonly T[]): T {
  const item = items[0];
  if (item === undefined) throw new Error('fixture list is empty');
  return item;
}

const withCurve =
  (id: (typeof CURVE_IDS)[number], curve: Polyline): Mutator =>
  (d) => ({
    ...d,
    flowpath: { ...d.flowpath, curves: { ...d.flowpath.curves, [id]: curve } },
  });

const withComponent =
  (id: FlowComponent['id'], patch: Partial<FlowComponent>): Mutator =>
  (d) => ({
    ...d,
    flowpath: {
      ...d.flowpath,
      components: d.flowpath.components.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    },
  });

const withRow =
  (id: string, patch: Partial<BladeRow>): Mutator =>
  (d) => ({
    ...d,
    bladeRows: d.bladeRows.map((r) => (r.id === id ? { ...r, ...patch } : r)),
  });

function problemsAfter(mutator: Mutator): string {
  return validateEngineDefinition(mutator(validEngine())).join('\n');
}

describe('curve helpers', () => {
  const line: Polyline = {
    points: [
      { x: 0, r: 1 },
      { x: 2, r: 3 },
      { x: 3, r: 3 },
    ],
  };

  it('interpolates linearly inside the curve and returns null outside', () => {
    expect(radiusAt(line, 0)).toBe(1);
    expect(radiusAt(line, 1)).toBe(2);
    expect(radiusAt(line, 2.5)).toBe(3);
    expect(radiusAt(line, 3)).toBe(3);
    expect(radiusAt(line, -0.01)).toBeNull();
    expect(radiusAt(line, 3.01)).toBeNull();
  });

  it('treats a hub that starts on the axis as the axis upstream of its nose', () => {
    const d = validEngine();
    const inlet = d.flowpath.components.find((c) => c.id === 'inlet');
    if (!inlet) throw new Error('fixture has no inlet');
    expect(hubRadiusAt(d.flowpath, inlet, -1.5)).toBe(0); // ahead of the spinner nose
    expect(hubRadiusAt(d.flowpath, inlet, -0.5)).toBeCloseTo(0.15, 12);
    expect(casingRadiusAt(d.flowpath, inlet, -1.5)).toBe(1);
    expect(hubRadiusAt(d.flowpath, inlet, 0.5)).toBeNull(); // outside the component
  });
});

describe('validateEngineDefinition', () => {
  it('accepts the fixture', () => {
    expect(validateEngineDefinition(validEngine())).toEqual([]);
  });

  it('knows every component and curve id', () => {
    expect(COMPONENT_IDS).toHaveLength(11);
    expect(CURVE_IDS).toEqual([
      'spinner',
      'coreInner',
      'plug',
      'coreOuter',
      'coreCowl',
      'nacelleInner',
      'nacelleOuter',
    ]);
  });

  it.each<[string, Mutator, RegExp]>([
    // identity and rotation
    ['an empty id', (d) => ({ ...d, id: '' }), /id must not be empty/],
    [
      'a rotation sign that is not +-1',
      (d) => ({ ...d, rotation: { ...d.rotation, hp: 0 as unknown as 1 } }),
      /rotation\.hp/,
    ],
    // curves
    [
      'x not increasing along a curve',
      withCurve('coreInner', {
        points: [
          { x: 0, r: 0.3 },
          { x: 5, r: 0.3 },
          { x: 5, r: 0.3 },
          { x: 10, r: 0.3 },
        ],
      }),
      /curve coreInner: x must increase strictly/,
    ],
    [
      'a one-point curve',
      withCurve('plug', { points: [{ x: 10, r: 0.3 }] }),
      /curve plug: needs at least 2 points/,
    ],
    [
      'a negative radius',
      withCurve('nacelleOuter', {
        points: [
          { x: -2, r: 1 },
          { x: 5, r: -1 },
        ],
      }),
      /curve nacelleOuter: .*r must be finite and >= 0/,
    ],
    [
      'a missing curve',
      (d) => {
        const curves: Record<string, Polyline> = { ...d.flowpath.curves };
        delete curves['coreCowl'];
        return {
          ...d,
          flowpath: { ...d.flowpath, curves: curves as EngineDefinition['flowpath']['curves'] },
        };
      },
      /curve coreCowl is missing/,
    ],
    [
      'a spinner that does not start on the axis',
      withCurve('spinner', {
        points: [
          { x: -1, r: 0.05 },
          { x: 0, r: 0.3 },
        ],
      }),
      /spinner must start on the axis/,
    ],
    [
      'a plug that does not end on the axis',
      withCurve('plug', {
        points: [
          { x: 10, r: 0.3 },
          { x: 12, r: 0.1 },
        ],
      }),
      /plug must end on the axis/,
    ],
    [
      'a gap between spinner and core hub',
      withCurve('spinner', {
        points: [
          { x: -1, r: 0 },
          { x: 0, r: 0.25 },
        ],
      }),
      /spinner must end where coreInner starts/,
    ],
    [
      'a splitter where the two sides do not meet',
      withCurve('coreCowl', {
        points: [
          { x: 1, r: 0.55 },
          { x: 11, r: 0.6 },
        ],
      }),
      /splitter: coreOuter and coreCowl must start at the same point/,
    ],
    [
      'a nacelle lip that is not closed',
      withCurve('nacelleOuter', {
        points: [
          { x: -2.1, r: 1 },
          { x: 5, r: 1.1 },
        ],
      }),
      /nacelle highlight/,
    ],
    [
      'a nacelle whose outer skin dips inside the inner one',
      withCurve('nacelleOuter', {
        points: [
          { x: -2, r: 1 },
          { x: 2, r: 0.9 },
          { x: 5, r: 1.1 },
        ],
      }),
      /nacelleOuter is inside nacelleInner/,
    ],
    [
      'a core nozzle lip that does not line up',
      withCurve('coreCowl', {
        points: [
          { x: 1, r: 0.5 },
          { x: 1.2, r: 0.6 },
          { x: 11.5, r: 0.6 },
        ],
      }),
      /core nozzle lip/,
    ],
    // components
    [
      'hub above casing',
      withCurve('coreInner', {
        points: [
          { x: 0, r: 0.3 },
          { x: 3.5, r: 0.6 },
          { x: 10, r: 0.3 },
        ],
      }),
      /component hpc: hub radius .* is not below casing/,
    ],
    [
      'a casing that does not cover its component',
      withComponent('exhaust', { xEnd: 11.5 }),
      /component exhaust: casing coreOuter does not cover/,
    ],
    [
      'a component not continuing from its upstream',
      withComponent('hpc', { xStart: 3.1 }),
      /component hpc: starts at x=3\.100 but its upstream transitionDuct ends at x=3\.000/,
    ],
    [
      'an empty component',
      withComponent('combustor', { xEnd: 4 }),
      /component combustor: xStart must be < xEnd/,
    ],
    [
      'an unknown upstream',
      withComponent('lpt', { upstream: 'gearbox' as unknown as FlowComponent['id'] }),
      /component lpt: unknown upstream "gearbox"/,
    ],
    [
      'two roots',
      withComponent('fan', { upstream: null }),
      /exactly one component must have no upstream/,
    ],
    [
      'a duplicated component',
      (d) => ({
        ...d,
        flowpath: {
          ...d.flowpath,
          components: [...d.flowpath.components, first(d.flowpath.components)],
        },
      }),
      /component inlet is defined more than once/,
    ],
    [
      'a missing component',
      (d) => ({
        ...d,
        flowpath: {
          ...d.flowpath,
          components: d.flowpath.components.filter((c) => c.id !== 'hpt'),
        },
      }),
      /component hpt is missing/,
    ],
    // stations
    [
      'station 2 away from x = 0',
      (d) => ({ ...d, stations: d.stations.map((s) => (s.id === '2' ? { ...s, x: 0.01 } : s)) }),
      /station 2 must be at x = 0/,
    ],
    [
      'a station outside its component',
      (d) => ({ ...d, stations: d.stations.map((s) => (s.id === '3' ? { ...s, x: 4.5 } : s)) }),
      /station 3: x=4\.500 is outside component hpc/,
    ],
    [
      'stations out of stream order',
      (d) => ({
        ...d,
        stations: d.stations.map((s) =>
          s.id === '45' ? { ...s, x: 5.2, component: 'hpt' as const } : s,
        ),
      }),
      /station 45 .* upstream of station 41/,
    ],
    [
      'a station in the wrong stream',
      (d) => ({
        ...d,
        stations: d.stations.map((s) =>
          s.id === '13' ? { ...s, x: 1.5, component: 'booster' as const } : s,
        ),
      }),
      /station 13 is a bypass station but component booster is core/,
    ],
    [
      'a missing station',
      (d) => ({ ...d, stations: d.stations.filter((s) => s.id !== '49.5') }),
      /station 49\.5 is missing/,
    ],
    // blade rows
    [
      'a zero blade count',
      withRow('fan', { count: 0 }),
      /row fan: count must be a positive integer/,
    ],
    [
      'a fractional blade count',
      withRow('fan', { count: 24.5 }),
      /row fan: count must be a positive integer/,
    ],
    [
      'a duplicated row id',
      (d) => ({ ...d, bladeRows: [...d.bladeRows, first(d.bladeRows)] }),
      /row id "fan" is used more than once/,
    ],
    [
      'a row in an unknown component',
      withRow('fan', { component: 'gearbox' as unknown as BladeRow['component'] }),
      /row fan: unknown component "gearbox"/,
    ],
    [
      'a row outside its component',
      withRow('b-s1', {
        leadingEdge: { hub: { x: 0.9, r: 0.3 }, tip: { x: 0.9, r: 0.5 } },
      }),
      /row b-s1: leading edge hub x=0\.900 is outside component booster/,
    ],
    [
      'a blade tip through the casing',
      withRow('hpc-r1', {
        leadingEdge: { hub: { x: 3.5, r: 0.3 }, tip: { x: 3.5, r: 0.52 } },
      }),
      /row hpc-r1: leading edge tip r=0\.520 is outside the annulus/,
    ],
    [
      'a rotor without tip clearance room',
      withRow('hpc-r1', { tipClearance: 0.02 }),
      /row hpc-r1: .*tip clearance/,
    ],
    [
      'a trailing edge ahead of the leading edge',
      withRow('fan', { trailingEdge: { hub: { x: 0.1, r: 0.3 }, tip: { x: 0.5, r: 0.99 } } }),
      /row fan: trailing edge must be downstream of the leading edge at the hub/,
    ],
    [
      'overlapping rows',
      withRow('hpc-r1', {
        leadingEdge: { hub: { x: 3.35, r: 0.3 }, tip: { x: 3.35, r: 0.49 } },
      }),
      /rows hpc-igv and hpc-r1 overlap/,
    ],
    [
      'a chord shorter than the axial extent',
      withRow('fan', { chord: { hub: 0.2, mid: 0.45, tip: 0.5 } }),
      /row fan: chord\.hub/,
    ],
    [
      'a metal angle beyond 90 deg',
      withRow('fan', { inletMetalAngle: { hub: 0.5, mid: 1.6, tip: 1 } }),
      /row fan: inletMetalAngle\.mid/,
    ],
    [
      'a thickness ratio of zero',
      withRow('fan', { maxThicknessRatio: { hub: 0, mid: 0.05, tip: 0.03 } }),
      /row fan: maxThicknessRatio\.hub/,
    ],
    ['a sweep not matching the leading edge', withRow('fan', { sweep: 0.2 }), /row fan: sweep/],
    [
      'a stator on a spool',
      withRow('b-s1', { spool: 'lp' }),
      /row b-s1: a stator must have spool "none"/,
    ],
    [
      'a rotor on the wrong spool',
      withRow('hpc-r1', { spool: 'lp' }),
      /row hpc-r1: rotor spool lp does not match component hpc \(hp\)/,
    ],
    [
      'a VSV without a schedule',
      withRow('hpc-igv', { vsv: null }),
      /row hpc-igv: a VSV needs a schedule/,
    ],
    [
      'a VSV with an unknown schedule',
      withRow('hpc-igv', { vsv: { scheduleId: 'nope', gain: 1 } }),
      /row hpc-igv: unknown VSV schedule "nope"/,
    ],
    [
      'a fixed stator with a schedule',
      withRow('b-s1', { vsv: { scheduleId: 'hpc-vsv', gain: 1 } }),
      /row b-s1: only VSV rows may have a schedule/,
    ],
    // schedules, bleeds
    [
      'a schedule with decreasing speed',
      (d) => ({
        ...d,
        vsvSchedules: [
          {
            id: 'hpc-vsv',
            points: [
              { n2CorrectedPercent: 100, closure: 0 },
              { n2CorrectedPercent: 50, closure: 0.6 },
            ],
          },
        ],
      }),
      /VSV schedule hpc-vsv: n2CorrectedPercent must increase/,
    ],
    [
      'a bleed outside its component',
      (d) => ({ ...d, bleeds: [{ ...first(d.bleeds), x: 9 }] }),
      /bleed hpc9: x=9\.000 is outside component hpc/,
    ],
    [
      'a bleed fraction of 1',
      (d) => ({ ...d, bleeds: [{ ...first(d.bleeds), maxFraction: 1 }] }),
      /bleed hpc9: maxFraction/,
    ],
    // design point, ratings, limits, start
    [
      'an overall pressure ratio that is not the product',
      (d) => ({
        ...d,
        designPoint: {
          ...d.designPoint,
          pressureRatios: { ...d.designPoint.pressureRatios, overall: 32 },
        },
      }),
      /overall pressure ratio 32\.00 is not fanCore x booster x hpc = 30\.00/,
    ],
    [
      'an efficiency above 1',
      (d) => ({
        ...d,
        designPoint: {
          ...d.designPoint,
          efficiencies: { ...d.designPoint.efficiencies, hpc: 1.1 },
        },
      }),
      /designPoint\.efficiencies\.hpc/,
    ],
    [
      'a pressure ratio below 1',
      (d) => ({
        ...d,
        designPoint: {
          ...d.designPoint,
          pressureRatios: { ...d.designPoint.pressureRatios, fanBypass: 0.9 },
        },
      }),
      /designPoint\.pressureRatios\.fanBypass/,
    ],
    [
      'a zero airflow',
      (d) => ({ ...d, designPoint: { ...d.designPoint, totalAirflowKgPerS: 0 } }),
      /totalAirflowKgPerS/,
    ],
    [
      'a bad design ambient',
      (d) => ({
        ...d,
        designPoint: {
          ...d.designPoint,
          ambient: { pressurePa: 0, temperatureK: 288, machNumber: 0 },
        },
      }),
      /designPoint\.ambient/,
    ],
    [
      'max continuous above takeoff',
      (d) => ({ ...d, ratings: { ...d.ratings, maxContinuousThrustN: 120_000 } }),
      /ratings: maxContinuousThrustN must not exceed takeoffThrustN/,
    ],
    [
      'an N1 limit below 100 %',
      (d) => ({ ...d, limits: { ...d.limits, n1MaxRpm: 4000 } }),
      /limits\.n1MaxRpm/,
    ],
    [
      'a start EGT limit above the redline',
      (d) => ({ ...d, limits: { ...d.limits, egtStartLimitK: 1300 } }),
      /limits: EGT limits must satisfy start < max continuous < takeoff redline < transient/,
    ],
    [
      'a starter cut-out below fuel-on',
      (d) => ({ ...d, startSchedule: { ...d.startSchedule, starterCutoutN2Percent: 22 } }),
      /startSchedule/,
    ],
  ])('reports %s', (_name, mutator, pattern) => {
    expect(problemsAfter(mutator)).toMatch(pattern);
  });

  it('reports every problem, not only the first', () => {
    const problems = validateEngineDefinition({
      ...validEngine(),
      id: '',
      bladeRows: validEngine().bladeRows.map((r) => ({ ...r, count: -1 })),
    });
    expect(problems.length).toBeGreaterThanOrEqual(5);
  });
});
