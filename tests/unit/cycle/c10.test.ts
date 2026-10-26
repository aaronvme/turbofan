import { describe, expect, it } from 'vitest';
import { THRESHOLDS } from '../../../src/contracts/thresholds';
import { factValue } from '../../../src/engine/facts';
import {
  REFERENCE_ENGINE,
  displayedEgt,
  solveSteady,
  type OperatingConditions,
  type SteadySolution,
} from '../../../src/cycle/engine';

// C10 (D3-3): the measured on-wing ground run, [WIDURI] Table 7 (OAT 25 C, 1008 hPa). The model
// runs at each measured N1 and must show the measured N2 within +-1.5 points and the displayed EGT
// within +-30 K (idle: inside the measured 466-493 C range widened by 30 K on each side). The
// measured values are ENGINE_FACTS rows; the tolerances are thresholds.ts (PHYSICS.md 3.2).
const C10 = THRESHOLDS.C10.values;
const E = REFERENCE_ENGINE;
const run: OperatingConditions = {
  ambient: {
    temperatureK: factValue('runUpOat'),
    pressurePa: factValue('runUpPressure'),
    machNumber: 0,
  },
  // the ground run's bleed and accessory loads (ENGINE_FACTS "Ground-run loads")
  customerBleedFraction: factValue('groundRunCustomerBleed'),
  powerExtractionW: factValue('groundRunAccessoryLoad'),
};

interface Point {
  readonly name: string;
  readonly n1: number;
  readonly n2: number;
  readonly egtLowK: number;
  readonly egtHighK: number;
}
const idleLow = factValue('idleEgtLow');
const idleHigh = factValue('idleEgtHigh');
const POINTS: readonly Point[] = [
  {
    name: 'takeoff',
    n1: factValue('staticTakeoffN1'),
    n2: factValue('staticTakeoffN2'),
    egtLowK: factValue('staticTakeoffEgt'),
    egtHighK: factValue('staticTakeoffEgt'),
  },
  {
    name: 'MPA',
    n1: factValue('mpaN1'),
    n2: factValue('mpaN2'),
    egtLowK: factValue('mpaEgt'),
    egtHighK: factValue('mpaEgt'),
  },
  {
    name: 'ground idle, position 2',
    n1: factValue('idleN1High'),
    n2: factValue('idleN2High'),
    egtLowK: idleLow,
    egtHighK: idleHigh,
  },
  {
    name: 'ground idle, position 1',
    n1: factValue('idleN1Low'),
    n2: factValue('idleN2Low'),
    egtLowK: idleLow,
    egtHighK: idleHigh,
  },
];

// continuation from the design point down through the measured N1s (each solve warm-starts the next)
const solved = new Map<string, SteadySolution>();
let s = solveSteady(E, run, { kind: 'fuelFlow', value: E.calibration.fuelFlowKgPerS });
for (const p of POINTS) {
  for (const n1 of [90, 80, 70, 55, 45, 35, 28, 24]) {
    if (n1 < s.point.n1Percent && n1 > p.n1) {
      s = solveSteady(E, run, { kind: 'n1Percent', value: n1 }, s.unknowns);
    }
  }
  s = solveSteady(E, run, { kind: 'n1Percent', value: p.n1 }, s.unknowns);
  solved.set(p.name, s);
}

describe('C10 (D3-3): the measured ground-run points, WIDURI Table 7', () => {
  it.each(POINTS)('$name: converged at the measured N1', (p) => {
    const r = solved.get(p.name);
    expect(r?.converged).toBe(true);
    expect(r?.point.n1Percent ?? 0).toBeCloseTo(p.n1, 6);
  });
  it.each(POINTS)(`$name: N2 within ${C10.maxN2ErrorPoints.token} of the measured value`, (p) => {
    const n2 = solved.get(p.name)?.point.n2Percent ?? Infinity;
    expect(Math.abs(n2 - p.n2)).toBeLessThanOrEqual(C10.maxN2ErrorPoints.value);
  });
  it.each(POINTS)(
    `$name: displayed EGT within ${C10.maxEgtErrorK.token} of the measured value`,
    (p) => {
      const r = solved.get(p.name);
      const egt = r === undefined ? Infinity : displayedEgt(E, r.point);
      expect(egt).toBeGreaterThanOrEqual(p.egtLowK - C10.maxEgtErrorK.value);
      expect(egt).toBeLessThanOrEqual(p.egtHighK + C10.maxEgtErrorK.value);
    },
  );
});
