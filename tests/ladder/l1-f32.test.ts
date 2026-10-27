// L1, reported (not gated; PHYSICS.md 3.3 CPU variants, SOLVER.md 12.3): uniform M 0.5 on the
// shipped asset, whose metrics are f32. The f64 oracle shows what the f32 metrics alone cost,
// before any f32 arithmetic: a cell's face vectors no longer sum to zero exactly.
import { describe, expect, it } from 'vitest';
import { THRESHOLDS } from '../../src/contracts/thresholds';
import { THERMALLY_PERFECT } from '../../src/flow/reference/gas';
import { ReferenceSolver } from '../../src/flow/reference/solver';
import { solverMeshFromFile, type SolverMesh } from '../../src/flow/reference/solverMesh';
import { BC } from '../../tools/mesh/types';
import { report } from './common';
import { engineAsset, spuriousVelocity } from './engine';

/** max over cells of |sum of outward face vectors, x| / max face area of the cell. */
function gclDefect(m: SolverMesh): number {
  let worst = 0;
  for (const b of m.blocks) {
    for (let j = 0; j < b.nj; j++) {
      for (let i = 0; i < b.ni; i++) {
        const w = b.iFaceOffset + j * (b.ni + 1) + i;
        const s = b.jFaceOffset + j * b.ni + i;
        const n = s + b.ni;
        const sx = (f: number, d: 'i' | 'j') =>
          d === 'i'
            ? (m.iNx[f] ?? NaN) * (m.iArea[f] ?? NaN)
            : (m.jNx[f] ?? NaN) * (m.jArea[f] ?? NaN);
        const sum = -sx(w, 'i') + sx(w + 1, 'i') - sx(s, 'j') + sx(n, 'j');
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

describe('L1, reported: uniform M 0.5 on the f32-metric asset', () => {
  it('measures the GCL defect and the spurious velocity it causes', async () => {
    const { file } = await engineAsset();
    const mesh = solverMeshFromFile(file);
    const defect = gclDefect(mesh);
    const probe = new ReferenceSolver(mesh, {
      gas: THERMALLY_PERFECT,
      freeStream: { pressure: 101325, temperature: 288.15, velocity: 0 },
    });
    const u = THRESHOLDS.L1.values.uniformFlowMach.value * probe.ref.c;
    const s = new ReferenceSolver(mesh, {
      gas: THERMALLY_PERFECT,
      freeStream: { pressure: 101325, temperature: 288.15, velocity: u },
      bcRemap: { [BC.SLIP_WALL]: BC.FARFIELD },
    });
    s.setUniform({ rho: s.ref.rho, u, v: 0, w: 0, p: 101325, z: 0 });
    s.iterate(25);
    const v25 = spuriousVelocity(s);
    s.iterate(25);
    const v50 = spuriousVelocity(s);
    report(
      'L1-uniform-f32-asset',
      [
        {
          id: 'L1',
          metric: 'uniform M 0.5 on the f32 asset: max |u - u_inf| after 50 its',
          threshold: `reported (L1: < ${THRESHOLDS.L1.values.maxSpuriousVelocityMPerS.value} m/s)`,
          value: v50,
          pass: 'reported',
        },
        {
          id: 'L1',
          metric: 'f32 asset GCL defect max |sum S_x| / |S|',
          threshold: 'reported',
          value: defect,
          pass: 'reported',
        },
      ],
      { v25, v50 },
    );
    expect(Number.isFinite(v50)).toBe(true);
  });
});
