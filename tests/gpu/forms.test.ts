// The kernel's own WGSL against the f64 oracle, value for value on UNEQUAL states (W2S-B-I1/I2,
// W2S-A-N3; D4-49: every SOLVER.md 14 form gets an identity test against the oracle). The probe
// kernels (src/flow/gpu/wgsl/kernels.ts probeKernelWgsl) call the same WGSL functions the solver
// kernels call, so a change to one of them is seen here; tests/unit/flow/f32forms.test.ts checks
// the same algebra in f64 (the identity to f64 rounding), this file checks the WGSL text.
//
// - SLAU2 (14.3-14.5: the gauge flux difference G = F - F_inf(S)) against slau2Flux on 1200
//   random faces: subsonic, expansions (the g term), |M| > 1, machCut 1 and 0.003. Every
//   dissipation term vanishes for equal states, so functions.test.ts's antisymmetry and
//   consistency checks cannot see them.
// - consToPrim (14.3), deltaE (14.1: R - R_inf = phi dR), deltaH, cp, entropy and enthalpy
//   deltas against the oracle.
// - The limited slopes, including the pressure branch of the positivity fallback.
// - 14.2: the preconditioned increment, all six components, against preconditionIncrement.
// - 14.6(a): the cell residual's Neumaier sum against the exact sum of its f32 terms, on faces
//   whose fluxes cancel to 1e-6 of their size, and the free stream's add-back (14.4) with its sign.
// Both sides get bit-identical f32 inputs; the oracle runs in f64 on a reference state whose
// constants are the kernel's f32 ones, so what is left is f32 arithmetic. Tolerances: 1e-5 of a
// per-component scale (f32 is 6e-8; an O(1) error in any term is >= 1e-4 of the scale here).
// The SLAU2, gas and slope tests are reviewer B's probe santa-solver-B-functions (critic branch
// santa-b), moved into the suite as B-I1 asks.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { SimDevice } from '../../src/gpu/device';
import type { GpuSchemeOptions } from '../../src/flow/gpu/params';
import {
  THERMALLY_PERFECT,
  cpMix,
  deltaE,
  deltaH,
  enthalpyDelta,
  entropyDelta,
  productsFraction,
  referenceState,
  type ReferenceState,
} from '../../src/flow/reference/gas';
import { limitedSlopes } from '../../src/flow/reference/muscl';
import { preconditionIncrement } from '../../src/flow/reference/precondition';
import { slau2Flux } from '../../src/flow/reference/slau2';
import { NP, NU, consToPrim, physicalToPrim, primToCons } from '../../src/flow/reference/state';
import { BC, rectangle, singleBlock, solverMesh } from '../unit/flow/helpers';
import { GpuErrorLog, solverDevice } from './helpers/solver';
import { runProbe } from './helpers/probe';

const f = Math.fround;
const U_INF = 170;
const OPTS: GpuSchemeOptions = {
  gas: THERMALLY_PERFECT,
  freeStream: { pressure: 101325, temperature: 288.15, velocity: U_INF },
};
const REF = referenceState(OPTS.gas, OPTS.freeStream);
/** The oracle's reference state with the kernel's f32 constants. */
const REF_F: ReferenceState = {
  ...REF,
  rho: f(REF.rho),
  u: f(REF.u),
  t: f(REF.t),
  r: f(REF.r),
  dInf: f(REF.dInf),
};
const MESH = solverMesh(
  singleBlock(rectangle('m', 0, 1, 0, 1, 4, 4), {
    imin: BC.SLIP_WALL,
    imax: BC.SLIP_WALL,
    jmin: BC.AXIS,
    jmax: BC.SLIP_WALL,
  }),
);

/** A deterministic LCG (Numerical Recipes): the same random states on every run. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A random primitive record (oracle layout, f32-representable, u absolute = u_inf_f32 + du). */
function randomState(next: () => number, du: number, rc: number): Float64Array {
  const P = physicalToPrim(
    REF,
    {
      rho: REF.rho * (1 + 0.4 * (next() - 0.5)),
      u: REF.u + du * (next() - 0.5),
      v: du * (next() - 0.5),
      w: 0.5 * du * (next() - 0.5),
      p: REF.p * (1 + 0.4 * (next() - 0.5)),
      z: next() < 0.5 ? 0 : 0.06 * next(),
    },
    rc,
  );
  const out = new Float64Array(NP);
  out[0] = f(P[0] ?? NaN);
  out[1] = REF_F.u + f((P[1] ?? NaN) - REF_F.u);
  out[2] = f(P[2] ?? NaN);
  out[3] = f(P[3] ?? NaN);
  out[4] = f(P[4] ?? NaN);
  out[5] = f(P[5] ?? NaN);
  return out;
}

describe('the kernel WGSL against the f64 oracle on unequal states (SOLVER.md 14, D4-49)', () => {
  const log = new GpuErrorLog();
  let sim: SimDevice;

  beforeAll(async () => {
    sim = await solverDevice(log);
  });

  afterEach(() => {
    log.assertNone('forms');
  });

  afterAll(() => {
    sim.destroy();
  });

  for (const machCut of [1, 0.003]) {
    it(`14.3-14.5 SLAU2 values (machCut ${machCut}): subsonic, expansions, |M| > 1`, async () => {
      const next = rng(machCut === 1 ? 101 : 202);
      const N = 600;
      const faces: {
        L: Float64Array;
        R: Float64Array;
        nx: number;
        nr: number;
        area: number;
        rf: number;
      }[] = [];
      const input = new Float32Array(20 * N);
      // the face's beta (D4-44), log-uniform over 1e-3..1 (below machCut 0.003, between, and 1)
      const betas: number[] = [];
      for (let k = 0; k < N; k++) {
        const rf = f(0.2 + next());
        const a = 2 * Math.PI * next();
        const nx = f(Math.cos(a));
        const nr = f(Math.sin(a));
        const area = f(0.01 + next());
        const du = [40, 250, 700][k % 3] ?? 40;
        const L = randomState(next, du, rf);
        const R = randomState(next, du, rf);
        faces.push({ L, R, nx, nr, area, rf });
        const betaFace = f(k % 5 === 0 ? 1 : 10 ** (-3 + 3 * next()));
        betas.push(betaFace);
        const rec = (P: Float64Array) => [
          P[0] ?? NaN,
          (P[1] ?? NaN) - REF_F.u,
          P[2] ?? NaN,
          P[3] ?? NaN,
        ];
        input.set(
          [
            ...rec(L),
            L[4] ?? NaN,
            L[5] ?? NaN,
            nx,
            nr,
            ...rec(R),
            R[4] ?? NaN,
            R[5] ?? NaN,
            area,
            rf,
            betaFace,
            0,
            0,
            0,
          ],
          20 * k,
        );
      }
      const out = await runProbe(sim.device, MESH, OPTS, 'probeFlux', input, { machCut });
      const F = new Float64Array(6);
      const worst = [0, 0, 0, 0, 0, 0];
      let expansions = 0;
      let transonic = 0;
      const faMin = machCut < 1 ? machCut * (2 - machCut) : 1;
      faces.forEach(({ L, R, nx, nr, area, rf }, k) => {
        slau2Flux(REF_F, L, 0, R, 0, nx, nr, area, rf, F, machCut, betas[k] ?? NaN);
        // the kernel returns G = F - F_inf(S): add the free stream's flux back (14.4)
        const fInf = REF_F.rho * REF_F.u * nx;
        const g = [
          (out[20 * k] ?? NaN) + area * fInf,
          (out[20 * k + 1] ?? NaN) + area * fInf * REF_F.u,
          out[20 * k + 2] ?? NaN,
          out[20 * k + 3] ?? NaN,
          out[20 * k + 4] ?? NaN,
          out[20 * k + 5] ?? NaN,
        ];
        const rho = REF_F.rho + 0.5 * ((L[0] ?? NaN) + (R[0] ?? NaN));
        const q = Math.max(...[L, R].map((P) => Math.hypot(P[1] ?? NaN, P[2] ?? NaN))) + 400;
        const mScale = rho * q + Math.abs((R[4] ?? NaN) - (L[4] ?? NaN)) / (340 * faMin);
        const scale = [
          area * mScale,
          area * (mScale * q + Math.abs(L[4] ?? NaN) + Math.abs(R[4] ?? NaN)),
          area * (mScale * q + Math.abs(L[4] ?? NaN) + Math.abs(R[4] ?? NaN)),
          area * mScale * (Math.abs(L[3] ?? NaN) + Math.abs(R[3] ?? NaN) + 1e-3),
          area * mScale * q * q,
          area * mScale * 0.07,
        ];
        for (let m = 0; m < 6; m++) {
          const e = Math.abs((g[m] ?? NaN) - (F[m] ?? NaN)) / (scale[m] ?? NaN);
          worst[m] = Math.max(worst[m] ?? 0, Number.isNaN(e) ? Infinity : e);
        }
        const vnL = (L[1] ?? NaN) * nx + (L[2] ?? NaN) * nr;
        const vnR = (R[1] ?? NaN) * nx + (R[2] ?? NaN) * nr;
        if (vnL < -10 && vnR > 10) expansions++;
        if (Math.abs(vnL) > 340 || Math.abs(vnR) > 340) transonic++;
      });
      process.stdout.write(
        `[forms] SLAU2 machCut ${machCut}: worst per component ${worst
          .map((e) => e.toExponential(2))
          .join(' ')} (${expansions} expansions, ${transonic} |M| > 1 faces)\n`,
      );
      expect(expansions).toBeGreaterThan(30);
      expect(transonic).toBeGreaterThan(30);
      for (let m = 0; m < 6; m++) expect(worst[m], `component ${m}`).toBeLessThan(1e-5);
    });
  }

  it('14.1 and 14.3: consToPrim, deltaE, deltaH, cp, enthalpy and entropy deltas', async () => {
    const next = rng(303);
    const N = 400;
    const input = new Float32Array(16 * N);
    const cells: { U: Float64Array; rc: number; tP: number; z: number; tau: number }[] = [];
    for (let k = 0; k < N; k++) {
      const rc = f(0.05 + next());
      const P = physicalToPrim(
        REF,
        {
          rho: REF.rho * (0.3 + 1.5 * next()),
          u: REF.u + 400 * (next() - 0.5),
          v: 200 * (next() - 0.5),
          w: 150 * (next() - 0.5),
          p: REF.p * (0.3 + 2 * next()),
          z: next() < 0.3 ? 0 : 0.07 * next(),
        },
        rc,
      );
      const Ua = new Float64Array(NU);
      primToCons(REF, P, 0, rc, Ua, 0);
      // the state copy holds the momentum gauge (rho u)' = rho u - rho_inf u_inf (14.3)
      const mG = REF_F.rho * REF_F.u;
      const ga = [f(Ua[0] ?? NaN), f((Ua[1] ?? NaN) - mG), f(Ua[2] ?? NaN), f(Ua[3] ?? NaN)];
      const gb = [f(Ua[4] ?? NaN), f(Ua[5] ?? NaN)];
      const U = Float64Array.from([
        ga[0] ?? NaN,
        (ga[1] ?? NaN) + mG,
        ga[2] ?? NaN,
        ga[3] ?? NaN,
        gb[0] ?? NaN,
        gb[1] ?? NaN,
      ]);
      const tP = f(-150 + 1700 * next());
      const z = f(next() < 0.3 ? 0 : 0.07 * next());
      const tau = f(-100 + 1500 * next());
      cells.push({ U, rc, tP, z, tau });
      input.set([...ga, gb[0] ?? NaN, gb[1] ?? NaN, rc, tP, z, 0, 0, 0, 0, 0, tau, 0], 16 * k);
    }
    const out = await runProbe(sim.device, MESH, OPTS, 'probeGas', input);
    const Q = new Float64Array(NP);
    const worst: Record<string, number> = {};
    const note = (name: string, e: number) => {
      worst[name] = Math.max(worst[name] ?? 0, Number.isNaN(e) ? Infinity : e);
    };
    cells.forEach(({ U, rc, tP, z, tau }, k) => {
      const o = 16 * k;
      consToPrim(REF_F, U, 0, rc, Q, 0);
      const T = REF_F.t + (Q[6] ?? NaN);
      const qScale = 400;
      note("rho'", Math.abs((out[o] ?? NaN) - (Q[0] ?? NaN)) / REF_F.rho);
      note('u', Math.abs(REF_F.u + (out[o + 1] ?? NaN) - (Q[1] ?? NaN)) / qScale);
      note('v', Math.abs((out[o + 2] ?? NaN) - (Q[2] ?? NaN)) / qScale);
      note('rw', Math.abs((out[o + 3] ?? NaN) - (Q[3] ?? NaN)) / (qScale * rc));
      note("p'", Math.abs((out[o + 4] ?? NaN) - (Q[4] ?? NaN)) / REF_F.p);
      note('Z', Math.abs((out[o + 5] ?? NaN) - (Q[5] ?? NaN)));
      note("T'", Math.abs((out[o + 6] ?? NaN) - (Q[6] ?? NaN)) / T);
      note('c', Math.abs((out[o + 7] ?? NaN) / (Q[7] ?? NaN) - 1));
      const phi = productsFraction(REF_F.gas, z);
      const eScale = 1004 * (REF_F.t + Math.abs(tP));
      note('deltaE', Math.abs((out[o + 9] ?? NaN) - deltaE(REF_F, tP, phi)) / eScale);
      note('deltaH', Math.abs((out[o + 10] ?? NaN) - deltaH(REF_F, tP, phi)) / eScale);
      note('cp', Math.abs((out[o + 11] ?? NaN) / cpMix(REF_F.gas, REF_F.t + tP, phi) - 1));
      const sScale = 1004 * Math.abs(Math.log((REF_F.t + tau) / REF_F.t)) + 1e-3;
      note(
        'entropyDelta',
        Math.abs((out[o + 14] ?? NaN) - entropyDelta(REF_F.gas, REF_F.t, tau, phi)) / sScale,
      );
      note(
        'enthalpyDelta',
        Math.abs((out[o + 15] ?? NaN) - enthalpyDelta(REF_F.gas, REF_F.t, tau, phi)) /
          (1004 * (REF_F.t + Math.abs(tau))),
      );
    });
    process.stdout.write(
      `[forms] gas: ${Object.entries(worst)
        .map(([k, v]) => `${k} ${v.toExponential(2)}`)
        .join(', ')}\n`,
    );
    for (const [name, e] of Object.entries(worst)) expect(e, name).toBeLessThan(1e-5);
  });

  it('limited slopes and the positivity fallback (rho and p) against the oracle', async () => {
    const next = rng(404);
    const N = 300;
    const input = new Float32Array(16 * N);
    const recs: Float64Array[][] = [];
    for (let k = 0; k < N; k++) {
      // every third record has a pressure jump large enough that p - |sigma| / 2 <= 0 is possible
      const big = k % 3 === 0;
      const one = () => {
        const P = new Float64Array(NP);
        P[0] = f(0.5 * (next() - 0.5));
        P[1] = REF_F.u + f(100 * (next() - 0.5));
        P[2] = f(100 * (next() - 0.5));
        P[3] = f(20 * (next() - 0.5));
        P[4] = f((big ? -0.95 + 1.9 * next() : 0.4 * (next() - 0.5)) * REF_F.p);
        return P;
      };
      const [m, c, p] = [one(), one(), one()];
      // a monotone pressure line through a non-positive neighbour (an extrapolated wall ghost can
      // be one): van Albada keeps |sigma| / 2 <= 0.604 min(|a|, |b|), so with positive neighbours
      // the face value never reaches 0 and the fallback cannot trigger
      if (big) {
        m[4] = f((-1.6 + 1.2 * next()) * REF_F.p);
        c[4] = f((-0.9 + 0.5 * next()) * REF_F.p);
        p[4] = f(next() * REF_F.p);
      }
      recs.push([m, c, p]);
      const a = (P: Float64Array) => [
        P[0] ?? NaN,
        (P[1] ?? NaN) - REF_F.u,
        P[2] ?? NaN,
        P[3] ?? NaN,
      ];
      input.set([...a(m), ...a(c), ...a(p), m[4] ?? NaN, c[4] ?? NaN, p[4] ?? NaN, 0], 16 * k);
    }
    const out = await runProbe(sim.device, MESH, OPTS, 'probeSlope', input);
    const S = new Float64Array(6);
    const all = new Float64Array(3 * NP);
    let pressureFallbacks = 0;
    let worst = 0;
    let mismatchedFallback = 0;
    recs.forEach(([m, c, p], k) => {
      all.set(m ?? [], 0);
      all.set(c ?? [], NP);
      all.set(p ?? [], 2 * NP);
      const fell = limitedSlopes(REF_F, all, 0, NP, 2 * NP, 1, S, 0); // rc = 1: the sharp limiter ignores it (santa A-B1 / B-B2 merge fix)
      const rhoOk = REF_F.rho + (c?.[0] ?? NaN) - 0.5 * Math.abs(S[0] ?? NaN) > 0;
      if (fell && rhoOk) pressureFallbacks++;
      const g = [0, 1, 2, 3, 4].map((j) => out[16 * k + j] ?? NaN);
      const want = [S[0], S[1], S[2], S[3], S[4]].map((x) => x ?? NaN);
      const gpuFell = g.every((x) => x === 0);
      // the oracle fell back and the GPU did not, or the GPU fell back where the oracle kept slopes
      if ((fell && !gpuFell) || (!fell && gpuFell && want.some((x) => x !== 0))) {
        mismatchedFallback++;
      }
      for (let j = 0; j < 5; j++) {
        const sc = Math.abs(want[j] ?? NaN) + 1e-30;
        const e = Math.abs((g[j] ?? NaN) - (want[j] ?? NaN)) / sc;
        if ((want[j] ?? 0) !== 0) worst = Math.max(worst, e);
      }
    });
    process.stdout.write(
      `[forms] slopes: worst ${worst.toExponential(2)}, pressure fallbacks ${pressureFallbacks}, mismatched ${mismatchedFallback}\n`,
    );
    expect(pressureFallbacks).toBeGreaterThan(5);
    expect(mismatchedFallback).toBe(0);
    expect(worst).toBeLessThan(1e-5);
  });

  it('14.2: the preconditioned increment, all six components, against the oracle', async () => {
    const next = rng(505);
    const N = 400;
    const input = new Float32Array(16 * N);
    const recs: { P: Float64Array; dU: Float64Array; rc: number; beta2: number }[] = [];
    const betas = [9e-6, 1e-4, 1e-2, 0.3, 0.9];
    for (let k = 0; k < N; k++) {
      const rc = f(0.05 + next());
      const s = {
        rho: REF.rho * (0.5 + next()),
        u: REF.u + 300 * (next() - 0.5),
        v: 150 * (next() - 0.5),
        w: 150 * (next() - 0.5),
        p: REF.p * (0.5 + next()),
        z: next() < 0.3 ? 0 : 0.07 * next(),
      };
      // the cell's record from its f32 conserved state (as the prim pass gives it)
      const Pf = physicalToPrim(REF_F, s, rc);
      const P = new Float64Array(NP);
      for (const m of [0, 2, 3, 4, 5]) P[m] = f(Pf[m] ?? NaN);
      P[1] = REF_F.u + f((Pf[1] ?? NaN) - REF_F.u);
      // T' and c from (rho', p', Z) in f64, then rounded: both sides read the same record
      const Q = physicalToPrim(
        REF_F,
        {
          rho: REF_F.rho + (P[0] ?? NaN),
          u: P[1],
          v: P[2] ?? NaN,
          w: (P[3] ?? NaN) / rc,
          p: REF_F.p + (P[4] ?? NaN),
          z: P[5] ?? NaN,
        },
        rc,
      );
      P[6] = f(Q[6] ?? NaN);
      P[7] = f(Q[7] ?? NaN);
      // an increment: the difference of two nearby conserved states, so its parts are physical
      const U1 = new Float64Array(NU);
      const U2 = new Float64Array(NU);
      primToCons(REF_F, Q, 0, rc, U1, 0);
      const Q2 = physicalToPrim(
        REF_F,
        {
          ...s,
          rho: s.rho * (1 + 1e-3 * (next() - 0.5)),
          u: s.u + 0.3 * (next() - 0.5),
          v: s.v + 0.3 * (next() - 0.5),
          p: s.p * (1 + 1e-3 * (next() - 0.5)),
        },
        rc,
      );
      primToCons(REF_F, Q2, 0, rc, U2, 0);
      const dU = Float64Array.from(U2, (x, m) => f(x - (U1[m] ?? NaN)));
      const beta2 = f(betas[k % betas.length] ?? 1);
      recs.push({ P, dU, rc, beta2 });
      input.set(
        [
          ...dU.subarray(0, 4),
          dU[4] ?? NaN,
          dU[5] ?? NaN,
          P[5] ?? NaN,
          P[6],
          P[0] ?? NaN,
          P[1] - REF_F.u,
          P[2] ?? NaN,
          P[3] ?? NaN,
          P[7],
          rc,
          beta2,
          0,
        ],
        16 * k,
      );
    }
    const out = await runProbe(sim.device, MESH, OPTS, 'probePrecondition', input);
    const worst = [0, 0, 0, 0, 0, 0];
    recs.forEach(({ P, dU, rc, beta2 }, k) => {
      const d = Float64Array.from(dU);
      preconditionIncrement(REF_F, P, 0, rc, beta2, d, 0);
      // each component's scale: the sizes of its two literal terms, dU_m and k (dU/dp)_m
      const kk = (dU[0] ?? NaN) - (d[0] ?? NaN);
      const coef = [
        1,
        P[1] ?? NaN,
        P[2] ?? NaN,
        P[3] ?? NaN,
        ((dU[4] ?? NaN) - (d[4] ?? NaN)) / kk,
        P[5] ?? NaN,
      ];
      const g = [0, 1, 2, 3, 4, 5].map((m) => out[16 * k + m] ?? NaN);
      for (let m = 0; m < 6; m++) {
        const scale = Math.abs(dU[m] ?? NaN) + Math.abs(kk * (coef[m] ?? NaN)) + 1e-30;
        const e = Math.abs((g[m] ?? NaN) - (d[m] ?? NaN)) / scale;
        worst[m] = Math.max(worst[m] ?? 0, Number.isNaN(e) ? Infinity : e);
      }
    });
    process.stdout.write(
      `[forms] 14.2 preconditioned increment: worst per component ${worst
        .map((e) => e.toExponential(2))
        .join(' ')}\n`,
    );
    for (let m = 0; m < 6; m++) expect(worst[m], `component ${m}`).toBeLessThan(1e-5);
  });

  it("14.6(a): the cell residual's Neumaier sum is the exact sum of its f32 terms, and 14.4's add-back has its sign", async () => {
    // record (10 vec4): west, east, south, north (a), (west.b, east.b), (south.b, north.b), the
    // pressure/swirl source, the volume source (a), (its b, sum of b S_x over the flow faces, 0),
    // 0. R = -west + east - south + north + F_inf(flowSx) - pressure source - volume source.
    const next = rng(606);
    const N = 512;
    const STRIDE = 40;
    const input = new Float32Array(STRIDE * N);
    const want: number[][] = [];
    const termScale: number[] = [];
    const mInf = f(f(REF_F.rho) * f(REF_F.u));
    const addX = f(mInf * f(REF_F.u));
    for (let k = 0; k < N; k++) {
      // half the records cancel (flowSx = 0, so no product enters the sum), half add F_inf back
      const cancel = k % 2 === 0;
      const big = () => f((next() < 0.5 ? -1 : 1) * 10 ** (3 * next()));
      // T[t][m]: term t (west, east, south, north, pressure source, volume source), component m;
      // the pressure/swirl source is a momentum source (components 0-3 only)
      const T: number[][] = Array.from({ length: 6 }, (_, t) =>
        Array.from({ length: 6 }, (_, m) => (t === 4 && m >= 4 ? 0 : big())),
      );
      const sign = [-1, 1, -1, 1, -1, -1];
      const flowSx = cancel ? 0 : f(0.01 + next());
      const add = [mInf * flowSx, addX * flowSx, 0, 0, 0, 0];
      const R: number[] = [];
      for (let m = 0; m < 6; m++) {
        // north closes the sum to a residual eps x the largest term (cancel) or leaves it random
        const eps = cancel ? (m % 2 === 0 ? 1e-6 : 1e-5) : 0.3;
        const others = [0, 1, 2, 4, 5].reduce(
          (s, t) => s + (sign[t] ?? 0) * (T[t]?.[m] ?? 0),
          add[m] ?? 0,
        );
        const max = Math.max(...[0, 1, 2, 4, 5].map((t) => Math.abs(T[t]?.[m] ?? 0)));
        const north = f(eps * max * (next() < 0.5 ? -1 : 1) - others);
        const row = T[3];
        if (row !== undefined) row[m] = north;
        // the exact sum of the f32 terms: f64 holds it exactly (|terms| in [1, 1e3]: 36 bits)
        R.push(others + north);
        // the scale of the terms, the add-back's included (rho_inf u_inf^2 flowSx, up to 3.5e4)
        termScale.push(Math.max(max, Math.abs(add[m] ?? 0)));
      }
      want.push(R);
      const t = (i: number, m: number) => T[i]?.[m] ?? NaN;
      input.set(
        [
          ...[0, 1, 2, 3].flatMap((i) => [t(i, 0), t(i, 1), t(i, 2), t(i, 3)]),
          t(0, 4),
          t(0, 5),
          t(1, 4),
          t(1, 5),
          t(2, 4),
          t(2, 5),
          t(3, 4),
          t(3, 5),
          t(4, 0),
          t(4, 1),
          t(4, 2),
          t(4, 3),
          t(5, 0),
          t(5, 1),
          t(5, 2),
          t(5, 3),
          t(5, 4),
          t(5, 5),
          flowSx,
          0,
          0,
          0,
          0,
          0,
        ],
        STRIDE * k,
      );
    }
    const out = await runProbe(sim.device, MESH, OPTS, 'probeResidual', input);
    let worstCancel = 0;
    let worstAdd = 0;
    for (let k = 0; k < N; k++) {
      const o = STRIDE * k;
      const g = [0, 1, 2, 3, 4, 5].map((m) => out[o + m] ?? NaN);
      const R = want[k] ?? [];
      for (let m = 0; m < 6; m++) {
        const r = R[m] ?? NaN;
        if (k % 2 === 0) {
          // within a few ulp of the result itself: the sum is compensated (uncompensated, the
          // error is ~1 ulp of the terms, 1e5 ulp of a result 1e-6 of them)
          const e = Math.abs((g[m] ?? NaN) - r) / (Math.abs(r) * 2 ** -23);
          worstCancel = Math.max(worstCancel, Number.isNaN(e) ? Infinity : e);
        } else {
          const e = Math.abs((g[m] ?? NaN) - r) / (termScale[6 * k + m] ?? NaN);
          worstAdd = Math.max(worstAdd, Number.isNaN(e) ? Infinity : e);
        }
      }
    }
    process.stdout.write(
      `[forms] 14.6(a) residual: cancelling to 1e-6 of the terms, worst ${worstCancel.toFixed(2)} ulp of the result; with the add-back ${worstAdd.toExponential(2)} of the largest term\n`,
    );
    expect(worstCancel).toBeLessThan(8);
    expect(worstAdd).toBeLessThan(1e-6);
  });
});
