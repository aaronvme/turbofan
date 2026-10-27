// L1, reported (not gated; PHYSICS.md 3.3, SOLVER.md 12.3): uniform M 0.5 on the shipped asset,
// whose metrics are f32: what the f32 metrics alone cost, before any f32 arithmetic.
import { THRESHOLDS } from '../../../src/contracts/thresholds';
import { THERMALLY_PERFECT } from '../../../src/flow/reference/gas';
import { ReferenceSolver } from '../../../src/flow/reference/solver';
import { solverMeshFromFile, type SolverMesh } from '../../../src/flow/reference/solverMesh';
import { BC } from '../../../tools/mesh/types';
import { engineAsset, spuriousVelocity } from '../engine';

/** max over cells of |sum of the outward face vectors, x| / the cell's largest face area. */
function gclDefect(m: SolverMesh): number {
  let worst = 0;
  for (const b of m.blocks) {
    for (let j = 0; j < b.nj; j++) {
      for (let i = 0; i < b.ni; i++) {
        const w = b.iFaceOffset + j * (b.ni + 1) + i;
        const s = b.jFaceOffset + j * b.ni + i;
        const n = s + b.ni;
        const ix = (f: number) => (m.iNx[f] ?? NaN) * (m.iArea[f] ?? NaN);
        const jx = (f: number) => (m.jNx[f] ?? NaN) * (m.jArea[f] ?? NaN);
        const sum = -ix(w) + ix(w + 1) - jx(s) + jx(n);
        const scale = Math.max(
          m.iArea[w] ?? 0,
          m.iArea[w + 1] ?? 0,
          m.jArea[s] ?? 0,
          m.jArea[n] ?? 0,
        );
        worst = Math.max(worst, Math.abs(sum) / scale);
      }
    }
  }
  return worst;
}

export async function run() {
  const { file } = await engineAsset();
  const mesh = solverMeshFromFile(file);
  const fs = { pressure: 101325, temperature: 288.15, velocity: 0 };
  const probe = new ReferenceSolver(mesh, { gas: THERMALLY_PERFECT, freeStream: fs });
  const u = THRESHOLDS.L1.values.uniformFlowMach.value * probe.ref.c;
  const s = new ReferenceSolver(mesh, {
    gas: THERMALLY_PERFECT,
    freeStream: { ...fs, velocity: u },
    bcRemap: { [BC.SLIP_WALL]: BC.FARFIELD },
  });
  s.setUniform({ rho: s.ref.rho, u, v: 0, w: 0, p: fs.pressure, z: 0 });
  s.iterate(25);
  const v25 = spuriousVelocity(s);
  s.iterate(25);
  const v50 = spuriousVelocity(s);
  return {
    id: 'L1-uniform-f32-asset',
    rows: [
      {
        id: 'L1',
        metric: 'uniform M 0.5, shipped f32-metric asset: max |u - u_inf| after 50 its',
        threshold: `reported (L1 gate: < ${THRESHOLDS.L1.values.maxSpuriousVelocityMPerS.value} m/s)`,
        value: v50,
        pass: 'reported' as const,
      },
      {
        id: 'L1',
        metric: 'f32 asset GCL defect: max |sum S_x| / |S|',
        threshold: 'reported',
        value: gclDefect(mesh),
        pass: 'reported' as const,
      },
    ],
    extra: { v25, v50, residual: s.stats.residualDensityL2 },
  };
}
