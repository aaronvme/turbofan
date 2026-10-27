import { describe, expect, it } from 'vitest';
import { DEFAULT_CYCLE_INPUTS, type CycleInputs } from '../../../src/contracts/cycle';
import { casingRadiusAt, hubRadiusAt } from '../../../src/contracts/engine';
import { ENGINE_DEFINITION } from '../../../src/engine/definition';
import { gamma, gasConstant } from '../../../src/thermo/gas';
import { REF } from './fixtures';
import { compressorPoint } from '../../../src/cycle/componentMaps';
import {
  characteristic,
  criticalB,
  equilibrium,
  greitzerStep,
  helmholtzFrequency,
  simulateSurge,
  type GreitzerParams,
} from '../../../src/cycle/greitzer';
import {
  SHUTOFF_TO_PEAK_MIN,
  compressionSystem,
  ductVariables,
  engineGreitzerParams,
  greitzerB,
  hpcCubic,
  stallRlineForLoss,
  systemHelmholtzFrequency,
  throttleThrough,
  withStallRline,
} from '../../../src/cycle/surgeSystem';
import { ISA_SLS } from '../../../src/contracts/ambient';
import { THRESHOLDS } from '../../../src/contracts/thresholds';
import { createCycleModel } from '../../../src/cycle/model';

const def = ENGINE_DEFINITION;
const x = (id: string) => def.stations.find((s) => s.id === id)?.x ?? NaN;
const coreArea = (xx: number) => {
  const c = def.flowpath.components.find(
    (k) => k.stream !== 'bypass' && xx >= k.xStart && xx <= k.xEnd,
  );
  if (c === undefined) throw new Error(`no component at ${xx}`);
  const rh = hubRadiusAt(def.flowpath, c, xx) ?? NaN;
  const rc = casingRadiusAt(def.flowpath, c, xx) ?? NaN;
  return Math.PI * (rc * rc - rh * rh);
};
/** Independent trapezoid rule (the module uses the midpoint rule). */
const trapezoid = (f: (t: number) => number, a: number, b: number, n = 4000) => {
  const h = (b - a) / n;
  let s = 0.5 * (f(a) + f(b));
  for (let i = 1; i < n; i++) s += f(a + i * h);
  return s * h;
};

describe('W1C-I2 / D3-4: the compression system comes from the definition', () => {
  const sys = compressionSystem(def);
  it('duct area is the HPC inlet annulus (station 25)', () => {
    expect(sys.ductAreaM2).toBeCloseTo(coreArea(x('25')), 12);
  });
  it('effective duct length is A_c * integral dx / A over the HPC (25 -> 3)', () => {
    const ref = sys.ductAreaM2 * trapezoid((t) => 1 / coreArea(t), x('25'), x('3'));
    expect(Math.abs(sys.ductLengthM / ref - 1)).toBeLessThan(1e-4);
    // the annulus converges, so the inertance length exceeds the geometric length
    expect(sys.ductLengthM).toBeGreaterThan(x('3') - x('25'));
  });
  it('plenum is the HPC exit diffuser plus the combustor (3 -> 4)', () => {
    const ref = trapezoid(coreArea, x('3'), x('4'));
    expect(Math.abs(sys.plenumVolumeM3 / ref - 1)).toBeLessThan(1e-4);
  });
  it('the tip radius is the first HPC rotor leading-edge tip', () => {
    const rotor = def.bladeRows.find((r) => r.component === 'hpc' && r.kind === 'rotor');
    expect(sys.tipRadiusM).toBe(rotor?.leadingEdge.tip.r);
  });
  it('omega_H = a sqrt(A / (V L)) and B = U / (2 omega_H L), with L != 1', () => {
    const s = { ductAreaM2: 0.2, ductLengthM: 2, plenumVolumeM3: 0.5, tipRadiusM: 0.3 };
    expect(systemHelmholtzFrequency(s, 400)).toBeCloseTo(400 * Math.sqrt(0.2 / (0.5 * 2)), 9);
    expect(helmholtzFrequency(340, 0.1, 0.4, 2)).toBeCloseTo(340 * Math.sqrt(0.1 / 0.8), 9);
    const u = (12000 * 2 * Math.PI * 0.3) / 60;
    expect(greitzerB(s, 12000, 400)).toBeCloseTo(u / (2 * 400 * Math.sqrt(0.2 / 1) * 2), 9);
  });
  it('rejects a throttle through a non-positive plenum pressure', () => {
    expect(() => throttleThrough(0.3, 0)).toThrow(/> 0/);
    expect(throttleThrough(0.3, 0.09)).toBeCloseTo(1, 12);
  });
});

describe('W1C-I2 / D3-4: the post-surge cubic extends the scaled HPC map', () => {
  const sys = compressionSystem(def);
  // read inside the tests (D2-15: nothing sized at collection)
  const design = () => {
    const p = REF.design.point;
    const st = p.stations;
    const inlet = {
      pt25Pa: st['25'].ptPa,
      tt25K: st['25'].ttK,
      n2Rpm: p.n2Rpm,
      rJPerKgK: gasConstant(0),
    };
    return { p, st, inlet, maps: REF.maps };
  };
  for (const speed of ['design', 0.8, 0.7] as const) {
    it(`speed ${String(speed)}: peak on the map's stall point, shut-off head bounded`, () => {
      const { p, inlet, maps } = design();
      const nc = speed === 'design' ? p.hpc.speedFraction : speed;
      const fit = hpcCubic(maps.hpc, nc, sys, inlet);
      const q = compressorPoint(maps.hpc, nc, maps.hpc.map.rlineStall);
      const stallPoint = ductVariables(sys, inlet, q.correctedFlow, q.pressureRatio);
      const params: GreitzerParams = { ...SURGE, psi0: fit.psi0, h: fit.h, w: fit.w };
      expect(2 * fit.w).toBeCloseTo(stallPoint.phi, 12);
      expect(characteristic(params, 2 * fit.w)).toBeCloseTo(stallPoint.psi, 9);
      expect(fit.psi0).toBeGreaterThanOrEqual(SHUTOFF_TO_PEAK_MIN * stallPoint.psi - 1e-12);
      expect(fit.h).toBeGreaterThan(0);
    });
  }

  it('takeoff: B is above critical inside the surge line, so a surge is a deep surge', () => {
    const { p, st, inlet, maps } = design();
    const t3 = st['3'].ttK;
    const a3 = Math.sqrt(gamma(t3, 0) * gasConstant(0) * t3);
    const omegaH = systemHelmholtzFrequency(sys, a3);
    const b = greitzerB(sys, p.n2Rpm, a3);
    // independent: U from the design N2 and the rotor tip, omega_H from its definition
    const u = (p.n2Rpm * 2 * Math.PI * sys.tipRadiusM) / 60;
    expect(b).toBeCloseTo(u / (2 * omegaH * sys.ductLengthM), 12);
    const fit = hpcCubic(maps.hpc, p.hpc.speedFraction, sys, inlet);
    const params = engineGreitzerParams(fit, b, 0.9 * 2 * fit.w);
    expect(params.b).toBeGreaterThan(criticalB(params));
    const r = simulateSurge(params, 0.05, 400);
    expect(r.minPhi).toBeLessThan(0);
    // B < 1: a relaxation oscillation, slower than the Helmholtz period (2 pi in xi)
    expect(r.periodXi ?? 0).toBeGreaterThan(2 * Math.PI);
    expect(r.periodXi ?? Infinity).toBeLessThan(4 * 2 * Math.PI);
  });
});

describe('D3-17 / C12: a lowered HPC surge line (Delta PRS, SAE ARP1420)', () => {
  const sys = compressionSystem(def);
  const loss = THRESHOLDS.C12.values.surgePressureRatioLoss.value;

  it.each([1, 0.8, 0.65])(
    'speed %f: the stall point moves down the speed line by Delta PRS',
    (n) => {
      const map = REF.maps.hpc;
      expect(stallRlineForLoss(map, n, 0)).toBe(map.map.rlineStall);
      const r = stallRlineForLoss(map, n, loss);
      expect(r).toBeGreaterThan(map.map.rlineStall);
      const clean = compressorPoint(map, n, map.map.rlineStall);
      const lowered = compressorPoint(map, n, r);
      expect(lowered.pressureRatio / clean.pressureRatio).toBeCloseTo(1 - loss, 9);
      // a worn or distorted compressor stalls earlier: at a higher flow on the same speed line
      expect(lowered.correctedFlow).toBeGreaterThan(clean.correctedFlow);
      expect(stallRlineForLoss(map, n, 2 * loss)).toBeGreaterThan(r);
    },
  );

  it('the cubic peaks on the lowered stall point; a loss off the map throws', () => {
    const map = REF.maps.hpc;
    const st = REF.design.point.stations;
    const inlet = {
      pt25Pa: st['25'].ptPa,
      tt25K: st['25'].ttK,
      n2Rpm: REF.design.point.n2Rpm,
      rJPerKgK: gasConstant(0),
    };
    const r = stallRlineForLoss(map, 0.8, loss);
    const moved = withStallRline(map, r);
    expect(withStallRline(map, map.map.rlineStall)).toBe(map);
    expect(moved.map.rlineStall).toBe(r);
    expect(map.map.rlineStall).toBe(1);
    const q = compressorPoint(map, 0.8, r);
    const peak = ductVariables(sys, inlet, q.correctedFlow, q.pressureRatio);
    const fit = hpcCubic(moved, 0.8, sys, inlet);
    expect(2 * fit.w).toBeCloseTo(peak.phi, 12);
    const params: GreitzerParams = { ...SURGE, psi0: fit.psi0, h: fit.h, w: fit.w };
    expect(characteristic(params, 2 * fit.w)).toBeCloseTo(peak.psi, 9);
    expect(() => stallRlineForLoss(map, 0.8, 0.9)).toThrow(/leaves the map/);
  });

  it('the model reports the margin to the lowered line, (1 + m)(1 - Delta PRS) - 1', () => {
    const clean = createCycleModel().reset('groundIdle', ISA_SLS).hpc.surgeMarginFraction;
    const worn = createCycleModel({ hpcSurgeMarginLoss: loss }).reset('groundIdle', ISA_SLS).hpc
      .surgeMarginFraction;
    expect(worn).toBeCloseTo((1 + clean) * (1 - loss) - 1, 12);
    expect(() => createCycleModel({ hpcSurgeMarginLoss: -0.01 })).toThrow();
    expect(() => createCycleModel({ hpcSurgeMarginLoss: 1 })).toThrow();
  });
});

/** The C9 test system (model.test.ts). */
const SURGE: GreitzerParams = { psi0: 0.3, h: 0.18, w: 0.25, gammaT: 0.5, b: 1 };

describe('Greitzer numerics (critic pass 3 survivors)', () => {
  it('criticalB is sqrt(dPhi_T/dPsi / dPsi_c/dPhi) at the equilibrium (closed form)', () => {
    const eq = equilibrium(SURGE);
    const xx = eq.phi / SURGE.w - 1;
    const slope = (SURGE.h * 1.5 * (1 - xx * xx)) / SURGE.w;
    const dPhiT = SURGE.gammaT / (2 * Math.sqrt(eq.psi));
    expect(criticalB(SURGE)).toBeCloseTo(Math.sqrt(dPhiT / slope), 12);
  });
  it('greitzerStep is fourth order (halving the step cuts the error ~16x)', () => {
    const p = { ...SURGE, b: 0.5 };
    const s0 = { phi: 0.3, psi: 0.5 };
    const run = (n: number, dxi: number) => {
      let s = s0;
      for (let i = 0; i < n; i++) s = greitzerStep(p, s, dxi);
      return s;
    };
    const ref = run(6400, 1 / 6400);
    const e1 = Math.hypot(run(10, 0.1).phi - ref.phi, run(10, 0.1).psi - ref.psi);
    const e2 = Math.hypot(run(20, 0.05).phi - ref.phi, run(20, 0.05).psi - ref.psi);
    expect(e1 / e2).toBeGreaterThan(12);
    expect(e1 / e2).toBeLessThan(20);
  });
});

const TIMEOUT_MS = 600_000;
const inputs = (lever: number): CycleInputs => ({
  ...DEFAULT_CYCLE_INPUTS,
  fuelLever: 'run',
  ignition: 'auto',
  throttleLever: lever,
});

describe('W1C-I2: the model surges on its own compression system', { timeout: TIMEOUT_MS }, () => {
  it('an injected surge at takeoff: reverse flow at the derived period, then recovery', () => {
    const m = createCycleModel();
    m.reset('groundIdle');
    for (let i = 0; i < 300; i++) m.step(0.05, inputs(1));
    const before = m.state();
    m.injectFault('surge');
    const p3: number[] = [];
    const ts: number[] = [];
    let reverse = 0;
    for (let i = 0; i < 1000; i++) {
      const s = m.step(0.001, inputs(1));
      if (!s.flags.surge) continue;
      p3.push(s.stations['3'].ptPa);
      ts.push(s.timeS);
      if (s.stations['3'].wKgPerS === 0) reverse++;
    }
    expect(p3.length).toBeGreaterThan(0);
    expect(reverse).toBeGreaterThan(0);
    expect(m.state().flags.surge).toBe(false);
    // period of the P3 oscillation vs the derived Helmholtz period at the onset state
    const mean = p3.reduce((a, b) => a + b, 0) / p3.length;
    const ups: number[] = [];
    for (let k = 1; k < p3.length; k++) {
      if ((p3[k - 1] ?? 0) < mean && (p3[k] ?? 0) >= mean) ups.push(ts[k] ?? 0);
    }
    expect(ups.length).toBeGreaterThanOrEqual(3);
    const period = ((ups[ups.length - 1] ?? 0) - (ups[0] ?? 0)) / (ups.length - 1);
    const t3 = before.stations['3'].ttK;
    const tH =
      (2 * Math.PI) /
      systemHelmholtzFrequency(
        compressionSystem(def),
        Math.sqrt(gamma(t3, 0) * gasConstant(0) * t3),
      );
    expect(period).toBeGreaterThan(tH);
    // B < 1 makes it a relaxation oscillation, longer than the Helmholtz period
    expect(period).toBeLessThan(4 * tH);
  });
});
