// The GPU kernel against the f64 oracle (docs/SOLVER.md 12.2, W0G-N4): the same mesh (f32
// metrics), the same f32-representable initial state and options on both, several iterations,
// relative errors e_q = max_c |q_GPU - q_ref| / S_q (tests/ladder/oracle.ts, the shared set-ups
// the f32-storage experiment sized the table with; copied from w2/reference c1094fc). Row B (the
// 130k uniform flow) is in the GPU ladder (slow on the oracle's side).
//
// The oracle on this branch is main's reference; at c1094fc it differs only in the default CFL of
// preconditioned tracking (0.8, D4-32) and the smooth-limiter option, so the preconditioned rows
// pass the CFL explicitly and both runs use the sharp limiter.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { SimDevice } from '../../src/gpu/device';
import { GpuSolver, type GpuSolverOptions } from '../../src/flow/gpu/device/gpuSolver';
import { DEFAULT_CFL_PRECONDITIONED } from '../../src/flow/gpu/params';
import {
  THERMALLY_PERFECT,
  caloricallyPerfectGas,
  type GasModel,
} from '../../src/flow/reference/gas';
import { ReferenceSolver, type SolverOptions } from '../../src/flow/reference/solver';
import type { SolverMesh } from '../../src/flow/reference/solverMesh';
import type { SourceModel } from '../../src/flow/reference/sources';
import { NP, NU, type PhysicalState } from '../../src/flow/reference/state';
import {
  SINK,
  closedBoxMesh,
  closedBoxOptions,
  relativeError,
  sinkCase,
  smoothPerturbation,
} from '../ladder/oracle';
import { machFromArea, pOverP0, tOverT0 } from '../ladder/theory';
import { BC, rectangle, singleBlock, solverMesh } from '../unit/flow/helpers';
import {
  ENGINE_PRECONDITIONING_CUT,
  FLUX_SCALE_TOLERANCE,
  GpuErrorLog,
  shippedMesh,
  solverDevice,
} from './helpers/solver';

/** SOLVER.md 12.2 tolerances after 1 / 10 / 100 iterations (rows C, C-pre, C physical, S). */
const TOL = { 1: 1e-5, 10: 1e-4, 100: 1e-3 } as const;
/** Row D: L1 relative error of rho' and p' after 100 physical steps. */
const TOL_SOD = 1e-3;
/** Row E: blockage and source cell sets after 10 iterations. */
const TOL_E = 1e-4;
/** Any row: the density residual L2 within this relative difference of the oracle's. */
const TOL_RESIDUAL = 1e-3;
/**
 * Rows E-L5 and E-L9a: the residual difference over the flux scale (D4-48), at D4-62's tolerances
 * (ten times the GPU's measured error, SOLVER.md 12.2) with D4-71's E-L9a (W2R-I19: they replace
 * TOL_RESIDUAL and round 2's 1e-6 on these rows).
 */
const TOL_FLUX = FLUX_SCALE_TOLERANCE;

const CHECKPOINTS = [1, 10, 100] as const;

interface Pair {
  readonly gpu: GpuSolver;
  readonly ref: ReferenceSolver;
}

describe('GPU kernel against the f64 oracle (SOLVER.md 12.2)', () => {
  const log = new GpuErrorLog();
  let sim: SimDevice;

  beforeAll(async () => {
    sim = await solverDevice(log);
  });

  afterEach(() => {
    log.assertNone('oracle');
  });

  afterAll(() => {
    sim.destroy();
  });

  /** Both solvers on one mesh, the oracle's state rounded to f32 and copied to both. */
  async function pair(
    mesh: SolverMesh,
    options: SolverOptions,
    gpuExtra: Partial<GpuSolverOptions> = {},
    init?: (s: ReferenceSolver) => void,
  ): Promise<Pair> {
    const ref = new ReferenceSolver(mesh, options);
    init?.(ref);
    for (let k = 0; k < ref.U.length; k++) ref.U[k] = Math.fround(ref.U[k] ?? NaN);
    const gpu = await GpuSolver.create(sim.device, mesh, {
      gas: options.gas,
      freeStream: options.freeStream,
      ...(options.cfl === undefined ? {} : { cfl: options.cfl }),
      ...(options.inflowTotal === undefined ? {} : { inflowTotal: options.inflowTotal }),
      ...(options.outflowPressure === undefined
        ? {}
        : { outflowPressure: options.outflowPressure }),
      ...(options.lowMachPreconditioning === undefined
        ? {}
        : { lowMachPreconditioning: options.lowMachPreconditioning }),
      ...gpuExtra,
    });
    gpu.setBlockage(ref.blockage);
    gpu.setConserved(ref.U);
    return { gpu, ref };
  }

  async function error(p: Pair): Promise<number> {
    const P = await p.gpu.readPrimitives();
    return relativeError(P, p.ref.primitives(), p.ref.mesh.cellR, p.ref.ref.u);
  }

  async function residualError(p: Pair): Promise<number> {
    const g = await p.gpu.readResidual();
    const r = p.ref.stats.residualDensityL2;
    return Math.abs(g - r) / r;
  }

  /**
   * D4-48 (SOLVER.md 12.2, rows B and E): the density-residual difference over the flux scale
   * r_flux = sqrt(mean_c (sum_f |b_f F_f,rho| / (b_c V_c))^2), the residual's L2 with every face
   * flux counted positive: the oracle's own, in f64, at its current state (residualFluxScale,
   * every block; W2R-I15), not the residual itself.
   */
  async function fluxScaleError(p: Pair): Promise<number> {
    const g = await p.gpu.readResidual();
    return Math.abs(g - p.ref.stats.residualDensityL2) / p.ref.residualFluxScale();
  }

  /**
   * The oracle's density-residual L2, sqrt(mean_c (R_rho / (b V))^2) (section 11), of a given
   * conserved state U, in f64: a fresh oracle with the case's options and blockage evaluates R(U).
   */
  function oracleResidualL2(
    mesh: SolverMesh,
    options: SolverOptions,
    U: ArrayLike<number>,
    blockage?: Float64Array,
  ): number {
    const s = new ReferenceSolver(mesh, options);
    if (blockage !== undefined) s.setBlockage(blockage);
    s.U.set(U);
    const R = s.residual();
    let sum = 0;
    for (let c = 0; c < mesh.nCells; c++) {
      const q = (R[NU * c] ?? NaN) / ((s.blockage[c] ?? NaN) * (mesh.cellVolR[c] ?? NaN));
      sum += q * q;
    }
    return Math.sqrt(sum / mesh.nCells);
  }

  /** Tracking iterations to each checkpoint, comparing the fields and the residual. */
  async function trackingRows(p: Pair, label: string) {
    let done = 0;
    const out: Record<number, number> = {};
    for (const n of CHECKPOINTS) {
      p.ref.iterate(n - done);
      p.gpu.iterate(n - done);
      done = n;
      const e = await error(p);
      out[n] = e;
      expect(e, `${label} e_q after ${n}`).toBeLessThanOrEqual(TOL[n]);
      expect(await residualError(p), `${label} residual after ${n}`).toBeLessThanOrEqual(
        TOL_RESIDUAL,
      );
    }
    process.stdout.write(
      `[12.2] ${label}: ${CHECKPOINTS.map((n) => out[n]?.toExponential(2)).join(' / ')}\n`,
    );
    p.gpu.destroy();
    return out;
  }

  it('A: keeps the quiescent 130k ambient bitwise zero with preconditioned tracking', async () => {
    const mesh = await shippedMesh();
    // the GPU options named one by one (W2S-B-B1): the oracle's SolverOptions carries options
    // the kernel does not take (main's limiter, sources), so it is never spread into them
    const o = closedBoxOptions('preconditioned');
    const gpu = await GpuSolver.create(sim.device, mesh, {
      gas: o.gas,
      freeStream: o.freeStream,
      lowMachPreconditioning: ENGINE_PRECONDITIONING_CUT,
    });
    for (const n of [1, 99]) {
      gpu.iterate(n);
      const st = await gpu.readState();
      expect(st.every((v, k) => k % 8 >= 6 || v === 0)).toBe(true);
    }
    expect(await gpu.readResidual()).toBe(0);
    gpu.destroy();
  });

  it('C: plain tracking in the closed box (CFL 1.5)', async () => {
    const p = await pair(closedBoxMesh('f32'), closedBoxOptions('tracking'), {}, (s) => {
      s.setState(smoothPerturbation);
    });
    await trackingRows(p, 'C tracking');
  });

  it('C-pre: preconditioned tracking at the engine settings (D4-89: minMach = M_cut = 0.02)', async () => {
    const options = {
      ...closedBoxOptions('preconditioned'),
      lowMachPreconditioning: ENGINE_PRECONDITIONING_CUT,
      cfl: DEFAULT_CFL_PRECONDITIONED,
    };
    const p = await pair(closedBoxMesh('f32'), options, {}, (s) => {
      s.setState(smoothPerturbation);
    });
    await trackingRows(p, 'C-pre tracking');
  });

  // W2K-N1 (critic pass 16's mutant K4; the CPU's twin is precondition.test.ts's global M_cut
  // case, W2R-N31): a global M_cut >= 1 raises minMach to 1, which is the plain scheme (beta = 1,
  // f_a = 1) at the plain default CFL 1.5. The GPU, given the cut beside minMach 0.003 and no CFL,
  // runs row C's oracle (plain tracking, its own default CFL) within row C's tolerances. The CFL
  // switch read from the given minMach picks 0.8 and is off by the step's whole increment.
  it('C-cut: a global M_cut >= 1 is plain tracking (CFL 1.5) on the GPU', async () => {
    const p = await pair(
      closedBoxMesh('f32'),
      closedBoxOptions('tracking'),
      { lowMachPreconditioning: { minMach: 0.003, globalMachCut: 1 } },
      (s) => {
        s.setState(smoothPerturbation);
      },
    );
    expect(p.gpu.params.tracking[0]?.cfl).toBe(p.ref.trackingCfl);
    await trackingRows(p, 'C-cut tracking');
  });

  it('C: physical time (SSP-RK3 at the oracle dt)', async () => {
    const p = await pair(closedBoxMesh('f32'), closedBoxOptions('physical'), {}, (s) => {
      s.setState(smoothPerturbation);
    });
    let done = 0;
    const out: number[] = [];
    for (const n of CHECKPOINTS) {
      for (; done < n; done++) {
        const dt = p.ref.globalDt();
        p.ref.stepPhysical(dt);
        p.gpu.stepPhysical(dt);
      }
      const e = await error(p);
      out.push(e);
      expect(e, `C physical after ${n}`).toBeLessThanOrEqual(TOL[n]);
      expect(await residualError(p)).toBeLessThanOrEqual(TOL_RESIDUAL);
    }
    // the GPU's own CFL_phys dt of the same state agrees with the oracle's to f32 rounding
    const dtRef = p.ref.globalDt();
    expect(Math.abs((await p.gpu.globalDt()) / dtRef - 1)).toBeLessThan(1e-5);
    process.stdout.write(`[12.2] C physical: ${out.map((e) => e.toExponential(2)).join(' / ')}\n`);
    p.gpu.destroy();
  });

  it('D: the Sod tube (ladder L2 set-up), 100 physical steps', async () => {
    const GAMMA = 1.4;
    const RGAS = 287.05287;
    const mesh = solverMesh(
      singleBlock(rectangle('tube', 0, 1, 1.0, 1.1, 400, 2), {
        imin: BC.SLIP_WALL,
        imax: BC.SLIP_WALL,
        jmin: BC.SLIP_WALL,
        jmax: BC.SLIP_WALL,
      }),
      'f32',
    );
    const options: SolverOptions = {
      gas: caloricallyPerfectGas(GAMMA, RGAS),
      freeStream: { pressure: 1e5, temperature: 1e5 / RGAS, velocity: 0 },
    };
    const p = await pair(mesh, options, {}, (s) => {
      s.setState((x) => ({
        ...(x < 0.5 ? { rho: 1, p: 1e5 } : { rho: 0.125, p: 1e4 }),
        u: 0,
        v: 0,
        w: 0,
        z: 0,
      }));
    });
    for (let k = 0; k < 100; k++) {
      const dt = p.ref.globalDt();
      p.ref.stepPhysical(dt);
      p.gpu.stepPhysical(dt);
    }
    const G = await p.gpu.readPrimitives();
    const R = p.ref.primitives();
    for (const k of [0, 4]) {
      let diff = 0;
      let sum = 0;
      for (let c = 0; c < mesh.nCells; c++) {
        diff += Math.abs((G[NP * c + k] ?? NaN) - (R[NP * c + k] ?? NaN));
        sum += Math.abs(R[NP * c + k] ?? NaN);
      }
      process.stdout.write(
        `[12.2] D Sod L1(${k === 0 ? "rho'" : "p'"}): ${(diff / sum).toExponential(2)}\n`,
      );
      expect(diff / sum).toBeLessThanOrEqual(TOL_SOD);
    }
    p.gpu.destroy();
  });

  /** A 0.6 m annular duct (ladder L5 / L9a), inflow at total conditions, outflow pressure. */
  function duct(ni: number) {
    return solverMesh(
      singleBlock(rectangle('duct', -0.3, 0.3, 0.5, 0.6, ni, 4), {
        imin: BC.INFLOW,
        imax: BC.OUTFLOW,
        jmin: BC.SLIP_WALL,
        jmax: BC.SLIP_WALL,
      }),
      'f32',
    );
  }

  /** Ladder L5's blockage duct from its quasi-1D start, both solvers after 10 iterations. */
  async function l5Pair() {
    const GAMMA = 1.4;
    const RGAS = 287.05287;
    const P0 = 1e5;
    const T0 = 288.15;
    const B_MIN = 0.8;
    const b = (x: number) =>
      Math.abs(x) < 0.1 ? 1 - (1 - B_MIN) * Math.cos((Math.PI * x) / 0.2) ** 2 : 1;
    const mesh = duct(90);
    const options: SolverOptions = {
      gas: caloricallyPerfectGas(GAMMA, RGAS),
      freeStream: { pressure: P0, temperature: T0, velocity: 0 },
      inflowTotal: { p0: P0, t0: T0 },
      outflowPressure: 0.2 * P0,
    };
    const blockage = Float64Array.from(mesh.cellX, b);
    const p = await pair(mesh, options, {}, (s) => {
      s.setBlockage(blockage);
      s.setState((x): PhysicalState => {
        const M = machFromArea(b(x) / B_MIN, GAMMA, x > 0);
        const T = T0 * tOverT0(M, GAMMA);
        const pr = P0 * pOverP0(M, GAMMA);
        return {
          rho: pr / (RGAS * T),
          u: M * Math.sqrt(GAMMA * RGAS * T),
          v: 0,
          w: 0,
          p: pr,
          z: 0,
        };
      });
    });
    p.ref.iterate(10);
    p.gpu.iterate(10);
    /** The f64 density-residual L2 of a state (the oracle's evaluation). */
    const residualOf = (U: Float64Array) => oracleResidualL2(mesh, options, U, blockage);
    return { p, residualOf };
  }

  it('E: the L5 blockage row (10 iterations)', async () => {
    const { p, residualOf } = await l5Pair();
    const e = await error(p);
    process.stdout.write(`[12.2] E L5 blockage: ${e.toExponential(2)}
`);
    expect(e).toBeLessThanOrEqual(TOL_E);
    // D4-48: E's residual row divides by the flux scale. L5 starts at its quasi-1D solution, so
    // its residual is ~1e-4 of the face fluxes, and f32's 6e-8 on each flux is ~1e-3 of it: over
    // the residual itself (printed) the row was ill-posed. The oracle evaluating the GPU's state
    // and its own in f64 shows how much of that difference is the states'.
    const gpuState = residualOf(await p.gpu.readConserved());
    const refState = residualOf(Float64Array.from(p.ref.U));
    const ofStates = Math.abs(gpuState - refState) / refState;
    const own = await residualError(p);
    const scaled = await fluxScaleError(p);
    process.stdout.write(
      `[12.2] E L5 residual: / residual ${own.toExponential(2)} (the f64 residual of the two states ${ofStates.toExponential(2)}); / flux scale ${scaled.toExponential(2)}
`,
    );
    // the row of record at D4-62's 3e-7 (W2R-I19): r_flux / r_ref is ~4e4 here, so at D4-48's
    // 1e-3 the row could not see a residual off by its own size (W2R-I11), and round 2's 1e-6 is
    // subsumed (SOLVER.md 12.2)
    expect(scaled).toBeLessThanOrEqual(TOL_FLUX.E_L5);
    p.gpu.destroy();
  });

  it('E: the L9a rotor-disk source set (10 iterations)', async () => {
    const GAMMA = 1.4;
    const RGAS = 287.05287;
    const OMEGA = 300;
    const F_THETA = 3e4;
    const mesh = duct(60);
    const disk = Array.from({ length: mesh.nCells }, (_, c) => c).filter(
      (c) => Math.abs(mesh.cellX[c] ?? NaN) < 0.05,
    );
    const rotor: SourceModel = (ctx, out) => {
      for (const c of disk) {
        const rho = ctx.ref.rho + (ctx.prim[NP * c] ?? NaN);
        const sL = rho * (mesh.cellR[c] ?? NaN) * F_THETA;
        out.rate[6 * c + 3] = sL;
        out.rate[6 * c + 4] = OMEGA * sL;
      }
    };
    const gas: GasModel = caloricallyPerfectGas(GAMMA, RGAS);
    const options: SolverOptions = {
      gas,
      freeStream: { pressure: 1e5, temperature: 288.15, velocity: 0 },
      inflowTotal: { p0: 1e5, t0: 288.15 },
      outflowPressure: 0.95e5,
      sources: rotor,
    };
    const p = await pair(mesh, options, { cellSource: true }, (s) => {
      let M = 0.3;
      for (let k = 0; k < 60; k++)
        M -= (pOverP0(M, GAMMA) - 0.95) / ((pOverP0(M + 1e-7, GAMMA) - pOverP0(M, GAMMA)) / 1e-7);
      const T = 288.15 * tOverT0(M, GAMMA);
      s.setUniform({
        rho: 0.95e5 / (RGAS * T),
        u: M * Math.sqrt(GAMMA * RGAS * T),
        v: 0,
        w: 0,
        p: 0.95e5,
        z: 0,
      });
    });
    const aRho = new Float64Array(6 * mesh.nCells);
    for (const c of disk) {
      aRho[6 * c + 3] = (mesh.cellR[c] ?? NaN) * F_THETA;
      aRho[6 * c + 4] = OMEGA * (mesh.cellR[c] ?? NaN) * F_THETA;
    }
    p.gpu.setCellSource({ aRho });
    // The residual of record is the first stage's of iteration 10, i.e. R(U^9). Both solvers run 9
    // iterations, the GPU's own U^9 is read back (f32 copy + low part) and the oracle's residual of
    // it is evaluated in f64; then both run the 10th.
    p.ref.iterate(9);
    p.gpu.iterate(9);
    const u9Ref = Float64Array.from(p.ref.U);
    const ofGpuState = oracleResidualL2(mesh, options, await p.gpu.readConserved());
    const ofRefState = oracleResidualL2(mesh, options, u9Ref);
    const ofRoundedState = oracleResidualL2(mesh, options, u9Ref.map(Math.fround));
    p.ref.iterate(1);
    p.gpu.iterate(1);
    const e = await error(p);
    const own = await residualError(p);
    const rGpu = await p.gpu.readResidual();
    const rRef = p.ref.stats.residualDensityL2;
    const rFlux = p.ref.residualFluxScale();
    // the evaluation is the oracle's residual of record: on the oracle's own U^9 it gives the
    // stage-1 residual of its iteration 10 (measured: equal to the last bit; 1e-12 allows the f64
    // summation of the norm in another order)
    expect(Math.abs(ofRefState - rRef) / rRef).toBeLessThanOrEqual(1e-12);
    // W3S-I1 (critic pass 20, D5-6): the row of record is K2 = |r_GPU - L2 R_ref(U^9_GPU)| / r_flux,
    // the kernel's residual against the oracle's residual of the GPU's own state, at D4-71's 1e-10
    // unchanged (W2R-I19; D4-62's 3e-11 sat inside the f32 rounding of the norm, W2R-I17). The old
    // form |r_GPU - r_ref| / r_flux also holds the two states' drift: with the mirrored wall (D5-5)
    // rounding the oracle's own U^9 to f32 moves it by 1.94e-10 with no kernel in it (S3), and it
    // passes the critic's mutant W1g (the kernel's rho' extrapolated at the wall while the oracle
    // mirrors it: 3.34e-11), which K2 fails (1.66e-10; the adopted kernel 2.20e-11). Both printed.
    const kernel = Math.abs(rGpu - ofGpuState) / rFlux;
    const oldForm = Math.abs(rGpu - rRef) / rFlux;
    const floor = Math.abs(ofRoundedState - ofRefState) / rFlux;
    process.stdout.write(
      `[12.2] E L9a source: ${e.toExponential(2)}; residual / residual ${own.toExponential(2)}; / flux scale: K2 (the kernel against the oracle on the GPU's U^9) ${kernel.toExponential(3)}; reported: the old form |r_GPU - r_ref| ${oldForm.toExponential(3)}, S3 (the oracle's U^9 rounded to f32) ${floor.toExponential(3)}\n`,
    );
    expect(e).toBeLessThanOrEqual(TOL_E);
    // K2 over the flux scale at D4-71's 1e-10, and the residual form, which this case meets too
    expect(kernel).toBeLessThanOrEqual(TOL_FLUX.E_L9a);
    expect(own).toBeLessThanOrEqual(TOL_RESIDUAL);
    p.gpu.destroy();
  });

  it('S: ladder L8 sink, preconditioned tracking from rest (D4-89: minMach = M_cut = 0.02)', async () => {
    const sc = sinkCase(ENGINE_PRECONDITIONING_CUT, 'f32');
    const options = { ...sc.options, cfl: DEFAULT_CFL_PRECONDITIONED };
    const p = await pair(sc.mesh, options, { cellSource: true });
    const n = sc.mesh.nCells;
    const kMass = new Float64Array(n);
    const damping = new Float64Array(6 * n);
    for (const c of sc.sinkCells) {
      kMass[c] = SINK.k;
      for (let m = 0; m < 6; m++) damping[6 * c + m] = SINK.k;
    }
    p.gpu.setCellSource({ kMass, damping });
    await trackingRows(p, 'S sink');
  });

  // D5-5 (SOLVER.md 5): the slip-wall ghost mirrors rho' and Z (layer 1 the wall cell's, layer 2
  // the next cell's, i.e. each ghost's own source cell's) and keeps p', rw and the tangential
  // velocity extrapolated; the kernel's copy is exact, so it is checked bitwise against its own cells
  it("the slip-wall ghost mirrors rho' and Z and extrapolates p', rw and u, v as the oracle does", async () => {
    const mesh = duct(12);
    const options: SolverOptions = {
      gas: THERMALLY_PERFECT,
      freeStream: { pressure: 101325, temperature: 288.15, velocity: 0 },
      lowMachPreconditioning: ENGINE_PRECONDITIONING_CUT,
    };
    // radial gradients in every primitive, so extrapolating and mirroring differ at both walls
    const p = await pair(mesh, options, {}, (s) => {
      s.setState((x, r): PhysicalState => {
        const k = (r - 0.5) / 0.1;
        const pr = 101325 * (1 + 0.04 * k);
        const T = 288.15 + 600 * k * k + 20 * x;
        return {
          rho: pr / (287.05287 * T),
          u: 40 - 30 * k,
          v: 8 * k,
          w: 15 * k,
          p: pr,
          z: 0.015 * k,
        };
      });
    });
    const P = await p.gpu.readPrimitives();
    const R = p.ref.primitives();
    // each field's largest cell error of the kernel against the oracle (the f32 state's rounding)
    const cellErr = [0, 1, 2, 3, 4, 5].map((k) => {
      let m = 0;
      for (let c = 0; c < mesh.nCells; c++) {
        m = Math.max(m, Math.abs((P[NP * c + k] ?? NaN) - (R[NP * c + k] ?? NaN)));
      }
      return m;
    });
    let walls = 0;
    for (let g = 0; g < mesh.nGhosts; g++) {
      if (mesh.ghostBc[g] !== BC.SLIP_WALL) continue;
      walls++;
      const e = NP * (mesh.nCells + g);
      const src = NP * (mesh.ghostSrc[g] ?? 0);
      for (const k of [0, 5]) {
        expect(P[e + k], `ghost ${g} (layer ${mesh.ghostLayer[g]}) entry ${k}`).toBe(P[src + k]);
        expect(R[e + k]).toBe(R[src + k]);
      }
      // an extrapolated entry is a q0 - b q1 with a + b <= 5 (layer 2: 3 q0 - 2 q1), so its error is
      // at most 5 times its cells' plus the f32 rounding of the result
      for (const k of [1, 2, 3, 4]) {
        const d = Math.abs((P[e + k] ?? NaN) - (R[e + k] ?? NaN));
        const tol = 5 * (cellErr[k] ?? NaN) + 2 ** -22 * Math.abs(R[e + k] ?? NaN);
        expect(d, `ghost ${g} entry ${k}`).toBeLessThanOrEqual(tol);
      }
    }
    expect(walls).toBe(2 * 2 * 12);
    p.gpu.destroy();
  });

  // W3S-N4 (critic pass 20's mutant R2g): the kernel's slip-wall exclusion in the local step
  // (SOLVER.md 17; neighbourRadius returns 0 for a wall ghost, wb < 0), on the unit row's wall state
  // (precondition.test.ts, section 17): axial flow at 170 m/s (beta = M, 0.48-0.50, in every cell,
  // above dp / (rho c^2)), both wall rows at p_inf + 30 kPa and the rest at p_inf, so each wall
  // ghost (p' extrapolated, rho' mirrored) is 23 % hotter than its cell and its radius on the wall
  // face would set the cell's j term. T rises axially from 288.15 K by 30 K, so that T' has a scale:
  // at the unit row's uniform 288.15 K, T' stays within 1.8 K after one iteration and its e_q is the
  // f32 rounding of T (8.5e-6 K, 4.7e-6 of that scale). The kernel's stage-1 tau (stored with U)
  // is checked cell by cell against the oracle's, and the fields after the iteration, at row C's
  // one-iteration 1e-5 (measured: tau 1.2e-7, e_q 2.7e-7; with R2g, tau 5.5e-2 in the wall rows and
  // e_q 1.9e-2, where the moving duct's row was its only kill, at 1.45e-4 against 1e-4).
  it("the local step keeps a slip-wall face at the cell's own radius when its ghost's is larger (SOLVER.md 17)", async () => {
    const mesh = duct(12);
    const options: SolverOptions = {
      gas: THERMALLY_PERFECT,
      freeStream: { pressure: 101325, temperature: 288.15, velocity: 0 },
      lowMachPreconditioning: ENGINE_PRECONDITIONING_CUT,
      cfl: DEFAULT_CFL_PRECONDITIONED,
    };
    const wallRow = (r: number) => r < 0.525 || r > 0.575;
    const p = await pair(mesh, options, {}, (s) => {
      s.setState((x, r): PhysicalState => {
        const pr = wallRow(r) ? 131325 : 101325;
        const T = 288.15 + 30 * ((x + 0.3) / 0.6);
        return { rho: pr / (287.05287 * T), u: 170, v: 0, w: 0, p: pr, z: 0 };
      });
    });
    // the state has the property the exclusion is for: every wall ghost hotter than its cell by
    // more than a fifth (T from its own p' and rho'; Z = 0, so the air's R in both)
    const P0 = p.ref.primitives();
    const tOf = (e: number) =>
      (101325 + (P0[NP * e + 4] ?? NaN)) / (p.ref.ref.rho + (P0[NP * e] ?? NaN));
    let walls = 0;
    for (let g = 0; g < mesh.nGhosts; g++) {
      if (mesh.ghostBc[g] !== BC.SLIP_WALL || mesh.ghostLayer[g] !== 1) continue;
      walls++;
      expect(tOf(mesh.nCells + g) / tOf(mesh.ghostSrc[g] ?? 0)).toBeGreaterThan(1.2);
    }
    expect(walls).toBe(2 * 12);
    p.ref.iterate(1);
    p.gpu.iterate(1);
    const st = await p.gpu.readState();
    const dt = p.ref.localDt();
    let worstWall = 0;
    let worstRest = 0;
    for (let c = 0; c < mesh.nCells; c++) {
      const tauRef = (dt[c] ?? NaN) / ((p.ref.blockage[c] ?? NaN) * (mesh.cellVolR[c] ?? NaN));
      const d = Math.abs((st[8 * c + 6] ?? NaN) / tauRef - 1);
      if (wallRow(mesh.cellR[c] ?? NaN)) worstWall = Math.max(worstWall, d);
      else worstRest = Math.max(worstRest, d);
    }
    const e = await error(p);
    process.stdout.write(
      `[12.2] wall exclusion: tau kernel / oracle - 1, wall rows ${worstWall.toExponential(2)}, the rest ${worstRest.toExponential(2)}; e_q after 1 ${e.toExponential(2)}\n`,
    );
    // tau is the f32 evaluation of the same radii from the same f32 state and metrics (a few f32
    // roundings, ~1e-7), held at row C's one-iteration 1e-5
    expect(Math.max(worstWall, worstRest)).toBeLessThanOrEqual(TOL[1]);
    expect(e).toBeLessThanOrEqual(TOL[1]);
    p.gpu.destroy();
  });

  // W2S-N1: at p_out = p_inf the pOut uniform equals p_inf whatever the BC says (mutant A3g, `pOut:
  // ref.p`, survived every GPU test), so the row also runs at 0.98 p_inf, where the kernel's pOut
  // and pOutGauge both differ from the free stream's
  it.each([1, 0.98])(
    'the outflow’s backflow (SOLVER.md 5, W2S-B1) at p_out = %s p_inf: the inflow ghost at (p_out, T_inf), and the kernel follows the oracle (row C’s tolerances)',
    async (pOutRatio) => {
      // hot, fuelled, swirling gas flowing back in through the outflow (imax), preconditioned at the
      // engine's cut: every outflow ghost takes the backflow branch
      const mesh = duct(40);
      const options: SolverOptions = {
        gas: THERMALLY_PERFECT,
        freeStream: { pressure: 101325, temperature: 288.15, velocity: 0 },
        lowMachPreconditioning: ENGINE_PRECONDITIONING_CUT,
        ...(pOutRatio === 1 ? {} : { outflowPressure: pOutRatio * 101325 }),
      };
      const p = await pair(mesh, options, {}, (s) => {
        s.setState((x): PhysicalState => {
          const k = 0.5 * (1 + x / 0.3);
          // a 5 % wave: p' at the scale of the hot gas's terms rho R T' (a 0.5 % wave left e_q at 2.3e-5
          // after 1 iteration, plain and preconditioned alike, in interior cells: the f32 state's
          // rounding of a small p' among large thermal terms, not the boundary)
          const pr = 101325 * (1 + 0.05 * Math.cos((Math.PI * x) / 0.3));
          const T = 288.15 + 150 * k;
          return { rho: pr / (287.05287 * T), u: -30 * k, v: 0, w: 10 * k, p: pr, z: 0.02 * k };
        });
      });
      const P = await p.gpu.readPrimitives();
      const R = p.ref.primitives();
      let outflowGhosts = 0;
      for (let g = 0; g < mesh.nGhosts; g++) {
        if (mesh.ghostBc[g] !== BC.OUTFLOW) continue;
        outflowGhosts++;
        const e = NP * (mesh.nCells + g);
        // no swirl and no fuel come in: the ambient's, not the cell's
        expect(P[e + 3] === 0 && P[e + 5] === 0, `ghost ${g}: rw ${P[e + 3]}, Z ${P[e + 5]}`).toBe(
          true,
        );
        expect(R[e + 3] === 0 && R[e + 5] === 0).toBe(true);
        for (const k of [0, 1, 2, 4]) {
          expect(Math.abs((P[e + k] ?? NaN) - (R[e + k] ?? NaN))).toBeLessThan(
            1e-5 * Math.max(1, Math.abs(R[e + k] ?? NaN)),
          );
        }
      }
      expect(outflowGhosts).toBe(2 * 4);
      await trackingRows(p, `backflow at p_out ${pOutRatio} p_inf`);
      p.gpu.destroy();
    },
  );
});
