// W1C-I4: the gas path away from static, no-bleed, no-extraction conditions, and the pieces the
// critic's mutants showed were unpinned (free stream, bleed, extraction, VBV, choked bypass
// pressure thrust, the design residual, the nozzle throat, the surge margin, the shunt ramp).
import { describe, expect, it } from 'vitest';
import { THRESHOLDS } from '../../../src/contracts/thresholds';
import type { AmbientConditions } from '../../../src/contracts/ambient';
import { factValue } from '../../../src/engine/facts';
import { ENGINE_DEFINITION } from '../../../src/engine/definition';
import { enthalpy, entropyFunction, gamma, gasConstant } from '../../../src/thermo/gas';
import {
  balances,
  egtShunt,
  evaluateGasPath,
  nozzle,
  solveSteady,
  surgeMargins,
  type OperatingConditions,
  type SteadySolution,
} from '../../../src/cycle/engine';
import { compressorPoint, surgeMargin } from '../../../src/cycle/componentMaps';
import { at } from '../../../src/cycle/at';
import { REF, lazy } from './fixtures';

const E = REF;
const C7 = THRESHOLDS.C7.values;
const C8 = THRESHOLDS.C8.values;
const SLS: AmbientConditions = { temperatureK: 288.15, pressurePa: 101325, machNumber: 0 };
const clean = (ambient: AmbientConditions): OperatingConditions => ({
  ambient,
  customerBleedFraction: 0,
  powerExtractionW: 0,
});

function expectC7C8(s: SteadySolution): void {
  expect(s.converged).toBe(true);
  expect(s.maxResidual).toBeLessThan(C7.maxRelativeResidual.value);
  expect(s.iterations).toBeLessThanOrEqual(C7.maxNewtonIterations.value);
  const b = balances(s.point);
  expect(Math.abs(b.mass)).toBeLessThan(C8.maxRelativeImbalance.value);
  expect(Math.abs(b.energy)).toBeLessThan(C8.maxRelativeImbalance.value);
}

describe('W1C-I4: customer bleed, power extraction and VBV (C7, C8)', () => {
  const loaded: OperatingConditions = {
    ...clean(SLS),
    customerBleedFraction: 0.05,
    powerExtractionW: 150e3,
    vbvFraction: 0.15,
  };
  const pair = lazy(() => ({
    base: solveSteady(E, clean(SLS), { kind: 'n1Percent', value: 70 }),
    s: solveSteady(E, loaded, { kind: 'n1Percent', value: 70 }),
  }));
  it('converges from the design guess and closes the books with bleed in them', () => {
    const { base, s } = pair();
    expectC7C8(base);
    expectC7C8(s);
    const p = s.point;
    // the bleed leaves at HPC exit: 5 % of the HPC inlet flow is in the mass books
    const wBleed = 0.05 * p.stations['25'].wKgPerS;
    expect(p.mass.inKgPerS - p.mass.outKgPerS).toBeCloseTo(0, 9);
    expect(p.mass.outKgPerS - (p.stations['8'].wKgPerS + p.stations['18'].wKgPerS)).toBeCloseTo(
      wBleed,
      6,
    );
  });
  it('the VBV dumps its fraction of the booster flow into the bypass stream', () => {
    const { s } = pair();
    const p = s.point;
    const w21 = p.stations['21'].wKgPerS;
    expect(p.vbvFlowKgPerS).toBeCloseTo(0.15 * w21, 9);
    expect(p.stations['25'].wKgPerS).toBeCloseTo(0.85 * w21, 9);
    expect(p.stations['18'].wKgPerS).toBeCloseTo(p.stations['13'].wKgPerS + 0.15 * w21, 9);
  });
  it('bleed and extraction cost fuel and heat the core at the same N1; the extraction is in the HP balance', () => {
    const { base, s } = pair();
    expect(s.point.fuelFlowKgPerS).toBeGreaterThan(1.05 * base.point.fuelFlowKgPerS);
    expect(s.point.stations['4'].ttK).toBeGreaterThan(base.point.stations['4'].ttK + 20);
    const p = s.point;
    const net = p.power.hpt - p.mechanicalLossW.hp - p.power.hpc - 150e3;
    expect(p.netPowerHpW).toBeCloseTo(net, 6);
    expect(Math.abs(p.netPowerHpW)).toBeLessThan(1e-6 * p.power.hpt);
  });
  it('surge margins stay positive and the HPC margin is pinned at this point', () => {
    const { s } = pair();
    const m = surgeMargins(E, s.point);
    expect(m.hpc).toBeGreaterThan(0.2);
    expect(m.fan).toBeGreaterThan(0.1);
    // regression pin (this commit): 0.331 HPC, 0.182 fan
    expect(m.hpc).toBeCloseTo(0.331, 2);
    expect(m.fan).toBeCloseTo(0.182, 2);
  });
});

describe('W1C-I4: flight Mach > 0 (free stream, ram drag)', () => {
  const m25: AmbientConditions = { ...SLS, machNumber: 0.25 };
  const mach = lazy(() => solveSteady(E, clean(m25), { kind: 'n1Percent', value: 95 }));
  it('C7 and C8 at Mach 0.25', () => {
    expectC7C8(mach());
  });
  it('the inlet sees the isentropic free-stream totals and the net thrust carries the ram drag', () => {
    const s = mach();
    const p = s.point;
    const t0 = m25.temperatureK;
    const v0 = 0.25 * Math.sqrt(gamma(t0, 0) * gasConstant(0) * t0);
    const tt = p.stations['2'].ttK;
    // energy: h(Tt) = h(T0) + V0^2 / 2; isentropic: s(Tt) - s(T0) = R ln(Pt / p0)
    expect(enthalpy(tt, 0) - enthalpy(t0, 0)).toBeCloseTo(0.5 * v0 * v0, 3);
    const ptRatio = Math.exp((entropyFunction(tt, 0) - entropyFunction(t0, 0)) / gasConstant(0));
    expect(p.stations['2'].ptPa / m25.pressurePa).toBeCloseTo(ptRatio, 9);
    expect(p.grossThrustN - p.netThrustN).toBeCloseTo(p.totalAirflowKgPerS * v0, 6);
  });
});

describe('W1C-I4: cruise, 35,000 ft ISA, Mach 0.8 (both nozzles choked)', () => {
  const cruise: AmbientConditions = { temperatureK: 218.81, pressurePa: 23842, machNumber: 0.8 };
  // continuation from SLS, as the engine climbs; solved on first use (D2-15)
  const flight = lazy(() => {
    let s = solveSteady(E, clean(SLS), { kind: 'n1Percent', value: 85 });
    for (let k = 1; k <= 8; k++) {
      const f = k / 8;
      const ambient = {
        temperatureK: 288.15 + f * (cruise.temperatureK - 288.15),
        pressurePa: 101325 * Math.pow(cruise.pressurePa / 101325, f),
        machNumber: 0.8 * f,
      };
      s = solveSteady(E, clean(ambient), { kind: 'n1Percent', value: 85 + 5 * f }, s.unknowns);
    }
    const climb = solveSteady(
      E,
      clean(cruise),
      { kind: 'netThrust', value: factValue('maxClimbThrust') },
      s.unknowns,
    );
    return { s, climb };
  });
  it('C7 and C8 at cruise and at the published max climb thrust', () => {
    const { s, climb } = flight();
    expectC7C8(s);
    expectC7C8(climb);
    expect(climb.point.coreNozzleChoked).toBe(true);
    expect(climb.point.bypassNozzleChoked).toBe(true);
  });
  it('gross thrust = sum of W V + (p - p0) A over both nozzles, pressure thrust included', () => {
    const { climb } = flight();
    const p = climb.point;
    const p0 = cruise.pressurePa;
    const st = p.stations;
    const core = nozzle(st['8'].ptPa, st['8'].ttK, st['8'].fuelAirRatio, p0);
    const byp = nozzle(st['18'].ptPa, st['18'].ttK, 0, p0);
    const a8 = E.design.coreNozzleAreaM2;
    const a18 = E.design.bypassNozzleAreaM2;
    const pressureThrust = (core.staticPressure - p0) * a8 + (byp.staticPressure - p0) * a18;
    expect(byp.staticPressure).toBeGreaterThan(p0);
    expect(pressureThrust).toBeGreaterThan(0.05 * p.grossThrustN);
    const fg = st['8'].wKgPerS * core.velocity + st['18'].wKgPerS * byp.velocity + pressureThrust;
    expect(p.grossThrustN).toBeCloseTo(fg, 4);
  });
  it('validation: OPR at max climb thrust vs the published 32.7 (FICHE), within 1 %', () => {
    const { climb } = flight();
    // not a PHYSICS.md threshold: an independent published point the model was not fitted to
    // (32.63 at this commit)
    const opr = climb.point.overallPressureRatio;
    expect(Math.abs(opr / factValue('overallPressureRatioMaxClimb') - 1)).toBeLessThan(0.01);
  });
});

describe('W1C-I4: the gas path at the design unknowns is the sizing cycle', () => {
  it('max |residual| < 1e-9 at the design speeds, fuel flow and unknowns', () => {
    const cal = E.calibration;
    const p = evaluateGasPath(
      E,
      clean(cal.ambient),
      cal.n1Rpm,
      cal.n2Rpm,
      cal.fuelFlowKgPerS,
      E.design.unknowns,
    );
    expect(Math.max(...p.residuals.map(Math.abs))).toBeLessThan(1e-9);
    expect(Math.abs(p.netPowerHpW / p.power.hpt)).toBeLessThan(1e-9);
    expect(Math.abs(p.netPowerLpW / p.power.lpt)).toBeLessThan(1e-9);
    // the cooling flow is the calibrated fraction of the HPC inlet flow
    const w25 = p.stations['25'].wKgPerS;
    const wComb = p.stations['4'].wKgPerS - p.fuelFlowKgPerS;
    expect((w25 - wComb) / w25).toBeCloseTo(cal.turbineCoolingFraction, 12);
  });
});

describe('W1C-I4: the nozzle throat against an independent thermally perfect search', () => {
  /** Mass flux p V / (R T) maximised over the static temperature (golden section). */
  function maxFlux(pt: number, tt: number, far: number): number {
    const r = gasConstant(far);
    const flux = (t: number) => {
      const p = pt * Math.exp((entropyFunction(t, far) - entropyFunction(tt, far)) / r);
      return (p / (r * t)) * Math.sqrt(2 * (enthalpy(tt, far) - enthalpy(t, far)));
    };
    let a = 0.6 * tt;
    let b = 0.99 * tt;
    const g = (Math.sqrt(5) - 1) / 2;
    for (let i = 0; i < 200; i++) {
      const c = b - g * (b - a);
      const d = a + g * (b - a);
      if (flux(c) > flux(d)) b = d;
      else a = c;
    }
    return flux(0.5 * (a + b));
  }
  it.each([
    [3e5, 950, 0.02],
    [2.2e5, 330, 0],
    [8e5, 1600, 0.06],
  ])('choked at pt %d Pa, Tt %d K, FAR %d: flux is the maximum', (pt, tt, far) => {
    const n = nozzle(pt, tt, far, 1e4);
    expect(n.choked).toBe(true);
    expect(Math.abs(n.flux / maxFlux(pt, tt, far) - 1)).toBeLessThan(1e-9);
    // sonic at the throat
    const ts = tt - (n.velocity * n.velocity) / (2 * 1100);
    expect(ts).toBeGreaterThan(0);
  });
  it('unchoked: expands to ambient; at or below ambient: no flow', () => {
    const n = nozzle(1.2e5, 330, 0, 1.01325e5);
    expect(n.choked).toBe(false);
    expect(n.staticPressure).toBe(1.01325e5);
    expect(nozzle(1e5, 330, 0, 1.01325e5).flux).toBe(0);
  });
});

describe('W1C-I4: surge margin on a hand-computed map point', () => {
  it('HPC: a point at the stall-line flow of the 0.9 speed node, one unit of PR below it', () => {
    const s = E.maps.hpc;
    const m = s.map;
    const i = m.nc.indexOf(0.9);
    const wc = s.wcScale * at(at(m.wc, i), 0);
    const prSurge = 1 + s.prScale * (at(at(m.pr, i), 0) - 1);
    const pr = prSurge - 1;
    // (PR_surge - PR) / PR at equal corrected flow = 1 / PR
    expect(surgeMargin(s, { correctedFlow: wc, pressureRatio: pr, efficiency: 0.8 })).toBeCloseTo(
      1 / pr,
      9,
    );
    // on the stall line itself (any speed) the margin is zero
    const stall = compressorPoint(s, 0.83, m.rlineStall);
    expect(surgeMargin(s, stall)).toBeCloseTo(0, 9);
  });
});

describe('W1C-I4: the EGT display shunt ramp (TCDS E.004 IV.1.1)', () => {
  it.each([
    [8200, 0],
    [8300, 0],
    [8400, 15],
    [8450, 22.5],
    [8500, 30],
    [9000, 30],
  ])('N2 %d rpm: +%d K', (n2, k) => {
    expect(egtShunt(ENGINE_DEFINITION, n2)).toBeCloseTo(k, 9);
  });
});
