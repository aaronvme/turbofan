// The f32-storage experiment behind docs/SOLVER.md 12.2: the oracle with its state rounded to f32
// after every stage, against the pure f64 oracle, from the same f32-representable start. It
// measures the storage part of the GPU's f32 error; the table's tolerances must sit at least 10x
// above it. The set-ups, the perturbation and the error metric come from tests/ladder/oracle.ts,
// which w2/solver's GPU-against-oracle tests import too (W2R-I2).
// - Case C: a smooth acoustic pulse with swirl and a hot fuel-air spot in a closed curvilinear
//   3-block box with both interface orientations (D4-12: in the first version, an open domain,
//   the pulse had left by 100 iterations and the error divided by a vanishing scale). Tracking,
//   preconditioned tracking (C-pre, the engine's mode: minMach = M_cut = 0.003) and physical time.
// - Case S: ladder L8's sink (source model, point-implicit damping, preconditioned far field, D4-20
//   at the cut), preconditioned like L8, from the ambient at rest.
import { ReferenceSolver, type SolverOptions } from '../../../src/flow/reference/solver';
import type { SolverMesh } from '../../../src/flow/reference/solverMesh';
import { NP } from '../../../src/flow/reference/state';
import type { LadderRow } from '../common';
import {
  ENGINE_PRECONDITIONING,
  closedBoxMesh,
  closedBoxOptions,
  relativeError,
  sinkCase,
  smoothPerturbation,
} from '../oracle';

const TOLERANCE: Readonly<Record<number, number>> = { 1: 1e-5, 10: 1e-4, 100: 1e-3 };

function storageRun(
  label: string,
  mesh: SolverMesh,
  options: SolverOptions,
  mode: 'tracking' | 'physical',
  init: (s: ReferenceSolver) => void,
  rows: LadderRow[],
  extra: Record<string, number>,
): void {
  const f32 = new ReferenceSolver(mesh, { ...options, storage: 'f32' });
  init(f32);
  // the f32 run's start is f32-representable; the oracle starts from the same numbers
  const r32 = Float32Array.from(f32.U);
  f32.U.set(r32);
  const f64 = new ReferenceSolver(mesh, options);
  f64.U.set(r32);
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
    const P = f64.primitives();
    const e = relativeError(f32.primitives(), P, mesh.cellR, f64.ref.u);
    const tol = TOLERANCE[N] ?? NaN;
    extra[`${label}-${N}`] = e;
    let pScale = 0;
    for (let c = 0; c < mesh.nCells; c++) pScale = Math.max(pScale, Math.abs(P[NP * c + 4] ?? NaN));
    extra[`${label}-${N}-pressureScale`] = pScale;
    extra[`${label}-${N}-residual`] = f64.stats.residualDensityL2;
    rows.push({
      id: 'SOLVER 12.2',
      metric: `${label}, f32 storage vs f64 after ${N}: max_q e_q`,
      threshold: `<= ${tol} / 10 (the kernel tolerance / 10)`,
      value: e,
      pass: e <= tol / 10,
    });
  }
}

export function run() {
  const rows: LadderRow[] = [];
  const extra: Record<string, number> = {};
  const box = closedBoxMesh();
  const pulse = (s: ReferenceSolver) => {
    s.setState((x, r) => smoothPerturbation(x, r));
  };
  storageRun('C tracking', box, closedBoxOptions('tracking'), 'tracking', pulse, rows, extra);
  storageRun(
    'C-pre tracking (minMach 0.003)',
    box,
    closedBoxOptions('preconditioned'),
    'tracking',
    pulse,
    rows,
    extra,
  );
  storageRun('C physical', box, closedBoxOptions('physical'), 'physical', pulse, rows, extra);
  const sink = sinkCase(ENGINE_PRECONDITIONING, 'f32');
  storageRun(
    'S sink (L8 set-up, minMach 0.003)',
    sink.mesh,
    sink.options,
    'tracking',
    () => undefined,
    rows,
    extra,
  );
  return { id: 'f32-storage', rows, extra };
}
