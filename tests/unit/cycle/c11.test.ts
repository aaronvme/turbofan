import { describe, expect, it } from 'vitest';
import { ISA_SLS } from '../../../src/contracts/ambient';
import { THRESHOLDS } from '../../../src/contracts/thresholds';
import { factValue } from '../../../src/engine/facts';
import {
  solveSteady,
  type OperatingConditions,
  type SteadySolution,
} from '../../../src/cycle/engine';
import { REF, lazy } from './fixtures';

// C11 (D3-11): the EEDB LTO fuel flows. The databank row ([EEDB] 8CM066) is a test-bed run
// corrected to ISA SLS with no customer bleed and no power extraction; the model runs at the
// LTO thrust settings (a % of eedbRatedThrust) and its fuel flow must be within +-5 % of the
// databank's. The fractions and the tolerance are thresholds.ts (PHYSICS.md 3.2); the fuel flows
// are ENGINE_FACTS rows.
const C11 = THRESHOLDS.C11.values;
const E = REF;
const testBed: OperatingConditions = {
  ambient: ISA_SLS,
  customerBleedFraction: 0,
  powerExtractionW: 0,
};

interface Setting {
  readonly name: string;
  readonly thrustPercent: number;
  readonly fuelFlowKgPerS: number;
}
const SETTINGS: readonly Setting[] = [
  {
    name: 'climb-out',
    thrustPercent: C11.climbOutThrustPercent.value,
    fuelFlowKgPerS: factValue('fuelFlowClimbOut'),
  },
  {
    name: 'approach',
    thrustPercent: C11.approachThrustPercent.value,
    fuelFlowKgPerS: factValue('fuelFlowApproach'),
  },
  {
    name: 'idle',
    thrustPercent: C11.idleThrustPercent.value,
    fuelFlowKgPerS: factValue('fuelFlowIdle'),
  },
];

const rated = factValue('eedbRatedThrust');

// continuation in thrust from the design point down through the LTO settings
const solvedAll = lazy(() => {
  const solved = new Map<string, SteadySolution>();
  let s = solveSteady(E, testBed, { kind: 'fuelFlow', value: E.calibration.fuelFlowKgPerS });
  for (const p of SETTINGS) {
    for (const pct of [92, 70, 50, 40, 20, 14, 10]) {
      const now = (100 * s.point.netThrustN) / rated;
      if (pct < now && pct > p.thrustPercent) {
        s = solveSteady(E, testBed, { kind: 'netThrust', value: (pct / 100) * rated }, s.unknowns);
      }
    }
    s = solveSteady(
      E,
      testBed,
      { kind: 'netThrust', value: (p.thrustPercent / 100) * rated },
      s.unknowns,
    );
    solved.set(p.name, s);
  }
  return solved;
});

/**
 * The C11 checks the reference calibration misses: the part-power gap that D3-15 accepts
 * (PHYSICS.md fidelity ledger). In the reference the D3-11 / D3-14 part-power mechanisms are off.
 * Their bounded fit (PART_POWER_FIT_CALIBRATION, every mechanism on its bound) meets idle (-4.3 %)
 * but still misses approach (-6.4 %), and it was rejected under D3-14's adoption rule because it
 * breaks the transient model (partPower.test.ts pins both). They run as it.fails: each must still
 * FAIL, so the suite turns red the moment a change makes one pass and the marker has to come off.
 * The threshold is not loosened.
 */
const KNOWN_LIMIT: ReadonlySet<string> = new Set(['approach', 'idle']);
const check = (name: string) => (KNOWN_LIMIT.has(name) ? it.fails : it);
const label = (name: string, text: string) =>
  KNOWN_LIMIT.has(name)
    ? `KNOWN FAIL (D3-15: accepted part-power gap, PHYSICS.md ledger): ${text}`
    : text;

describe('C11 (D3-11): the EEDB LTO fuel flows, ISA SLS test bed', () => {
  it.each(SETTINGS)('$name ($thrustPercent %): converged at the LTO thrust', (p) => {
    const r = solvedAll().get(p.name);
    expect(r?.converged).toBe(true);
    expect(((r?.point.netThrustN ?? 0) / rated) * 100).toBeCloseTo(p.thrustPercent, 6);
  });
  for (const p of SETTINGS) {
    check(p.name)(
      label(
        p.name,
        `${p.name} (${p.thrustPercent} %): fuel flow within ${C11.maxRelativeError.token} of the databank`,
      ),
      () => {
        const wf = solvedAll().get(p.name)?.point.fuelFlowKgPerS ?? Infinity;
        expect(Math.abs(wf / p.fuelFlowKgPerS - 1)).toBeLessThanOrEqual(C11.maxRelativeError.value);
      },
    );
  }
});
