import { describe, expect, it } from 'vitest';
import { ISA_SLS } from '../../../src/contracts/ambient';
import { ENGINE_DEFINITION } from '../../../src/engine/definition';
import {
  CYCLE_CALIBRATION,
  PART_POWER_FIT_CALIBRATION,
  W0_CALIBRATION,
  evaluateGasPath,
  referenceEngine,
  reynoldsIndex,
  sizeEngine,
  solveSteady,
  sutherlandViscosity,
  vsvFlowSensitivity,
  vsvOffsetRad,
  CO_HEATING_VALUE_J_PER_KG,
  combustionEfficiencyFromEmissions,
  combustionEfficiencyTable,
  type SizedEngine,
} from '../../../src/cycle/engine';
import { factValue } from '../../../src/engine/facts';
import { boundedLeastSquares } from '../../../src/cycle/boundedLeastSquares';
import {
  BOOSTER_RLINE_LIMIT,
  PART_POWER_LOWER,
  PART_POWER_PARAMETERS,
  PART_POWER_START,
  PART_POWER_UPPER,
  evaluatePartPower,
  partPowerResiduals,
  partPowerVector,
  withCalibration,
  withPartPower,
} from '../../../src/cycle/partPower';
import { PART_POWER_FIT } from '../../../src/cycle/partPowerFit';
import { lazy } from './fixtures';

// D3-11: the part-power calibration. The mechanisms act in the physical direction, vanish at the
// design point and stay inside their pre-set bounds; the committed values are the bounded
// least-squares optimum that tools/cycle/fit-part-power.ts found (not hand-set numbers), and
// what that optimum does to C10 and C11 is pinned here.

// a real SizedEngine (withCalibration spreads it, which the lazy REF proxy cannot provide)
const eng = (): SizedEngine => referenceEngine();
const fitted = (): number[] => PART_POWER_PARAMETERS.map((p) => PART_POWER_FIT[p.id]);
const TIMEOUT_MS = 600_000;
const OFF = [0, 0, 0, 0.2, 65, 88, 0, 0, 0, 0.04, 0.35];
const X11 = (head: readonly number[]) => [...head, ...OFF.slice(head.length)];
const testBed = { ambient: ISA_SLS, customerBleedFraction: 0, powerExtractionW: 0 };

describe('D3-11 part-power parameters and bounds', () => {
  it('every parameter has a non-empty bound and a stated reason', () => {
    expect(PART_POWER_PARAMETERS.map((p) => p.id)).toEqual(Object.keys(PART_POWER_FIT));
    for (const p of PART_POWER_PARAMETERS) {
      expect(p.lower, p.id).toBeLessThan(p.upper);
      expect(p.reason.length, p.id).toBeGreaterThan(40);
    }
    expect(PART_POWER_START).toEqual(
      PART_POWER_LOWER.map((l, i) => 0.5 * (l + (PART_POWER_UPPER[i] ?? 0))),
    );
  });

  it('the committed fit lies inside the bounds; PART_POWER_FIT_CALIBRATION carries it', () => {
    const x = fitted();
    x.forEach((v, i) => {
      expect(v).toBeGreaterThanOrEqual(PART_POWER_LOWER[i] ?? NaN);
      expect(v).toBeLessThanOrEqual(PART_POWER_UPPER[i] ?? NaN);
    });
    expect(partPowerVector(PART_POWER_FIT_CALIBRATION)).toEqual(x);
    expect(PART_POWER_FIT_CALIBRATION.egtProbeLptWorkFraction).toBe(
      PART_POWER_FIT.egtProbeLptWorkFraction,
    );
    // the VBV schedule closes 5 points or more above where it is fully open
    expect(
      PART_POWER_FIT.vbvClosedAboveN2cPercent - PART_POWER_FIT.vbvOpenBelowN2cPercent,
    ).toBeGreaterThanOrEqual(5);
  });

  it('the reference calibration keeps the mechanisms off (adopting the fit is a decision)', () => {
    const pp = CYCLE_CALIBRATION.partPower;
    expect([pp.fanEfficiencyLoss, pp.boosterEfficiencyLoss, pp.lptReynoldsExponent]).toEqual([
      0, 0, 0,
    ]);
    expect(pp.vsvOffsetRad).toEqual([0, 0, 0]);
    expect(pp.hpcReynoldsExponent).toBe(0);
    expect(CYCLE_CALIBRATION.egtProbeLptWorkFraction).toBe(0.35);
    expect(CYCLE_CALIBRATION.clearanceEfficiencyLoss.hpt).toBe(0.04);
  });

  it('withPartPower and partPowerVector are inverses; a wrong length throws', () => {
    const x = [0.035, 0.01, 0.1, 0.2, 65, 88, -0.05, 0.07, 0.1, 0.03, 0.4];
    expect(partPowerVector(withPartPower(CYCLE_CALIBRATION, x))).toEqual(x);
    expect(() => withPartPower(CYCLE_CALIBRATION, [1, 2])).toThrow(/2 values/);
  });

  it('the W0 calibration has every mechanism off', () => {
    const pp = W0_CALIBRATION.partPower;
    expect([pp.fanEfficiencyLoss, pp.boosterEfficiencyLoss, pp.lptReynoldsExponent]).toEqual([
      0, 0, 0,
    ]);
    expect(pp.vsvOffsetRad).toEqual([0, 0, 0]);
    expect(pp.vsvFlowLossPerRad).toBe(0);
  });
});

describe('D3-14 combustion efficiency from the EEDB emission indices', () => {
  it('CO heating value from the JANAF heats of formation, and the efficiency relation', () => {
    // CO + 1/2 O2 -> CO2: (393.52 - 110.53) kJ/mol / 28.01 g/mol = 10.10 MJ/kg
    expect(CO_HEATING_VALUE_J_PER_KG / 1e6).toBeCloseTo(10.103, 3);
    expect(combustionEfficiencyFromEmissions(0, 0, 4.32e7)).toBe(1);
    // 1 g of unburnt fuel per kg is 0.1 % of the fuel energy
    expect(1 - combustionEfficiencyFromEmissions(0, 1, 4.32e7)).toBeCloseTo(1e-3, 12);
  });

  it('the 8CM066 table: idle about 0.83 % below takeoff, the design point at 1', () => {
    const t = combustionEfficiencyTable(factValue('fuelLhv'));
    expect(t.correctedFuelFlowKgPerS).toEqual([0.11, 0.343, 1.031, 1.293]);
    expect(t.relativeEfficiency.at(-1)).toBe(1);
    // idle: (29.39 x 10.10 + 1.54 x 43.2) / 43200 = 0.84 % inefficiency vs 0.010 % at takeoff
    expect(1 - (t.relativeEfficiency[0] ?? 0)).toBeCloseTo(0.00831, 4);
    expect(1 - (t.relativeEfficiency[1] ?? 0)).toBeCloseTo(0.0006, 4);
    expect(CYCLE_CALIBRATION.partPower.combustion).toEqual(t);
  });
});

describe('D3-11 mechanisms', () => {
  it('VSV flow sensitivity: the IGV / rotor-1 velocity triangle of the definition', () => {
    // IGV exit 38.1 deg pre-swirl, rotor-1 inlet 57.4 deg at mid-span (definition.ts)
    const igv = ENGINE_DEFINITION.bladeRows.find((r) => r.id === 'hpc-igv');
    const r1 = ENGINE_DEFINITION.bladeRows.find((r) => r.id === 'hpc-r1');
    const a = Math.abs(igv?.exitMetalAngle.mid ?? NaN);
    const b = Math.abs(r1?.inletMetalAngle.mid ?? NaN);
    // numerical derivative of ln(c_x) = ln(U) - ln(tan b + tan a) at fixed U and b
    const h = 1e-6;
    const lnCx = (alpha: number) => -Math.log(Math.tan(b) + Math.tan(alpha));
    const k = -(lnCx(a + h) - lnCx(a - h)) / (2 * h);
    expect(vsvFlowSensitivity(ENGINE_DEFINITION)).toBeCloseTo(k, 6);
    expect(k).toBeGreaterThan(0.6);
    expect(k).toBeLessThan(0.8); // about 1.2 % of flow per degree
    expect(CYCLE_CALIBRATION.partPower.vsvFlowLossPerRad).toBe(
      vsvFlowSensitivity(ENGINE_DEFINITION),
    );
    expect(() => vsvFlowSensitivity({ ...ENGINE_DEFINITION, bladeRows: [] })).toThrow(/hpc-igv/);
  });

  it('the VSV offset is piecewise linear through its knots and zero at and above 95 % N2c', () => {
    const cal = withPartPower(CYCLE_CALIBRATION, X11([0.035, 0, 0, 0.2, 65, 88, -0.06, 0.08]));
    expect(vsvOffsetRad(cal, 40)).toBeCloseTo(-0.06, 12);
    expect(vsvOffsetRad(cal, 60)).toBeCloseTo(-0.06, 12);
    expect(vsvOffsetRad(cal, 72.5)).toBeCloseTo(0.01, 12);
    expect(vsvOffsetRad(cal, 85)).toBeCloseTo(0.08, 12);
    expect(vsvOffsetRad(cal, 90)).toBeCloseTo(0.04, 12);
    expect(vsvOffsetRad(cal, 95)).toBe(0);
    expect(vsvOffsetRad(cal, 104)).toBe(0);
  });

  it('Sutherland viscosity and the Reynolds index', () => {
    // air at 273.15 K: 1.716e-5 Pa s (the Sutherland reference value)
    expect(sutherlandViscosity(273.15)).toBeCloseTo(1.716e-5, 8);
    // halving the pressure halves the index at a fixed temperature
    expect(reynoldsIndex(5e4, 800) / reynoldsIndex(1e5, 800)).toBeCloseTo(0.5, 12);
    // hotter gas at the same pressure: lower Reynolds number
    expect(reynoldsIndex(1e5, 1200)).toBeLessThan(reynoldsIndex(1e5, 800));
  });

  it('every mechanism acts in its physical direction at a part-power point', () => {
    // one gas-path evaluation at the same unknowns, N1 62 %, mechanisms off vs on one at a time
    const off = withCalibration(eng(), withPartPower(eng().calibration, OFF));
    const s = solveSteady(off, testBed, { kind: 'n1Percent', value: 62 });
    expect(s.converged).toBe(true);
    const at = (x: readonly number[]) =>
      evaluateGasPath(
        withCalibration(eng(), withPartPower(eng().calibration, x)),
        testBed,
        s.point.n1Rpm,
        s.point.n2Rpm,
        s.point.fuelFlowKgPerS,
        s.unknowns,
      );
    const set = (i: number, v: number) => OFF.map((o, k) => (k === i ? v : o));
    const p0 = at(OFF);
    const fan = at(set(0, 0.04));
    const lpc = at(set(1, 0.04));
    const lpt = at(set(2, 0.2));
    const vsv = at(set(7, 0.1));
    const e = CYCLE_CALIBRATION.efficiencies;
    // N1 62 % is below the 0.875 knee: the full loss, as a fraction of the design efficiency
    expect(p0.fan.speedFraction).toBeLessThan(0.875);
    expect(fan.fan.point.efficiency).toBeCloseTo(
      p0.fan.point.efficiency * (1 - 0.04 / e.fanBypass),
      12,
    );
    expect(lpc.lpc.point.efficiency).toBeCloseTo(
      p0.lpc.point.efficiency * (1 - 0.04 / e.booster),
      12,
    );
    // the LPT inlet is at a far lower pressure than at design: a Reynolds lapse
    expect(lpt.lpt.point.efficiency).toBeLessThan(p0.lpt.point.efficiency - 0.005);
    // a more closed VSV passes less flow: the flow factor is below 1 by k * offset
    const n2c = (100 * s.point.n2Rpm) / CYCLE_CALIBRATION.n2ReferenceRpm;
    expect(vsv.vsvOffsetRad).toBeCloseTo(
      vsvOffsetRad(withPartPower(eng().calibration, set(7, 0.1)), n2c),
      12,
    );
    expect(vsv.vsvOffsetRad).toBeGreaterThan(0);
    expect(vsv.hpcVsvFlowFactor).toBeCloseTo(
      1 - CYCLE_CALIBRATION.partPower.vsvFlowLossPerRad * vsv.vsvOffsetRad,
      12,
    );
    expect(p0.hpcVsvFlowFactor).toBe(1);
  });

  it('none of the mechanisms acts at the design point (sizing and design match unchanged)', () => {
    const fit = sizeEngine(PART_POWER_FIT_CALIBRATION, ENGINE_DEFINITION);
    const ref = eng();
    expect(fit.design.fanBypassPressureRatio).toBeCloseTo(ref.design.fanBypassPressureRatio, 12);
    expect(fit.design.coreNozzleAreaM2).toBeCloseTo(ref.design.coreNozzleAreaM2, 12);
    expect(fit.design.point.netThrustN).toBeCloseTo(ref.design.point.netThrustN, 6);
    expect(fit.design.point.vsvOffsetRad).toBe(0);
    expect(fit.design.point.vbvFlowKgPerS).toBe(0);
    expect(fit.design.point.fan.point.efficiency).toBeCloseTo(
      ref.design.point.fan.point.efficiency,
      12,
    );
    expect(fit.design.point.lpt.point.efficiency).toBeCloseTo(
      ref.design.point.lpt.point.efficiency,
      12,
    );
    expect(Math.max(...fit.design.point.residuals.map(Math.abs))).toBeLessThan(1e-9);
  });
});

describe('D3-11 fit', { timeout: TIMEOUT_MS }, () => {
  const fitEngine = lazy(() => withCalibration(eng(), PART_POWER_FIT_CALIBRATION));
  const atFit = lazy(() => evaluatePartPower(fitEngine()));

  it('evaluates every fitted point (C11 x 3, C10 x 8, C4 x 2, the booster map guard)', () => {
    const ev = atFit();
    expect(ev.converged).toBe(true);
    expect(ev.points.map((p) => p.threshold)).toEqual([
      ...Array<string>(3).fill('C11'),
      ...Array<string>(8).fill('C10'),
      'C4',
      'C4',
      'map',
    ]);
    const guard = ev.points.at(-1);
    expect(guard?.model ?? Infinity).toBeLessThanOrEqual(BOOSTER_RLINE_LIMIT + 0.05);
  });

  it('at the bounded optimum C11 approach still misses; every C10, C11 and C4 check else passes', () => {
    // pins the D3-11 outcome reported in docs/handoffs/w1-cycle-calib-2.md: if a change makes
    // these reachable inside the bounds, this fails and the decision has to be revisited
    const MISSES = ['C11 approach fuel flow'];
    for (const p of atFit().points) {
      if (MISSES.includes(p.id)) expect(p.residual, p.id).toBeLessThan(-1);
      else expect(Math.abs(p.residual), p.id).toBeLessThanOrEqual(1);
    }
  });

  it('the committed values are the bounded optimum: more iterations from them gain nothing', () => {
    const f = (x: readonly number[]) => partPowerResiduals(eng(), x);
    const r0 = f(fitted());
    expect(r0).not.toBeNull();
    const cost0 = 0.5 * (r0 ?? []).reduce((a, v) => a + v * v, 0);
    const more = boundedLeastSquares(f, fitted(), PART_POWER_LOWER, PART_POWER_UPPER, {
      maxIterations: 2,
    });
    expect(more.cost).toBeGreaterThan(cost0 * (1 - 1e-3));
    more.x.forEach((v, i) => {
      const width = (PART_POWER_UPPER[i] ?? 0) - (PART_POWER_LOWER[i] ?? 0);
      expect(Math.abs(v - (fitted()[i] ?? NaN)), PART_POWER_PARAMETERS[i]?.id).toBeLessThan(
        0.01 * width,
      );
    });
  });
});
