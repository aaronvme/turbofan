// The calibrator's pure logic (PHYSICS.md 3.3 CP3-CP5, L12): the knob-target pairings, the
// log-space integral trim around the feedforward, L12's check and CP4's steadiness form.
import { describe, expect, it } from 'vitest';
import type { FlowTargets, ReducedStation, StationReduction } from '../../../../src/contracts/flow';
import {
  SOLVER_REDUCTION_STATIONS,
  type SolverReductionStationId,
} from '../../../../src/contracts/stations';
import { THRESHOLDS } from '../../../../src/contracts/thresholds';
import {
  PAIRINGS,
  TRIM_LIMIT,
  ZERO_TRIM,
  couplingStateOf,
  feedforward,
  knobsFrom,
  l12Check,
  pairingError,
  steadyWithin,
  trimFromErrors,
  trimStep,
} from '../../../../src/flow/coupling/calibrator';
import { KNOB_IDS, UNIT_KNOBS } from '../../../../src/flow/coupling/knobs';

const L12 = THRESHOLDS.L12.values;

function station(w: number, pt: number, tt: number, swirl = 0): ReducedStation {
  return {
    massFlowKgPerS: w,
    ptMassAvgPa: pt,
    ttMassAvgK: tt,
    psAreaAvgPa: pt,
    swirlAngleMassAvgRad: swirl,
    areaM2: 1,
  };
}

/** Targets with every station at W 100 kg/s, Pt 2e5 Pa, Tt 500 K (T4 1700 K). */
const TARGETS: FlowTargets = {
  timeS: 0,
  n1RadPerS: 500,
  n2RadPerS: 1500,
  fuelFlowKgPerS: 1,
  vsvClosureRad: 0,
  ambient: { pressurePa: 101325, temperatureK: 288.15, machNumber: 0 },
  stations: Object.fromEntries(
    SOLVER_REDUCTION_STATIONS.map((id) => [
      id,
      { ptPa: 2e5, ttK: id === '4' ? 1700 : 500, wKgPerS: 100, fuelAirRatio: 0 },
    ]),
  ) as FlowTargets['stations'],
};
const THRUST = 1e5;

function reduction(
  f: (id: SolverReductionStationId) => ReducedStation,
  thrust = THRUST,
): StationReduction {
  return {
    iteration: 0,
    stations: Object.fromEntries(SOLVER_REDUCTION_STATIONS.map((id) => [id, f(id)])) as Record<
      SolverReductionStationId,
      ReducedStation
    >,
    grossThrustN: thrust,
    lpTorqueNm: 0,
    hpTorqueNm: 0,
  };
}

const onTarget = reduction((id) => station(100, 2e5, id === '4' ? 1700 : 500));

describe('the pairings', () => {
  it('pairs every knob with one target of its own, in the knob order', () => {
    expect(PAIRINGS.map((p) => p.knob)).toEqual([...KNOB_IDS]);
    const keys = PAIRINGS.map((p) => `${p.station}/${p.kind}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('measures W, Pt and Tt in log space and the swirl in radians against 0', () => {
    const r = reduction((id) => station(id === '13' ? 101 : 100, 2e5, 500, id === '13' ? -0.1 : 0));
    const w13 = PAIRINGS.find((p) => p.station === '13' && p.kind === 'W');
    const s13 = PAIRINGS.find((p) => p.station === '13' && p.kind === 'swirl');
    if (w13 === undefined || s13 === undefined) throw new Error('pairings');
    expect(pairingError(w13, r, TARGETS)).toBeCloseTo(Math.log(1.01), 14);
    expect(pairingError(s13, r, TARGETS)).toBeCloseTo(-0.1, 14);
  });
});

describe('the log-space integral trim', () => {
  it('moves each knob against its signed error, stays put on target, and is clamped', () => {
    expect(trimStep(ZERO_TRIM, onTarget, TARGETS)).toEqual(ZERO_TRIM);
    const hot = reduction((id) => station(100, 2e5, id === '13' ? 510 : id === '4' ? 1700 : 500));
    const t = trimStep(ZERO_TRIM, hot, TARGETS);
    const fanTip = PAIRINGS.find((p) => p.knob === 'fanTip');
    expect(fanTip?.kind).toBe('Tt');
    // T13 too high: the fan tip's turning comes down (its sensitivity is positive)
    expect(t.logTrim.fanTip).toBeLessThan(0);
    for (const k of KNOB_IDS) if (k !== 'fanTip') expect(t.logTrim[k]).toBe(0);
    let s = ZERO_TRIM;
    for (let n = 0; n < 1000; n++) s = trimStep(s, hot, TARGETS);
    expect(s.logTrim.fanTip).toBe(-TRIM_LIMIT);
    const k = knobsFrom({ ...UNIT_KNOBS, fanTip: 2 }, s);
    expect(k.fanTip).toBeCloseTo(2 * Math.exp(-TRIM_LIMIT), 14);
    expect(k.hpcLoss).toBe(1);
  });

  it('converges a coupled model plant without a limit cycle (CP4 logic, not the field)', () => {
    // a static plant in log space: e_i = offset_i + s_i (0.8 trim_i + 0.25 trim_(i+1)), each
    // pairing's own sensitivity sign s_i and a 0.25 coupling to the next pairing's knob
    const n = PAIRINGS.length;
    const offset = PAIRINGS.map((_, i) => 0.15 * Math.sin(1.7 * i + 0.3));
    let s = ZERO_TRIM;
    const history: { iteration: number; errors: number[] }[] = [];
    for (let step = 0; step < 400; step++) {
      const e = PAIRINGS.map((p, i) => {
        const next = PAIRINGS[(i + 1) % n]?.knob ?? p.knob;
        return (offset[i] ?? NaN) + p.sign * (0.8 * s.logTrim[p.knob] + 0.25 * s.logTrim[next]);
      });
      history.push({ iteration: 10 * step, errors: e.map(Math.abs) });
      s = trimFromErrors(s, e);
    }
    const tol = PAIRINGS.map(() => 1e-3);
    const first = history.findIndex((h) => h.errors.every((v, i) => v <= (tol[i] ?? 0)));
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(30); // < 300 iterations at a reduction every 10
    expect(steadyWithin(history, tol, history[first]?.iteration ?? 0, 2000)).toBe(true);
  });
});

describe('the feedforward table', () => {
  const table = [
    { n1c: 20, n2c: 60, knobs: { ...UNIT_KNOBS, hpcRotor: 0.5 } },
    { n1c: 100, n2c: 100, knobs: { ...UNIT_KNOBS, hpcRotor: 2 } },
  ];
  it('interpolates log K along the working line by N2c, held beyond its ends', () => {
    expect(feedforward(table, 60, 80).hpcRotor).toBeCloseTo(1, 14);
    expect(feedforward(table, 0, 40).hpcRotor).toBe(0.5);
    expect(feedforward(table, 0, 120).hpcRotor).toBe(2);
    expect(feedforward([], 0, 80)).toEqual(UNIT_KNOBS);
  });
});

describe("L12's check and the coupling state (CP5)", () => {
  it('holds only with every station flow within 0.5 %, T4 within 10 K and the thrust within 2 %', () => {
    expect(l12Check(onTarget, TARGETS, THRUST).holds).toBe(true);
    expect(couplingStateOf(l12Check(onTarget, TARGETS, THRUST))).toBe('coupled');
    expect(couplingStateOf(null)).toBe('calibrating');
    const w = 100 * (1 + 1.01 * L12.maxStationFlowRelativeError.value);
    const flow = l12Check(
      reduction((id) => station(id === '45' ? w : 100, 2e5, id === '4' ? 1700 : 500)),
      TARGETS,
      THRUST,
    );
    expect(flow.holds).toBe(false);
    expect(couplingStateOf(flow)).toBe('calibrating');
    const t4 = l12Check(
      reduction((id) => station(100, 2e5, id === '4' ? 1711 : 500)),
      TARGETS,
      THRUST,
    );
    expect(t4.t4ErrorK).toBeCloseTo(11, 9);
    expect(t4.holds).toBe(false);
    const thrust = l12Check(
      onTarget,
      TARGETS,
      THRUST / (1 + 1.01 * L12.maxThrustRelativeError.value),
    );
    expect(thrust.holds).toBe(false);
    const edge = l12Check(
      reduction((id) => station(100, 2e5, id === '4' ? 1709.9 : 500)),
      TARGETS,
      THRUST,
    );
    expect(edge.holds).toBe(true);
  });

  it("reads CP4's steadiness: inside, with a spread at most a tenth of each tolerance", () => {
    const steady = Array.from({ length: 300 }, (_, k) => ({
      iteration: 10 * k,
      errors: [1e-4, 2e-4],
    }));
    expect(steadyWithin(steady, [1e-3, 1e-3], 0, 2000)).toBe(true);
    const cycle = steady.map((h, k) => ({ ...h, errors: [1e-4 + (k % 2) * 2e-4, 2e-4] }));
    expect(steadyWithin(cycle, [1e-3, 1e-3], 0, 2000)).toBe(false);
    const out = steady.map((h, k) => ({ ...h, errors: [k === 100 ? 2e-3 : 1e-4, 2e-4] }));
    expect(steadyWithin(out, [1e-3, 1e-3], 0, 2000)).toBe(false);
    // the window must be covered
    expect(steadyWithin(steady.slice(0, 50), [1e-3, 1e-3], 0, 2000)).toBe(false);
  });
});
