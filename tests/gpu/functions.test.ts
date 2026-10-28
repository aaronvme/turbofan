// The WGSL device functions on Dawn, through the probe kernels (src/flow/gpu/wgsl/kernels.ts): the
// gauge gas model (exact ambient zeros, the energy inversion's round trip across the 1000 K break,
// against the f64 gas functions), log1p/expm1, SLAU2's bitwise antisymmetry and consistency, and
// the limiter's bitwise odd symmetry and positivity fallback.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { SimDevice } from '../../src/gpu/device';
import type { GpuSchemeOptions } from '../../src/flow/gpu/params';
import {
  THERMALLY_PERFECT,
  deltaH,
  productsFraction,
  referenceState,
} from '../../src/flow/reference/gas';
import { physicalFlux } from '../../src/flow/reference/slau2';
import { BC, rectangle, singleBlock, solverMesh } from '../unit/flow/helpers';
import { GpuErrorLog, solverDevice } from './helpers/solver';
import { runProbe } from './helpers/probe';

const OPTS: GpuSchemeOptions = {
  gas: THERMALLY_PERFECT,
  freeStream: { pressure: 101325, temperature: 288.15, velocity: 0 },
};
const MESH = solverMesh(
  singleBlock(rectangle('m', 0, 1, 0, 1, 4, 4), {
    imin: BC.SLIP_WALL,
    imax: BC.SLIP_WALL,
    jmin: BC.AXIS,
    jmax: BC.SLIP_WALL,
  }),
);

describe('WGSL device functions', () => {
  const log = new GpuErrorLog();
  let sim: SimDevice;

  beforeAll(async () => {
    sim = await solverDevice(log);
  });

  afterEach(() => {
    log.assertNone('functions');
  });

  afterAll(() => {
    sim.destroy();
  });

  const records = (rows: readonly (readonly number[])[], width = 16) => {
    const a = new Float32Array(width * rows.length);
    rows.forEach((r, k) => {
      a.set(r, width * k);
    });
    return a;
  };

  it('gives exact zeros for the ambient and inverts the energy to 1e-6 K across the range break', async () => {
    const ref = referenceState(OPTS.gas, OPTS.freeStream);
    const cases: [number, number][] = [];
    for (const tP of [0, 1e-3, 1, -100, 300, 711.85, 711.86, 1500, 1700]) {
      for (const z of [0, 0.01, 0.0682]) cases.push([tP, z]);
    }
    const out = await runProbe(
      sim.device,
      MESH,
      OPTS,
      'probeGas',
      records(cases.map(([tP, z]) => [0, 0, 0, 0, 0, 0, 0.5, tP, z, 0, 0, 0, 0, 0, 0, 0])),
    );
    cases.forEach(([tP, z], k) => {
      const o = 16 * k;
      // U = 0: every primitive gauge exactly zero, the sound speed c_inf
      for (let m = 0; m < 7; m++) expect(out[o + m]).toBe(0);
      expect(out[o + 7]).toBeCloseTo(ref.c, 3);
      // the round trip temperatureGauge(deltaE(T')) = T'
      const back = out[o + 8] ?? NaN;
      expect(Math.abs(back - tP), `T' ${tP}, Z ${z}`).toBeLessThan(1e-6 * (ref.t + tP) + 1e-9);
      // deltaH against the f64 gas model
      const dh = deltaH(ref, Math.fround(tP), productsFraction(OPTS.gas, Math.fround(z)));
      const scale = Math.abs(dh) + 1004 * 1e-3;
      expect(Math.abs((out[o + 10] ?? NaN) - dh) / scale, `deltaH ${tP} ${z}`).toBeLessThan(1e-6);
    });
    expect(out[8]).toBe(0);
  });

  it('computes log1p and expm1 to 1e-6 relative, exactly 0 at 0', async () => {
    const xs = [0, 1e-12, -3e-7, 1e-4, -0.2, 0.33, -0.45, 0.9, 3, 40];
    const out = await runProbe(
      sim.device,
      MESH,
      OPTS,
      'probeGas',
      records(xs.map((x) => [0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0, x, x / 100, 0, 0])),
    );
    xs.forEach((x, k) => {
      const lp = out[16 * k + 12] ?? NaN;
      const em = out[16 * k + 13] ?? NaN;
      const xf = Math.fround(x);
      const yf = Math.fround(x / 100);
      if (x === 0) {
        expect(lp).toBe(0);
        expect(em).toBe(0);
        return;
      }
      expect(Math.abs(lp / Math.log1p(xf) - 1), `log1p ${x}`).toBeLessThan(1e-6);
      expect(Math.abs(em / Math.expm1(yf) - 1), `expm1 ${x / 100}`).toBeLessThan(1e-6);
    });
  });

  it('SLAU2 is bitwise antisymmetric, consistent, and zero through a zero-area face', async () => {
    const ref = referenceState(OPTS.gas, OPTS.freeStream);
    // (rho', u, v, rw), (p', Z) pairs: subsonic jump, expansion, swirl + fuel, transonic, supersonic
    const states: [number[], number[]][] = [
      [
        [0.02, 30, -5, 4, 3000, 0],
        [-0.05, -12, 8, -2, -4000, 0],
      ],
      [
        [-0.3, -120, 10, 0, -25000, 0],
        [-0.31, 140, -12, 0, -26000, 0],
      ],
      [
        [0.4, 60, 20, 30, 50000, 0.05],
        [0.1, 80, -10, -20, 20000, 0.01],
      ],
      [
        [-0.2, 300, 0, 0, -20000, 0],
        [-0.25, 330, 5, 0, -30000, 0],
      ],
      [
        [0.3, 700, 30, 10, 60000, 0.02],
        [0.2, 650, -20, 5, 40000, 0.03],
      ],
    ];
    const normals = [
      [0.6, 0.8],
      [-1, 0],
      [0.28, -0.96],
    ];
    const rows: number[][] = [];
    for (const [L, R] of states) {
      for (const [nx, nr] of normals) {
        const n = [nx ?? 0, nr ?? 0];
        const f = (a: number[], b: number[], s: number) => [
          ...a.slice(0, 4),
          a[4] ?? 0,
          a[5] ?? 0,
          s * (n[0] ?? 0),
          s * (n[1] ?? 0),
          ...b.slice(0, 4),
          b[4] ?? 0,
          b[5] ?? 0,
          0.37,
          0.9,
          // the face's beta (D4-44; machCut 1 here, so M_ref = 1 whatever it is)
          0.05,
          0,
          0,
          0,
        ];
        rows.push(f(L, R, 1), f(R, L, -1), f(L, L, 1));
      }
    }
    rows.push([0.1, 10, 0, 0, 100, 0, 1, 0, 0.2, 0, 0, 0, 0, 0, 0, 0.5, 0.05, 0, 0, 0]);
    const out = await runProbe(sim.device, MESH, OPTS, 'probeFlux', records(rows, 20));
    const flux = (k: number) => [0, 1, 2, 3, 4, 5].map((m) => out[20 * k + m] ?? NaN);
    let k = 0;
    for (const [L] of states) {
      for (const [nx, nr] of normals) {
        const a = flux(k);
        const b = flux(k + 1);
        for (let m = 0; m < 6; m++) {
          // F(L, R, n) = -F(R, L, -n), bitwise
          expect(a[m] === -(b[m] ?? NaN) || (a[m] === 0 && b[m] === 0), `pair ${k} comp ${m}`).toBe(
            true,
          );
        }
        // equal states: the physical flux
        const P = new Float64Array([...L.map((v) => Math.fround(v)), 0, 0]);
        const exact = new Float64Array(6);
        physicalFlux(ref, P, 0, nx ?? 0, nr ?? 0, 0.37, 0.9, exact);
        const c = flux(k + 2);
        const scale = Math.max(...Array.from(exact, Math.abs));
        for (let m = 0; m < 6; m++) {
          expect(
            Math.abs((c[m] ?? NaN) - (exact[m] ?? NaN)) / scale,
            `consistency ${k}`,
          ).toBeLessThan(2e-6);
        }
        k += 3;
      }
    }
    expect(flux(k)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('limits slopes oddly and symmetrically (bitwise) and falls back to first order', async () => {
    const rows = [
      // m.a, c.a, p.a, (m.p', c.p', p.p', 0)
      [0.01, 3, -1, 2, 0.02, 4, 1, 1, 0.025, 4.5, 3, 0, 100, 300, 350, 0],
      [-0.3, 0, 0, 0, 0.1, 1e-3, 5, 7, -0.2, -2, 1, 7, -5000, 10, 20, 0],
      // rho = 0.025 with a density slope -0.057: a face value would be negative, all six zeroed
      [-0.9, 0, 0, 0, -1.2, 1, 1, 1, -1.25, 2, 2, 2, 0, 0, 0, 0],
    ];
    const out = await runProbe(sim.device, MESH, OPTS, 'probeSlope', records(rows));
    for (let k = 0; k < rows.length; k++) {
      const va = Array.from(out.subarray(16 * k + 8, 16 * k + 12));
      const vb = Array.from(out.subarray(16 * k + 12, 16 * k + 16));
      for (let m = 0; m < 4; m++) {
        expect(va[m] === -(vb[m] ?? NaN) || (va[m] === 0 && vb[m] === 0)).toBe(true);
      }
    }
    expect(Array.from(out.subarray(32, 38))).toEqual([0, 0, 0, 0, 0, 0]);
    expect(out[0]).not.toBe(0);
  });
});
