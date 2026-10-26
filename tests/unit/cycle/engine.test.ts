import { describe, expect, it } from 'vitest';
import { THRESHOLDS } from '../../../src/contracts/thresholds';
import { ISA_SLS } from '../../../src/contracts/ambient';
import { factValue } from '../../../src/engine/facts';
import { ENGINE_DEFINITION } from '../../../src/engine/definition';
import { casingRadiusAt, hubRadiusAt } from '../../../src/contracts/engine';
import {
  CYCLE_CALIBRATION,
  REFERENCE_ENGINE,
  balances,
  displayedEgt,
  evaluateGasPath,
  groundIdle,
  sizeEngine,
  solveSteady,
  type SteadySolution,
} from '../../../src/cycle/engine';
import { newton } from '../../../src/cycle/newton';

const rel = (a: number, b: number) => Math.abs(a / b - 1);
const C7 = THRESHOLDS.C7.values;
const engine = REFERENCE_ENGINE;
const dp = engine.design;

describe('Newton solver', () => {
  it('solves a coupled nonlinear system to the C7 residual', () => {
    const r = newton(
      (x) => [(x[0] ?? 0) ** 2 + (x[1] ?? 0) - 3, (x[0] ?? 0) - (x[1] ?? 0) ** 3 + 1],
      [1, 1],
      { tolerance: C7.maxRelativeResidual.value, maxIterations: 50, maxStep: [0.5, 0.5] },
    );
    expect(r.converged).toBe(true);
    expect(r.maxResidual).toBeLessThan(C7.maxRelativeResidual.value);
  });
  it('reports non-convergence instead of throwing', () => {
    const r = newton((x) => [(x[0] ?? 0) ** 2 + 1], [0.5], {
      tolerance: 1e-12,
      maxIterations: 5,
      maxStep: [1],
    });
    expect(r.converged).toBe(false);
    expect(r.iterations).toBe(5);
  });
});

describe('design point (D1-2): sized to the published SLS takeoff figures', () => {
  it('C1 thrust, C2 BPR/OPR/airflow, C3 TSFC within 3 %', () => {
    const p = dp.point;
    expect(rel(p.netThrustN, factValue('takeoffThrust'))).toBeLessThan(
      THRESHOLDS.C1.values.maxRelativeError.value,
    );
    expect(rel(p.bypassRatio, factValue('bypassRatio'))).toBeLessThan(
      THRESHOLDS.C2.values.maxRelativeError.value,
    );
    expect(rel(p.overallPressureRatio, factValue('overallPressureRatio'))).toBeLessThan(
      THRESHOLDS.C2.values.maxRelativeError.value,
    );
    expect(rel(p.totalAirflowKgPerS, factValue('totalAirflow'))).toBeLessThan(
      THRESHOLDS.C2.values.maxRelativeError.value,
    );
    expect(rel(p.tsfcKgPerNs ?? 0, factValue('tsfcTakeoff'))).toBeLessThan(
      THRESHOLDS.C3.values.maxRelativeError.value,
    );
  });
  it('nozzle areas are outputs: core choked at SLS takeoff, bypass not', () => {
    expect(dp.coreNozzleAreaM2).toBeGreaterThan(0);
    expect(dp.point.coreNozzleChoked).toBe(true);
    expect(dp.point.bypassNozzleChoked).toBe(false);
  });
  it('W1C-I3 / D2-2: the sized A8 and A18 are the definition nozzle areas (one source of truth)', () => {
    // the facts carry the sizing to four digits (half a unit in the last digit: 5e-4 relative at
    // most); the definition's flowpath is built from the facts
    const redo =
      'the sizing moved: redo D2-2 (coreNozzleArea / bypassNozzleArea facts, then npm run mesh)';
    expect(rel(dp.coreNozzleAreaM2, factValue('coreNozzleArea')), redo).toBeLessThan(5e-4);
    expect(rel(dp.bypassNozzleAreaM2, factValue('bypassNozzleArea')), redo).toBeLessThan(5e-4);
    const fp = ENGINE_DEFINITION.flowpath;
    const annulus = (component: string, station: string) => {
      const x = ENGINE_DEFINITION.stations.find((s) => s.id === station)?.x ?? NaN;
      const c = fp.components.find((k) => k.id === component);
      if (c === undefined) throw new Error(`no ${component}`);
      const rc = casingRadiusAt(fp, c, x) ?? NaN;
      const rh = hubRadiusAt(fp, c, x) ?? NaN;
      return Math.PI * (rc * rc - rh * rh);
    };
    expect(rel(annulus('exhaust', '8'), factValue('coreNozzleArea'))).toBeLessThan(1e-9);
    expect(rel(annulus('bypassDuct', '18'), factValue('bypassNozzleArea'))).toBeLessThan(1e-9);
  });
  it('the fan bypass pressure ratio that closes the thrust is physically plausible', () => {
    expect(dp.fanBypassPressureRatio).toBeGreaterThan(1.45);
    expect(dp.fanBypassPressureRatio).toBeLessThan(1.75);
  });
  it('W1C-N3: sizing throws instead of returning an engine whose thrust secant did not converge', () => {
    for (const k of [1.6, 2]) {
      expect(() =>
        sizeEngine(
          { ...CYCLE_CALIBRATION, netThrustN: k * CYCLE_CALIBRATION.netThrustN },
          ENGINE_DEFINITION,
        ),
      ).toThrow(/sizing/);
    }
  });
  it('sizing is deterministic and pure', () => {
    const again = sizeEngine(CYCLE_CALIBRATION, ENGINE_DEFINITION);
    expect(again.design.coreNozzleAreaM2).toBe(dp.coreNozzleAreaM2);
    expect(again.design.fanBypassPressureRatio).toBe(dp.fanBypassPressureRatio);
  });
});

describe('off-design matching', () => {
  const sls = { ambient: ISA_SLS, customerBleedFraction: 0, powerExtractionW: 0 };
  it('reproduces the design point when asked for the design fuel flow', () => {
    const s = solveSteady(engine, sls, { kind: 'fuelFlow', value: dp.point.fuelFlowKgPerS });
    expect(s.converged).toBe(true);
    expect(rel(s.point.netThrustN, dp.point.netThrustN)).toBeLessThan(1e-6);
    expect(rel(s.point.n1Rpm, dp.point.n1Rpm)).toBeLessThan(1e-6);
    expect(rel(s.point.n2Rpm, dp.point.n2Rpm)).toBeLessThan(1e-6);
  });

  it('an unlit combustor releases no heat: the fuel only dilutes, so T4 falls below T3', () => {
    const p = dp.point;
    const args = [engine, sls, p.n1Rpm, p.n2Rpm, p.fuelFlowKgPerS, dp.unknowns] as const;
    const lit = evaluateGasPath(...args);
    const unlit = evaluateGasPath(...args, false);
    expect(lit.stations['4'].ttK).toBeGreaterThan(lit.stations['3'].ttK + 500);
    expect(unlit.stations['4'].ttK).toBeLessThan(unlit.stations['3'].ttK);
    expect(unlit.stations['4'].ttK).toBeGreaterThan(unlit.stations['3'].ttK - 30);
  });

  // idle first (setup), then the counted sweep idle -> takeoff
  const idle = groundIdle(engine, sls);
  const sweep: SteadySolution[] = [];
  const n = 16;
  let prev = idle;
  for (let i = 1; i <= n; i++) {
    const spec =
      i === n
        ? ({ kind: 'netThrust', value: factValue('takeoffThrust') } as const)
        : ({
            kind: 'n1Percent',
            value: idle.point.n1Percent + ((100 - idle.point.n1Percent) * i) / n,
          } as const);
    const s = solveSteady(engine, sls, spec, prev.unknowns);
    sweep.push(s);
    prev = s;
  }

  it(`C7: every point of the idle -> takeoff sweep converges below ${C7.maxRelativeResidual.token} in ${C7.maxNewtonIterations.token} iterations`, () => {
    expect(idle.converged).toBe(true);
    for (const s of sweep) {
      expect(s.converged).toBe(true);
      expect(s.maxResidual).toBeLessThan(C7.maxRelativeResidual.value);
      expect(s.iterations).toBeLessThanOrEqual(C7.maxNewtonIterations.value);
    }
  });
  it(`C8: mass and energy balance within ${THRESHOLDS.C8.values.maxRelativeImbalance.token} at every point`, () => {
    for (const s of [idle, ...sweep]) {
      const b = balances(s.point);
      expect(Math.abs(b.mass)).toBeLessThan(THRESHOLDS.C8.values.maxRelativeImbalance.value);
      expect(Math.abs(b.energy)).toBeLessThan(THRESHOLDS.C8.values.maxRelativeImbalance.value);
    }
  });
  it('thrust and fuel flow rise monotonically along the sweep', () => {
    for (let i = 1; i < sweep.length; i++) {
      expect(sweep[i]?.point.netThrustN ?? 0).toBeGreaterThan(sweep[i - 1]?.point.netThrustN ?? 0);
      expect(sweep[i]?.point.fuelFlowKgPerS ?? 0).toBeGreaterThan(
        sweep[i - 1]?.point.fuelFlowKgPerS ?? 0,
      );
    }
  });
  it('C4: ground idle N1, N2 and displayed EGT inside the published ranges (ISA SLS)', () => {
    const p = idle.point;
    expect(p.n1Percent).toBeGreaterThanOrEqual(factValue('idleN1Min'));
    expect(p.n1Percent).toBeLessThanOrEqual(factValue('idleN1Max'));
    expect(p.n2Percent).toBeGreaterThanOrEqual(factValue('idleN2Min'));
    expect(p.n2Percent).toBeLessThanOrEqual(factValue('idleN2Max'));
    expect(displayedEgt(engine, p)).toBeLessThan(factValue('idleEgtMax'));
  });
  it('ground idle is at most 15 % of rated takeoff thrust (the 33.73(b) start point)', () => {
    expect(idle.point.netThrustN / factValue('takeoffThrust')).toBeLessThanOrEqual(
      factValue('accelStartMaxThrustFraction'),
    );
  });
});

describe('EGT calibration (W0C-I6) and C6', () => {
  it('matches the measured static takeoff run: 855 C displayed at N1 97.4 %, OAT 25 C, 1008 hPa (within 15 K)', () => {
    const run = {
      ambient: {
        temperatureK: factValue('runUpOat'),
        pressurePa: factValue('runUpPressure'),
        machNumber: 0,
      },
      customerBleedFraction: 0,
      powerExtractionW: 0,
    };
    const s = solveSteady(engine, run, { kind: 'n1Percent', value: factValue('staticTakeoffN1') });
    expect(s.converged).toBe(true);
    expect(Math.abs(displayedEgt(engine, s.point) - factValue('staticTakeoffEgt'))).toBeLessThan(
      15,
    );
    // the measured N2 at that point, 99.8 %, within 3 points
    expect(Math.abs(s.point.n2Percent - factValue('staticTakeoffN2'))).toBeLessThan(3);
  });
  it('C6 (D1-1): rated takeoff thrust at the 30 C flat-rating corner stays below the redline', () => {
    const corner = {
      ambient: { ...ISA_SLS, temperatureK: factValue('flatRatingTemperature') },
      customerBleedFraction: 0,
      powerExtractionW: 0,
    };
    const s = solveSteady(engine, corner, { kind: 'netThrust', value: factValue('takeoffThrust') });
    expect(s.converged).toBe(true);
    expect(displayedEgt(engine, s.point)).toBeLessThan(factValue('egtTakeoffLimit'));
  });
});
