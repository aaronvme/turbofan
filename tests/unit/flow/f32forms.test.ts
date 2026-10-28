// SOLVER.md 14 (D4-41): the GPU kernel's f32 implementation forms are algebraic identities of the
// scheme. Each form is transcribed here in f64 from its WGSL (src/flow/gpu/wgsl/*.ts) and compared
// with the oracle's literal form (src/flow/reference): the two agree to f64 rounding, so the forms
// change only the f32 rounding, not the scheme.
import { describe, expect, it } from 'vitest';
import {
  THERMALLY_PERFECT,
  cpMix,
  deltaE,
  deltaH,
  gasConstantMix,
  productsFraction,
  referenceState,
  soundSpeed,
  temperatureFromPressure,
  type ReferenceState,
} from '../../../src/flow/reference/gas';
import { preconditionIncrement } from '../../../src/flow/reference/precondition';
import { slau2Flux } from '../../../src/flow/reference/slau2';
import { NP, consToPrim, physicalToPrim, primToCons } from '../../../src/flow/reference/state';

const EPS = 2 ** -52;

/** A deterministic LCG in [0, 1) (no unseeded randomness). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const ref = referenceState(THERMALLY_PERFECT, {
  pressure: 101325,
  temperature: 288.15,
  velocity: 170,
});

/** A primitive record around the free stream: velocity scale du (m/s), fuel up to zMax. */
function randomPrim(next: () => number, du: number, zMax: number, rc: number): Float64Array {
  const s = {
    rho: ref.rho * (1 + 0.3 * (next() - 0.5)),
    u: ref.u + du * (next() - 0.5),
    v: du * (next() - 0.5),
    w: 0.5 * du * (next() - 0.5),
    p: ref.p * (1 + 0.3 * (next() - 0.5)),
    z: zMax * next(),
  };
  return physicalToPrim(ref, s, rc);
}

/** WGSL slau2 of flux.ts in f64: the gauge flux difference F - F_inf(S) (SOLVER.md 14.3-14.5). */
function gaugeSlau2(
  r: ReferenceState,
  L: Float64Array,
  R: Float64Array,
  nx: number,
  nr: number,
  area: number,
  rf: number,
  machCut: number,
): number[] {
  const side = (P: Float64Array) => {
    const rhoP = P[0] ?? NaN;
    const du = (P[1] ?? NaN) - r.u; // the kernel's primitive is this velocity gauge
    const u = r.u + du;
    const v = P[2] ?? NaN;
    const w = (P[3] ?? NaN) / rf;
    const phi = productsFraction(r.gas, P[5] ?? NaN);
    const tP = temperatureFromPressure(r, rhoP, P[4] ?? NaN, phi);
    const t = r.t + tP;
    const cp = cpMix(r.gas, t, phi);
    const rg = gasConstantMix(r.gas, phi);
    const dvn = du * nx + v * nr;
    return {
      rhoP,
      du,
      rho: r.rho + rhoP,
      dvn,
      vn: r.u * nx + dvn,
      q2: u * u + v * v + w * w,
      c: Math.sqrt((cp * rg * t) / (cp - rg)),
      dh0: deltaH(r, tP, phi) + 0.5 * (du * (du + 2 * r.u) + v * v + w * w),
    };
  };
  const l = side(L);
  const rr = side(R);
  const pL = L[4] ?? NaN;
  const pR = R[4] ?? NaN;
  const cbar = 0.5 * (l.c + rr.c);
  const mL = l.vn / cbar;
  const mR = rr.vn / cbar;
  const qAvg = Math.sqrt(0.5 * (l.q2 + rr.q2));
  const mHat = Math.min(1, qAvg / cbar);
  const chi = (1 - mHat) * (1 - mHat);
  const g = -Math.max(Math.min(mL, 0), -1) * Math.min(Math.max(mR, 0), 1);
  const rhoSum = l.rho + rr.rho;
  const vbar = (l.rho * Math.abs(l.vn) + rr.rho * Math.abs(rr.vn)) / rhoSum;
  const mRef = Math.min(1, Math.max(qAvg / cbar, machCut));
  const fa = mRef * (2 - mRef);
  const vbarDiff =
    (1 - g) * vbar * (l.rhoP - rr.rhoP) + g * (l.rho * Math.abs(l.vn) - rr.rho * Math.abs(rr.vn));
  const gm =
    0.5 *
    (l.rhoP * l.vn +
      rr.rhoP * rr.vn +
      r.rho * (l.dvn + rr.dvn) +
      vbarDiff -
      (chi / (cbar * fa)) * (pR - pL));
  const mdot = r.rho * (r.u * nx) + gm;
  const bp = Math.abs(mL) >= 1 ? 0.5 * (1 + Math.sign(mL)) : 0.25 * (2 - mL) * (mL + 1) ** 2;
  const bm = Math.abs(mR) >= 1 ? 0.5 * (1 - Math.sign(mR)) : 0.25 * (2 + mR) * (mR - 1) ** 2;
  const dm = (l.dvn - rr.dvn) / cbar;
  const bsum =
    Math.abs(mL) < 1 && Math.abs(mR) < 1
      ? 0.25 * dm * (3 - (mL * mL + mR * mR) - mL * mR)
      : bp + bm - 1;
  const pt = 0.5 * (pL + pR) + 0.5 * (bp - bm) * (pL - pR) + qAvg * bsum * 0.5 * rhoSum * cbar;
  const mp = 0.5 * (mdot + Math.abs(mdot));
  const mm = 0.5 * (mdot - Math.abs(mdot));
  return [
    gm,
    gm * r.u + (mp * l.du + mm * rr.du) + pt * nx,
    mp * (L[2] ?? NaN) + mm * (R[2] ?? NaN) + pt * nr,
    mp * (L[3] ?? NaN) + mm * (R[3] ?? NaN),
    mp * l.dh0 + mm * rr.dh0,
    mp * (L[5] ?? NaN) + mm * (R[5] ?? NaN),
  ].map((x) => area * x);
}

describe('SOLVER.md 14: the f32 implementation forms agree with the oracle to f64 rounding', () => {
  it('14.1 R(phi) - R_inf = phi (R_p - R_a)', () => {
    const g = THERMALLY_PERFECT;
    for (const phi of [0, 1e-7, 1e-4, 0.01, 0.3, 1]) {
      const literal = gasConstantMix(g, phi) - g.air.r;
      const form = phi * (g.products.r - g.air.r);
      expect(Math.abs(form - literal)).toBeLessThanOrEqual(4 * EPS * g.air.r);
    }
  });

  it('14.2 the preconditioned density increment n + beta^2 (dRho - n)', () => {
    const next = rng(7);
    for (let k = 0; k < 200; k++) {
      const rc = 0.2 + next();
      const P = randomPrim(next, 60, 0.05, rc);
      const beta2 = 10 ** (-6 * next());
      const dU = Float64Array.from({ length: 6 }, () => next() - 0.5);
      dU[4] = 1e4 * (next() - 0.5);
      const literal = Float64Array.from(dU);
      preconditionIncrement(ref, P, 0, rc, beta2, literal, 0);
      // the kernel's form (kernels.ts preconditionIncrement)
      const u = P[1] ?? NaN;
      const v = P[2] ?? NaN;
      const rw = P[3] ?? NaN;
      const tP = P[6] ?? NaN;
      const w = rw / rc;
      const phi = productsFraction(ref.gas, P[5] ?? NaN);
      const t = ref.t + tP;
      const cp = cpMix(ref.gas, t, phi);
      const q2 = u * u + v * v + w * w;
      const dRho = dU[0] ?? NaN;
      const y =
        ref.r * tP +
        phi * (ref.gas.products.r - ref.gas.air.r) * t -
        0.5 * (ref.u * ref.u + q2) +
        deltaE(ref, tP, phi);
      const n =
        (y * dRho - dU[4] + u * (dU[1] ?? NaN) + v * (dU[2] ?? NaN) + (w * (dU[3] ?? NaN)) / rc) /
        (cp * t);
      const form = n + beta2 * (dRho - n);
      // the literal form loses ~eps |dp / c^2| to cancellation; the scale bounds both roundings
      const scale = Math.abs(dRho) + Math.abs(n) + Math.abs(dU[4] / (cp * t));
      expect(Math.abs(form - (literal[0] ?? NaN))).toBeLessThanOrEqual(64 * EPS * scale);
    }
  });

  it("14.3 the momentum and velocity gauges: u - u_inf = ((rho u)' - rho' u_inf) / rho", () => {
    const next = rng(11);
    for (let k = 0; k < 200; k++) {
      const rc = 0.2 + next();
      const P = randomPrim(next, 100, 0.05, rc);
      const U = new Float64Array(6);
      primToCons(ref, P, 0, rc, U, 0);
      const Q = new Float64Array(NP);
      consToPrim(ref, U, 0, rc, Q, 0);
      const mGauge = (U[1] ?? NaN) - ref.rho * ref.u;
      const du = (mGauge - (U[0] ?? NaN) * ref.u) / (ref.rho + (U[0] ?? NaN));
      expect(Math.abs(du - ((Q[1] ?? NaN) - ref.u))).toBeLessThanOrEqual(8 * EPS * ref.u);
      // q^2 - q_inf^2 from the gauge: du (du + 2 u_inf) = (u - u_inf)(u + u_inf)
      const u = Q[1] ?? NaN;
      expect(Math.abs(du * (du + 2 * ref.u) - (u - ref.u) * (u + ref.u))).toBeLessThanOrEqual(
        64 * EPS * ref.u * ref.u,
      );
    }
  });

  it('14.3-14.5 SLAU2 as the gauge flux difference: G = F - F_inf(S)', () => {
    const next = rng(3);
    const F = new Float64Array(6);
    let expansions = 0;
    let supersonic = 0;
    for (let k = 0; k < 400; k++) {
      const rf = 0.2 + next();
      const a = 2 * Math.PI * next();
      const nx = Math.cos(a);
      const nr = Math.sin(a);
      const area = 0.01 + next();
      const du = k % 4 === 0 ? 600 : 80; // every fourth face reaches |M| >= 1 or g != 0
      const L = randomPrim(next, du, 0.05, rf);
      const R = randomPrim(next, du, 0.05, rf);
      const machCut = k % 3 === 0 ? 0.01 : 1;
      slau2Flux(ref, L, 0, R, 0, nx, nr, area, rf, F, machCut);
      const G = gaugeSlau2(ref, L, R, nx, nr, area, rf, machCut);
      const fInf = [ref.rho * ref.u * nx, ref.rho * ref.u * ref.u * nx, 0, 0, 0, 0];
      for (let m = 0; m < 6; m++) {
        const want = (F[m] ?? NaN) - area * (fInf[m] ?? NaN);
        const scale = Math.abs(F[m] ?? NaN) + Math.abs(area * (fInf[m] ?? NaN)) + 1e-300;
        expect(Math.abs((G[m] ?? NaN) - want), `face ${k} component ${m}`).toBeLessThanOrEqual(
          1e-12 * scale,
        );
      }
      const cL = soundSpeed(ref.gas, ref.t + (L[6] ?? NaN), productsFraction(ref.gas, L[5] ?? 0));
      const vnL = (L[1] ?? NaN) * nx + (L[2] ?? NaN) * nr;
      const vnR = (R[1] ?? NaN) * nx + (R[2] ?? NaN) * nr;
      if (vnL < 0 && vnR > 0) expansions++;
      if (Math.abs(vnL) > cL) supersonic++;
    }
    expect(expansions).toBeGreaterThan(20);
    expect(supersonic).toBeGreaterThan(5);
  });

  it('14.3 the free stream is an exact zero of the gauge flux (f64 here, f32 on the GPU)', () => {
    const P = physicalToPrim(ref, { rho: ref.rho, u: ref.u, v: 0, w: 0, p: ref.p, z: 0 }, 0.7);
    for (const a of [0, 0.3, 1.2, Math.PI / 2, 2.5]) {
      const G = gaugeSlau2(ref, P, P, Math.cos(a), Math.sin(a), 0.4, 0.7, 1);
      expect(G.every((x) => x === 0)).toBe(true);
    }
  });

  it('14.6 SSP-RK3 in its Butcher form: U + (inc1 + inc2) / 6 + 2 inc3 / 3', () => {
    const next = rng(5);
    for (let k = 0; k < 100; k++) {
      const U = 1e3 * (next() - 0.5);
      const [i1, i2, i3] = [next() - 0.5, next() - 0.5, next() - 0.5];
      const U1 = U + i1;
      const U2 = 0.75 * U + 0.25 * (U1 + i2);
      const shuOsher = U / 3 + (2 / 3) * (U2 + i3);
      const butcher = U + i1 / 6 + i2 / 6 + (2 * i3) / 3;
      expect(Math.abs(shuOsher - butcher)).toBeLessThanOrEqual(8 * EPS * Math.abs(U));
    }
  });
});
