// The blade-row body forces (PHYSICS.md 3.3 CP1): Hall-Thollet with blockage on the compressor
// rows, a stiff follow-camber relaxation on the turbine rows, point-implicit, Euler work exact.
import { describe, expect, it } from 'vitest';
import { THRESHOLDS } from '../../../../src/contracts/thresholds';
import { ENGINE_DEFINITION as DEF } from '../../../../src/engine/definition';
import {
  BODY_FORCE_KIND,
  BODY_FORCE_STRIDE,
  STALL_INCIDENCE_RAD,
  bodyForceCoefficients,
  bodyForceSource,
  cellForce,
  stallSaturation,
  wrapAngle,
} from '../../../../src/flow/coupling/bodyForce';
import { UNIT_KNOBS } from '../../../../src/flow/coupling/knobs';
import { meshRows, rowBlockageField } from '../../../../src/flow/coupling/rows';
import { THERMALLY_PERFECT, referenceState } from '../../../../src/flow/reference/gas';
import { NP, NU } from '../../../../src/flow/reference/state';
import { engineSolverMesh } from './engineMesh';

const CP1 = THRESHOLDS.CP1.values;

/** A coefficient record (BODY_FORCE_STRIDE values) for the pure per-cell tests. */
function coef(kind: number, omega = -1500, kappa = 0.8): Float64Array {
  // omega, kappa, cN, cP, deltaStall, cf2, kRev, kind
  return Float64Array.from([omega, kappa, 40, 6, STALL_INCIDENCE_RAD, 0.006, 3, kind]);
}

/** Deterministic pseudo-random numbers in [0, 1) (a 32-bit LCG; no unseeded randomness). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const out = new Float64Array(6);
function force(k: Float64Array, u: number, v: number, w: number, r = 0.3, c = 340): number[] {
  cellForce(k, 0, u, v, w, r, c, out);
  return Array.from(out);
}

function maxDiff(a: number[], b: number[]): number {
  let d = 0;
  for (let m = 0; m < 3; m++) d = Math.max(d, Math.abs((a[m] ?? NaN) - (b[m] ?? NaN)));
  return d;
}

describe('the stall saturation and the reversed-flow loss (CP1: continuous in the incidence)', () => {
  it('saturates the incidence beyond the stall, continuously, and returns to 0 at a reversed camber', () => {
    const ds = STALL_INCIDENCE_RAD;
    expect(stallSaturation(0.05, ds)).toBe(0.05);
    expect(stallSaturation(-0.05, ds)).toBe(-0.05);
    for (const s of [1, -1]) {
      const below = stallSaturation(s * (ds - 1e-10), ds);
      const above = stallSaturation(s * (ds + 1e-10), ds);
      expect(Math.abs(above - below)).toBeLessThan(3e-10);
    }
    expect(Math.abs(stallSaturation(Math.PI, ds))).toBeLessThan(1e-15);
    expect(Math.abs(stallSaturation(-Math.PI, ds))).toBeLessThan(1e-15);
    // saturated: never more than the stall incidence
    for (let d = -Math.PI; d <= Math.PI; d += 0.01) {
      expect(Math.abs(stallSaturation(d, ds))).toBeLessThanOrEqual(ds + 1e-15);
    }
    expect(wrapAngle(Math.PI + 0.1)).toBeCloseTo(-Math.PI + 0.1, 14);
    expect(wrapAngle(-Math.PI - 0.1)).toBeCloseTo(Math.PI - 0.1, 14);
    expect(wrapAngle(0.3)).toBe(0.3);
  });

  it('is continuous in the force across the stall switch, the reversed-flow switch and the wrap', () => {
    const k = coef(BODY_FORCE_KIND.compressor);
    const omega = k[0] ?? NaN;
    const kappa = k[1] ?? NaN;
    const r = 0.3;
    // relative flow at the angle kappa + delta and 200 m/s
    const at = (delta: number) => {
      const beta = kappa + delta;
      return force(k, 200 * Math.cos(beta), 10, 200 * Math.sin(beta) + omega * r, r);
    };
    const scale = Math.max(...at(STALL_INCIDENCE_RAD).slice(0, 3).map(Math.abs));
    expect(scale).toBeGreaterThan(0);
    for (const d of [STALL_INCIDENCE_RAD, -STALL_INCIDENCE_RAD]) {
      expect(maxDiff(at(d - 1e-9), at(d + 1e-9))).toBeLessThan(1e-6 * scale);
    }
    // the reversed-flow switch: the axial relative velocity through 0 (delta = pi/2 - kappa)
    const zero = Math.PI / 2 - kappa;
    expect(maxDiff(at(zero - 1e-9), at(zero + 1e-9))).toBeLessThan(1e-6 * scale);
    // the wrap at delta = +-pi (the flow exactly against the camber line)
    expect(maxDiff(at(Math.PI - 1e-9), at(-Math.PI + 1e-9))).toBeLessThan(1e-6 * scale);
  });

  it('adds a loss in reversed flow that is 0 in forward flow', () => {
    const k = coef(BODY_FORCE_KIND.compressor, 0, 0);
    const kNoRev = Float64Array.from(k);
    kNoRev[6] = 0;
    // forward along the camber: the reversed-flow term does nothing
    expect(force(k, 150, 0, 0)).toEqual(force(kNoRev, 150, 0, 0));
    // reversed: more drag with it (the force points along +x against a flow toward -x)
    expect(force(k, -150, 0, 0)[0] ?? NaN).toBeGreaterThan(force(kNoRev, -150, 0, 0)[0] ?? NaN);
  });
});

describe('the force directions (Hall-Thollet and follow-camber)', () => {
  it('turns the relative flow toward the camber, with a normal force that does no work in the relative frame', () => {
    const k = coef(BODY_FORCE_KIND.compressor);
    k[3] = 0; // cP: no loss
    const omega = k[0] ?? NaN;
    const r = 0.3;
    const rand = lcg(7);
    for (let n = 0; n < 200; n++) {
      const u = 50 + 250 * rand();
      const v = -30 + 60 * rand();
      const w = -200 + 400 * rand();
      const f = force(k, u, v, w, r);
      const wTheta = w - omega * r;
      const dot = u * (f[0] ?? NaN) + v * (f[1] ?? NaN) + wTheta * (f[2] ?? NaN);
      const mag = Math.hypot(u, v, wTheta) * Math.hypot(f[0] ?? NaN, f[1] ?? NaN, f[2] ?? NaN);
      expect(Math.abs(dot)).toBeLessThanOrEqual(1e-12 * mag);
      // toward the camber: a relative angle above kappa gets a swirl force toward -theta
      const delta = Math.atan2(wTheta, u) - (k[1] ?? NaN);
      if (delta > 1e-3) expect(f[2] ?? NaN).toBeLessThan(0);
      if (delta < -1e-3) expect(f[2] ?? NaN).toBeGreaterThan(0);
    }
  });

  it('dissipates: every force does negative or zero work on the relative flow, and the damping is >= 0', () => {
    const rand = lcg(11);
    for (const kind of [BODY_FORCE_KIND.compressor, BODY_FORCE_KIND.turbine]) {
      const k = coef(kind);
      const omega = k[0] ?? NaN;
      for (let n = 0; n < 300; n++) {
        const u = -100 + 400 * rand();
        const v = -50 + 100 * rand();
        const w = -300 + 600 * rand();
        const f = force(k, u, v, w);
        const wTheta = w - omega * 0.3;
        const power = u * (f[0] ?? NaN) + v * (f[1] ?? NaN) + wTheta * (f[2] ?? NaN);
        expect(power).toBeLessThanOrEqual(1e-9);
        for (let m = 3; m < 6; m++) {
          expect(f[m] ?? NaN).toBeGreaterThanOrEqual(0);
          expect(Number.isFinite(f[m] ?? NaN)).toBe(true);
        }
      }
    }
  });

  it('relaxes the turbine rows toward the camber: no force along it but the loss', () => {
    const k = coef(BODY_FORCE_KIND.turbine, 0, -1.2);
    k[3] = 0;
    const along = force(k, 200 * Math.cos(-1.2), 0, 200 * Math.sin(-1.2));
    for (let m = 0; m < 3; m++) expect(Math.abs(along[m] ?? NaN)).toBeLessThan(1e-9);
    // off the camber toward +theta: pushed back toward -theta
    expect(force(k, 200 * Math.cos(-1.1), 0, 200 * Math.sin(-1.1))[2] ?? NaN).toBeLessThan(0);
    // no row, or no flow: no force
    expect(force(coef(BODY_FORCE_KIND.none), 100, 0, 50)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(force(coef(BODY_FORCE_KIND.compressor, 0), 0, 0, 0)).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe('CP1 on the 130k mesh: the Euler work of every row (oracle)', () => {
  const mesh = engineSolverMesh();
  const rows = meshRows(mesh, DEF);
  const ref = referenceState(THERMALLY_PERFECT, {
    pressure: 101325,
    temperature: 288.15,
    velocity: 0,
  });
  // the design point's speeds (rad/s; FlowTargets carries magnitudes)
  const op = {
    n1RadPerS: (DEF.designPoint.n1Rpm * 2 * Math.PI) / 60,
    n2RadPerS: (DEF.designPoint.n2Rpm * 2 * Math.PI) / 60,
    vsvClosureRad: 0.2,
  };
  const k = bodyForceCoefficients(mesh, rows, DEF, op, UNIT_KNOBS);

  it('gives every row cell its row kind and speed, and every other cell none', () => {
    expect(k.length).toBe(BODY_FORCE_STRIDE * mesh.nCells);
    const inRow = new Uint8Array(mesh.nCells);
    for (const r of rows) {
      const turbine = r.row.component === 'hpt' || r.row.component === 'lpt';
      const sign = r.row.spool === 'none' ? 0 : DEF.rotation[r.row.spool];
      const n = r.row.spool === 'lp' ? op.n1RadPerS : op.n2RadPerS;
      for (const c of r.cells) {
        inRow[c] = 1;
        const o = BODY_FORCE_STRIDE * c;
        expect(k[o + 7]).toBe(turbine ? BODY_FORCE_KIND.turbine : BODY_FORCE_KIND.compressor);
        expect(k[o]).toBe(sign * n);
        expect(k[o + 2] ?? NaN).toBeGreaterThan(0);
      }
    }
    for (let c = 0; c < mesh.nCells; c++) {
      if (inRow[c] === 0) expect(k[BODY_FORCE_STRIDE * c + 7]).toBe(BODY_FORCE_KIND.none);
    }
  });

  it("integrates each row's energy source to Omega x its angular-momentum source within 1e-4", () => {
    // a swirling, mostly axial state in every row (deterministic): u about 150 m/s, w varying
    const prim = new Float64Array(NP * (mesh.nCells + mesh.nGhosts));
    for (let c = 0; c < mesh.nCells; c++) {
      const r = mesh.cellR[c] ?? NaN;
      const x = mesh.cellX[c] ?? NaN;
      const o = NP * c;
      prim[o] = 0.02 * Math.sin(7 * x);
      prim[o + 1] = 150 + 20 * Math.cos(3 * x);
      prim[o + 2] = 5;
      prim[o + 3] = r * (-60 + 40 * Math.sin(11 * r));
      prim[o + 7] = 340;
    }
    const rate = new Float64Array(NU * mesh.nCells);
    const damping = new Float64Array(NU * mesh.nCells);
    const blockage = rowBlockageField(mesh, rows);
    bodyForceSource(k)(
      { mesh, ref, prim, U: new Float64Array(NU * mesh.nCells), blockage, time: 0 },
      { rate, damping },
    );
    for (const r of rows) {
      let energy = 0;
      let torque = 0;
      for (const c of r.cells) {
        const bv = (blockage[c] ?? NaN) * (mesh.cellVolR[c] ?? NaN);
        energy += bv * (rate[NU * c + 4] ?? NaN);
        torque += bv * (rate[NU * c + 3] ?? NaN);
      }
      const omega = k[BODY_FORCE_STRIDE * (r.cells[0] ?? 0)] ?? NaN;
      expect(Math.abs(torque), r.row.id).toBeGreaterThan(0);
      if (omega === 0) expect(energy, r.row.id).toBe(0);
      else
        expect(
          Math.abs(energy - omega * torque) / Math.abs(omega * torque),
          r.row.id,
        ).toBeLessThanOrEqual(CP1.maxEulerWorkRelativeError.value);
    }
    // the point-implicit damping is non-negative everywhere; a rotor's energy takes its torque's
    // (so the Euler work holds through a stiff stage too: the energy's increment is Omega x the
    // angular momentum's, both divided by the same factor), a stator's energy and the fuel none
    for (let c = 0; c < mesh.nCells; c++) {
      for (let m = 0; m < NU; m++) expect(damping[NU * c + m] ?? NaN).toBeGreaterThanOrEqual(0);
      const omega = k[BODY_FORCE_STRIDE * c] ?? NaN;
      expect(damping[NU * c + 4]).toBe(omega === 0 ? 0 : damping[NU * c + 3]);
      expect(damping[NU * c + 5]).toBe(0);
    }
    // 130k cells x (sources + 6 checks): a few seconds, over vitest's 5 s default on a loaded laptop
  }, 60_000);
});
