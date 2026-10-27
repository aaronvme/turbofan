// The shared set-ups of docs/SOLVER.md 12.2 (W2R-I2). Two suites import this module and must see
// the same numbers:
// - the f32-storage experiment (tests/ladder/cases/f32.ts), which sizes the tolerance table, and
// - w2/solver's GPU-against-oracle tests, which apply it.
// Each set-up returns the mesh (with the metric precision the row states) and the solver options;
// the caller starts both runs from the same f32-representable state (`setState`, then copy U).
import { THERMALLY_PERFECT } from '../../src/flow/reference/gas';
import type { SolverOptions } from '../../src/flow/reference/solver';
import type { SolverMesh } from '../../src/flow/reference/solverMesh';
import { massSourceRates, type SourceModel } from '../../src/flow/reference/sources';
import { NP, type PhysicalState } from '../../src/flow/reference/state';
import { BC, polarMesh, solverMesh, threeBlockRow } from '../unit/flow/helpers';
import { geometricGrowth } from './common';

/** The ambient at rest of the case C rows and of the sink. */
export const AMBIENT_AT_REST = { pressure: 101325, temperature: 288.15, velocity: 0 } as const;

/**
 * Case C's smooth perturbation: an acoustic pulse (rho' 4 %, p' 8 %) carrying axial, radial and
 * swirl velocity and a hot fuel-air spot (Z 0.03), centred at (0.3, 0.08) m, width sqrt(0.004) m.
 */
export function smoothPerturbation(x: number, r: number): PhysicalState {
  const g = Math.exp(-((x - 0.3) ** 2 + (r - 0.08) ** 2) / 0.004);
  return {
    rho: 1.225 * (1 + 0.04 * g),
    u: 20 * g,
    v: -10 * g,
    w: 60 * g * (r / 0.15),
    p: 101325 * (1 + 0.08 * g),
    z: 0.03 * g,
  };
}

/**
 * Case C's mesh: three wiggled blocks of 20 x 12 cells over [0, 0.6] x [0, 0.15] m with both
 * interface orientations (max/max and min/min), closed (slip walls left, right and top, the axis
 * below; decision D4-12, so the pulse stays in the domain). f32 metrics, as the GPU reads them.
 */
export function closedBoxMesh(precision: 'f32' | 'f64' = 'f32'): SolverMesh {
  return solverMesh(
    threeBlockRow(0.2, 0.15, 20, 12, {
      left: BC.SLIP_WALL,
      right: BC.SLIP_WALL,
      bottom: BC.AXIS,
      top: BC.SLIP_WALL,
    }),
    precision,
  );
}

/** The engine's low-Mach preconditioning: minMach = M_cut = 0.003 (SOLVER.md 7, machCut default). */
export const ENGINE_PRECONDITIONING = { minMach: 0.003 } as const;

/** The case C rows' options: tracking, preconditioned tracking (C-pre) or physical time. */
export function closedBoxOptions(mode: 'tracking' | 'preconditioned' | 'physical'): SolverOptions {
  return {
    gas: THERMALLY_PERFECT,
    freeStream: AMBIENT_AT_REST,
    ...(mode === 'preconditioned' ? { lowMachPreconditioning: ENGINE_PRECONDITIONING } : {}),
  };
}

/** Ladder L8's sink geometry: radii 0.05-2 m, 64 x 24 cells, sink k 225 1/s within 0.1 m. */
export const SINK = { rIn: 0.05, rOut: 2, nR: 64, nTheta: 24, k: 225, radius: 0.1 } as const;

/**
 * Ladder L8's set-up: the static point sink in ambient air at rest on the polar mesh (slip wall
 * inside, far field outside, the axis on both polar edges), a point-implicit sink s = -k U at the
 * local h0. `lowMachPreconditioning` as given (L8 uses minMach = M_cut = 0.003).
 */
export function sinkCase(
  lowMachPreconditioning?: SolverOptions['lowMachPreconditioning'],
  precision: 'f32' | 'f64' = 'f64',
): { mesh: SolverMesh; options: SolverOptions; sinkCells: number[]; growth: number } {
  const growth = geometricGrowth((SINK.rIn * Math.PI) / SINK.nTheta, SINK.rOut - SINK.rIn, SINK.nR);
  const mesh = solverMesh(
    polarMesh(SINK.rIn, SINK.rOut, SINK.nR, SINK.nTheta, growth, BC.SLIP_WALL, BC.FARFIELD),
    precision,
  );
  const radius = (c: number) => Math.hypot(mesh.cellX[c] ?? NaN, mesh.cellR[c] ?? NaN);
  const sinkCells = Array.from({ length: mesh.nCells }, (_, c) => c).filter(
    (c) => radius(c) < SINK.radius,
  );
  const sink: SourceModel = (ctx, out) => {
    for (const c of sinkCells) {
      const rho = ctx.ref.rho + (ctx.prim[NP * c] ?? NaN);
      massSourceRates(
        ctx.ref,
        ctx.prim,
        NP * c,
        mesh.cellR[c] ?? NaN,
        -SINK.k * rho,
        out.rate,
        6 * c,
      );
      for (let m = 0; m < 6; m++) out.damping[6 * c + m] = SINK.k;
    }
  };
  return {
    mesh,
    options: {
      gas: THERMALLY_PERFECT,
      freeStream: AMBIENT_AT_REST,
      sources: sink,
      ...(lowMachPreconditioning === undefined ? {} : { lowMachPreconditioning }),
    },
    sinkCells,
    growth,
  };
}

/**
 * The relative error of SOLVER.md 12.2: max over the fields of max_c |q_a - q_b| / S_q with the
 * perturbation scale S_q = max_c |q_b - q_inf| of the oracle run b. Fields: rho', the velocity
 * (u - u_inf, v, w with w = rw / r_c, one shared scale), p', Z and T'. Records of NP values per
 * cell (src/flow/reference/state.ts); cellR gives r_c and the cell count.
 */
export function relativeError(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  cellR: ArrayLike<number>,
  uInf: number,
): number {
  const fields = [[0], [1, 2, 3], [4], [5], [6]];
  let worst = 0;
  for (const group of fields) {
    let diff = 0;
    let scale = 0;
    for (let c = 0; c < cellR.length; c++) {
      const rc = cellR[c] ?? NaN;
      for (const k of group) {
        const qa = a[NP * c + k] ?? NaN;
        const qb = b[NP * c + k] ?? NaN;
        const inf = k === 1 ? uInf : 0;
        diff = Math.max(diff, Math.abs(k === 3 ? (qa - qb) / rc : qa - qb));
        scale = Math.max(scale, Math.abs((k === 3 ? qb / rc : qb) - inf));
      }
    }
    // a field the oracle leaves exactly unperturbed (Z of the sink) must stay exactly so: 0 or
    // infinitely wrong. A NaN anywhere (a diverged run) propagates through Math.max.
    worst = Math.max(worst, scale === 0 ? (diff === 0 ? 0 : Infinity) : diff / scale);
  }
  return worst;
}
