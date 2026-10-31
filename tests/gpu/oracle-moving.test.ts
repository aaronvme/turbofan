// The GPU kernel against the f64 oracle with a moving reference state, u_inf != 0 (W2S-A-I2,
// W2S-B-I1). Every row of oracle.test.ts runs at u_inf = 0, where the velocity-gauge terms of the
// ghosts (u = u_inf + u'), the preconditioned far field (vn_inf), the preconditioned increment
// (14.2 / 14.3) and the free stream's add-back (14.4: F_inf times the sum of b S_x over the flow
// faces) are all multiplied by zero, so their mutants survived the whole of test:gpu.
//
// - The ghosts: every BC's ghost records after the BCs against the oracle's, on unequal random
//   states (the direct check: a ghost is a few f32 operations, so it agrees to ~1e-7).
// - SOLVER.md 12.2-style rows (same protocol and tolerances as oracle.test.ts) on flows that move
//   with u_inf, so the gauge is the flow's own and f32 seeds no relative motion (B-N10):
//   a duct with far-field ends and a blockage bump (the add-back acts where sum b S_x != 0),
//   plain and preconditioned; ladder L5's blockage duct at u_inf 60 m/s (inflow and wall ghosts
//   in a moving gauge); the L8 sink at u_inf 20 m/s (the preconditioned far field's vn_inf).
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { SimDevice } from '../../src/gpu/device';
import { GpuSolver, type GpuSolverOptions } from '../../src/flow/gpu/device/gpuSolver';
import { DEFAULT_CFL_PRECONDITIONED } from '../../src/flow/gpu/params';
import { THERMALLY_PERFECT, caloricallyPerfectGas } from '../../src/flow/reference/gas';
import { ReferenceSolver, type SolverOptions } from '../../src/flow/reference/solver';
import type { SolverMesh } from '../../src/flow/reference/solverMesh';
import { NP, type PhysicalState } from '../../src/flow/reference/state';
import { SINK, relativeError, sinkCase } from '../ladder/oracle';
import { machFromArea, pOverP0, tOverT0 } from '../ladder/theory';
import { BC, rectangle, singleBlock, solverMesh } from '../unit/flow/helpers';
import { ENGINE_PRECONDITIONING_CUT, GpuErrorLog, solverDevice } from './helpers/solver';

/** SOLVER.md 12.2 tolerances after 1 / 10 / 100 iterations. */
const TOL = { 1: 1e-5, 10: 1e-4, 100: 1e-3 } as const;
/** Row E: 10 iterations. */
const TOL_E = 1e-4;
/** A ghost record against the oracle's, per component scale: f32 arithmetic is ~1e-7. */
const TOL_GHOST = 1e-5;

/** A deterministic LCG (Numerical Recipes), so the random states are the same on every run. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('GPU kernel against the oracle with u_inf != 0 (W2S-A-I2, W2S-B-I1)', () => {
  const log = new GpuErrorLog();
  let sim: SimDevice;

  beforeAll(async () => {
    sim = await solverDevice(log);
  });

  afterEach(() => {
    log.assertNone('oracle-moving');
  });

  afterAll(() => {
    sim.destroy();
  });

  /** Both solvers on one mesh, the oracle's state rounded to f32 and copied to both. */
  async function pair(
    mesh: SolverMesh,
    options: SolverOptions,
    init: (s: ReferenceSolver) => void,
    gpuExtra: Partial<GpuSolverOptions> = {},
  ) {
    const ref = new ReferenceSolver(mesh, options);
    init(ref);
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

  type Pair = Awaited<ReturnType<typeof pair>>;

  async function error(p: Pair): Promise<number> {
    return relativeError(
      await p.gpu.readPrimitives(),
      p.ref.primitives(),
      p.ref.mesh.cellR,
      p.ref.ref.u,
    );
  }

  /** Tracking iterations to 1 / 10 / 100, each checkpoint against TOL. */
  async function rows(p: Pair, label: string): Promise<void> {
    let done = 0;
    const out: string[] = [];
    for (const n of [1, 10, 100] as const) {
      p.ref.iterate(n - done);
      p.gpu.iterate(n - done);
      done = n;
      const e = await error(p);
      out.push(e.toExponential(2));
      expect(e, `${label} after ${n}`).toBeLessThanOrEqual(TOL[n]);
    }
    process.stdout.write(`[12.2 moving] ${label}: ${out.join(' / ')}\n`);
    p.gpu.destroy();
  }

  const U_INF = 100;
  const FREE = { pressure: 101325, temperature: 288.15, velocity: U_INF } as const;

  for (const cfg of [
    {
      name: 'plain: inflow, outflow, slip wall, far field',
      bcs: { imin: BC.INFLOW, imax: BC.OUTFLOW, jmin: BC.SLIP_WALL, jmax: BC.FARFIELD },
      r0: 0.5,
      pre: undefined,
    },
    {
      name: 'preconditioned: far field (beta_inf^2 = M_inf^2), outflow, axis',
      bcs: { imin: BC.FARFIELD, imax: BC.OUTFLOW, jmin: BC.AXIS, jmax: BC.FARFIELD },
      r0: 0,
      pre: ENGINE_PRECONDITIONING_CUT,
    },
  ]) {
    it(`fills every ghost as the oracle does at u_inf = ${U_INF} m/s (${cfg.name})`, async () => {
      const ni = 10;
      const nj = 8;
      const mesh = solverMesh(
        singleBlock(rectangle('g', 0, 1, cfg.r0, cfg.r0 + 1, ni, nj), cfg.bcs),
        'f32',
      );
      const options: SolverOptions = {
        gas: THERMALLY_PERFECT,
        freeStream: FREE,
        // subsonic inflow from totals above the free stream's; an outflow pressure 5 % below it
        inflowTotal: { p0: 1.1e5, t0: 300 },
        outflowPressure: 0.95 * FREE.pressure,
        ...(cfg.pre === undefined ? {} : { lowMachPreconditioning: cfg.pre }),
      };
      const next = rng(cfg.pre === undefined ? 11 : 12);
      const states: PhysicalState[] = [];
      for (let c = 0; c < mesh.nCells; c++) {
        // the outflow column spans vn < c/2, c/2 < vn < c and vn > c (the outflow switch)
        const outflowColumn = c % ni === ni - 1;
        states.push({
          rho: 1.225 * (1 + 0.3 * (next() - 0.5)),
          u: outflowColumn ? 40 + 420 * next() : U_INF + 120 * (next() - 0.5),
          v: 60 * (next() - 0.5),
          w: 80 * (next() - 0.5),
          p: FREE.pressure * (1 + 0.3 * (next() - 0.5)),
          z: next() < 0.4 ? 0 : 0.05 * next(),
        });
      }
      const p = await pair(mesh, options, (s) => {
        s.setState((_x, _r, c) => {
          const st = states[c];
          if (st === undefined) throw new Error(`no state for cell ${c}`);
          return st;
        });
      });
      const G = await p.gpu.readPrimitives();
      const R = p.ref.primitives();
      const ref = p.ref.ref;
      const scale = [ref.rho, 400, 400, 600, ref.p, 0.1, ref.t, ref.c];
      const worst: Record<number, number> = {};
      const seen = { slow: 0, between: 0, fast: 0 };
      for (let g = 0; g < mesh.nGhosts; g++) {
        const bc = mesh.ghostBc[g] ?? -1;
        const e = mesh.nCells + g;
        for (let k = 0; k < NP; k++) {
          const d = Math.abs((G[NP * e + k] ?? NaN) - (R[NP * e + k] ?? NaN)) / (scale[k] ?? NaN);
          worst[bc] = Math.max(worst[bc] ?? 0, Number.isNaN(d) ? Infinity : d);
        }
        if (bc === BC.OUTFLOW) {
          const s = NP * (mesh.ghostSrc[g] ?? 0);
          const vn = R[s + 1] ?? NaN; // n = +x at imax
          const cs = R[s + 7] ?? NaN;
          if (vn < cs / 2) seen.slow++;
          else if (vn < cs) seen.between++;
          else seen.fast++;
        }
      }
      process.stdout.write(
        `[ghosts u_inf ${U_INF}] ${cfg.name}: ${Object.entries(worst)
          .map(([bc, w]) => `bc ${bc} ${w.toExponential(2)}`)
          .join(', ')}; outflow vn < c/2 ${seen.slow}, < c ${seen.between}, > c ${seen.fast}\n`,
      );
      expect(Object.keys(worst).length).toBe(new Set(Object.values(cfg.bcs)).size);
      for (const [bc, w] of Object.entries(worst)) expect(w, `bc ${bc}`).toBeLessThan(TOL_GHOST);
      expect(Math.min(seen.slow, seen.between, seen.fast)).toBeGreaterThan(0);
      p.gpu.destroy();
    });
  }

  /**
   * A duct moving with the free stream: far-field ends, the axis below, a slip wall above, a
   * blockage bump in the middle (sum b S_x != 0 there, so the add-back acts) and a pulse with
   * swirl and fuel on top of u_inf.
   */
  function movingDuct() {
    const mesh = solverMesh(
      singleBlock(rectangle('duct', 0, 0.6, 0, 0.15, 48, 12), {
        imin: BC.FARFIELD,
        imax: BC.FARFIELD,
        jmin: BC.AXIS,
        jmax: BC.SLIP_WALL,
      }),
      'f32',
    );
    const b = (x: number) =>
      x > 0.15 && x < 0.45 ? 1 - 0.15 * Math.sin((Math.PI * (x - 0.15)) / 0.3) ** 2 : 1;
    const blockage = Float64Array.from(mesh.cellX, b);
    const rho = 101325 / (287.05287 * 288.15);
    const state = (x: number, r: number): PhysicalState => {
      const g = Math.exp(-((x - 0.3) ** 2 + (r - 0.08) ** 2) / 0.004);
      return {
        rho: rho * (1 + 0.04 * g),
        u: U_INF + 20 * g,
        v: -10 * g,
        w: 60 * g * (r / 0.15),
        p: 101325 * (1 + 0.08 * g),
        z: 0.03 * g,
      };
    };
    return { mesh, blockage, state };
  }

  it(`a duct moving with the free stream (u_inf ${U_INF} m/s, blockage): plain tracking`, async () => {
    const { mesh, blockage, state } = movingDuct();
    const p = await pair(mesh, { gas: THERMALLY_PERFECT, freeStream: FREE }, (s) => {
      s.setBlockage(blockage);
      s.setState(state);
    });
    await rows(p, `duct u_inf ${U_INF}, plain`);
  });

  it(`a duct moving with the free stream (u_inf ${U_INF} m/s, blockage): preconditioned`, async () => {
    const { mesh, blockage, state } = movingDuct();
    const options: SolverOptions = {
      gas: THERMALLY_PERFECT,
      freeStream: FREE,
      lowMachPreconditioning: ENGINE_PRECONDITIONING_CUT,
      cfl: DEFAULT_CFL_PRECONDITIONED,
    };
    const p = await pair(mesh, options, (s) => {
      s.setBlockage(blockage);
      s.setState(state);
    });
    await rows(p, `duct u_inf ${U_INF}, preconditioned`);
  });

  it('E-L5 at u_inf = 60 m/s: the inflow and slip-wall ghosts in a moving gauge (10 its)', async () => {
    const GAMMA = 1.4;
    const RGAS = 287.05287;
    const P0 = 1e5;
    const T0 = 288.15;
    const B_MIN = 0.8;
    const b = (x: number) =>
      Math.abs(x) < 0.1 ? 1 - (1 - B_MIN) * Math.cos((Math.PI * x) / 0.2) ** 2 : 1;
    const mesh = solverMesh(
      singleBlock(rectangle('duct', -0.3, 0.3, 0.5, 0.6, 90, 4), {
        imin: BC.INFLOW,
        imax: BC.OUTFLOW,
        jmin: BC.SLIP_WALL,
        jmax: BC.SLIP_WALL,
      }),
      'f32',
    );
    const options: SolverOptions = {
      gas: caloricallyPerfectGas(GAMMA, RGAS),
      freeStream: { pressure: P0, temperature: T0, velocity: 60 },
      inflowTotal: { p0: P0, t0: T0 },
      outflowPressure: 0.2 * P0,
    };
    const blockage = Float64Array.from(mesh.cellX, b);
    const p = await pair(mesh, options, (s) => {
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
    const G = await p.gpu.readPrimitives();
    const R = p.ref.primitives();
    const e = relativeError(G, R, mesh.cellR, p.ref.ref.u);
    let ghost = 0;
    for (let g = 0; g < mesh.nGhosts; g++) {
      if (mesh.ghostBc[g] !== BC.INFLOW) continue;
      const k = NP * (mesh.nCells + g) + 1;
      ghost = Math.max(ghost, Math.abs((G[k] ?? NaN) - (R[k] ?? NaN)) / 300);
    }
    process.stdout.write(
      `[12.2 moving] E-L5 u_inf 60: ${e.toExponential(2)}; inflow ghost u ${ghost.toExponential(2)}\n`,
    );
    expect(e).toBeLessThanOrEqual(TOL_E);
    expect(ghost).toBeLessThanOrEqual(TOL_GHOST);
    p.gpu.destroy();
  });

  it('S at u_inf = 20 m/s: the preconditioned far field with vn_inf != 0, and the sink', async () => {
    const sc = sinkCase(ENGINE_PRECONDITIONING_CUT, 'f32');
    const options: SolverOptions = {
      ...sc.options,
      freeStream: { ...sc.options.freeStream, velocity: 20 },
      cfl: DEFAULT_CFL_PRECONDITIONED,
    };
    const p = await pair(
      sc.mesh,
      options,
      (s) => {
        s.setUniform({ rho: s.ref.rho, u: 20, v: 0, w: 0, p: s.ref.p, z: 0 });
      },
      { cellSource: true },
    );
    const n = sc.mesh.nCells;
    const kMass = new Float64Array(n);
    const damping = new Float64Array(6 * n);
    for (const c of sc.sinkCells) {
      kMass[c] = SINK.k;
      for (let m = 0; m < 6; m++) damping[6 * c + m] = SINK.k;
    }
    p.gpu.setCellSource({ kMass, damping });
    await rows(p, 'S sink, u_inf 20');
  });
});
