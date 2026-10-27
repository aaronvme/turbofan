// The f32-storage experiment behind docs/SOLVER.md 12.2: the oracle with its state rounded to f32
// after every stage, against the pure f64 oracle, from the same f32-representable start (case C: a
// smooth acoustic pulse with swirl and a hot fuel-air spot on a curvilinear 3-block mesh with every
// BC). It measures the storage part of the GPU's f32 error; the table's tolerances must sit at
// least 10x above it.
import { THERMALLY_PERFECT } from '../../../src/flow/reference/gas';
import { ReferenceSolver } from '../../../src/flow/reference/solver';
import { NP } from '../../../src/flow/reference/state';
import { BC, solverMesh, threeBlockRow } from '../../unit/flow/helpers';
import type { LadderRow } from '../common';

const TOLERANCE: Readonly<Record<number, number>> = { 1: 1e-5, 10: 1e-4, 100: 1e-3 };

function pulse(x: number, r: number) {
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

/** max over fields of max_c |q_a - q_b| / max_c |q_b - q_inf| (velocities share one scale). */
function relativeError(a: ReferenceSolver, b: ReferenceSolver): number {
  const Pa = a.primitives();
  const Pb = b.primitives();
  const n = a.mesh.nCells;
  const fields = [[0], [1, 2, 3], [4], [5], [6]];
  let worst = 0;
  for (const group of fields) {
    let diff = 0;
    let scale = 0;
    for (let c = 0; c < n; c++) {
      for (const k of group) {
        const qa = Pa[NP * c + k] ?? NaN;
        const qb = Pb[NP * c + k] ?? NaN;
        const inf = k === 1 ? b.ref.u : 0;
        const val = k === 3 ? qb / (b.mesh.cellR[c] ?? NaN) : qb;
        diff = Math.max(diff, Math.abs(k === 3 ? (qa - qb) / (b.mesh.cellR[c] ?? NaN) : qa - qb));
        scale = Math.max(scale, Math.abs(val - inf));
      }
    }
    worst = Math.max(worst, diff / scale);
  }
  return worst;
}

export function run() {
  const mesh = solverMesh(
    threeBlockRow(0.2, 0.15, 20, 12, {
      left: BC.INFLOW,
      right: BC.OUTFLOW,
      bottom: BC.AXIS,
      top: BC.FARFIELD,
    }),
  );
  const opts = {
    gas: THERMALLY_PERFECT,
    freeStream: { pressure: 101325, temperature: 288.15, velocity: 30 },
  };
  const rows: LadderRow[] = [];
  const extra: Record<string, number> = {};
  for (const mode of ['tracking', 'physical'] as const) {
    const f32 = new ReferenceSolver(mesh, { ...opts, storage: 'f32' });
    f32.setState((x, r) => pulse(x, r));
    const f64 = new ReferenceSolver(mesh, opts);
    f64.U.set(f32.U);
    const dt = f64.globalDt();
    let done = 0;
    for (const N of [1, 10, 100]) {
      for (; done < N; done++) {
        if (mode === 'tracking') {
          f32.iterate(1);
          f64.iterate(1);
        } else {
          f32.stepPhysical(dt);
          f64.stepPhysical(dt);
        }
      }
      const e = relativeError(f32, f64);
      const tol = TOLERANCE[N] ?? NaN;
      extra[`${mode}-${N}`] = e;
      rows.push({
        id: 'SOLVER 12.2',
        metric: `${mode}, f32 storage vs f64 after ${N}: max_q e_q`,
        threshold: `<= ${tol} / 10 (the kernel tolerance / 10)`,
        value: e,
        pass: e <= tol / 10,
      });
    }
  }
  return { id: 'f32-storage', rows, extra };
}
