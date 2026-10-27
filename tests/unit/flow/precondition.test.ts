// Low-Mach preconditioning of the pseudo-time derivative (docs/SOLVER.md section 10, decision
// D4-10): the increment's pressure part scaled by beta^2 and nothing else, the preconditioned
// spectral radius in the local time step, identity at beta = 1, exact ambient, and the same steady
// state as the unpreconditioned scheme, reached in fewer iterations.
import { describe, expect, it } from 'vitest';
import {
  THERMALLY_PERFECT,
  caloricallyPerfectGas,
  cpMix,
  referenceState,
} from '../../../src/flow/reference/gas';
import {
  lowMachBeta2,
  preconditionIncrement,
  spectralRadius,
} from '../../../src/flow/reference/precondition';
import { boundaryParams, ghostPrimitive } from '../../../src/flow/reference/boundary';
import { ReferenceSolver } from '../../../src/flow/reference/solver';
import { NP, NU, consToPrim, physicalToPrim, primToCons } from '../../../src/flow/reference/state';
import { converge } from '../../ladder/common';
import { BC, rectangle, singleBlock, solverMesh, threeBlockRow } from './helpers';

const AMBIENT = { pressure: 101325, temperature: 288.15, velocity: 0 } as const;

describe('preconditioner (pure parts)', () => {
  const ref = referenceState(THERMALLY_PERFECT, {
    pressure: 101325,
    temperature: 288.15,
    velocity: 12,
  });

  it('beta^2 is the local Mach number squared between minMach^2 and 1', () => {
    const P = physicalToPrim(ref, { rho: 1.1, u: 30, v: -10, w: 20, p: 99000, z: 0 }, 0.3);
    const m2 = (30 ** 2 + 10 ** 2 + 20 ** 2) / (P[7] as number) ** 2;
    expect(lowMachBeta2(P, 0, 0.3, 0.01, 0, 1.1)).toBeCloseTo(m2, 15);
    expect(lowMachBeta2(P, 0, 0.3, 0.01, 0.4 * 1.1 * (P[7] as number) ** 2, 1.1)).toBeCloseTo(
      0.4,
      12,
    );
    expect(lowMachBeta2(P, 0, 0.3, 0.5, 0, 1.1)).toBe(0.25);
    expect(lowMachBeta2(P, 0, 0.3, 2, 0, 1.1)).toBe(1);
  });

  it('the spectral radius is |vn| + c at beta = 1 and of order |vn| at low Mach', () => {
    expect(spectralRadius(-20, 340, 1)).toBe(360);
    const b2 = (20 / 340) ** 2;
    const lam = spectralRadius(20, 340, b2);
    expect(lam).toBeCloseTo(
      0.5 * ((1 + b2) * 20 + Math.sqrt((1 - b2) ** 2 * 400 + 4 * b2 * 340 ** 2)),
      12,
    );
    expect(lam).toBeLessThan(2 * 20);
  });

  it('scales the pressure increment by beta^2 and keeps u, v, rw, entropy and Z', () => {
    const rc = 0.4;
    const P0 = physicalToPrim(ref, { rho: 0.9, u: 25, v: 8, w: -30, p: 1.1e5, z: 0 }, rc);
    const U = new Float64Array(NU);
    primToCons(ref, P0, 0, rc, U, 0);
    const dU = Float64Array.from([1e-6, 3e-5, -2e-5, 4e-6, 7e-2, 0]);
    const beta2 = 0.0123;
    const pre = Float64Array.from(dU);
    preconditionIncrement(ref, P0, 0, rc, beta2, pre, 0);
    const prim = (d: Float64Array) => {
      const q = new Float64Array(NP);
      consToPrim(
        ref,
        U.map((x, k) => x + (d[k] as number)),
        0,
        rc,
        q,
        0,
      );
      return q;
    };
    const plain = prim(dU);
    const scaled = prim(pre);
    const delta = (q: Float64Array, k: number) => (q[k] as number) - (P0[k] as number);
    // first order in the increment: relative 1e-6 of each component's change
    expect(delta(scaled, 4) / delta(plain, 4)).toBeCloseTo(beta2, 5);
    for (const k of [1, 2, 3]) expect(delta(scaled, k) / delta(plain, k)).toBeCloseTo(1, 5);
    // entropy s = phi_s(T) - R ln p: unchanged, i.e. cp dT / T = R dp / p along the correction
    const ds = (q: Float64Array) => {
      const t = ref.t + (q[6] as number);
      const t0 = ref.t + (P0[6] as number);
      const p = ref.p + (q[4] as number);
      const p0 = ref.p + (P0[4] as number);
      return cpMix(THERMALLY_PERFECT, t0, 0) * Math.log(t / t0) - ref.r * Math.log(p / p0);
    };
    expect(Math.abs(ds(scaled) - ds(plain))).toBeLessThan(1e-6 * Math.abs(ds(plain)) + 1e-12);
  });
});

describe('far field under preconditioning', () => {
  const ref = referenceState(THERMALLY_PERFECT, {
    pressure: 101325,
    temperature: 288.15,
    velocity: 3.4,
  });
  const q = physicalToPrim(ref, { rho: 1.2251, u: 3.1, v: 0.2, w: 0, p: 101327, z: 0 }, 1);
  const ghost = (beta2: number, nx: number) => {
    const out = new Float64Array(NP);
    ghostPrimitive(
      ref,
      boundaryParams(ref, { farFieldBeta2: beta2 }),
      BC.FARFIELD,
      q,
      0,
      nx,
      0,
      out,
      0,
    );
    return out;
  };

  it('is the physical far field at beta^2 = 1', () => {
    const plain = new Float64Array(NP);
    ghostPrimitive(ref, boundaryParams(ref), BC.FARFIELD, q, 0, 1, 0, plain, 0);
    expect(ghost(1, 1)).toEqual(plain);
  });

  it('keeps the outgoing preconditioned characteristic and zeroes the incoming one', () => {
    const b2 = 1e-4;
    for (const nx of [1, -1]) {
      const g = ghost(b2, nx);
      const vn = ref.u * nx;
      const root = Math.sqrt((1 - b2) ** 2 * vn * vn + 4 * b2 * ref.c * ref.c);
      const ap = ref.rho * (0.5 * ((1 + b2) * vn + root) - b2 * vn);
      const am = ref.rho * (0.5 * ((1 + b2) * vn - root) - b2 * vn);
      const dun = (u: number, v: number) => (u - ref.u) * nx + v * 0;
      const wCell = (q[4] as number) + ap * dun(q[1] as number, q[2] as number);
      expect((g[4] as number) + ap * dun(g[1] as number, g[2] as number)).toBeCloseTo(wCell, 9);
      expect((g[4] as number) + am * dun(g[1] as number, g[2] as number)).toBeCloseTo(0, 9);
    }
  });

  it('lets a far-field duct at M 0.01 converge (the physical far field diverged with it)', () => {
    const duct = solverMesh(
      singleBlock(rectangle('duct', -0.3, 0.3, 0, 0.6, 24, 8), {
        imin: BC.FARFIELD,
        imax: BC.FARFIELD,
        jmin: BC.AXIS,
        jmax: BC.SLIP_WALL,
      }),
    );
    const u = 0.01 * 340.29;
    const s = new ReferenceSolver(duct, {
      gas: caloricallyPerfectGas(1.4, 287.05287),
      freeStream: { pressure: 101325, temperature: 288.15, velocity: u },
      lowMachPreconditioning: { minMach: 0.01 },
    });
    s.setBlockage(
      Float64Array.from(duct.cellX, (x) =>
        Math.abs(x) < 0.1 ? 1 - 0.15 * Math.cos((Math.PI * x) / 0.2) ** 2 : 1,
      ),
    );
    s.setUniform({ rho: s.ref.rho, u, v: 0, w: 0, p: 101325, z: 0 });
    const conv = converge(s, 1e-10, 3000);
    expect(conv.converged).toBe(true);
  }, 120_000);
});

describe('preconditioned tracking mode', () => {
  const mesh = solverMesh(
    threeBlockRow(0.2, 0.15, 6, 5, {
      left: BC.INFLOW,
      right: BC.OUTFLOW,
      bottom: BC.AXIS,
      top: BC.FARFIELD,
    }),
  );
  const pulse = (x: number, r: number) => {
    const g = Math.exp(-((x - 0.25) ** 2 + (r - 0.07) ** 2) / 0.003);
    return {
      rho: 1.225 * (1 + 0.01 * g),
      u: 20 + 5 * g,
      v: -3 * g,
      w: 10 * g,
      p: 101325 * (1 + 0.01 * g),
      z: 0,
    };
  };
  const fs = { pressure: 101325, temperature: 288.15, velocity: 20 } as const;

  it('is the plain scheme, bitwise, when minMach >= 1', () => {
    const a = new ReferenceSolver(mesh, { gas: THERMALLY_PERFECT, freeStream: fs });
    const b = new ReferenceSolver(mesh, {
      gas: THERMALLY_PERFECT,
      freeStream: fs,
      lowMachPreconditioning: { minMach: 1 },
    });
    a.setState(pulse);
    b.setState(pulse);
    a.iterate(3);
    b.iterate(3);
    expect(b.U).toEqual(a.U);
    expect(b.localDt()).toEqual(a.localDt());
  });

  it('keeps the quiescent ambient exactly', () => {
    const s = new ReferenceSolver(mesh, {
      gas: THERMALLY_PERFECT,
      freeStream: AMBIENT,
      lowMachPreconditioning: { minMach: 0.01 },
    });
    s.iterate(3);
    expect(s.U.every((x) => x === 0)).toBe(true);
  });

  it('takes the preconditioned local time step', () => {
    const plain = new ReferenceSolver(mesh, { gas: THERMALLY_PERFECT, freeStream: fs });
    const pre = new ReferenceSolver(mesh, {
      gas: THERMALLY_PERFECT,
      freeStream: fs,
      lowMachPreconditioning: { minMach: 0.01 },
    });
    plain.setState(pulse);
    pre.setState(pulse);
    const ratio = pre.localDt().map((dt, c) => dt / (plain.localDt()[c] as number));
    // M ~ 0.06: the acoustic speed no longer sets the step, which grows by about 1 / (M + small)
    for (const r of ratio) expect(r).toBeGreaterThan(4);
  });

  it('converges a low-Mach blockage duct from rest, to a steady state of the plain scheme', () => {
    const duct = solverMesh(
      singleBlock(rectangle('duct', -0.3, 0.3, 0.5, 0.6, 24, 3), {
        imin: BC.INFLOW,
        imax: BC.OUTFLOW,
        jmin: BC.SLIP_WALL,
        jmax: BC.SLIP_WALL,
      }),
    );
    const gas = caloricallyPerfectGas(1.4, 287.05287);
    const b = Float64Array.from(duct.cellX, (x) =>
      Math.abs(x) < 0.1 ? 1 - 0.15 * Math.cos((Math.PI * x) / 0.2) ** 2 : 1,
    );
    const opts = {
      gas,
      freeStream: AMBIENT,
      inflowTotal: { p0: 101325, t0: 288.15 },
      outflowPressure: 101325 * 0.998,
    };
    // machCut 1: the D4-20 dissipation scaling off, so this checks the preconditioner alone
    const pre = new ReferenceSolver(duct, {
      ...opts,
      lowMachPreconditioning: { minMach: 0.01, machCut: 1 },
    });
    pre.setBlockage(b);
    // M 0.06 at the throat; the plain scheme is still at 6e2 x its first residual after 20000
    // iterations from rest (acoustic waves between the reflecting inflow and outflow)
    const conv = converge(pre, 1e-11, 6000);
    expect(conv.converged).toBe(true);
    expect(conv.iterations).toBeLessThan(4000);
    // the plain scheme, started from the preconditioned steady state, stays there: R = 0 is the same
    // equation with and without the preconditioner. (Only 30 iterations: with blockage the plain
    // scheme has a slowly growing mode about this state, x1e3 in 300 iterations; handoff W2R-6.)
    const plain = new ReferenceSolver(duct, opts);
    plain.setBlockage(b);
    plain.U.set(pre.U);
    const P0 = Float64Array.from(pre.primitives().subarray(0, NP * duct.nCells));
    const r = plain.iterate(30).residualDensityL2;
    expect(r).toBeLessThan(1e-10 * conv.first);
    const P1 = plain.primitives();
    // per field: rho', p' against their own scale, u and v against max |u| (as SOLVER.md 12.2)
    const scale = (k: number) => {
      let m = 0;
      for (let c = 0; c < duct.nCells; c++) m = Math.max(m, Math.abs(P0[NP * c + k] as number));
      return m;
    };
    for (const [k, sk] of [
      [0, 0],
      [1, 1],
      [2, 1],
      [4, 4],
    ] as const) {
      let diff = 0;
      for (let c = 0; c < duct.nCells; c++)
        diff = Math.max(diff, Math.abs((P1[NP * c + k] as number) - (P0[NP * c + k] as number)));
      expect(diff).toBeLessThanOrEqual(1e-9 * scale(sk));
    }
  }, 120_000);
});

describe('low-Mach dissipation scaling in the solver (D4-20)', () => {
  const mesh = solverMesh(
    threeBlockRow(0.2, 0.15, 6, 5, {
      left: BC.FARFIELD,
      right: BC.FARFIELD,
      bottom: BC.AXIS,
      top: BC.FARFIELD,
    }),
  );
  const fs = { pressure: 101325, temperature: 288.15, velocity: 3 } as const;
  const bump = (x: number, r: number) => {
    const g = Math.exp(-((x - 0.25) ** 2 + (r - 0.07) ** 2) / 0.003);
    return { rho: 1.225, u: 3 + g, v: -0.5 * g, w: g, p: 101325 + 20 * g, z: 0 };
  };
  const make = (pre?: { minMach: number; machCut?: number }) => {
    const s = new ReferenceSolver(mesh, {
      gas: THERMALLY_PERFECT,
      freeStream: fs,
      ...(pre === undefined ? {} : { lowMachPreconditioning: pre }),
    });
    s.setState(bump);
    return s;
  };

  it('changes the tracking residual (default M_cut = minMach), not with machCut >= 1', () => {
    const off = make({ minMach: 0.01, machCut: 1 }).residual();
    const on = make({ minMach: 0.01 }).residual();
    const plain = make().residual();
    expect(off).toEqual(plain);
    let diff = 0;
    for (let k = 0; k < on.length; k += NU)
      diff = Math.max(diff, Math.abs((on[k] as number) - (off[k] as number)));
    expect(diff).toBeGreaterThan(0);
    // the default cut is minMach: the same residual as machCut = minMach given explicitly
    expect(make({ minMach: 0.01, machCut: 0.01 }).residual()).toEqual(on);
  });

  it('leaves the physical-time mode unscaled', () => {
    const a = make({ minMach: 0.01 });
    const b = make();
    const dt = b.globalDt();
    a.stepPhysical(dt);
    b.stepPhysical(dt);
    expect(a.U).toEqual(b.U);
  });
});

