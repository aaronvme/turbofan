// W0C-I4: one case per validateEngineDefinition check that the suite did not exercise (the
// critic's surviving mutants in src/contracts/engine.ts). Each case feeds one defect and checks
// the sentence that reports it, or feeds an edge case the contract accepts and checks that
// nothing is reported, so a check that is removed, inverted or loosened fails here.
import { describe, expect, it } from 'vitest';
import {
  casingRadiusAt,
  hubRadiusAt,
  radiusAt,
  validateEngineDefinition,
  type BladeRow,
  type CurveId,
  type EngineDefinition,
  type FlowComponent,
  type Polyline,
} from '../../../src/contracts/engine';
import { validEngine } from './fixtures/engineFixture';

type Mutator = (d: EngineDefinition) => EngineDefinition;

const pts = (...xy: readonly (readonly [number, number])[]): Polyline => ({
  points: xy.map(([x, r]) => ({ x, r })),
});

const withCurve =
  (id: CurveId, curve: Polyline): Mutator =>
  (d) => ({ ...d, flowpath: { ...d.flowpath, curves: { ...d.flowpath.curves, [id]: curve } } });

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
  (d) => ({ ...d, bladeRows: d.bladeRows.map((r) => (r.id === id ? { ...r, ...patch } : r)) });

const withDesign =
  (patch: Partial<EngineDefinition['designPoint']>): Mutator =>
  (d) => ({ ...d, designPoint: { ...d.designPoint, ...patch } });

const withLimits =
  (patch: Partial<EngineDefinition['limits']>): Mutator =>
  (d) => ({ ...d, limits: { ...d.limits, ...patch } });

const withStart =
  (patch: Partial<EngineDefinition['startSchedule']>): Mutator =>
  (d) => ({ ...d, startSchedule: { ...d.startSchedule, ...patch } });

const problems = (...mutators: Mutator[]): string[] =>
  validateEngineDefinition(mutators.reduce((d, m) => m(d), validEngine()));
const text = (...mutators: Mutator[]): string => problems(...mutators).join('\n');

function component(id: FlowComponent['id']): FlowComponent {
  const c = validEngine().flowpath.components.find((k) => k.id === id);
  if (c === undefined) throw new Error(`fixture has no ${id}`);
  return c;
}

function row(id: string): BladeRow {
  const r = validEngine().bladeRows.find((k) => k.id === id);
  if (r === undefined) throw new Error(`fixture has no row ${id}`);
  return r;
}

describe('curve helpers at their edges', () => {
  const { flowpath } = validEngine();

  it('a vertical step in a curve returns the first radius instead of NaN', () => {
    expect(radiusAt(pts([0, 1], [0, 2]), 0)).toBe(1);
  });

  it('a component range includes its ends within the 1e-9 m tolerance', () => {
    // the inlet hub is the spinner, whose nose on the axis extends it upstream as r = 0
    expect(hubRadiusAt(flowpath, component('inlet'), -2 - 1e-9)).toBe(0);
    expect(hubRadiusAt(flowpath, component('fan'), 1 + 1e-9)).toBeCloseTo(0.3, 12);
  });

  it('returns null outside the component even where the curve continues', () => {
    expect(hubRadiusAt(flowpath, component('fan'), 5)).toBeNull(); // coreInner runs to x = 10
    expect(casingRadiusAt(flowpath, component('fan'), 3)).toBeNull(); // nacelleInner runs to x = 5
  });

  it('returns null for a component naming an unknown curve', () => {
    const bogus = { ...component('fan'), hub: 'shaft', casing: 'duct' } as unknown as FlowComponent;
    expect(hubRadiusAt(flowpath, bogus, 0.5)).toBeNull();
    expect(casingRadiusAt(flowpath, bogus, 0.5)).toBeNull();
  });

  it('extends only a hub that starts on the axis, and only upstream of its nose', () => {
    const offAxis: FlowComponent = { ...component('fan'), xStart: -2, xEnd: 1 };
    expect(hubRadiusAt(flowpath, offAxis, -1)).toBeNull(); // coreInner starts at r = 0.3
    const pastTheTail: FlowComponent = { ...component('inlet'), xEnd: 0.5 };
    expect(hubRadiusAt(flowpath, pastTheTail, 0.25)).toBeNull(); // the spinner ends at x = 0
  });
});

describe('W0C-I4: validateEngineDefinition, identity and curves', () => {
  it('an empty name', () => {
    expect(text((d) => ({ ...d, name: '' }))).toMatch(/name must not be empty/);
  });

  it('accepts both rotation signs', () => {
    expect(problems((d) => ({ ...d, rotation: { lp: 1, hp: -1 } }))).toEqual([]);
    expect(problems((d) => ({ ...d, rotation: { lp: -1, hp: 1 } }))).toEqual([]);
  });

  it('a curve point with a non-finite x', () => {
    expect(text(withCurve('coreInner', pts([0, 0.3], [Number.NaN, 0.3], [10, 0.3])))).toMatch(
      /curve coreInner: point 1 x must be finite/,
    );
  });

  it('an empty curve is reported once, without a crash or a spurious axis message', () => {
    const t = text(withCurve('spinner', { points: [] }));
    expect(t).toMatch(/curve spinner: needs at least 2 points/);
    expect(t).toMatch(/spinner must end where coreInner starts/);
    expect(t).not.toMatch(/spinner must start on the axis/);
    const plug = text(withCurve('plug', { points: [] }));
    expect(plug).not.toMatch(/plug must end on the axis/);
    // the trailing-edge and nozzle-lip checks skip a side that has no points
    expect(text(withCurve('nacelleOuter', { points: [] }))).toMatch(
      /curve nacelleOuter: needs at least 2 points/,
    );
    expect(text(withCurve('coreOuter', { points: [] }))).toMatch(
      /curve coreOuter: needs at least 2 points/,
    );
  });

  it('a missing inner wall curve does not crash the wall-thickness check', () => {
    const t = text((d) => {
      const curves: Partial<Record<CurveId, Polyline>> = { ...d.flowpath.curves };
      delete curves.nacelleInner;
      return {
        ...d,
        flowpath: { ...d.flowpath, curves: curves as EngineDefinition['flowpath']['curves'] },
      };
    });
    expect(t).toMatch(/curve nacelleInner is missing/);
  });

  it('nacelle trailing edge: the two skins end at different x', () => {
    const t = text(withCurve('nacelleOuter', pts([-2, 1], [-1.5, 1.2], [5.2, 1.1])));
    expect(t).toMatch(
      /nacelle trailing edge: nacelleInner and nacelleOuter must end at the same x/,
    );
  });

  it('nacelle trailing edge: the outer skin ends below the inner one', () => {
    const t = text(withCurve('nacelleOuter', pts([-2, 1], [-1.5, 1.2], [4.9, 1.1], [5, 0.99])));
    expect(t).toMatch(/nacelle trailing edge/);
  });

  it('a knife-edge nacelle trailing edge (outer = inner) is valid', () => {
    expect(problems(withCurve('nacelleOuter', pts([-2, 1], [-1.5, 1.2], [5, 1])))).toEqual([]);
  });

  it('an inner skin running past the outer one is reported once, not as negative thickness', () => {
    const t = text(withCurve('nacelleInner', pts([-2, 1], [5, 1], [5.5, 1])));
    expect(t).toMatch(/nacelle trailing edge/);
    expect(t).not.toMatch(/nacelleOuter is inside nacelleInner/);
  });

  it('core nozzle lip: the cowl ends below the casing', () => {
    const t = text(withCurve('coreCowl', pts([1, 0.5], [1.2, 0.6], [10.9, 0.6], [11, 0.49])));
    expect(t).toMatch(/core nozzle lip: coreOuter and coreCowl must end at the same x/);
  });

  it('a knife-edge core nozzle lip (cowl = casing) is valid', () => {
    expect(
      problems(withCurve('coreCowl', pts([1, 0.5], [1.2, 0.6], [10.9, 0.6], [11, 0.5]))),
    ).toEqual([]);
  });

  it('a curve that ends exactly 1e-9 m from its neighbour still joins it', () => {
    expect(problems(withCurve('spinner', pts([-1, 0], [1e-9, 0.3])))).toEqual([]);
  });
});

describe('W0C-I4: validateEngineDefinition, components', () => {
  it('a component with an infinite end', () => {
    expect(text(withComponent('combustor', { xEnd: Number.POSITIVE_INFINITY }))).toMatch(
      /component combustor: xStart must be < xEnd/,
    );
  });

  it('an unknown hub curve, and an unknown casing curve', () => {
    expect(text(withComponent('hpc', { hub: 'shaft' as unknown as CurveId }))).toMatch(
      /component hpc: unknown hub or casing curve/,
    );
    expect(text(withComponent('hpc', { casing: 'duct' as unknown as CurveId }))).toMatch(
      /component hpc: unknown hub or casing curve/,
    );
  });

  it('a casing that does not reach back to the component start', () => {
    expect(text(withComponent('booster', { xStart: 0.9 }))).toMatch(
      /component booster: casing coreOuter does not cover \[0\.900, 2\.000\]/,
    );
  });

  it('a hub that does not cover the component start, and one that does not cover its end', () => {
    expect(text(withComponent('inlet', { hub: 'coreInner' }))).toMatch(
      /component inlet: hub coreInner does not cover \[-2\.000, 0\.000\]/,
    );
    expect(text(withComponent('exhaust', { hub: 'coreInner' }))).toMatch(
      /component exhaust: hub coreInner does not cover \[10\.000, 11\.000\]/,
    );
  });

  it('a hub that rises through the casing only at one of its own points', () => {
    const spike = withCurve(
      'coreInner',
      pts([0, 0.3], [3.4, 0.3], [3.5, 0.6], [3.6, 0.3], [10, 0.3]),
    );
    expect(text(spike)).toMatch(
      /component hpc: hub radius 0\.600 m is not below casing 0\.500 m at x=3\.500/,
    );
  });

  it('a casing that dips through the hub only at one of its own points', () => {
    const dip = withCurve(
      'coreOuter',
      pts([1, 0.5], [3.4, 0.5], [3.5, 0.25], [3.6, 0.5], [11, 0.5]),
    );
    expect(text(dip)).toMatch(
      /component hpc: hub radius 0\.300 m is not below casing 0\.250 m at x=3\.500/,
    );
  });

  it('a hub touching the casing (zero annulus height)', () => {
    const touch = withCurve(
      'coreInner',
      pts([0, 0.3], [3.4, 0.3], [3.5, 0.5], [3.6, 0.3], [10, 0.3]),
    );
    expect(text(touch)).toMatch(/component hpc: hub radius 0\.500 m is not below casing 0\.500 m/);
  });

  it('checks the component start and end planes themselves', () => {
    // the hub touches the casing only at x = 3, the transition duct's end and the HPC's start
    const atThree = withCurve(
      'coreInner',
      pts([0, 0.3], [2.9, 0.3], [3, 0.5], [3.1, 0.3], [10, 0.3]),
    );
    const t = text(atThree);
    expect(t).toMatch(
      /component transitionDuct: hub radius 0\.500 m is not below casing 0\.500 m at x=3\.000/,
    );
    expect(t).toMatch(
      /component hpc: hub radius 0\.500 m is not below casing 0\.500 m at x=3\.000/,
    );
  });
});

describe('W0C-I4: validateEngineDefinition, stations', () => {
  it('a station defined twice', () => {
    expect(
      text((d) => ({ ...d, stations: [...d.stations, { id: '3', x: 3.9, component: 'hpc' }] })),
    ).toMatch(/station 3 is defined more than once/);
  });

  it('a station in an unknown component', () => {
    expect(
      text((d) => ({
        ...d,
        stations: d.stations.map((s) =>
          s.id === '3' ? { ...s, component: 'gearbox' as unknown as FlowComponent['id'] } : s,
        ),
      })),
    ).toMatch(/station 3: unknown component "gearbox"/);
  });

  it('a missing station 2 is reported without a crash', () => {
    expect(text((d) => ({ ...d, stations: d.stations.filter((s) => s.id !== '2') }))).toMatch(
      /station 2 is missing/,
    );
  });
});

describe('W0C-I4: validateEngineDefinition, blade rows', () => {
  it('a rotor without a spool', () => {
    expect(text(withRow('hpc-r1', { spool: 'none' }))).toMatch(/row hpc-r1: a rotor needs a spool/);
  });

  it('a VSV with zero gain (a fixed vane on the ring) is valid', () => {
    expect(problems(withRow('hpc-igv', { vsv: { scheduleId: 'hpc-vsv', gain: 0 } }))).toEqual([]);
  });

  it('a row whose component hub does not cover it is skipped, not crashed on', () => {
    const t = text(withComponent('booster', { hub: 'plug' }));
    expect(t).toMatch(/component booster: hub plug does not cover/);
    expect(t).not.toMatch(/row b-s1: .*outside the annulus/);
    // even with its tip through the casing: without a hub radius there is no annulus to test
    const through = text(
      withComponent('booster', { hub: 'plug' }),
      withRow('b-s1', { leadingEdge: { hub: { x: 1.2, r: 0.3 }, tip: { x: 1.2, r: 0.55 } } }),
    );
    expect(through).not.toMatch(/row b-s1: .*outside the annulus/);
  });

  it('a blade edge below the hub', () => {
    expect(
      text(withRow('b-s1', { leadingEdge: { hub: { x: 1.2, r: 0.25 }, tip: { x: 1.2, r: 0.5 } } })),
    ).toMatch(/row b-s1: leading edge hub r=0\.250 is outside the annulus \[0\.300, 0\.500\]/);
  });

  it('applies the tip clearance to rotor tips only', () => {
    // a stator whose tip touches the casing is fine whatever tipClearance says
    expect(problems(withRow('b-s1', { tipClearance: 0.01 }))).toEqual([]);
    // a rotor with a huge clearance: only the tip is reported, never the hub
    const t = text(withRow('hpc-r1', { tipClearance: 0.25 }));
    expect(t).toMatch(/row hpc-r1: leading edge tip r=0\.490 leaves less than the tip clearance/);
    expect(t).not.toMatch(/tip r=0\.300/);
  });

  it('an edge whose hub is not below its tip', () => {
    const t = text(
      withRow('b-s1', { leadingEdge: { hub: { x: 1.2, r: 0.45 }, tip: { x: 1.2, r: 0.35 } } }),
    );
    expect(t).toMatch(/row b-s1: leading edge: hub r must be below tip r/);
    const level = text(
      withRow('b-s1', { trailingEdge: { hub: { x: 1.4, r: 0.4 }, tip: { x: 1.4, r: 0.4 } } }),
    );
    expect(level).toMatch(/row b-s1: trailing edge: hub r must be below tip r/);
  });

  it('a trailing edge level with the leading edge', () => {
    expect(
      text(withRow('b-s1', { trailingEdge: { hub: { x: 1.2, r: 0.3 }, tip: { x: 1.4, r: 0.5 } } })),
    ).toMatch(/row b-s1: trailing edge must be downstream of the leading edge at the hub/);
  });

  it('a zero or non-finite chord at each span', () => {
    expect(text(withRow('fan', { chord: { hub: 0, mid: 0.45, tip: 0.5 } }))).toMatch(
      /row fan: chord\.hub must be finite and > 0/,
    );
    expect(text(withRow('fan', { chord: { hub: 0.4, mid: 0.45, tip: Number.NaN } }))).toMatch(
      /row fan: chord\.tip must be finite and > 0/,
    );
    expect(text(withRow('fan', { chord: { hub: 0.4, mid: 0, tip: 0.5 } }))).toMatch(
      /row fan: chord\.mid must be finite and > 0/,
    );
    expect(text(withRow('fan', { chord: { hub: 0.4, mid: Number.NaN, tip: 0.5 } }))).toMatch(
      /row fan: chord\.mid must be finite and > 0/,
    );
  });

  it('a chord exactly as long as the meridional length (zero stagger) is valid', () => {
    expect(problems(withRow('fan', { chord: { hub: 0.3, mid: 0.45, tip: 0.3 } }))).toEqual([]);
  });

  it('a metal angle of exactly 90 deg, and the thickness and lean limits', () => {
    expect(
      text(withRow('fan', { exitMetalAngle: { hub: 0, mid: Math.PI / 2, tip: 0.8 } })),
    ).toMatch(/row fan: exitMetalAngle\.mid must be finite with \|angle\| < pi\/2/);
    expect(
      text(withRow('fan', { maxThicknessRatio: { hub: 0.41, mid: 0.06, tip: 0.03 } })),
    ).toMatch(/row fan: maxThicknessRatio\.hub must be in \(0, 0\.4\]/);
    expect(
      problems(withRow('fan', { maxThicknessRatio: { hub: 0.4, mid: 0.06, tip: 0.03 } })),
    ).toEqual([]);
    expect(text(withRow('fan', { lean: -Math.PI / 4 }))).toMatch(
      /row fan: lean must be finite with \|lean\| < pi\/4/,
    );
  });

  it('a blade row with an empty id', () => {
    expect(text(withRow('b-s1', { id: '' }))).toMatch(/a blade row has an empty id/);
  });

  it('rows may be listed in any order', () => {
    expect(problems((d) => ({ ...d, bladeRows: [...d.bladeRows].reverse() }))).toEqual([]);
  });

  it('rows that touch axially do not overlap', () => {
    expect(
      problems(
        withRow('hpc-r1', {
          leadingEdge: { hub: { x: 3.4, r: 0.3 }, tip: { x: 3.4, r: 0.49 } },
          chord: { hub: 0.3, mid: 0.3, tip: 0.3 },
        }),
      ),
    ).toEqual([]);
  });

  it('rows in different components may share an axial position', () => {
    // an outlet guide vane in the bypass duct beside the booster stator (as in the real engine)
    const ogv: BladeRow = {
      ...row('b-s1'),
      id: 'ogv',
      component: 'bypassDuct',
      leadingEdge: { hub: { x: 1.25, r: 0.6 }, tip: { x: 1.25, r: 1 } },
      trailingEdge: { hub: { x: 1.45, r: 0.6 }, tip: { x: 1.45, r: 1 } },
    };
    expect(problems((d) => ({ ...d, bladeRows: [...d.bladeRows, ogv] }))).toEqual([]);
  });

  it('overlap is judged on the swept extents: first leading-edge x to last trailing-edge x', () => {
    const t = text(
      withRow('hpc-igv', { trailingEdge: { hub: { x: 3.4, r: 0.3 }, tip: { x: 3.46, r: 0.5 } } }),
      withRow('hpc-r1', {
        leadingEdge: { hub: { x: 3.45, r: 0.3 }, tip: { x: 3.5, r: 0.49 } },
        sweep: Math.atan2(0.05, 0.19),
      }),
    );
    expect(t).toMatch(/rows hpc-igv and hpc-r1 overlap \(x=3\.450 < 3\.460\)/);
  });
});

describe('W0C-I4: validateEngineDefinition, VSV schedules and bleeds', () => {
  const schedule = (id: string, points: readonly [number, number][]) => ({
    id,
    points: points.map(([n2CorrectedPercent, closure]) => ({ n2CorrectedPercent, closure })),
  });

  it('a schedule id used twice, and a one-point schedule', () => {
    const twice: Mutator = (d) => ({
      ...d,
      vsvSchedules: [
        ...d.vsvSchedules,
        schedule('hpc-vsv', [
          [60, 0.5],
          [90, 0],
        ]),
      ],
    });
    expect(text(twice)).toMatch(/VSV schedule id "hpc-vsv" is used more than once/);
    const one: Mutator = (d) => ({ ...d, vsvSchedules: [schedule('hpc-vsv', [[50, 0.6]])] });
    expect(text(one)).toMatch(/VSV schedule hpc-vsv: needs at least 2 points/);
  });

  it('a schedule that repeats a speed', () => {
    const flat: Mutator = (d) => ({
      ...d,
      vsvSchedules: [
        schedule('hpc-vsv', [
          [50, 0.6],
          [50, 0],
        ]),
      ],
    });
    expect(text(flat)).toMatch(/VSV schedule hpc-vsv: n2CorrectedPercent must increase strictly/);
  });

  it('a bleed id used twice, and a bleed in an unknown component', () => {
    const twice: Mutator = (d) => ({ ...d, bleeds: [...d.bleeds, ...d.bleeds] });
    expect(text(twice)).toMatch(/bleed id "hpc9" is used more than once/);
    const nowhere: Mutator = (d) => ({
      ...d,
      bleeds: d.bleeds.map((b) => ({
        ...b,
        component: 'gearbox' as unknown as FlowComponent['id'],
      })),
    });
    expect(text(nowhere)).toMatch(/bleed hpc9: unknown component "gearbox"/);
  });

  it('a bleed fraction of zero or below', () => {
    for (const maxFraction of [0, -0.1]) {
      const m: Mutator = (d) => ({ ...d, bleeds: d.bleeds.map((b) => ({ ...b, maxFraction })) });
      expect(text(m)).toMatch(/bleed hpc9: maxFraction must be in \(0, 1\)/);
    }
  });
});

describe('W0C-I4: validateEngineDefinition, design point, ratings, limits, start', () => {
  it.each(['bypassRatio', 't4K', 'n1Rpm', 'n2Rpm', 'netThrustN', 'fuelFlowKgPerS'] as const)(
    'designPoint.%s must be positive',
    (field) => {
      expect(text(withDesign({ [field]: 0 }))).toMatch(
        new RegExp(`designPoint\\.${field} must be finite and > 0`),
      );
    },
  );

  it.each(['takeoffThrustN', 'maxContinuousThrustN', 'flatRatingTemperatureK'] as const)(
    'ratings.%s must be positive',
    (field) => {
      expect(text((d) => ({ ...d, ratings: { ...d.ratings, [field]: -1 } }))).toMatch(
        new RegExp(`ratings\\.${field} must be finite and > 0`),
      );
    },
  );

  it('a pressure ratio of exactly 1 (no compression) is valid', () => {
    expect(
      problems(
        withDesign({
          pressureRatios: { ...validEngine().designPoint.pressureRatios, fanBypass: 1 },
        }),
      ),
    ).toEqual([]);
  });

  it('efficiencies must be in (0, 1]', () => {
    const eff = validEngine().designPoint.efficiencies;
    for (const v of [0, -0.5]) {
      expect(text(withDesign({ efficiencies: { ...eff, hpt: v } }))).toMatch(
        /designPoint\.efficiencies\.hpt must be in \(0, 1\]/,
      );
    }
    expect(problems(withDesign({ efficiencies: { ...eff, combustor: 1 } }))).toEqual([]);
  });

  it('the combustor loss must be in [0, 0.2)', () => {
    for (const v of [-0.01, 0.2]) {
      expect(text(withDesign({ combustorPressureLossFraction: v }))).toMatch(
        /combustorPressureLossFraction must be in \[0, 0\.2\)/,
      );
    }
    expect(problems(withDesign({ combustorPressureLossFraction: 0 }))).toEqual([]);
  });

  it('the turbine cooling fraction must be in [0, 0.5)', () => {
    for (const v of [-0.01, 0.5]) {
      expect(text(withDesign({ turbineCoolingFraction: v }))).toMatch(
        /turbineCoolingFraction must be in \[0, 0\.5\)/,
      );
    }
    expect(problems(withDesign({ turbineCoolingFraction: 0 }))).toEqual([]);
  });

  it('max continuous thrust may equal takeoff thrust', () => {
    expect(
      problems((d) => ({ ...d, ratings: { ...d.ratings, maxContinuousThrustN: 100_000 } })),
    ).toEqual([]);
  });

  it('the N1 limit must exceed the 100 % speed', () => {
    expect(text(withLimits({ n1MaxRpm: 5000 }))).toMatch(/limits\.n1MaxRpm \(5000\) must exceed/);
  });

  it('EGT limits must be positive and strictly increasing', () => {
    const order =
      /limits: EGT limits must satisfy start < max continuous < takeoff redline < transient/;
    expect(text(withLimits({ egtStartLimitK: -1 }))).toMatch(order); // increasing, not positive
    expect(text(withLimits({ egtStartLimitK: 0 }))).toMatch(order);
    expect(text(withLimits({ egtStartLimitK: 1198.15 }))).toMatch(order); // equal to max continuous
  });

  it('limits.egtTransientDurationS must be positive', () => {
    expect(text(withLimits({ egtTransientDurationS: 0 }))).toMatch(
      /limits\.egtTransientDurationS must be finite and > 0/,
    );
  });

  it('the EGT shunt: offset >= 0, finite fields, ramp start <= full', () => {
    const shunt = /limits\.egtShunt: need offsetK >= 0 and rampStartN2Rpm <= fullN2Rpm/;
    const sh = validEngine().limits.egtShunt;
    expect(text(withLimits({ egtShunt: { ...sh, offsetK: -5 } }))).toMatch(shunt);
    expect(text(withLimits({ egtShunt: { ...sh, offsetK: Number.NaN } }))).toMatch(shunt);
    expect(text(withLimits({ egtShunt: { ...sh, rampStartN2Rpm: Number.NaN } }))).toMatch(shunt);
    expect(text(withLimits({ egtShunt: { ...sh, fullN2Rpm: Number.POSITIVE_INFINITY } }))).toMatch(
      shunt,
    );
    expect(problems(withLimits({ egtShunt: { ...sh, offsetK: 0 } }))).toEqual([]);
    // a step instead of a ramp
    expect(problems(withLimits({ egtShunt: { ...sh, rampStartN2Rpm: 8500 } }))).toEqual([]);
  });

  it('the start schedule: one case per inequality', () => {
    const start =
      /startSchedule: need 0 < minFuelOnN2Percent <= fuelOnN2Percent < starterCutoutN2Percent < 100/;
    expect(text(withStart({ fuelOnN2Percent: Number.NaN }))).toMatch(start);
    expect(text(withStart({ minFuelOnN2Percent: 0 }))).toMatch(start);
    expect(text(withStart({ minFuelOnN2Percent: 26 }))).toMatch(start);
    expect(text(withStart({ fuelOnN2Percent: 56 }))).toMatch(start);
    expect(text(withStart({ starterCutoutN2Percent: 100 }))).toMatch(start);
    // fuel on at the earliest allowed speed
    expect(problems(withStart({ minFuelOnN2Percent: 25 }))).toEqual([]);
  });
});
