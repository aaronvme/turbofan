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
  neighbourSpectralRadius,
  preconditionIncrement,
  spectralRadius,
} from '../../../src/flow/reference/precondition';
import { boundaryParams, ghostPrimitive } from '../../../src/flow/reference/boundary';
import {
  DEFAULT_CFL,
  DEFAULT_CFL_PRECONDITIONED,
  ReferenceSolver,
  type SolverOptions,
} from '../../../src/flow/reference/solver';
import { NP, NU, consToPrim, physicalToPrim, primToCons } from '../../../src/flow/reference/state';
import { converge } from '../../ladder/common';
import { BC, facePatches, rectangle, singleBlock, solverMesh, threeBlockRow } from './helpers';

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
    // machCut 1: the far field alone, without the D4-20 scaling
    const conv = converge(ffDuct(ductMesh(), 1), 1e-10, 3000);
    expect(conv.converged).toBe(true);
  }, 120_000);

  // D4-20 on the same duct (M 0.01 free stream, M 0.012 at the blockage): with M_cut above the
  // flow's Mach the scaled diffusion is a constant multiple (1/f_a(0.02) = 25) and converges
  // faster than unscaled (1e-12 at 1200 against 1500 iterations)
  it('converges the far-field duct with the D4-20 scaling at M_cut 0.02 (above the flow Mach)', () => {
    const conv = converge(ffDuct(ductMesh(), 0.02), 1e-10, 3000);
    expect(conv.converged).toBe(true);
  }, 120_000);

  // With M_cut <= the flow's Mach, M_ref follows the local Mach and, with the sharp van Albada
  // switch at ab = 0, the residual cycles at 3e-3 of the first at any CFL (D4-25's case).
  it.fails(
    'converges the far-field duct with the D4-20 scaling at M_cut = minMach (open: limiter)',
    () => {
      const conv = converge(ffDuct(ductMesh(), 0.01), 1e-10, 3000);
      expect(conv.converged).toBe(true);
    },
    120_000,
  );

  // the smooth form (the D4-25 trial, option limiter 'smooth') has no switch: this case converges
  it('converges it with the smooth van Albada trial form (D4-25)', () => {
    const conv = converge(ffDuct(ductMesh(), 0.01, 'smooth'), 1e-10, 3000);
    expect(conv.converged).toBe(true);
  }, 120_000);
});

function ductMesh() {
  return solverMesh(
    singleBlock(rectangle('duct', -0.3, 0.3, 0, 0.6, 24, 8), {
      imin: BC.FARFIELD,
      imax: BC.FARFIELD,
      jmin: BC.AXIS,
      jmax: BC.SLIP_WALL,
    }),
  );
}

/** The M 0.01 far-field duct with a 15 % blockage, preconditioned at minMach 0.01. */
function ffDuct(
  duct: ReturnType<typeof solverMesh>,
  machCut: number,
  limiter: 'sharp' | 'smooth' = 'sharp',
) {
  const u = 0.01 * 340.29;
  const s = new ReferenceSolver(duct, {
    limiter,
    gas: caloricallyPerfectGas(1.4, 287.05287),
    freeStream: { pressure: 101325, temperature: 288.15, velocity: u },
    lowMachPreconditioning: { minMach: 0.01, machCut },
  });
  s.setBlockage(
    Float64Array.from(duct.cellX, (x) =>
      Math.abs(x) < 0.1 ? 1 - 0.15 * Math.cos((Math.PI * x) / 0.2) ** 2 : 1,
    ),
  );
  s.setUniform({ rho: s.ref.rho, u, v: 0, w: 0, p: 101325, z: 0 });
  return s;
}

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

  // D4-32: the pseudo-acoustic pair needs its own CFL (section 10, tests/unit/flow/rk.test.ts)
  it('takes DEFAULT_CFL_PRECONDITIONED when no CFL is given (minMach >= 1: the plain default)', () => {
    const solver = (minMach: number, cfl?: number) => {
      const s = new ReferenceSolver(mesh, {
        gas: THERMALLY_PERFECT,
        freeStream: fs,
        lowMachPreconditioning: { minMach },
        ...(cfl === undefined ? {} : { cfl }),
      });
      s.setState(pulse);
      return s.localDt();
    };
    expect(DEFAULT_CFL_PRECONDITIONED).toBe(0.8);
    expect(solver(0.01)).toEqual(solver(0.01, DEFAULT_CFL_PRECONDITIONED));
    const ratio = solver(0.01, 1.2).map((dt, c) => dt / (solver(0.01)[c] as number));
    for (const r of ratio) expect(r).toBeCloseTo(1.2 / DEFAULT_CFL_PRECONDITIONED, 12);
    expect(solver(1)).toEqual(solver(1, DEFAULT_CFL));
    // the CFL the tracking mode runs at, for the ladder's CFL-scaled caps (D4-45)
    const cflOf = (pre?: { minMach: number }, cfl?: number) =>
      new ReferenceSolver(mesh, {
        gas: THERMALLY_PERFECT,
        freeStream: fs,
        ...(pre === undefined ? {} : { lowMachPreconditioning: pre }),
        ...(cfl === undefined ? {} : { cfl }),
      }).trackingCfl;
    expect(cflOf({ minMach: 0.01 })).toBe(DEFAULT_CFL_PRECONDITIONED);
    expect(cflOf({ minMach: 1 })).toBe(DEFAULT_CFL);
    expect(cflOf()).toBe(DEFAULT_CFL);
    expect(cflOf({ minMach: 0.01 }, 1.2)).toBe(1.2);
  });

  // D4-81: the global cutoff of the standard preconditioners (Weiss & Smith 1995; Turkel's
  // beta^2 >= K M_ref^2), one floor on beta and on the flux's M_cut, the same in every cell, which
  // the caller ties to the domain's peak velocity. The pulse runs at M 0.06-0.07 (u 20-25 m/s), so a
  // cut of 0.1 binds in every cell and one of 0.005 in none. The far field (top) takes it too.
  it('takes a global M_cut as minMach = max(minMach, cut) and M_cut = max(M_cut, cut) (D4-81)', () => {
    type Pre = NonNullable<SolverOptions['lowMachPreconditioning']>;
    const run = (pre?: Pre) => {
      const s = new ReferenceSolver(mesh, {
        gas: THERMALLY_PERFECT,
        freeStream: fs,
        ...(pre === undefined ? {} : { lowMachPreconditioning: pre }),
      });
      s.setState(pulse);
      const dt = s.localDt();
      const residual = s.residual();
      s.iterate(3);
      return { U: Float64Array.from(s.U), dt, residual, cfl: s.trackingCfl };
    };
    const floored = run({ minMach: 0.1, machCut: 0.1 });
    // it binds: the run at minMach = M_cut = the cut, whatever M_cut was given below it
    expect(run({ minMach: 0.01, globalMachCut: 0.1 })).toEqual(floored);
    expect(run({ minMach: 0.01, machCut: 0.003, globalMachCut: 0.1 })).toEqual(floored);
    expect(run({ minMach: 0.01, globalMachCut: 0.1 }).U).not.toEqual(run({ minMach: 0.01 }).U);
    // below minMach and M_cut it changes nothing
    expect(run({ minMach: 0.01, globalMachCut: 0.005 })).toEqual(run({ minMach: 0.01 }));
    // the scaling switched off (M_cut >= 1) stays off, and minMach >= 1 stays the plain scheme
    expect(run({ minMach: 0.01, machCut: 1, globalMachCut: 0.1 })).toEqual(
      run({ minMach: 0.1, machCut: 1 }),
    );
    expect(run({ minMach: 1, globalMachCut: 0.1 })).toEqual(run());
    // a cut >= 1 is itself the plain scheme, at the plain CFL (W2R-N31; its GPU twin, W2K-N1, is
    // tests/gpu/oracle.test.ts's C-cut row)
    expect(run({ minMach: 0.01, globalMachCut: 1 })).toEqual(run());
    expect(() => run({ minMach: 0.01, globalMachCut: -0.01 })).toThrow(RangeError);
    expect(() => run({ minMach: 0.01, globalMachCut: Number.NaN })).toThrow(RangeError);
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
    // iterations from rest (acoustic waves between the reflecting inflow and outflow). At the
    // preconditioned default CFL 0.8 (D4-32) this takes 4723 iterations (< 4000 at CFL 1.5).
    const conv = converge(pre, 1e-11, 6000);
    expect(conv.converged).toBe(true);
    // W2R-N10: the bound restated for CFL 0.8 (4723 measured), so a slowdown of the path is caught
    expect(conv.iterations).toBeLessThan(5500);
    // the plain scheme, started from the preconditioned steady state, has R = 0 there too: it is the
    // same equation with and without the preconditioner. This checks the steady state, not its
    // stability, so it runs only 30 iterations: with blockage the plain scheme is linearly unstable
    // about this state, in tracking and in physical time (W2R-6, D4-29: max |dU| 1e-11 -> 0.5 in
    // 1000 iterations, saturating near 1 % of the state; KNOWN-FAIL pins in blockage.test.ts).
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
  // closed (walls and the axis), so the preconditioned far field (section 5) does not enter
  const mesh = solverMesh(
    threeBlockRow(0.2, 0.15, 6, 5, {
      left: BC.SLIP_WALL,
      right: BC.SLIP_WALL,
      bottom: BC.AXIS,
      top: BC.SLIP_WALL,
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

  // D4-44 (section 7): M_ref is the face's beta, so the residual depends on minMach at a fixed cut
  it('takes M_ref from the cells beta (D4-44): the residual follows minMach at a fixed M_cut', () => {
    const a = make({ minMach: 0.01, machCut: 0.003 }).residual();
    const b = make({ minMach: 0.05, machCut: 0.003 }).residual();
    let diff = 0;
    for (let k = 0; k < a.length; k += NU)
      diff = Math.max(diff, Math.abs((a[k] as number) - (b[k] as number)));
    expect(diff).toBeGreaterThan(0);
    // minMach 0.05 holds beta at 0.05 here (M ~ 0.01), the same as M_cut 0.05 with minMach 0.05
    expect(make({ minMach: 0.05, machCut: 0.05 }).residual()).toEqual(b);
  });

  it('evaluates beta from the current state for residual() (not the last iteration)', () => {
    const s = make({ minMach: 0.01 });
    const before = s.residual();
    s.iterate(3);
    s.setState(bump);
    expect(s.residual()).toEqual(before);
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

// D4-44 (c), docs/SOLVER.md section 10: where beta varies between cells, the face's beta_f differs
// from each cell's own beta, which a von Neumann analysis cannot cover. Two flow cases started from
// rest at the engine settings (minMach = M_cut = 0.003) and the default CFL 0.8; the rule stated
// before the runs: the residual <= 1e-5 of its peak, staying there 50 iterations, within 20000.
describe('D4-44 (c): preconditioned tracking where beta varies between cells', () => {
  const gas = caloricallyPerfectGas(1.4, 287.05287);
  const ENGINE = { minMach: 0.003, machCut: 0.003 } as const;

  // KNOWN-FAIL (D4-51): with D4-44 (a) R stalls at 4.2e-4 of its peak, the same absolute floor as
  // before (0.03 kg/(m^3 s)), and at CFL 0.4 too, so it is not the acoustic limit but the sharp
  // limiter's floor: D4-36's variants (a) and (b) converge it to 1e-6 in 1566 / 1390 iterations,
  // and neither met D4-36's rule (round 7, SOLVER.md 6). J (W2R-I8) wanders at 0.2-0.6 of its peak
  // with (a), at CFL 0.4, with either limiter variant and with the pressure-difference cutoff at
  // K = 1-100; a global M_cut >= 0.02 converges it (round 7, SOLVER.md 10). D4-59's trial (round 8):
  // at minMach = M_cut = 0.02 J meets the rule at 9441 and then rebounds to 1e-4, while R keeps its
  // limiter floor (4.3e-4 at 20000), so 0.02 is not adopted and both stay pinned at 0.003.
  it.fails(
    'R: converges a blockage duct started from rest (the dp term lifts beta)',
    () => {
      const duct = solverMesh(
        singleBlock(rectangle('duct', -0.3, 0.3, 0.5, 0.6, 24, 6), {
          imin: BC.INFLOW,
          imax: BC.OUTFLOW,
          jmin: BC.SLIP_WALL,
          jmax: BC.SLIP_WALL,
        }),
      );
      const s = new ReferenceSolver(duct, {
        gas,
        freeStream: AMBIENT,
        inflowTotal: { p0: 101325, t0: 288.15 },
        outflowPressure: 101325 * 0.998,
        lowMachPreconditioning: ENGINE,
      });
      s.setBlockage(
        Float64Array.from(duct.cellX, (x) =>
          Math.abs(x) < 0.1 ? 1 - 0.15 * Math.cos((Math.PI * x) / 0.2) ** 2 : 1,
        ),
      );
      s.setUniform({ rho: s.ref.rho, u: 0, v: 0, w: 0, p: 101325, z: 0 });
      // before D4-44 (M_ref = the face Mach): a limit cycle at 8e-5 of the peak at 20000
      const conv = converge(s, 1e-5, 20000, 'peak');
      expect(conv.converged).toBe(true);
    },
    600_000,
  );

  // J's pin is lifted by SOLVER.md 17 (W2S-I1, w3/scheme): with each face's eigenvalue the larger
  // of its two cells', the dead-air cells at beta = M_cut beside the jet take the jet's step on
  // their shared faces, and J meets the rule at 2415 iterations at 0.003, staying below 9.1e-6 of
  // its peak through 30000 (1.6e-8 at 28000; before: 0.24 at 20000). D4-52 had located the stall
  // in exactly those cells. R keeps its limiter floor (pinned above).
  it('J: converges a low-Mach jet into dead air (a shear layer beside cells at M_cut)', () => {
    const b = rectangle('jet', 0, 0.8, 0, 0.4, 32, 16);
    const mesh = solverMesh({
      blocks: [b],
      patches: [
        { block: 0, face: 'imin', start: 0, end: 4, bc: BC.INFLOW, label: 'nozzle' },
        { block: 0, face: 'imin', start: 4, end: 16, bc: BC.SLIP_WALL, label: 'base' },
        ...facePatches(b, 0, { imax: BC.OUTFLOW, jmin: BC.AXIS, jmax: BC.FARFIELD }),
      ],
    });
    const M = 0.05;
    const s = new ReferenceSolver(mesh, {
      gas,
      freeStream: AMBIENT,
      inflowTotal: { p0: 101325 * (1 + 0.2 * M * M) ** 3.5, t0: 288.15 * (1 + 0.2 * M * M) },
      lowMachPreconditioning: ENGINE,
    });
    s.setUniform({ rho: s.ref.rho, u: 0, v: 0, w: 0, p: 101325, z: 0 });
    // before D4-44: 3e-2 of the peak at 20000, wandering between 5e-3 and 0.17
    const conv = converge(s, 1e-5, 20000, 'peak');
    expect(conv.converged).toBe(true);
  }, 600_000);
});

// SOLVER.md 17 (W2S-I1, D5-2): with preconditioning, each face's eigenvalue in the local step is the
// larger of its two cells' preconditioned spectral radii. A cell at rest has beta = minMach and a
// step 1/minMach times its acoustic one; hot gas arriving through a face at 100-300 m/s crossed it
// at a Courant number of 5-50 (ladder L14: non-finite in one iteration).
describe('section 17: the local step takes both cells of every face (W2S-I1)', () => {
  const pocketMesh = () =>
    solverMesh(
      singleBlock(rectangle('duct', -0.04, 0.04, 0.3, 0.33, 8, 3), {
        imin: BC.INFLOW,
        imax: BC.OUTFLOW,
        jmin: BC.SLIP_WALL,
        jmax: BC.SLIP_WALL,
      }),
    );
  // cell (4, 1) hot (1500 K, Z 0.015) at -200 m/s at pressure equilibrium, the rest at rest
  const hot = (x: number, r: number) => Math.abs(x - 0.005) < 0.005 && Math.abs(r - 0.315) < 0.005;
  const start = (x: number, r: number) => {
    const T = hot(x, r) ? 1500 : 288.15;
    return {
      rho: 101325 / (287.05287 * T),
      u: hot(x, r) ? -200 : 0,
      v: 0,
      w: 0,
      p: 101325,
      z: hot(x, r) ? 0.015 : 0,
    };
  };
  const PRE = { minMach: 0.02, machCut: 0.02 } as const;

  it("is the neighbour state's own radius, its sound speed from its p', rho' and Z", () => {
    const ref = referenceState(THERMALLY_PERFECT, AMBIENT);
    const P = physicalToPrim(ref, { rho: 0.235, u: -200, v: 30, w: 0, p: 101325, z: 0.015 }, 0.3);
    const beta = 0.3;
    // the record's c is consToPrim's; the rule's comes from (p', rho', Z): the same to rounding
    const own = spectralRadius(-200 * 0.6 + 30 * 0.8, P[7] as number, beta * beta);
    expect(neighbourSpectralRadius(ref, P, 0, 0.6, 0.8, beta)).toBeCloseTo(own, 9);
    // a stored c is not read (a ghost's is don't-care, W2R-N2)
    const Q = Float64Array.from(P);
    Q[7] = 1e6;
    Q[6] = 1e6;
    expect(neighbourSpectralRadius(ref, Q, 0, 0.6, 0.8, beta)).toBe(
      neighbourSpectralRadius(ref, P, 0, 0.6, 0.8, beta),
    );
    expect(neighbourSpectralRadius(ref, P, 0, 1, 0, 1)).toBeCloseTo(200 + (P[7] as number), 9);
  });

  it("gives a cold cell at rest the hot neighbour's eigenvalue on their face", () => {
    const mesh = pocketMesh();
    const pre = new ReferenceSolver(mesh, {
      gas: THERMALLY_PERFECT,
      freeStream: AMBIENT,
      lowMachPreconditioning: PRE,
    });
    pre.setState(start);
    const dt = pre.localDt();
    const P = pre.primitives();
    const ref = pre.ref;
    // the rule, recomputed from the public parts: beta from lowMachBeta2 (dp from the face
    // neighbours' p'), the sum over the two directions of the larger b_f |S| radius of each face
    const betaOf = (e: number) => {
      const c = e < mesh.nCells ? e : (mesh.ghostSrc[e - mesh.nCells] ?? 0);
      let dp = 0;
      const i = c % 8;
      const j = Math.floor(c / 8);
      const p0 = P[NP * c + 4] as number;
      for (const [di, dj] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as const) {
        const ii = i + di;
        const jj = j + dj;
        if (ii < 0 || ii >= 8 || jj < 0 || jj >= 3) continue;
        dp = Math.max(dp, Math.abs((P[NP * (jj * 8 + ii) + 4] as number) - p0));
      }
      return Math.sqrt(
        lowMachBeta2(P, NP * c, mesh.cellR[c] as number, 0.02, dp, ref.rho + (P[NP * c] as number)),
      );
    };
    const cold = 1 * 8 + 3; // west of the hot cell (4, 1)
    const hotCell = 1 * 8 + 4;
    const f = mesh.blocks[0]?.iFaceOffset ?? 0;
    const east = f + 1 * 9 + 4;
    const radius = (c: number, nb: number, nx: number, nr: number) =>
      Math.max(
        spectralRadius(
          (P[NP * c + 1] as number) * nx + (P[NP * c + 2] as number) * nr,
          P[NP * c + 7] as number,
          betaOf(c) ** 2,
        ),
        neighbourSpectralRadius(ref, P, NP * nb, nx, nr, betaOf(nb)),
      );
    const lamE =
      (mesh.iArea[east] as number) *
      radius(cold, hotCell, mesh.iNx[east] as number, mesh.iNr[east] as number);
    const own =
      (mesh.iArea[east] as number) *
      spectralRadius(0, P[NP * cold + 7] as number, betaOf(cold) ** 2);
    // the hot cell's radius sets the cold cell's i-direction: its step is at least 15x shorter
    expect(lamE / own).toBeGreaterThan(15);
    const tau = (dt[cold] as number) / (mesh.cellVolR[cold] as number);
    const jS = (mesh.blocks[0]?.jFaceOffset ?? 0) + 1 * 8 + 3;
    const jN = jS + 8;
    const lamJ = Math.max(
      (mesh.jArea[jS] as number) *
        radius(cold, cold - 8, mesh.jNx[jS] as number, mesh.jNr[jS] as number),
      (mesh.jArea[jN] as number) *
        radius(cold, cold + 8, mesh.jNx[jN] as number, mesh.jNr[jN] as number),
    );
    const west = east - 1;
    const lamW =
      (mesh.iArea[west] as number) *
      radius(cold, cold - 1, mesh.iNx[west] as number, mesh.iNr[west] as number);
    expect(tau * (Math.max(lamW, lamE) + lamJ)).toBeCloseTo(DEFAULT_CFL_PRECONDITIONED, 12);
  });

  it("leaves the plain scheme and a slip wall face at the cell's own eigenvalue", () => {
    const mesh = pocketMesh();
    const plain = new ReferenceSolver(mesh, { gas: THERMALLY_PERFECT, freeStream: AMBIENT });
    plain.setState(start);
    const dt = plain.localDt();
    const P = plain.primitives();
    const cold = 1 * 8 + 3;
    const a = P[NP * cold + 7] as number;
    const f = mesh.blocks[0]?.iFaceOffset ?? 0;
    const jf = mesh.blocks[0]?.jFaceOffset ?? 0;
    const lamI = Math.max(mesh.iArea[f + 9 + 3] as number, mesh.iArea[f + 9 + 4] as number) * a;
    const lamJ = Math.max(mesh.jArea[jf + 8 + 3] as number, mesh.jArea[jf + 16 + 3] as number) * a;
    // the plain step is the cell's own |vn| + c (= c at rest) on every face
    expect(((dt[cold] as number) / (mesh.cellVolR[cold] as number)) * (lamI + lamJ)).toBeCloseTo(
      DEFAULT_CFL,
      12,
    );
    // a hot wall cell under cold gas: its wall ghost extrapolates rho' to 2 rho_0 - rho_1 < 0, a
    // state with no sound speed, so the wall face keeps the cell's own radius (and stays finite)
    const pre = new ReferenceSolver(mesh, {
      gas: THERMALLY_PERFECT,
      freeStream: AMBIENT,
      lowMachPreconditioning: PRE,
    });
    const wallHot = (x: number, r: number) => Math.abs(x - 0.005) < 0.005 && r < 0.31;
    pre.setState((x, r) => {
      const T = wallHot(x, r) ? 1500 : 288.15;
      return {
        rho: 101325 / (287.05287 * T),
        u: 0,
        v: 0,
        w: 0,
        p: 101325,
        z: wallHot(x, r) ? 0.015 : 0,
      };
    });
    const d0 = pre.localDt();
    expect(d0.every((d) => Number.isFinite(d) && d > 0)).toBe(true);
  });
});
