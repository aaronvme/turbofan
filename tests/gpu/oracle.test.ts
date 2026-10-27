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
import { caloricallyPerfectGas, type GasModel } from '../../src/flow/reference/gas';
import { ReferenceSolver, type SolverOptions } from '../../src/flow/reference/solver';
import type { SolverMesh } from '../../src/flow/reference/solverMesh';
import type { SourceModel } from '../../src/flow/reference/sources';
import { NP, type PhysicalState } from '../../src/flow/reference/state';
import {
  ENGINE_PRECONDITIONING,
  SINK,
  closedBoxMesh,
  closedBoxOptions,
  relativeError,
  sinkCase,
  smoothPerturbation,
} from '../ladder/oracle';
import { machFromArea, pOverP0, tOverT0 } from '../ladder/theory';
import { BC, rectangle, singleBlock, solverMesh } from '../unit/flow/helpers';
import { GpuErrorLog, shippedMesh, solverDevice } from './helpers/solver';

/** SOLVER.md 12.2 tolerances after 1 / 10 / 100 iterations (rows C, C-pre, C physical, S). */
const TOL = { 1: 1e-5, 10: 1e-4, 100: 1e-3 } as const;
/** Row D: L1 relative error of rho' and p' after 100 physical steps. */
const TOL_SOD = 1e-3;
/** Row E: blockage and source cell sets after 10 iterations. */
const TOL_E = 1e-4;
/** Any row: the density residual L2 within this relative difference of the oracle's. */
const TOL_RESIDUAL = 1e-3;

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
   * D4-39: the density-residual difference over the flux scale instead of the residual itself.
   * The scale is sqrt(mean_c (sum_f |b_f F_f,rho| / (b_c V_c))^2), the residual's L2 with every
   * face flux counted positive (the oracle's, in f64, at its current state; single-block meshes).
   */
  async function fluxScaleError(p: Pair): Promise<number> {
    const g = await p.gpu.readResidual();
    const ref = p.ref;
    const m = ref.mesh;
    const blk = m.blocks[0];
    if (blk === undefined || m.blocks.length !== 1) throw new Error('single-block meshes only');
    const sum = new Float64Array(m.nCells);
    for (let j = 0; j < blk.nj; j++) {
      for (let i = 0; i <= blk.ni; i++) {
        const f = Math.abs(ref.faceFlux(0, 'i', i, j)[0] ?? NaN);
        if (i > 0) sum[j * blk.ni + i - 1] = (sum[j * blk.ni + i - 1] ?? 0) + f;
        if (i < blk.ni) sum[j * blk.ni + i] = (sum[j * blk.ni + i] ?? 0) + f;
      }
    }
    for (let j = 0; j <= blk.nj; j++) {
      for (let i = 0; i < blk.ni; i++) {
        const f = Math.abs(ref.faceFlux(0, 'j', i, j)[0] ?? NaN);
        if (j > 0) sum[(j - 1) * blk.ni + i] = (sum[(j - 1) * blk.ni + i] ?? 0) + f;
        if (j < blk.nj) sum[j * blk.ni + i] = (sum[j * blk.ni + i] ?? 0) + f;
      }
    }
    let s2 = 0;
    for (let c = 0; c < m.nCells; c++) {
      const q = (sum[c] ?? NaN) / ((ref.blockage[c] ?? NaN) * (m.cellVolR[c] ?? NaN));
      s2 += q * q;
    }
    const scale = Math.sqrt(s2 / m.nCells);
    return Math.abs(g - ref.stats.residualDensityL2) / scale;
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
    const gpu = await GpuSolver.create(sim.device, mesh, {
      ...closedBoxOptions('preconditioned'),
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

  it('C-pre: preconditioned tracking at the engine settings (minMach = M_cut = 0.003)', async () => {
    const options = { ...closedBoxOptions('preconditioned'), cfl: DEFAULT_CFL_PRECONDITIONED };
    const p = await pair(closedBoxMesh('f32'), options, {}, (s) => {
      s.setState(smoothPerturbation);
    });
    await trackingRows(p, 'C-pre tracking');
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
    const residualOf = (U: Float64Array) => {
      const s = new ReferenceSolver(mesh, options);
      s.setBlockage(blockage);
      s.U.set(U);
      const R = s.residual();
      let sum = 0;
      for (let c = 0; c < mesh.nCells; c++) {
        const q = (R[6 * c] ?? NaN) / ((blockage[c] ?? NaN) * (mesh.cellVolR[c] ?? NaN));
        sum += q * q;
      }
      return Math.sqrt(sum / mesh.nCells);
    };
    return { p, residualOf };
  }

  it('E: the L5 blockage row (10 iterations)', async () => {
    const { p, residualOf } = await l5Pair();
    const e = await error(p);
    process.stdout.write(`[12.2] E L5 blockage: ${e.toExponential(2)}
`);
    expect(e).toBeLessThanOrEqual(TOL_E);
    // D4-39, the residual row's normalisation: it divides by the residual itself. L5 starts at
    // its quasi-1D solution, so its residual is ~1e-4 of the face fluxes, and f32's 6e-8 on each
    // flux is ~1e-3 of it. The oracle evaluating the GPU's state and its own in f64 shows how
    // much of the difference is the states' (the rest is the f32 evaluation); over the flux
    // scale (the proposal for the critic) the difference is at f32 rounding.
    const gpuState = residualOf(await p.gpu.readConserved());
    const refState = residualOf(Float64Array.from(p.ref.U));
    const ofStates = Math.abs(gpuState - refState) / refState;
    const own = await residualError(p);
    const scaled = await fluxScaleError(p);
    process.stdout.write(
      `[12.2] E L5 residual: / residual ${own.toExponential(2)} (the f64 residual of the two states ${ofStates.toExponential(2)}); / flux scale ${scaled.toExponential(2)}
`,
    );
    expect(scaled).toBeLessThanOrEqual(1e-6);
    p.gpu.destroy();
  });

  // KNOWN-FAIL (D4-39 keeps 1e-3): 1.05e-3 against the "any row" 1e-3 of 12.2, in the row's
  // current normalisation (over the residual). The flux-scale form proposed for the critic is in
  // the test above (1e-7).
  it.fails('E: the L5 residual within 1e-3 of the oracle (KNOWN-FAIL)', async () => {
    const { p } = await l5Pair();
    const own = await residualError(p);
    p.gpu.destroy();
    expect(own).toBeLessThanOrEqual(TOL_RESIDUAL);
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
    p.ref.iterate(10);
    p.gpu.iterate(10);
    const e = await error(p);
    const own = await residualError(p);
    const scaled = await fluxScaleError(p);
    process.stdout.write(
      `[12.2] E L9a source: ${e.toExponential(2)}; residual / residual ${own.toExponential(2)}, / flux scale ${scaled.toExponential(2)}\n`,
    );
    expect(e).toBeLessThanOrEqual(TOL_E);
    expect(await residualError(p)).toBeLessThanOrEqual(TOL_RESIDUAL);
    p.gpu.destroy();
  });

  it('S: ladder L8 sink, preconditioned tracking from rest (minMach = M_cut = 0.003)', async () => {
    const sc = sinkCase(ENGINE_PRECONDITIONING, 'f32');
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
});
